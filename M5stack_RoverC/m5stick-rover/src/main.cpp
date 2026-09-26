#include <Arduino.h>
#include <ESPmDNS.h>
#include <M5Unified.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <freertos/semphr.h>

#include "secrets.h"
#include "wifi_profiles.h"
#include "device_signature.h"
#include "control_protocol.h"

namespace {

SemaphoreHandle_t controlMutex;
bool safetyTaskReady = false;
struct ControlGuard {
  ControlGuard() { xSemaphoreTakeRecursive(controlMutex, portMAX_DELAY); }
  ~ControlGuard() { xSemaphoreGiveRecursive(controlMutex); }
};
#define LOCKED_HANDLER(fn) []() { ControlGuard guard; fn(); }

constexpr uint8_t kRoverAddress = 0x38;
constexpr int kSdaPin = 0;
constexpr int kSclPin = 26;
constexpr uint16_t kUdpPort = 4210;
constexpr uint32_t kControlTimeoutMs = 1000;
constexpr uint32_t kI2cCheckIntervalMs = 1000;
constexpr uint32_t kTelemetryIntervalMs = 100;
constexpr uint32_t kMotorRampIntervalMs = 20;
constexpr int kDefaultSpeedLimit = 35;
constexpr int kMaximumSpeedLimit = 100;
constexpr int kMotorRampStep = 5;
constexpr int kMinDurationMs = 50;
constexpr int kMaxDurationMs = 1000;
constexpr uint8_t kGripperMinAngle = 10;
constexpr uint8_t kGripperMaxAngle = 90;
constexpr uint8_t kAuxServoMinAngle = 45;
constexpr uint8_t kAuxServoMaxAngle = 135;
constexpr char kDiscoveryRequest[] = "ROVER_DISCOVER_V1";

WebServer server(80);
WiFiUDP udp;
WifiProfiles wifiProfiles;

bool roverReady = false;
bool serverStarted = false;
bool networkServicesStarted = false;
bool routesConfigured = false;
bool armed = false;
bool motorsRunning = false;
bool diagnosticPulse = false;
uint32_t activeSessionId = 0;
uint32_t lastSequence = 0;
uint32_t lastControlMs = 0;
uint32_t stopAtMs = 0;
uint32_t lastI2cCheckMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastRampMs = 0;
IPAddress telemetryIp;
uint16_t telemetryPort = 0;
int16_t commandX = 0;
int16_t commandY = 0;
int16_t commandZ = 0;
int speedLimit = kDefaultSpeedLimit;
int8_t motorSigns[4] = {1, 1, 1, 1};
int8_t targetMotors[4] = {0, 0, 0, 0};
int8_t appliedMotors[4] = {0, 0, 0, 0};
uint8_t gripperAngle = 25;
uint8_t auxServoAngle = 90;
String displayState;
StopReason stopReason = kStopBoot;
String lastStopReason = "boot";
uint32_t lastStopMs = 0;
uint32_t stopCount = 0;
bool linkWaiting = false;

void recordStop(StopReason reason, const char* detail) {
  stopReason = reason;
  lastStopReason = detail;
  lastStopMs = millis();
  ++stopCount;
  Serial.printf("STOP reason=%u: %s\n", reason, detail);
}

void showState(const char* state, uint32_t color) {
  if (displayState == state) {
    return;
  }
  displayState = state;
  M5.Display.fillScreen(BLACK);
  M5.Display.setTextColor(color);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(8, 12);
  M5.Display.println(state);
  M5.Display.setTextColor(WHITE);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(8, 52);
  if (WiFi.status() == WL_CONNECTED) {
    M5.Display.println(WiFi.localIP().toString());
    M5.Display.setCursor(8, 66);
    M5.Display.printf("RSSI %d", WiFi.RSSI());
  } else {
    M5.Display.println("Wi-Fi offline");
  }
}

bool roverResponds() {
  Wire.beginTransmission(kRoverAddress);
  return Wire.endTransmission() == 0;
}

bool writeAllMotors(int8_t m1, int8_t m2, int8_t m3, int8_t m4) {
  Wire.beginTransmission(kRoverAddress);
  Wire.write(0x00);
  Wire.write(static_cast<uint8_t>(m1));
  Wire.write(static_cast<uint8_t>(m2));
  Wire.write(static_cast<uint8_t>(m3));
  Wire.write(static_cast<uint8_t>(m4));
  return Wire.endTransmission() == 0;
}

bool writeServoAngle(uint8_t channel, uint8_t angle) {
  Wire.beginTransmission(kRoverAddress);
  Wire.write(static_cast<uint8_t>(0x10 + channel));
  Wire.write(angle);
  return Wire.endTransmission() == 0;
}

void readServoTargets() {
  // Read the board's commanded angles, not physical position or gripping force.
  // This avoids jumping from a made-up midpoint after an M5Stick reboot.
  Wire.beginTransmission(kRoverAddress);
  Wire.write(0x10);
  if (Wire.endTransmission(false) != 0 ||
      Wire.requestFrom(kRoverAddress, static_cast<uint8_t>(2)) != 2) {
    Serial.println("Servo target read unavailable; open gripper before calibration");
    return;
  }
  const uint8_t grip = Wire.read();
  const uint8_t aux = Wire.read();
  if (grip >= kGripperMinAngle && grip <= kGripperMaxAngle) gripperAngle = grip;
  if (aux >= kAuxServoMinAngle && aux <= kAuxServoMaxAngle) auxServoAngle = aux;
}

bool stopAllMotors() {
  for (int attempt = 0; attempt < 3; ++attempt) {
    if (writeAllMotors(0, 0, 0, 0)) {
      for (int i = 0; i < 4; ++i) {
        targetMotors[i] = 0;
        appliedMotors[i] = 0;
      }
      motorsRunning = false;
      diagnosticPulse = false;
      return true;
    }
    delay(5);
  }
  for (int i = 0; i < 4; ++i) {
    targetMotors[i] = 0;
    appliedMotors[i] = 0;
  }
  motorsRunning = false;
  diagnosticPulse = false;
  return false;
}

void disarm(const char* reason, bool showStop = true) {
  recordStop(kStopManual, reason);
  linkWaiting = false;
  armed = false;
  activeSessionId = 0;
  lastControlMs = 0;
  commandX = commandY = commandZ = 0;
  if (!stopAllMotors()) { roverReady = false; stopReason = kStopI2c; }
  if (showStop) {
    showState("STOP", WHITE);
  }
  Serial.printf("DISARM: %s\n", reason);
}

void enterI2cError(const char* reason) {
  const bool newlyFailed = roverReady || displayState != "I2C ERROR";
  if (newlyFailed) recordStop(kStopI2c, reason);
  linkWaiting = false;
  armed = false;
  activeSessionId = 0;
  roverReady = false;
  stopAllMotors();
  showState("I2C ERROR", RED);
  if (newlyFailed) {
    Serial.printf("I2C ERROR: %s\n", reason);
  }
}

void sendJson(int statusCode, const String& body) {
  // Socket writes may block on a slow HTTP peer; never hold the safety mutex.
  const bool held = xSemaphoreGetMutexHolder(controlMutex) == xTaskGetCurrentTaskHandle();
  if (held) xSemaphoreGiveRecursive(controlMutex);
  server.send(statusCode, "application/json", body);
  if (held) xSemaphoreTakeRecursive(controlMutex, portMAX_DELAY);
}

bool authorized() {
  if (strlen(ROVER_API_TOKEN) == 0 ||
      strcmp(ROVER_API_TOKEN, "change-me") == 0) {
    sendJson(503, "{\"ok\":false,\"error\":\"API token is not configured\"}");
    return false;
  }
  if (server.header("X-Rover-Token") != ROVER_API_TOKEN) {
    sendJson(401, "{\"ok\":false,\"error\":\"unauthorized\"}");
    return false;
  }
  return true;
}

bool parseIntegerArgument(const char* name, long minimum, long maximum,
                          long& value) {
  if (!server.hasArg(name)) {
    return false;
  }
  const String text = server.arg(name);
  char* end = nullptr;
  const long parsed = strtol(text.c_str(), &end, 10);
  if (end == text.c_str() || *end != '\0' || parsed < minimum ||
      parsed > maximum) {
    return false;
  }
  value = parsed;
  return true;
}

void handleStatus() {
  if (!authorized()) {
    return;
  }
  const uint32_t age = lastControlMs == 0 ? 0 : millis() - lastControlMs;
  const String state = !roverReady ? "I2C_ERROR" :
                       linkWaiting ? "LINK_WAIT" :
                       armed ? (motorsRunning ? "MOVING" : "ARMED") : "DISARMED";
  const String body =
      String("{\"ok\":true,\"protocol\":2,\"state\":\"") + state +
      "\",\"wifi\":" + (WiFi.status() == WL_CONNECTED ? "true" : "false") +
      ",\"i2c\":" + (roverReady ? "true" : "false") +
      ",\"armed\":" + (armed ? "true" : "false") +
      ",\"motors\":" + (motorsRunning ? "true" : "false") +
      ",\"ip\":\"" + WiFi.localIP().toString() + "\",\"rssi\":" +
      String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127) +
      ",\"udp_port\":" + String(kUdpPort) +
      ",\"speed_limit\":" + String(speedLimit) +
      ",\"motor_signs\":[" + String(motorSigns[0]) + "," +
      String(motorSigns[1]) + "," + String(motorSigns[2]) + "," +
      String(motorSigns[3]) + "]" +
      ",\"packet_age_ms\":" + String(age) +
      ",\"gripper_angle\":" + String(gripperAngle) +
      ",\"aux_servo_angle\":" + String(auxServoAngle) +
      ",\"firmware\":\"2.1-demo\",\"control_timeout_ms\":" + kControlTimeoutMs +
      ",\"stop_reason\":" + String(static_cast<int>(stopReason)) +
      ",\"last_stop_reason\":\"" + lastStopReason +
      "\",\"last_stop_ms\":" + lastStopMs + ",\"stop_count\":" + stopCount +
      ",\"uptime_ms\":" + millis() + "}";
  sendJson(200, body);
}

void handleArm() {
  if (!authorized()) {
    return;
  }
#if DEVICE_SIGNATURE_ENABLED
  if (DeviceSignature::busy()) {
    sendJson(409, "{\"ok\":false,\"error\":\"signature busy\"}");
    return;
  }
#endif
  if (wifiProfiles.switchPending()) {
    sendJson(409, "{\"ok\":false,\"error\":\"network switch pending\"}");
    return;
  }
  if (!safetyTaskReady || !roverReady || WiFi.status() != WL_CONNECTED) {
    sendJson(503, "{\"ok\":false,\"error\":\"rover is not ready\"}");
    return;
  }
  long session = 0;
  if (!parseIntegerArgument("session_id", 1, 0x7FFFFFFF, session)) {
    sendJson(400, "{\"ok\":false,\"error\":\"invalid session_id\"}");
    return;
  }
  if (armed && activeSessionId != static_cast<uint32_t>(session)) {
    sendJson(409, "{\"ok\":false,\"error\":\"rover is leased by another session\"}");
    return;
  }
  if (!stopAllMotors()) {
    enterI2cError("ARM stop failed");
    sendJson(503, "{\"ok\":false,\"error\":\"stop failed\"}");
    return;
  }
  activeSessionId = static_cast<uint32_t>(session);
  lastSequence = 0;
  lastControlMs = millis();
  armed = true;
  linkWaiting = false;
  stopReason = kStopNone;
  showState("ARMED", YELLOW);
  Serial.printf("ARMED: session=%lu\n", static_cast<unsigned long>(activeSessionId));
  sendJson(200, String("{\"ok\":true,\"state\":\"armed\",\"session_id\":") +
                    activeSessionId + "}");
}

void handleDisarm() {
  if (!authorized()) {
    return;
  }
  disarm("HTTP disarm");
  sendJson(roverReady ? 200 : 503, roverReady ? "{\"ok\":true,\"state\":\"disarmed\"}" : "{\"ok\":false,\"error\":\"stop unconfirmed\"}");
}

void handleStop() {
  if (!authorized()) {
    return;
  }
  disarm("HTTP emergency stop");
  sendJson(roverReady ? 200 : 503, roverReady ? "{\"ok\":true,\"state\":\"stopped\"}" : "{\"ok\":false,\"error\":\"stop unconfirmed\"}");
}

void handleConfig() {
  if (!authorized()) {
    return;
  }
  if (armed) {
    sendJson(409, "{\"ok\":false,\"error\":\"disarm before configuration\"}");
    return;
  }
  bool changed = false;
  if (server.hasArg("speed_limit")) {
    long requestedLimit = 0;
    if (!parseIntegerArgument("speed_limit", 10, kMaximumSpeedLimit,
                              requestedLimit)) {
      sendJson(400, "{\"ok\":false,\"error\":\"invalid speed_limit\"}");
      return;
    }
    speedLimit = static_cast<int>(requestedLimit);
    changed = true;
  }
  for (int i = 0; i < 4; ++i) {
    const String name = String("m") + (i + 1) + "_sign";
    if (server.hasArg(name)) {
      long sign = 0;
      if (!parseIntegerArgument(name.c_str(), -1, 1, sign) || sign == 0) {
        sendJson(400, "{\"ok\":false,\"error\":\"motor signs must be -1 or 1\"}");
        return;
      }
      motorSigns[i] = static_cast<int8_t>(sign);
      changed = true;
    }
  }
  if (!changed) {
    sendJson(400, "{\"ok\":false,\"error\":\"no configuration values\"}");
    return;
  }
  sendJson(200, String("{\"ok\":true,\"speed_limit\":") + speedLimit +
                    ",\"motor_signs\":[" + String(motorSigns[0]) + "," +
                    String(motorSigns[1]) + "," + String(motorSigns[2]) + "," +
                    String(motorSigns[3]) + "]}");
}

void handleDrive() {
  if (!authorized()) {
    return;
  }
  if (!armed || !roverReady) {
    sendJson(409, "{\"ok\":false,\"error\":\"arm rover first\"}");
    return;
  }
  long session = 0;
  long motors[4] = {0, 0, 0, 0};
  long durationMs = 0;
  if (!parseIntegerArgument("session_id", 1, 0x7FFFFFFF, session) ||
      static_cast<uint32_t>(session) != activeSessionId ||
      !parseIntegerArgument("m1", -speedLimit, speedLimit, motors[0]) ||
      !parseIntegerArgument("m2", -speedLimit, speedLimit, motors[1]) ||
      !parseIntegerArgument("m3", -speedLimit, speedLimit, motors[2]) ||
      !parseIntegerArgument("m4", -speedLimit, speedLimit, motors[3]) ||
      !parseIntegerArgument("duration_ms", kMinDurationMs, kMaxDurationMs,
                            durationMs)) {
    sendJson(400, "{\"ok\":false,\"error\":\"invalid diagnostic drive request\"}");
    return;
  }
  if (!writeAllMotors(static_cast<int8_t>(motors[0]),
                      static_cast<int8_t>(motors[1]),
                      static_cast<int8_t>(motors[2]),
                      static_cast<int8_t>(motors[3]))) {
    enterI2cError("diagnostic drive write failed");
    sendJson(503, "{\"ok\":false,\"error\":\"I2C write failed\"}");
    return;
  }
  diagnosticPulse = true;
  motorsRunning = false;
  for (int i = 0; i < 4; ++i) {
    targetMotors[i] = appliedMotors[i] = static_cast<int8_t>(motors[i]);
    motorsRunning = motorsRunning || motors[i] != 0;
  }
  commandX = commandY = commandZ = 0;
  lastControlMs = millis();
  linkWaiting = false;
  stopReason = kStopNone;
  stopAtMs = millis() + static_cast<uint32_t>(durationMs);
  showState("DIAG GO", YELLOW);
  sendJson(200, "{\"ok\":true,\"state\":\"running\"}");
}

void handleNotFound() {
  sendJson(404, "{\"ok\":false,\"error\":\"not found\"}");
}

void handleNetworkStatus() {
  if (!authorized()) return;
  sendJson(200, String("{\"ok\":true,\"device\":\"rover\",\"profile\":\"") +
      wifiProfiles.profileName() + "\",\"connected\":" +
      (WiFi.status() == WL_CONNECTED ? "true" : "false") +
      ",\"hotspot_configured\":" + (wifiProfiles.configured(true) ? "true" : "false") + "}");
}

void handleNetworkSelect() {
  if (!authorized()) return;
  const String profile = server.arg("profile");
  if ((profile != "home" && profile != "hotspot") ||
      !wifiProfiles.configured(profile == "hotspot")) {
    sendJson(400, "{\"ok\":false,\"error\":\"network profile not configured\"}");
    return;
  }
  if (!stopAllMotors()) {
    enterI2cError("network switch motor stop failed");
    sendJson(503, "{\"ok\":false,\"error\":\"motor stop failed\"}");
    return;
  }
  disarm("network switch");
  telemetryPort = 0;
  wifiProfiles.select(profile == "hotspot");
  sendJson(202, "{\"ok\":true,\"switching\":true}");
}

void connectWifi() {
  showState("WIFI...", YELLOW);
  wifiProfiles.begin("roverc");
}

// Physical USB recovery when the previously selected access point is absent.
// Never changes credentials or enables an automatic network fallback.
void processUsbNetworkCommand() {
  static char command[24];
  static size_t length = 0;
  static bool overflow = false;
  for (int budget = 0; budget < 32 && Serial.available(); ++budget) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch != '\n') {
      if (length < sizeof(command) - 1) command[length++] = ch;
      else overflow = true;
      continue;
    }
    command[length] = '\0';
    const bool home = !overflow && strcmp(command, "network home") == 0;
    const bool hotspot = !overflow && strcmp(command, "network hotspot") == 0;
    length = 0;
    overflow = false;
    if (!home && !hotspot) {
      Serial.println("USB NETWORK: expected network home or network hotspot");
    } else if (wifiProfiles.switchPending()
#if DEVICE_SIGNATURE_ENABLED
               || DeviceSignature::busy()
#endif
    ) {
      Serial.println("USB NETWORK: busy; retry later");
    } else if (!wifiProfiles.configured(hotspot)) {
      Serial.println("USB NETWORK: profile not configured");
    } else if (!stopAllMotors()) {
      enterI2cError("USB network switch stop failed");
      Serial.println("USB NETWORK: motor stop failed");
    } else {
      disarm("USB network switch");
      telemetryPort = 0;
      wifiProfiles.select(hotspot);
      Serial.printf("USB NETWORK: selecting %s\n", home ? "home" : "hotspot");
    }
  }
}

#if DEVICE_SIGNATURE_ENABLED
void handleDeviceSignature(bool keyOnly) {
  if (!authorized()) return;
  if (armed || motorsRunning || diagnosticPulse || wifiProfiles.switchPending()) {
    sendJson(409, "{\"error\":\"DISARM_REQUIRED\"}");
    return;
  }
  // Explicitly confirm a stopped output before expensive crypto, without
  // treating this response as evidence of physical movement or wheel position.
  if (!stopAllMotors()) {
    sendJson(503, "{\"error\":\"STOP_COMMAND_FAILED\"}");
    return;
  }
  // HTTP handlers are serialized on loop(); the safety worker only disarms.
  // Keep Button A and I2C checks running while the signature response is sent.
  xSemaphoreGiveRecursive(controlMutex);
  DeviceSignature::request(server, keyOnly);
  xSemaphoreTakeRecursive(controlMutex, portMAX_DELAY);
}
#endif

void startNetworkServices() {
  if (networkServicesStarted || WiFi.status() != WL_CONNECTED) {
    return;
  }
  if (!routesConfigured) {
    const char* headerKeys[] = {"X-Rover-Token"};
    server.collectHeaders(headerKeys, 1);
    server.on("/status", HTTP_GET, LOCKED_HANDLER(handleStatus));
    server.on("/arm", HTTP_POST, LOCKED_HANDLER(handleArm));
    server.on("/disarm", HTTP_POST, LOCKED_HANDLER(handleDisarm));
    server.on("/stop", HTTP_POST, LOCKED_HANDLER(handleStop));
    server.on("/config", HTTP_POST, LOCKED_HANDLER(handleConfig));
    server.on("/drive", HTTP_POST, LOCKED_HANDLER(handleDrive));
    server.on("/network", HTTP_GET, LOCKED_HANDLER(handleNetworkStatus));
    server.on("/network", HTTP_POST, LOCKED_HANDLER(handleNetworkSelect));
#if DEVICE_SIGNATURE_ENABLED
    server.on("/device-signature", HTTP_GET, []() {
      if (authorized()) DeviceSignature::status(server);
    });
    server.on("/device-signature/key", HTTP_POST, []() { ControlGuard guard; handleDeviceSignature(true); });
    server.on("/device-signature", HTTP_POST, []() { ControlGuard guard; handleDeviceSignature(false); });
#endif
    server.onNotFound(handleNotFound);
    routesConfigured = true;
  }
  server.begin();
  serverStarted = true;
  udp.begin(kUdpPort);
  if (MDNS.begin("roverc")) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("roverc", "udp", kUdpPort);
  }
  networkServicesStarted = true;
  Serial.print("WIFI OK: ");
  Serial.println(WiFi.localIP());
  displayState = "";  // Refresh the address after changing networks.
  showState(roverReady ? (armed ? "ARMED" : "READY") : "I2C ERROR",
            roverReady ? GREEN : RED);
  Serial.printf("NETWORK READY: HTTP 80, UDP %u, roverc.local\n", kUdpPort);
}

void calculateMotorTargets(int16_t x, int16_t y, int16_t z, int limit) {
  int32_t mixed[4] = {
      static_cast<int32_t>(y) + x - z,
      static_cast<int32_t>(y) - x + z,
      static_cast<int32_t>(y) - x - z,
      static_cast<int32_t>(y) + x + z,
  };
  int32_t maximum = 1000;
  for (int i = 0; i < 4; ++i) {
    maximum = max(maximum, abs(mixed[i]));
  }
  for (int i = 0; i < 4; ++i) {
    targetMotors[i] = static_cast<int8_t>(motorSigns[i] * constrain(
        (mixed[i] * limit) / maximum, -kMaximumSpeedLimit,
        kMaximumSpeedLimit));
  }
}

void processMotorRamp() {
  if (!armed || diagnosticPulse || millis() - lastRampMs < kMotorRampIntervalMs) {
    return;
  }
  lastRampMs = millis();
  bool targetIsZero = true;
  for (int i = 0; i < 4; ++i) {
    targetIsZero = targetIsZero && targetMotors[i] == 0;
  }
  if (targetIsZero) {
    if (motorsRunning) {
      if (!stopAllMotors()) { enterI2cError("zero output failed"); return; }
      showState("ARMED", YELLOW);
    }
    return;
  }
  bool changed = false;
  for (int i = 0; i < 4; ++i) {
    const int difference = targetMotors[i] - appliedMotors[i];
    if (difference != 0) {
      appliedMotors[i] += static_cast<int8_t>(constrain(
          difference, -kMotorRampStep, kMotorRampStep));
      changed = true;
    }
  }
  if (changed && !writeAllMotors(appliedMotors[0], appliedMotors[1],
                                 appliedMotors[2], appliedMotors[3])) {
    enterI2cError("motor ramp write failed");
    return;
  }
  motorsRunning = true;
  showState("MOVING", GREEN);
}

void sendDiscoveryReply() {
  const String reply = String("{\"name\":\"RoverC Pro\",\"host\":\"roverc.local\",") +
                       "\"ip\":\"" + WiFi.localIP().toString() +
                       "\",\"http_port\":80,\"udp_port\":" + kUdpPort +
                       ",\"protocol\":2}";
  udp.beginPacket(udp.remoteIP(), udp.remotePort());
  udp.write(reinterpret_cast<const uint8_t*>(reply.c_str()), reply.length());
  udp.endPacket();
}

void sendTelemetry() {
  if (telemetryPort == 0 || millis() - lastTelemetryMs < kTelemetryIntervalMs) {
    return;
  }
  lastTelemetryMs = millis();
  TelemetryPacket packet{};
  packet.magic = kTelemetryMagic;
  packet.version = kProtocolVersion;
  packet.flags = (roverReady ? kTelemetryI2cOk : 0) |
                 (armed ? kTelemetryArmed : 0) |
                 (motorsRunning ? kTelemetryMotorsRunning : 0) |
                 (WiFi.status() == WL_CONNECTED ? kTelemetryWifiOk : 0) |
                 (static_cast<uint8_t>(stopReason) << 4);
  packet.size = sizeof(packet);
  packet.sequence = lastSequence;
  packet.uptimeMs = millis();
  packet.x = commandX;
  packet.y = commandY;
  packet.z = commandZ;
  memcpy(packet.motors, appliedMotors, sizeof(appliedMotors));
  packet.gripperAngle = gripperAngle;
  packet.auxServoAngle = auxServoAngle;
  packet.rssi = static_cast<int8_t>(constrain(WiFi.RSSI(), -127, 0));
  packet.speedLimit = static_cast<uint8_t>(speedLimit);
  packet.packetAgeMs = static_cast<uint16_t>(
      min<uint32_t>(lastControlMs == 0 ? 0 : millis() - lastControlMs, 65535));
  packet.crc32 = crc32(reinterpret_cast<const uint8_t*>(&packet),
                      sizeof(packet) - sizeof(packet.crc32));
  udp.beginPacket(telemetryIp, telemetryPort);
  udp.write(reinterpret_cast<const uint8_t*>(&packet), sizeof(packet));
  udp.endPacket();
}

void processControlPacket(const ControlPacket& packet) {
  if (!validControl(packet, fnv1a(ROVER_API_TOKEN), armed, activeSessionId, lastSequence)) return;
  lastSequence = packet.sequence;
  lastControlMs = millis();
  linkWaiting = false;
  stopReason = kStopNone;
  telemetryIp = udp.remoteIP();
  telemetryPort = udp.remotePort();
  diagnosticPulse = false;

  if ((packet.flags & kFlagEmergencyStop) != 0) {
    disarm("UDP emergency stop");
    return;
  }
  if ((packet.flags & kFlagDeadman) == 0) {
    commandX = commandY = commandZ = 0;
    if (!stopAllMotors()) { enterI2cError("release failed"); return; }
    showState("ARMED", YELLOW);
    return;
  }

  commandX = constrain(packet.x, -1000, 1000);
  commandY = constrain(packet.y, -1000, 1000);
  commandZ = constrain(packet.z, -1000, 1000);
  const int requestedLimit = constrain(packet.speedLimit, 10, speedLimit);
  calculateMotorTargets(commandX, commandY, commandZ, requestedLimit);

  if ((packet.flags & kFlagGripperValid) != 0) {
    const uint8_t angle = constrain(packet.gripperAngle, kGripperMinAngle,
                                    kGripperMaxAngle);
    if (!writeServoAngle(0, angle)) {
      enterI2cError("gripper write failed");
      return;
    }
    gripperAngle = angle;
  }
  if ((packet.flags & kFlagAuxServoValid) != 0) {
    const uint8_t angle = constrain(packet.auxServoAngle, kAuxServoMinAngle,
                                    kAuxServoMaxAngle);
    if (!writeServoAngle(1, angle)) {
      enterI2cError("aux servo write failed");
      return;
    }
    auxServoAngle = angle;
  }
}

void processUdp() {
  const int packetSize = udp.parsePacket();
  if (packetSize <= 0) {
    return;
  }
  uint8_t buffer[128] = {};
  const int received = udp.read(buffer, sizeof(buffer));
  if (received == static_cast<int>(strlen(kDiscoveryRequest)) &&
      memcmp(buffer, kDiscoveryRequest, strlen(kDiscoveryRequest)) == 0) {
    sendDiscoveryReply();
    return;
  }
  if (received != sizeof(ControlPacket)) {
    return;
  }
  ControlPacket packet{};
  memcpy(&packet, buffer, sizeof(packet));
  processControlPacket(packet);
}

void maintainSafety() {
  if (safetyAction(armed, roverReady, WiFi.status() == WL_CONNECTED, linkWaiting, diagnosticPulse, millis(), lastControlMs, stopAtMs) == SafetyAction::StopDiagnostic) {
    if (!stopAllMotors()) { enterI2cError("diagnostic stop failed"); return; }
    showState(armed ? "ARMED" : "STOP", armed ? YELLOW : WHITE);
    Serial.println("STOP: diagnostic duration elapsed");
  }
  if (safetyAction(armed, roverReady, WiFi.status() == WL_CONNECTED, linkWaiting, diagnosticPulse, millis(), lastControlMs, stopAtMs) == SafetyAction::LinkWait) {
    commandX = commandY = commandZ = 0;
    if (!stopAllMotors()) {
      enterI2cError("timeout motor stop failed");
    } else {
      linkWaiting = true;
      recordStop(kStopControlTimeout, "control timeout; waiting for fresh input");
      showState("LINK WAIT", YELLOW);
    }
  }
  if (millis() - lastI2cCheckMs >= kI2cCheckIntervalMs) {
    lastI2cCheckMs = millis();
    if (!roverResponds()) {
      enterI2cError("RoverC Pro did not ACK");
    } else if (!roverReady) {
      if (!stopAllMotors()) { enterI2cError("recovery stop failed"); return; }
      roverReady = true;
      readServoTargets();
      showState("READY", GREEN);
      Serial.println("I2C RECOVERED: motors stopped");
    }
  }
  if (M5.BtnA.wasPressed()) {
    disarm("Button A emergency stop");
  }
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    startNetworkServices();
    return;
  }
  if (armed || motorsRunning) {
    disarm("Wi-Fi lost");
    if (roverReady) recordStop(kStopWifi, "Wi-Fi lost; ARM required");
  }
  if (networkServicesStarted) {
    server.stop();
    udp.stop();
    MDNS.end();
    networkServicesStarted = false;
    serverStarted = false;
  }
  showState("WIFI LOST", RED);
}

void safetyWorker(void*) {
  while (true) {
    {
      ControlGuard guard;
      M5.update();
      if ((armed || motorsRunning) && WiFi.status() != WL_CONNECTED) {
        disarm("Wi-Fi lost");
        if (roverReady) recordStop(kStopWifi, "Wi-Fi lost; ARM required");
      }
      maintainSafety();
      processMotorRamp();
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

}  // namespace

void setup() {
  controlMutex = xSemaphoreCreateRecursiveMutex();
  if (!controlMutex) abort();
  Serial.begin(115200);
  auto config = M5.config();
  M5.begin(config);
  M5.Display.setRotation(1);
  showState("STARTING", YELLOW);
  Serial.println("STARTING: Rover firmware 2.1-demo");

  Wire.begin(kSdaPin, kSclPin, 400000);
  Wire.setTimeOut(20);
  delay(10);
  roverReady = roverResponds();
  if (!roverReady || !stopAllMotors()) {
    enterI2cError("startup stop or probe failed");
  } else {
    readServoTargets();
    Serial.println("I2C OK: RoverC Pro found; motors stopped");
  }

  connectWifi();
  startNetworkServices();
  if (roverReady && WiFi.status() == WL_CONNECTED) {
    showState("READY", GREEN);
    Serial.println("READY: DISARMED");
  }
  safetyTaskReady = xTaskCreatePinnedToCore(safetyWorker, "rover-safety", 6144,
      nullptr, 2, nullptr, 1) == pdPASS;
}

void loop() {
  {
    ControlGuard guard;
    processUsbNetworkCommand();
  }
  wifiProfiles.poll(); // Network retries cannot block the independent stop task.
  {
    ControlGuard guard;
    maintainWifi();
  }
  if (WiFi.status() == WL_CONNECTED && serverStarted) {
    server.handleClient();
    ControlGuard guard;
    processUdp();
  }
  {
    ControlGuard guard;
    sendTelemetry();
  }
  delay(2);
}
