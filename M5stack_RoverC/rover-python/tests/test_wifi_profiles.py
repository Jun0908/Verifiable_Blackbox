"""Exercise the actual firmware retry state machine with a fake Wi-Fi driver."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class WifiProfileTests(unittest.TestCase):
    def test_rover_and_camera_use_identical_policy(self):
        self.assertEqual(
            (ROOT / "m5stick-rover/include/wifi_profiles.h").read_bytes(),
            (ROOT / "camera-firmware/RoverCamera/wifi_profiles.h").read_bytes(),
        )

    def test_explicit_selection_persistence_no_fallback_and_millis_wrap(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            (path / "wifi_profiles.h").write_bytes((ROOT / "m5stick-rover/include/wifi_profiles.h").read_bytes())
            (path / "Arduino.h").write_text('''#pragma once
#include <cstdint>
#include <cassert>
uint32_t now = 0;
uint32_t millis() { return now; }
struct SerialFake { template <typename... T> void printf(const char*, T...) {} } Serial;
''')
            (path / "Preferences.h").write_text('''#pragma once
unsigned char savedProfile = 255;
class Preferences {
 public:
  bool begin(const char*, bool) { return true; }
  unsigned char getUChar(const char*, unsigned char fallback) { return savedProfile == 255 ? fallback : savedProfile; }
  unsigned int putUChar(const char*, unsigned char value) { savedProfile = value; return 1; }
};
''')
            (path / "WiFi.h").write_text('''#pragma once
#include <string>
#include <vector>
enum { WIFI_STA, WL_CONNECTED, WL_DISCONNECTED };
struct WifiFake {
  int state = WL_DISCONNECTED;
  std::vector<std::string> attempts;
  void mode(int) {}
  void setHostname(const char*) {}
  void setAutoReconnect(bool on) { assert(!on); }
  int status() { return state; }
  void disconnect() { state = WL_DISCONNECTED; }
  void begin(const char* ssid, const char*) { attempts.push_back(ssid); }
} WiFi;
''')
            (path / "secrets.h").write_text('''#pragma once
#ifndef NO_PRIMARY
#define ROVER_WIFI_SSID "home"
#else
#define ROVER_WIFI_SSID ""
#endif
#define ROVER_WIFI_PASSWORD "dummy"
#ifndef NO_HOTSPOT
#define ROVER_HOTSPOT_SSID "mobile"
#define ROVER_HOTSPOT_PASSWORD "dummy"
#else
#define ROVER_HOTSPOT_SSID ""
#define ROVER_HOTSPOT_PASSWORD ""
#endif
''')
            (path / "test.cpp").write_text('''#include "wifi_profiles.h"
int main() {
  WifiProfiles profiles;
  profiles.begin("test");
  const bool primary = ROVER_WIFI_SSID[0];
  const bool mobile = ROVER_HOTSPOT_SSID[0];
  if (!primary && !mobile) {
    now = 15000; profiles.poll(); assert(WiFi.attempts.empty()); return 0;
  }
  const char* first = primary ? "home" : "mobile";
  assert(WiFi.attempts.size() == 1 && WiFi.attempts.back() == first);
  now = 14999; profiles.poll(); assert(WiFi.attempts.size() == 1);
  now = 15000; profiles.poll(); assert(WiFi.attempts.size() == 2);
  assert(WiFi.attempts.back() == first); // No automatic fallback.
  WiFi.state = WL_CONNECTED; profiles.poll();
  now = 50000; profiles.poll(); assert(WiFi.attempts.size() == 2);
  WiFi.state = WL_DISCONNECTED; profiles.poll();
  assert(WiFi.attempts.size() == 3 && WiFi.attempts.back() == first);
  now = 64999; profiles.poll(); assert(WiFi.attempts.size() == 3);
  now = 65000; profiles.poll();
  assert(WiFi.attempts.size() == 4 && WiFi.attempts.back() == first);
  // Unsigned elapsed-time calculation must survive millis() wraparound.
  now = 0xfffffff0u;
  WifiProfiles wrapping; wrapping.begin("test");
  now += 14999; wrapping.poll(); assert(WiFi.attempts.size() == 5);
  now += 1; wrapping.poll(); assert(WiFi.attempts.size() == 6);
  if (primary && mobile) {
    assert(wrapping.select(true));
    assert(wrapping.switchPending());
    now += 999; wrapping.poll(); assert(WiFi.attempts.back() == "home");
    now += 1; wrapping.poll(); assert(WiFi.attempts.back() == "mobile");
    assert(!wrapping.switchPending());
    now += 15000; wrapping.poll(); assert(WiFi.attempts.back() == "mobile");
    WifiProfiles rebooted; rebooted.begin("test");
    assert(WiFi.attempts.back() == "mobile"); // Explicit choice survives reboot.
    assert(rebooted.select(false)); now += 1000; rebooted.poll();
    assert(WiFi.attempts.back() == "home");
  } else {
    assert(!wrapping.select(!mobile)); // Reject an unconfigured network.
  }
}
''')
            import sys
            for defines in [[], ["-DNO_HOTSPOT"], ["-DNO_PRIMARY"], ["-DNO_HOTSPOT", "-DNO_PRIMARY"]]:
                result = subprocess.run([sys.executable, "-m", "ziglang", "c++", "-std=c++17", "-I.", *defines, "test.cpp", "-o", "test.exe"], cwd=path, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                result = subprocess.run([str(path / "test.exe")], cwd=path, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
