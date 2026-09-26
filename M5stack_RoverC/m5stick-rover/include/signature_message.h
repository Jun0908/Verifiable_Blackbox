#pragma once
#include <cstdint>
#include <cstring>

namespace DeviceJob {
constexpr char schema[] = "DeviceJobSignatureV1";
inline bool parseWord(const char* text, uint8_t* out, size_t size) {
  if (text[0] == '0' && text[1] == 'x') text += 2;
  if (strlen(text) != size * 2) return false;
  bool nonzero = false;
  for (size_t i=0; i<size; ++i) {
    unsigned value=0;
    for (size_t j=0; j<2; ++j) {
      char c=text[2*i+j];
      int digit = c>='0' && c<='9' ? c-'0' : c>='a' && c<='f' ? c-'a'+10 : c>='A' && c<='F' ? c-'A'+10 : -1;
      if (digit<0) return false;
      value=value*16+digit;
    }
    out[i]=value; nonzero |= value != 0;
  }
  return nonzero;
}
inline bool message(const uint8_t* schemaHash, const char* chain, const char* core,
                    const char* job, uint8_t* output) {
  memset(output,0,128);
  memcpy(output,schemaHash,32);
  return parseWord(chain,output+32,32) && parseWord(core,output+76,20) && parseWord(job,output+96,32);
}
}
