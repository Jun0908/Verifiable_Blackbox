#include <cassert>
#include <cstdio>
#include "signature_message.h"
int main(int argc, char** argv) {
  if (argc != 5) return 2;
  uint8_t schemaHash[32], output[128];
  assert(DeviceJob::parseWord(argv[1],schemaHash,32));
  assert(DeviceJob::message(schemaHash,argv[2],argv[3],argv[4],output));
  for (auto byte: output) printf("%02x",byte);
  puts("");
  assert(!DeviceJob::parseWord("0x00",output,1));
  assert(!DeviceJob::parseWord("0xzz",output,1));
  assert(!DeviceJob::parseWord("01",output,32));
}
