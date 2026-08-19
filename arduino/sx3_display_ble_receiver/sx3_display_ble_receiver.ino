// =============================================================================
//  VanMoof SX3 Display - BLE Image Receiver (ESP32-C3)
// =============================================================================
//
//  Receives images and animations over Bluetooth Low Energy and plays them
//  on the SX3 display. The companion sender is the web editor in /editor/
//  (built-in "Send via BLE…" button).
//
//  Protocol (BLE GATT)
//  -------------------
//  Service UUID:    6e400001-c352-11e6-9598-0800200c9a66      ("SX3 service")
//  RX char (write): 6e400002-...    receives image bytes from the browser
//  TX char (notify):6e400003-...    sends acknowledgements/errors back
//
//  Each transfer is a sequence of frames written to RX:
//    [0x01]  hdr_len_u16  total_len_u32  crc_u16            <- START header
//    [0x02]  seq_u16      bytes...                          <- DATA chunk
//    [0x02]  seq_u16      bytes...
//    ...
//    [0x03]                                                 <- END marker
//  After receiving END the ESP verifies the CRC, parses the image, and starts
//  playing it. Every chunk gets an ACK back over TX:
//    [0xA0] seq_u16    chunk OK
//    [0xA1] code_u8    error (1=too_big, 2=crc, 3=invalid_header, ...)
//    [0xA2]            transfer complete, playback started
//
//  The actual image bytes inside the transfer are exactly the same container
//  format as the gallery sketch / editor export (see guide/README.md, section 4).
//
//  Required Arduino libraries:
//    - "ESP32 BLE Arduino" (ships with the ESP32 board package; no extra install)
//  Board: ESP32-C3 Dev Module (or "ESP32C3 Super Mini")
//  Tools -> USB CDC On Boot: Enabled
// =============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ----- pinout (same as gallery sketch) ---------------------------------------
#define PIN_SDA       4
#define PIN_SCL       3
#define PIN_SDB       2
#define I2C_FREQ_HZ   400000

#define ADDR_LEFT     0x30
#define ADDR_RIGHT    0x33

#define ROWS          20
#define COLS           9

// ----- BLE UUIDs -------------------------------------------------------------
#define SERVICE_UUID  "6e400001-c352-11e6-9598-0800200c9a66"
#define RX_CHAR_UUID  "6e400002-c352-11e6-9598-0800200c9a66"
#define TX_CHAR_UUID  "6e400003-c352-11e6-9598-0800200c9a66"

// ----- protocol opcodes ------------------------------------------------------
static const uint8_t OP_START = 0x01;
static const uint8_t OP_DATA  = 0x02;
static const uint8_t OP_END   = 0x03;

static const uint8_t ACK_CHUNK    = 0xA0;
static const uint8_t ACK_ERROR    = 0xA1;
static const uint8_t ACK_COMPLETE = 0xA2;

static const uint8_t ERR_TOO_BIG       = 1;
static const uint8_t ERR_CRC           = 2;
static const uint8_t ERR_INVALID_HEAD  = 3;
static const uint8_t ERR_PROTOCOL      = 4;
static const uint8_t ERR_PARSE         = 5;

// ----- framebuffer + display driver ------------------------------------------
uint8_t fbLeft[150];
uint8_t fbRight[150];

const uint8_t LUT[8] = { 0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF };

static uint8_t w(uint8_t a, uint8_t r, uint8_t v) {
  Wire.beginTransmission(a);
  Wire.write(r); Wire.write(v);
  return Wire.endTransmission();
}
static void writeRegBlock(uint8_t a, uint8_t startReg, const uint8_t* d, int len) {
  const int CHUNK = 24;
  int i = 0;
  while (i < len) {
    int n = (len - i < CHUNK) ? (len - i) : CHUNK;
    Wire.beginTransmission(a);
    Wire.write(startReg + i);
    for (int k = 0; k < n; k++) Wire.write(d[i + k]);
    Wire.endTransmission();
    i += n;
  }
}
static void initController(uint8_t a) {
  w(a, 0xFE, 0xC5); w(a, 0xFD, 0x04);
  w(a, 0x00, 0x41); w(a, 0x01, 0x80);
  w(a, 0xFE, 0xC5); w(a, 0xFD, 0x02);
  uint8_t ff[150]; memset(ff, 0xFF, sizeof(ff));
  writeRegBlock(a, 0x00, ff, 150);
  w(a, 0xFE, 0xC5); w(a, 0xFD, 0x00);
}
static void displayPush() {
  writeRegBlock(ADDR_LEFT,  0x00, fbLeft,  150);
  writeRegBlock(ADDR_RIGHT, 0x00, fbRight, 150);
}
static void clearFB() {
  memset(fbLeft,  0, sizeof(fbLeft));
  memset(fbRight, 0, sizeof(fbRight));
}
static void ledSet(int row, int col, uint8_t pwm) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
  if (col < 5) {
    int off = (4 - col) * 30 + row;
    if (off >= 0 && off < 150) fbLeft[off] = pwm;
  } else {
    int off = (9 - col) * 30 + row;
    if (off >= 0 && off < 150) fbRight[off] = pwm;
  }
}

// ----- image container handling ----------------------------------------------
// Max image we'll accept. The receive buffer lives in heap and is malloc'd to
// the exact image size, so this is only a sanity cap — the ESP32 has plenty of
// heap. 64 KB fits very long animations (~750+ full-height frames).
#define MAX_IMAGE_BYTES   65536

uint8_t* g_imageBuf = nullptr;       // dynamically allocated, kept across plays
size_t   g_imageLen = 0;             // valid bytes in g_imageBuf
volatile bool g_haveImage = false;

// Render one frame of the current image to the framebuffer.
// Container layout: see guide/README.md, section 4
//   words 0..2: start_row, graphic_rows, num_frames (u32 LE)
//   words 3..3+nf-1: per-frame durations (u32 LE)
//   then per-row: nf packed pixel words, each containing 9 columns x 3 bits.
static void renderFrameToFB(uint8_t frameIdx) {
  if (!g_imageBuf || g_imageLen < 16) return;
  uint32_t* wbuf = (uint32_t*)g_imageBuf;
  uint32_t start_row    = wbuf[0];
  uint32_t graphic_rows = wbuf[1];
  uint32_t num_frames   = wbuf[2];
  if (frameIdx >= num_frames) return;

  clearFB();
  for (uint32_t rel = 0; rel < graphic_rows; rel++) {
    uint32_t wordIdx = num_frames * rel + frameIdx + num_frames + 3;
    if ((wordIdx + 1) * 4 > g_imageLen) break;       // truncated
    uint32_t word = wbuf[wordIdx];
    uint8_t absRow = start_row + rel;
    if (absRow >= ROWS) continue;
    for (int c = 0; c < COLS; c++) {
      uint8_t inten = (word >> (24 - 3*c)) & 0x7;
      ledSet(absRow, c, LUT[inten]);
    }
  }
  displayPush();
}

// ----- playback state --------------------------------------------------------
static uint32_t g_lastSwitchMs = 0;
static uint8_t  g_curFrame     = 0;
static uint32_t g_curDuration  = 100;

// Play loop helper, called from the main loop. Cycles through frames according
// to their per-frame durations.
static void playStep() {
  if (!g_haveImage || !g_imageBuf || g_imageLen < 16) return;
  uint32_t* wbuf = (uint32_t*)g_imageBuf;
  uint32_t num_frames = wbuf[2];
  if (num_frames == 0) return;
  if (g_curFrame >= num_frames) g_curFrame = 0;

  uint32_t now = millis();
  if (now - g_lastSwitchMs >= g_curDuration) {
    g_curFrame++;
    if (g_curFrame >= num_frames) g_curFrame = 0;
    g_curDuration = wbuf[3 + g_curFrame];
    if (g_curDuration < 10) g_curDuration = 100;     // clamp implausible values
    renderFrameToFB(g_curFrame);
    g_lastSwitchMs = now;
  }
}

// Called when a brand new image arrives; resets the player and renders frame 0
// immediately so the user sees the result without waiting a frame.
static void startPlayback() {
  if (!g_imageBuf || g_imageLen < 16) return;
  uint32_t* wbuf = (uint32_t*)g_imageBuf;
  uint32_t num_frames = wbuf[2];
  if (num_frames == 0) return;
  g_curFrame = 0;
  g_curDuration = wbuf[3 + 0];
  if (g_curDuration < 10) g_curDuration = 100;
  renderFrameToFB(0);
  g_lastSwitchMs = millis();
}

// ----- BLE transfer state machine --------------------------------------------
// Receive buffer for the *current* transfer. When complete and valid, its
// contents are moved into g_imageBuf for playback.
static uint8_t* rxBuf = nullptr;
static size_t   rxCap = 0;
static size_t   rxLen = 0;
static uint16_t rxExpectedSeq = 0;
static uint32_t rxExpectedLen = 0;
static uint16_t rxExpectedCrc = 0;
static bool     rxActive = false;

static BLECharacteristic* txChar = nullptr;
static bool deviceConnected = false;

// CRC-16-CCITT-FALSE for transfer integrity. Browser uses the same.
static uint16_t crc16(const uint8_t* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= ((uint16_t)data[i]) << 8;
    for (int b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
  }
  return crc;
}

static void sendAck(uint8_t op, uint16_t seqOrCode) {
  if (!txChar) return;
  uint8_t buf[3];
  buf[0] = op;
  buf[1] = (uint8_t)(seqOrCode & 0xFF);
  buf[2] = (uint8_t)((seqOrCode >> 8) & 0xFF);
  txChar->setValue(buf, 3);
  txChar->notify();
}
static void sendError(uint8_t code) {
  if (!txChar) return;
  uint8_t buf[2] = { ACK_ERROR, code };
  txChar->setValue(buf, 2);
  txChar->notify();
}
static void sendComplete() {
  if (!txChar) return;
  uint8_t buf[1] = { ACK_COMPLETE };
  txChar->setValue(buf, 1);
  txChar->notify();
}

// Reset receive buffer for a new transfer. `expectedLen` is image bytes only.
static bool rxBegin(uint32_t expectedLen, uint16_t expectedCrc) {
  if (expectedLen > MAX_IMAGE_BYTES) return false;
  if (rxCap < expectedLen) {
    if (rxBuf) free(rxBuf);
    rxBuf = (uint8_t*)malloc(expectedLen);
    if (!rxBuf) { rxCap = 0; return false; }
    rxCap = expectedLen;
  }
  rxLen = 0;
  rxExpectedSeq = 0;
  rxExpectedLen = expectedLen;
  rxExpectedCrc = expectedCrc;
  rxActive = true;
  Serial.printf("[BLE] START: expecting %u bytes, CRC %04X\n", expectedLen, expectedCrc);
  return true;
}

// Append chunk data. Returns true on success.
static bool rxData(uint16_t seq, const uint8_t* data, size_t len) {
  if (!rxActive) return false;
  if (seq != rxExpectedSeq) {
    Serial.printf("[BLE] seq mismatch: got %u, expected %u\n", seq, rxExpectedSeq);
    return false;
  }
  if (rxLen + len > rxExpectedLen) {
    Serial.printf("[BLE] overflow: have %u, +%u > %u\n",
                  (unsigned)rxLen, (unsigned)len, (unsigned)rxExpectedLen);
    return false;
  }
  memcpy(rxBuf + rxLen, data, len);
  rxLen += len;
  rxExpectedSeq++;
  return true;
}

// Finalize transfer. Validates CRC and total length, then moves the buffer
// into g_imageBuf and starts playback.
static bool rxEnd() {
  if (!rxActive) return false;
  rxActive = false;
  if (rxLen != rxExpectedLen) {
    Serial.printf("[BLE] END: short (%u of %u)\n",
                  (unsigned)rxLen, (unsigned)rxExpectedLen);
    return false;
  }
  uint16_t actualCrc = crc16(rxBuf, rxLen);
  if (actualCrc != rxExpectedCrc) {
    Serial.printf("[BLE] CRC fail: got %04X, expected %04X\n",
                  actualCrc, rxExpectedCrc);
    return false;
  }
  // Sanity-check header before committing.
  if (rxLen < 12) { Serial.println("[BLE] image too small"); return false; }
  uint32_t* wbuf = (uint32_t*)rxBuf;
  uint32_t start_row = wbuf[0], graphic_rows = wbuf[1], num_frames = wbuf[2];
  if (start_row >= ROWS || graphic_rows == 0 || graphic_rows > ROWS ||
      start_row + graphic_rows > ROWS || num_frames == 0 || num_frames > 1000) {
    Serial.println("[BLE] invalid image header");
    return false;
  }
  uint32_t expected = 4 * (3 + num_frames + num_frames * graphic_rows);
  if (rxLen < expected) {
    Serial.printf("[BLE] image truncated: have %u, need %u\n",
                  (unsigned)rxLen, (unsigned)expected);
    return false;
  }

  // Swap into the playback slot.
  if (g_imageBuf) free(g_imageBuf);
  g_imageBuf = rxBuf;
  g_imageLen = rxLen;
  rxBuf = nullptr; rxCap = 0; rxLen = 0;       // rxBuf reallocated next time
  g_haveImage = true;

  Serial.printf("[BLE] image OK: start_row=%u, graphic_rows=%u, num_frames=%u (%u bytes)\n",
                start_row, graphic_rows, num_frames, (unsigned)g_imageLen);

  startPlayback();
  return true;
}

// ----- BLE callbacks ---------------------------------------------------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("[BLE] client connected");
  }
  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    rxActive = false;
    Serial.println("[BLE] client disconnected; advertising again");
    BLEDevice::startAdvertising();
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* ch) override {
    String value = ch->getValue();
    if (value.length() == 0) return;
    const uint8_t* p = (const uint8_t*)value.c_str();
    size_t n = value.length();
    uint8_t op = p[0];
    switch (op) {
      case OP_START: {
        // [0x01] total_len_u32  crc_u16    (7 bytes total)
        if (n < 7) { sendError(ERR_PROTOCOL); return; }
        uint32_t totalLen = (uint32_t)p[1] | ((uint32_t)p[2] << 8) |
                           ((uint32_t)p[3] << 16) | ((uint32_t)p[4] << 24);
        uint16_t crc = (uint16_t)p[5] | ((uint16_t)p[6] << 8);
        if (!rxBegin(totalLen, crc)) {
          sendError(ERR_TOO_BIG);
          return;
        }
        sendAck(ACK_CHUNK, 0xFFFF);  // 0xFFFF = "start accepted"
        return;
      }
      case OP_DATA: {
        // [0x02] seq_u16 bytes...
        if (n < 3) { sendError(ERR_PROTOCOL); return; }
        uint16_t seq = (uint16_t)p[1] | ((uint16_t)p[2] << 8);
        if (!rxData(seq, p + 3, n - 3)) {
          sendError(ERR_PROTOCOL);
          return;
        }
        sendAck(ACK_CHUNK, seq);
        return;
      }
      case OP_END: {
        if (rxEnd()) {
          sendComplete();
        } else {
          sendError(rxExpectedCrc ? ERR_CRC : ERR_PARSE);
        }
        return;
      }
      default:
        sendError(ERR_PROTOCOL);
        return;
    }
  }
};

// =============================================================================
//  setup / loop
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== SX3 BLE Receiver ===");

  // ---- display init -----
  pinMode(PIN_SDB, OUTPUT);
  digitalWrite(PIN_SDB, LOW);  delay(20);
  digitalWrite(PIN_SDB, HIGH); delay(50);

  Wire.begin(PIN_SDA, PIN_SCL, I2C_FREQ_HZ);
  initController(ADDR_LEFT);
  initController(ADDR_RIGHT);
  clearFB(); displayPush();

  // Small "ready" indicator: 3 dots in the middle row.
  for (int c = 3; c <= 5; c++) ledSet(9, c, 0x20);
  displayPush();

  // ---- BLE init -----
  BLEDevice::init("SX3 Display");
  // Try to request a larger MTU when negotiation happens.
  BLEDevice::setMTU(247);

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* rxChar = service->createCharacteristic(
      RX_CHAR_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rxChar->setCallbacks(new RxCallbacks());

  txChar = service->createCharacteristic(
      TX_CHAR_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("Advertising as 'SX3 Display'. Connect from the web editor.");
}

void loop() {
  if (g_haveImage) {
    playStep();
  }
  delay(2);
}
