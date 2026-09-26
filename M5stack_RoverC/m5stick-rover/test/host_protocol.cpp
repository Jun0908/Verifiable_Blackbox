#include <cassert>
#include <cstdio>
#include "control_protocol.h"

int main() {
  assert(sizeof(ControlPacket) == 34 && sizeof(TelemetryPacket) == 36);
  const uint8_t crcFixture[] = "123456789";
  assert(crc32(crcFixture, 9) == 0xcbf43926);
  ControlPacket p{};
  p.magic = kControlMagic; p.version = 1; p.flags = kFlagDeadman;
  p.size = sizeof(p); p.sessionId = 123; p.sequence = 10;
  p.x = -1000; p.y = 500; p.speedLimit = 35; p.tokenHash = fnv1a("fixture-token");
  auto seal = [&]() { p.crc32 = crc32(reinterpret_cast<uint8_t*>(&p), sizeof(p) - 4); };
  auto accepts = [&](bool armed, unsigned session, unsigned sequence) {
    return validControl(p, fnv1a("fixture-token"), armed, session, sequence);
  };
  seal();
  assert(accepts(true,123,9));
  assert(!accepts(false,123,9) && !accepts(true,124,9));
  assert(!accepts(true,123,10) && !accepts(true,123,11));
  p.y++; assert(!accepts(true,123,9)); p.y--; seal();
  p.reserved=1; seal(); assert(!accepts(true,123,9)); p.reserved=0;
  p.flags=0x80; seal(); assert(!accepts(true,123,9)); p.flags=kFlagDeadman;
  p.size=33; seal(); assert(!accepts(true,123,9)); p.size=34;
  p.sequence=1; seal(); assert(accepts(true,123,0xffffffff));
  p.sequence=10; seal();
  using A=SafetyAction;
  assert(safetyAction(false,true,true,false,false,2000,0,0)==A::None);
  assert(safetyAction(true,true,true,false,false,999,0,0)==A::None);
  assert(safetyAction(true,true,true,false,false,1000,0,0)==A::LinkWait);
  assert(safetyAction(true,true,true,true,false,2000,0,0)==A::None);
  assert(safetyAction(true,true,false,true,false,2000,0,0)==A::DisarmWifi);
  assert(safetyAction(true,false,true,false,false,2000,0,0)==A::DisarmI2c);
  assert(safetyAction(true,true,true,false,true,300,0,300)==A::StopDiagnostic);
  assert(safetyAction(true,true,true,false,false,500,0xfffffe0c,0)==A::LinkWait);
  // Golden bytes are compared independently by the Python protocol test.
  auto bytes = reinterpret_cast<const unsigned char*>(&p);
  for (unsigned i=0;i<sizeof(p);++i) printf("%02x",bytes[i]);
  puts("");
}
