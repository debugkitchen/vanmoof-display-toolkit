// =============================================================================
//  VanMoof SX3 Display - Text Scroller (ESP32-C3)
// =============================================================================
//
//  Scrolls text vertically on the SX3 display, which is used in PORTRAIT
//  (20 LEDs tall, 9 LEDs wide). Letters appear at the bottom, slide up, and
//  exit at the top — natural to read when the panel is mounted on a bike
//  top tube (or held upright on the bench).
//
//  Text height is 7 pixels (the 5x7 ASCII font), centred in the 9-column
//  width with 1 column of padding on each side. Each glyph is laid out so
//  that when viewed in portrait, letters read correctly with a slight
//  head-tilt to the right (which is exactly the angle a cyclist sees the
//  top tube display under).
//
//  Hardware: same as the gallery sketch (see guide/README.md).
// =============================================================================

#include <Wire.h>
#include "sx3_font5x7.h"
#include "sx3_font3x5.h"

// ---- Font descriptors -------------------------------------------------------
//
// Both fonts share the same on-the-wire format: per glyph, N column bytes,
// each byte has bit 0 = top row of the glyph. They differ in width/height.
// Use FONT_5X7 / FONT_3X5 when calling scrollText() etc.
//
// `data` points to a flat run of bytes: glyph 0's columns first, then glyph 1's,
// etc. Lookup of glyph G's column C is: data[G * width + C].
struct SX3Font {
  const uint8_t* data;
  uint8_t width;
  uint8_t height;
  uint8_t first;
  uint8_t last;
};
const SX3Font FONT_5X7 = {
  (const uint8_t*)SX3_FONT5X7,
  SX3_FONT_WIDTH, SX3_FONT_HEIGHT,
  SX3_FONT_FIRST_CHAR, SX3_FONT_LAST_CHAR
};
const SX3Font FONT_3X5 = {
  (const uint8_t*)SX3_FONT3X5,
  SX3_FONT3X5_WIDTH, SX3_FONT3X5_HEIGHT,
  SX3_FONT3X5_FIRST_CHAR, SX3_FONT3X5_LAST_CHAR
};

#define PIN_SDA       4
#define PIN_SCL       3
#define PIN_SDB       2
#define I2C_FREQ_HZ   400000

#define ADDR_LEFT     0x30
#define ADDR_RIGHT    0x33

#define ROWS          20
#define COLS           9

uint8_t fbLeft[150];
uint8_t fbRight[150];

const uint8_t LUT[8] = { 0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF };

// ---- I2C plumbing (same as gallery sketch) ----
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
  memset(fbLeft, 0, sizeof(fbLeft));
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

// Where the text band sits inside the 9-column display: vertically centred
// for each font. With 7-px-tall 5x7 it occupies cols 1..7, with 5-px-tall
// 3x5 it occupies cols 2..6. textTopCol = (COLS - font.height) / 2.
static uint8_t textTopColFor(const SX3Font& f) {
  return (COLS - f.height) / 2;
}

// =============================================================================
//  Font lookup: returns a single column byte for character `ch` at horizontal
//  offset `colInGlyph` (0..font.width-1). Unknown chars render as blank.
// =============================================================================
static uint8_t glyphColumn(const SX3Font& f, char ch, uint8_t colInGlyph) {
  if (colInGlyph >= f.width) return 0;
  uint8_t code = (uint8_t)ch;
  if (code < f.first || code > f.last) return 0;
  return pgm_read_byte(f.data + (code - f.first) * f.width + colInGlyph);
}

// Width of the rendered text in pixels (font.width per glyph + 1 inter-char gap).
static int textPixelWidth(const SX3Font& f, const char* s) {
  int w = 0;
  while (*s) { w += f.width + 1; s++; }
  return w;
}

// What's the column byte at horizontal text-pixel `pixelX`?
static uint8_t columnFromText(const SX3Font& f, const char* s, int pixelX) {
  while (*s) {
    if (pixelX < f.width) {
      if (pixelX < 0) return 0;
      return glyphColumn(f, *s, (uint8_t)pixelX);
    }
    pixelX -= f.width;
    if (pixelX < 1) return 0;             // inter-char gap
    pixelX -= 1;
    s++;
  }
  return 0;                                // past end of string
}

// =============================================================================
//  Draw one frame of the scroll.
//
//  The display is used in PORTRAIT: 20 LEDs tall, 9 LEDs wide. Text scrolls
//  bottom-to-top along the long (20-row) axis; letters are oriented so they
//  read correctly when the panel is viewed upright in portrait.
//
//  Mapping:
//    - successive glyph columns occupy successive rows
//    - within each letter, bit 0 (top of the glyph) maps to the RIGHTMOST
//      column of the text band; bit (height-1) maps to the LEFTMOST.
// =============================================================================
static void drawScrollFrame(const SX3Font& f, const char* text,
                            int scrollX, uint8_t brightness) {
  clearFB();
  uint8_t topCol = textTopColFor(f);
  for (int row = 0; row < ROWS; row++) {
    uint8_t colBits = columnFromText(f, text, scrollX + row);
    for (int b = 0; b < f.height; b++) {
      if (colBits & (1 << b)) {
        int matCol = (topCol + f.height - 1) - b;
        ledSet(row, matCol, brightness);
      }
    }
  }
  displayPush();
}

// Scroll the text fully across the display, from off-screen bottom to
// off-screen top. Letters appear at the bottom of the panel and slide up
// — natural to read on a portrait-mounted SX3 display.
//   font: FONT_5X7 or FONT_3X5
//   speed_ms_per_pixel: how long each 1-pixel step is held (try 60-120 ms)
//   brightness: 0x00..0xFF (try 0x40 for legible without dazzling)
static void scrollText(const SX3Font& f, const char* text,
                       uint16_t speed_ms, uint8_t brightness) {
  int textW = textPixelWidth(f, text);
  for (int x = -ROWS; x <= textW; x++) {
    drawScrollFrame(f, text, x, brightness);
    delay(speed_ms);
  }
}

// Show text centred and held.
static void showTextCentred(const SX3Font& f, const char* text,
                            uint8_t brightness, uint16_t hold_ms) {
  int glyphW = textPixelWidth(f, text) - 1;
  if (glyphW < 0) glyphW = 0;
  int firstRow = (ROWS - glyphW) / 2;
  int x = -firstRow;
  drawScrollFrame(f, text, x, brightness);
  delay(hold_ms);
}

// Scroll text in from the bottom, then leave it centred and held.
static void scrollInThenHold(const SX3Font& f, const char* text,
                             uint16_t speed_ms, uint8_t brightness,
                             uint16_t hold_ms) {
  int glyphW = textPixelWidth(f, text) - 1;
  if (glyphW < 0) glyphW = 0;
  int firstRow = (ROWS - glyphW) / 2;
  int finalX = -firstRow;
  for (int x = -ROWS; x <= finalX; x++) {
    drawScrollFrame(f, text, x, brightness);
    delay(speed_ms);
  }
  delay(hold_ms);
}

// =============================================================================
//  setup / loop - demo
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== SX3 Text Scroller ===");

  pinMode(PIN_SDB, OUTPUT);
  digitalWrite(PIN_SDB, LOW);  delay(20);
  digitalWrite(PIN_SDB, HIGH); delay(50);

  Wire.begin(PIN_SDA, PIN_SCL, I2C_FREQ_HZ);
  initController(ADDR_LEFT);
  initController(ADDR_RIGHT);

  clearFB();
  displayPush();
  Serial.println("Init done.");
}

void loop() {
  // 1. Classic scrolling banner with the larger 5x7 font.
  Serial.println("[5x7] Scroll: VanMoof SX3 - Hello, world!");
  scrollText(FONT_5X7, "VanMoof SX3 - Hello, world!", 70, 0x40);
  delay(400);

  // 2. Same text in compact 3x5 — fits more glyph height on screen and looks
  //    a bit chunkier on the 9-col band.
  Serial.println("[3x5] Scroll: VanMoof SX3 - Hello, world!");
  scrollText(FONT_3X5, "VanMoof SX3 - Hello, world!", 70, 0x40);
  delay(400);

  // 3. Short word held briefly (5x7)
  Serial.println("[5x7] Centred: HELLO");
  showTextCentred(FONT_5X7, "HELLO", 0x40, 1500);
  clearFB(); displayPush(); delay(400);

  // 4. Short word held briefly (3x5) — more room since it's smaller
  Serial.println("[3x5] Centred: HELLO WORLD");
  showTextCentred(FONT_3X5, "HELLO WORLD", 0x40, 1500);
  clearFB(); displayPush(); delay(400);

  // 5. Scroll-in-then-hold (5x7)
  Serial.println("[5x7] Scroll-in: READY");
  scrollInThenHold(FONT_5X7, "READY", 60, 0x80, 1200);
  clearFB(); displayPush(); delay(400);

  // 6. Fast scroll with maximum brightness, digits & punctuation (3x5)
  Serial.println("[3x5] Fast bright: 0123456789 !@#$%^&*()");
  scrollText(FONT_3X5, "0123456789 !@#$%^&*()", 40, 0xFF);
  delay(400);

  // 7. Empty pause
  clearFB(); displayPush();
  Serial.println("--- loop restart ---\n");
  delay(800);
}
