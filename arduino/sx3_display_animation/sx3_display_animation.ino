#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// ---- wiring (matches section 2; adjust to your board) ----
#define PIN_SDA   4
#define PIN_SCL   3
#define PIN_SDB   2          // controller shutdown/enable line
#define ADDR_LEFT   0x30
#define ADDR_RIGHT  0x33
#define ROWS  20
#define COLS   9

// 3-bit intensity (0..7) -> 8-bit PWM
const uint8_t LUT[8] = { 0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF };

uint8_t fbLeft[150];
uint8_t fbRight[150];

static uint8_t w(uint8_t a, uint8_t r, uint8_t v) {
  Wire.beginTransmission(a);
  Wire.write(r); Wire.write(v);
  return Wire.endTransmission();
}
static void writeRegBlock(uint8_t a, uint8_t startReg, const uint8_t* d, int len) {
  const int CHUNK = 24;
  for (int i = 0; i < len; ) {
    int n = (len - i < CHUNK) ? (len - i) : CHUNK;
    Wire.beginTransmission(a);
    Wire.write(startReg + i);
    for (int k = 0; k < n; k++) Wire.write(d[i + k]);
    Wire.endTransmission();
    i += n;
  }
}
static void initController(uint8_t a) {
  w(a, 0xFE, 0xC5); w(a, 0xFD, 0x04);          // unlock, config page
  w(a, 0x00, 0x41); w(a, 0x01, 0x80);          // enable + global current
  w(a, 0xFE, 0xC5); w(a, 0xFD, 0x02);          // scaling page
  uint8_t on[150]; memset(on, 0xFF, sizeof(on));
  writeRegBlock(a, 0x00, on, 150);             // all LEDs on at full scale
  w(a, 0xFE, 0xC5); w(a, 0xFD, 0x00);          // PWM page (active from now)
}
static void clearFB() {
  memset(fbLeft,  0, sizeof(fbLeft));
  memset(fbRight, 0, sizeof(fbRight));
}
static void ledSet(int row, int col, uint8_t pwm) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
  if (col < 5) { int o = (4 - col) * 30 + row; if (o < 150) fbLeft[o]  = pwm; }
  else         { int o = (9 - col) * 30 + row; if (o < 150) fbRight[o] = pwm; }
}
static void displayPush() {
  writeRegBlock(ADDR_LEFT,  0x00, fbLeft,  150);
  writeRegBlock(ADDR_RIGHT, 0x00, fbRight, 150);
}

void setup() {
  pinMode(PIN_SDB, OUTPUT);
  digitalWrite(PIN_SDB, LOW);  delay(20);      // reset the controllers
  digitalWrite(PIN_SDB, HIGH); delay(50);

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  initController(ADDR_LEFT);
  initController(ADDR_RIGHT);
  clearFB(); displayPush();
}

void loop() {
  static uint8_t t = 0;
  clearFB();
  for (int row = 0; row < ROWS; row++) {
    for (int col = 0; col < COLS; col++) {
      // travelling diagonal wave, mapped to intensity 0..7
      float phase = (row + col) * 0.8f - t * 0.35f;
      int inten = (int)lroundf(3.5f * (1.0f + sinf(phase)));
      if (inten < 0) inten = 0;
      if (inten > 7) inten = 7;
      ledSet(row, col, LUT[inten]);
    }
  }
  displayPush();
  t++;
  delay(50);
}
