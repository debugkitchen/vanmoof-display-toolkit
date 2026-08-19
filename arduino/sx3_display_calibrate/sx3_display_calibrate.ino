// =============================================================================
//  SX3 Display - Calibration Sketch
//  Lights ONE labelled pixel at a time so the buffer<->physical mapping can
//  be measured directly instead of derived. Watch the display + serial.
// =============================================================================
#include <Wire.h>

#define PIN_SDA 4
#define PIN_SCL 3
#define PIN_SDB 2
#define I2C_FREQ_HZ 400000
#define ADDR_LEFT  0x30
#define ADDR_RIGHT 0x33

uint8_t fbLeft[150], fbRight[150];

static uint8_t w(uint8_t a,uint8_t r,uint8_t v){
  Wire.beginTransmission(a);Wire.write(r);Wire.write(v);return Wire.endTransmission();
}
static void writeRegBlock(uint8_t a,uint8_t sr,const uint8_t*d,int len){
  const int CH=24;int i=0;
  while(i<len){int n=(len-i<CH)?(len-i):CH;
    Wire.beginTransmission(a);Wire.write(sr+i);
    for(int k=0;k<n;k++)Wire.write(d[i+k]);Wire.endTransmission();i+=n;}
}
static void initController(uint8_t a){
  w(a,0xFE,0xC5);w(a,0xFD,0x04);w(a,0x00,0x41);w(a,0x01,0x80);
  w(a,0xFE,0xC5);w(a,0xFD,0x02);
  uint8_t ff[150];memset(ff,0xFF,150);writeRegBlock(a,0x00,ff,150);
  w(a,0xFE,0xC5);w(a,0xFD,0x00);
}
static void push(){
  writeRegBlock(ADDR_LEFT,0x00,fbLeft,150);
  writeRegBlock(ADDR_RIGHT,0x00,fbRight,150);
}

// RAW: write a single buffer offset directly (NO row/col math at all)
int curSide = 0;     // 0 = left buffer, 1 = right buffer
int curOff  = 0;

void setup(){
  Serial.begin(115200);delay(2000);
  Serial.println("\n=== SX3 RAW OFFSET CALIBRATION ===");
  Serial.println("One buffer byte at a time, every 2.5s.");
  Serial.println("Note for each: SIDE + offset -> which physical (row,col) lights.");
  pinMode(PIN_SDB,OUTPUT);
  digitalWrite(PIN_SDB,LOW);delay(20);digitalWrite(PIN_SDB,HIGH);delay(50);
  Wire.begin(PIN_SDA,PIN_SCL,I2C_FREQ_HZ);
  initController(ADDR_LEFT);initController(ADDR_RIGHT);
  Serial.println("Init done.");
}

void loop(){
  memset(fbLeft,0,150);memset(fbRight,0,150);
  if(curSide==0) fbLeft[curOff]=0xFF; else fbRight[curOff]=0xFF;
  push();
  Serial.printf(">>> %s buffer  offset=%3d (0x%02X)  -> physical (row,col)?\n",
                curSide==0?"LEFT ":"RIGHT", curOff, curOff);
  curOff++;
  if(curOff>=150){ curOff=0; curSide^=1;
    Serial.printf("\n===== now scanning %s buffer =====\n\n",
                  curSide==0?"LEFT":"RIGHT"); }
  delay(100);
}
