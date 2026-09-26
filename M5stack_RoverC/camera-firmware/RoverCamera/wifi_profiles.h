#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <atomic>
#include "secrets.h"

// Keep this header identical to camera-firmware/RoverCamera/wifi_profiles.h.
// Configure all Wi-Fi credentials in the private secrets.h only.
// The launcher explicitly selects a network. Never fall back to the other LAN.

class WifiProfiles {
 public:
  void begin(const char* hostname) {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(hostname);
    // Retry timing belongs to this state machine, not two competing reconnectors.
    WiFi.setAutoReconnect(false);
    preferences_.begin("rover-network", false);
    profile_ = preferences_.getUChar("profile", ROVER_WIFI_SSID[0] ? 0 : 1) == 1 ? 1 : 0;
    attempt();
  }

  bool configured(bool hotspot) const {
    return (hotspot ? ROVER_HOTSPOT_SSID : ROVER_WIFI_SSID)[0] != '\0';
  }

  const char* profileName() const { return profile_ == 1 ? "hotspot" : "home"; }
  bool switchPending() const { return pending_.load() >= 0; }

  bool select(bool hotspot) {
    if (!configured(hotspot)) return false;
    requestedAt_ = millis();
    pending_ = hotspot ? 1 : 0;
    return true;
  }

  void poll() {
    // HTTP response must leave the old network before we disconnect it.
    if (switchPending() && static_cast<uint32_t>(millis() - requestedAt_) >= 1000) {
      const int requested = pending_.exchange(-1);
      if (requested != profile_) {
        profile_ = requested;
        preferences_.putUChar("profile", profile_);
        connected_ = false;
        attempt();
      }
    }
    if (WiFi.status() == WL_CONNECTED) {
      connected_ = true;
      return;  // Never switch a working connection just because another AP appears.
    }
    if (connected_) {
      connected_ = false;
      attempt();  // Give the last working network one full retry first.
    } else if (static_cast<uint32_t>(millis() - attemptedAt_) >= 15000) {
      attempt();
    }
  }

 private:
  void attempt() {
    attemptedAt_ = millis();
    const char* ssid = profile_ == 0 ? ROVER_WIFI_SSID : ROVER_HOTSPOT_SSID;
    const char* password = profile_ == 0 ? ROVER_WIFI_PASSWORD : ROVER_HOTSPOT_PASSWORD;
    if (!ssid[0]) return;
    WiFi.disconnect();  // Does not erase saved credentials or turn off the radio.
    Serial.printf("WiFi trying %s profile\n", profile_ == 0 ? "primary" : "hotspot");
    WiFi.begin(ssid, password);
  }

  Preferences preferences_;
  std::atomic<int> profile_{0};
  std::atomic<int> pending_{-1};
  std::atomic<uint32_t> requestedAt_{0};
  uint32_t attemptedAt_ = 0;
  bool connected_ = false;
};
