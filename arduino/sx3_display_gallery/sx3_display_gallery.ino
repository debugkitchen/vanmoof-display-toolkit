// =============================================================================
//  VanMoof SX3 LED Matrix Display - Full Image Gallery (ESP32-C3)
// =============================================================================
//
//  Rotates through ALL 54 images extracted from the original VanMoof firmware
//  (mainware_1_9_3.bin). Each image plays through completely (animations at
//  their real per-frame durations from the image header), followed by a 1 s
//  black pause, then the next image. Loops forever. The current image name
//  is printed to Serial.
//
//  Image names match editor/gallery/firmware_gallery.json (the web editor's
//  gallery) -- both are generated from the same extraction pass.
//
//  Everything (init sequence, page logic, buffer mapping, frame-interleaved
//  image layout) was verified against the firmware machine code and a full
//  300-offset physical calibration scan of the panel.
//
//  Hardware: ESP32-C3 SuperMini <-> SX3 daughterboard (6 wires)
//    Ribbon 1 SDA->GPIO4, 2 SCL->GPIO3, 3 5V->5V, 4 GND->GND,
//    6 3V3->3V3, 7 SDB->GPIO2.  (Ribbon 5/8 unconnected.)
//  Requires: Tools -> USB CDC On Boot -> Enabled.
//  External pull-ups 4.7k SDA->3V3 and SCL->3V3 if the daughterboard lacks them.
//
//  Files: this .ino + sx3_images_all.h (in the same sketch folder).
// =============================================================================

#include <Wire.h>
#include "sx3_images_all.h"

#define PIN_SDA       4
#define PIN_SCL       3
#define PIN_SDB       2
#define I2C_FREQ_HZ   400000

#define ADDR_LEFT     0x30      // 7-bit (firmware 8-bit notation: 0x60)
#define ADDR_RIGHT    0x33      // 7-bit (0x66)

#define ROWS          20
#define COLS           9

#define BLACK_PAUSE_MS   1000   // black display between images
#define MAX_LOOP_MS     12000   // cap very long animations per gallery pass

uint8_t fbLeft[150];
uint8_t fbRight[150];

// 3-bit intensity -> 8-bit PWM. Exact firmware LUT @ 0x08042372.
const uint8_t LUT[8] = { 0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF };

// ---- I2C ----
static uint8_t w(uint8_t a, uint8_t r, uint8_t v) {
  Wire.beginTransmission(a);
  Wire.write(r); Wire.write(v);
  return Wire.endTransmission();
}

static void writeRegBlock(uint8_t a, uint8_t startReg,
                          const uint8_t* d, int len) {
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

// Machine-code-verified init: Function page(0x04) Config/Current,
// Scaling page(0x02) all 0xFF, leave PWM page(0x00) active for pushes.
static void initController(uint8_t a) {
  w(a, 0xFE, 0xC5);
  w(a, 0xFD, 0x04);
  w(a, 0x00, 0x41);
  w(a, 0x01, 0x80);
  w(a, 0xFE, 0xC5);
  w(a, 0xFD, 0x02);
  uint8_t ff[150];
  memset(ff, 0xFF, sizeof(ff));
  writeRegBlock(a, 0x00, ff, 150);
  w(a, 0xFE, 0xC5);
  w(a, 0xFD, 0x00);
}

static void displayPush() {
  writeRegBlock(ADDR_LEFT,  0x00, fbLeft,  150);
  writeRegBlock(ADDR_RIGHT, 0x00, fbRight, 150);
}

static void clearFB() {
  memset(fbLeft,  0, sizeof(fbLeft));
  memset(fbRight, 0, sizeof(fbRight));
}

// Buffer offset, verified against a full 300-offset calibration scan:
//   LEFT  (col 0..4): offset = (4 - col) * 30 + row
//   RIGHT (col 5..8): offset = (9 - col) * 30 + row
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

// ---- Image decoder (frame-interleaved, machine-code verified) ----
//   word 0..2 : start_row, graphic_rows, num_frames
//   duration(frame)      = word[ frame + 3 ]
//   pixel(relRow, frame) = word[ numFrames*relRow + frame + numFrames + 3 ]
static uint32_t imgU32(const uint8_t* img, int byteOff) {
  return  (uint32_t)pgm_read_byte(img + byteOff)
       | ((uint32_t)pgm_read_byte(img + byteOff + 1) << 8)
       | ((uint32_t)pgm_read_byte(img + byteOff + 2) << 16)
       | ((uint32_t)pgm_read_byte(img + byteOff + 3) << 24);
}
static uint32_t imgWord(const uint8_t* img, int wi) { return imgU32(img, wi * 4); }

static int   imgFrames(const uint8_t* img) { return (uint16_t)imgU32(img, 8); }

static void renderFrame(const uint8_t* img, int frame) {
  uint16_t startRow    = (uint16_t)imgU32(img, 0);
  uint16_t graphicRows = (uint16_t)imgU32(img, 4);
  uint16_t numFrames   = (uint16_t)imgU32(img, 8);
  if (frame >= numFrames) return;
  for (int rel = 0; rel < graphicRows; rel++) {
    int wi = numFrames * rel + frame + numFrames + 3;
    uint32_t rv = imgWord(img, wi);
    int physRow = startRow + rel;
    for (int c = 0; c < COLS; c++)
      ledSet(physRow, c, LUT[(rv >> (24 - 3 * c)) & 0x7]);
  }
}

static uint16_t frameDuration(const uint8_t* img, int frame) {
  if (frame >= imgFrames(img)) return 50;
  uint16_t d = (uint16_t)imgWord(img, frame + 3);
  return d ? d : 50;
}

// Play one image fully (all frames, real durations). Long animations are
// capped at MAX_LOOP_MS so the gallery keeps moving.

static const char* categoryName(uint8_t cat) {
  switch (cat) {
    case 0: return "STATIC";
    case 1: return "SHORT ANIM";
    case 2: return "MEDIUM ANIM";
    case 3: return "LONG ANIM";
    default: return "UNKNOWN";
  }
}

static void playImage(const SX3Image& img) {
  uint16_t startRow    = (uint16_t)imgU32(img.data, 0);
  uint16_t graphicRows = (uint16_t)imgU32(img.data, 4);
  int       frames     = imgFrames(img.data);

  Serial.printf("        category=%s  start_row=%u  rows=%u  frames=%d\n",
                categoryName(img.category), startRow, graphicRows, frames);

  uint32_t spent = 0;
  bool capped = false;
  for (int f = 0; f < frames; f++) {
    clearFB();
    renderFrame(img.data, f);
    displayPush();
    uint16_t d = frameDuration(img.data, f);

    if (frames > 1) {
      // live per-frame progress for animations
      Serial.printf("        frame %3d/%-3d  %4u ms  (elapsed %5lu ms)\r",
                    f + 1, frames, d, (unsigned long)spent + d);
    }

    delay(d);
    spent += d;
    if (spent > MAX_LOOP_MS) { capped = true; break; }
  }

  if (frames > 1) {
    Serial.printf("        played %d frame(s) in %lu ms%s            \n",
                  frames, (unsigned long)spent,
                  capped ? "  [capped at MAX_LOOP_MS]" : "");
  }

  // Static images (1 frame) need a hold so they're actually visible.
  if (frames <= 1) {
    Serial.println("        static image - holding 2500 ms");
    delay(2500);
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("=== VanMoof SX3 - Full Image Gallery ===");
  Serial.printf("%d images loaded.\n", SX3_IMAGE_COUNT);

  pinMode(PIN_SDB, OUTPUT);
  digitalWrite(PIN_SDB, LOW);  delay(20);
  digitalWrite(PIN_SDB, HIGH); delay(50);

  Wire.begin(PIN_SDA, PIN_SCL, I2C_FREQ_HZ);
  initController(ADDR_LEFT);
  initController(ADDR_RIGHT);

  clearFB();
  displayPush();
  Serial.println("Init done. Starting gallery rotation...");
}

void loop() {
  for (int i = 0; i < SX3_IMAGE_COUNT; i++) {
    const SX3Image& img = SX3_IMAGES[i];

    Serial.println();
    Serial.printf("==> [%2d/%d] NOW SHOWING: %s\n",
                  i + 1, SX3_IMAGE_COUNT, img.name);

    playImage(img);

    // 1 second of black between images
    clearFB();
    displayPush();
    Serial.printf("        (black pause %d ms)\n", BLACK_PAUSE_MS);
    delay(BLACK_PAUSE_MS);
  }
  Serial.println();
  Serial.println("===== gallery complete - restarting from image 1 =====");
}
