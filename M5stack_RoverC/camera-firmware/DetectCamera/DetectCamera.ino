#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin(17, 41);
}

void loop() {
  Wire.beginTransmission(0x1f);
  Wire.write(0x02);
  Wire.write(0x00);
  uint8_t status = Wire.endTransmission(false);
  Wire.requestFrom(static_cast<uint8_t>(0x1f), static_cast<uint8_t>(1));
  int version = Wire.available() ? Wire.read() : -1;
  Serial.printf("CAMERA_HARDWARE probe=%u version=0x%02X psram=%u\n", status, version, ESP.getPsramSize());
  delay(1000);
}
