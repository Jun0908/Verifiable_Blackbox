#pragma once
#include <cstdint>
#include <cstddef>

constexpr uint32_t kControlMagic = 0x52565232;    // RVR2
constexpr uint32_t kTelemetryMagic = 0x54454C32;  // TEL2
constexpr uint8_t kProtocolVersion = 1;
enum ControlFlags : uint8_t {
  kFlagDeadman = 1 << 0,
  kFlagEmergencyStop = 1 << 1,
  kFlagGripperValid = 1 << 2,
  kFlagAuxServoValid = 1 << 3,
};

enum TelemetryFlags : uint8_t {
  kTelemetryI2cOk = 1 << 0,
  kTelemetryArmed = 1 << 1,
  kTelemetryMotorsRunning = 1 << 2,
  kTelemetryWifiOk = 1 << 3,
};

// Upper telemetry flag bits report why output stopped, without changing size.
enum StopReason : uint8_t {
  kStopNone = 0, kStopManual = 1, kStopControlTimeout = 2,
  kStopWifi = 3, kStopI2c = 4, kStopBoot = 5,
};

#pragma pack(push, 1)
struct ControlPacket {
  uint32_t magic;
  uint8_t version;
  uint8_t flags;
  uint16_t size;
  uint32_t sessionId;
  uint32_t sequence;
  int16_t x;
  int16_t y;
  int16_t z;
  uint8_t speedLimit;
  uint8_t gripperAngle;
  uint8_t auxServoAngle;
  uint8_t reserved;
  uint32_t tokenHash;
  uint32_t crc32;
};

struct TelemetryPacket {
  uint32_t magic;
  uint8_t version;
  uint8_t flags;
  uint16_t size;
  uint32_t sequence;
  uint32_t uptimeMs;
  int16_t x;
  int16_t y;
  int16_t z;
  int8_t motors[4];
  uint8_t gripperAngle;
  uint8_t auxServoAngle;
  int8_t rssi;
  uint8_t speedLimit;
  uint16_t packetAgeMs;
  uint32_t crc32;
};
#pragma pack(pop)

static_assert(sizeof(ControlPacket) == 34, "Unexpected control packet size");
static_assert(sizeof(TelemetryPacket) == 36, "Unexpected telemetry packet size");

uint32_t crc32(const uint8_t* data, size_t length) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
  }
  return crc ^ 0xFFFFFFFFu;
}

uint32_t fnv1a(const char* text) {
  uint32_t hash = 2166136261u;
  while (*text != '\0') {
    hash ^= static_cast<uint8_t>(*text++);
    hash *= 16777619u;
  }
  return hash;
}


inline bool newerSequence(uint32_t candidate, uint32_t previous) {
  return static_cast<int32_t>(candidate - previous) > 0;
}
inline bool validControl(const ControlPacket& p, uint32_t token, bool armed,
                         uint32_t session, uint32_t sequence) {
  return p.magic == kControlMagic && p.version == kProtocolVersion &&
      p.size == sizeof(p) && p.tokenHash == token && p.reserved == 0 &&
      (p.flags & 0xf0) == 0 && p.sequence != 0 &&
      p.crc32 == crc32(reinterpret_cast<const uint8_t*>(&p), sizeof(p) - 4) &&
      armed && p.sessionId == session && (sequence == 0 || newerSequence(p.sequence, sequence));
}
enum class SafetyAction { None, LinkWait, DisarmWifi, DisarmI2c, StopDiagnostic };
inline SafetyAction safetyAction(bool armed, bool i2c, bool wifi, bool waiting,
    bool diagnostic, uint32_t now, uint32_t last, uint32_t stopAt) {
  if (!i2c) return SafetyAction::DisarmI2c;
  if (armed && !wifi) return SafetyAction::DisarmWifi;
  if (diagnostic && static_cast<int32_t>(now - stopAt) >= 0) return SafetyAction::StopDiagnostic;
  if (armed && !waiting && !diagnostic && now - last >= 1000) return SafetyAction::LinkWait;
  return SafetyAction::None;
}
