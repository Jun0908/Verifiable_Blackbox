#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include "secrets.h"
#include "wifi_profiles.h"

// ===========================
// Select camera model in board_config.h
// ===========================
#include "board_config.h"

// ===========================
// Enter your WiFi credentials
// ===========================
WifiProfiles wifiProfiles;
bool cameraReady = false;
bool cameraServerStarted = false;
bool cameraNetworkConnected = false;

void startCameraServer();
void setupLedFlash();

void setup() {
  Serial.begin(115200);
  // Core 3.1.0 HWCDC decrements an unsigned retry counter; zero can underflow
  // when the USB host stops draining output. Keep logging strictly bounded.
  Serial.setTxTimeoutMs(10);
  Serial.setDebugOutput(false);
  Serial.println();

  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
#ifdef CAMERA_MODEL_M5STACK_CAMS3_UNIT
  config.frame_size = FRAMESIZE_QVGA;
#else
  config.frame_size = FRAMESIZE_UXGA;
#endif
  config.pixel_format = PIXFORMAT_JPEG;  // for streaming
  // config.pixel_format = PIXFORMAT_RGB565; // for face detection/recognition
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  // if PSRAM IC present, init with UXGA resolution and higher JPEG quality
  //                      for larger pre-allocated frame buffer.
  if (config.pixel_format == PIXFORMAT_JPEG) {
    if (psramFound()) {
      config.jpeg_quality = 10;
#ifdef CAMERA_MODEL_M5STACK_CAMS3_UNIT
      config.fb_count = 1;
#else
      config.fb_count = 2;
#endif
      config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
      // Limit the frame size when PSRAM is not available
      config.frame_size = FRAMESIZE_SVGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  } else {
    // Best option for face detection/recognition
    config.frame_size = FRAMESIZE_240X240;
#if CONFIG_IDF_TARGET_ESP32S3
    config.fb_count = 2;
#endif
  }

#if defined(CAMERA_MODEL_ESP_EYE)
  pinMode(13, INPUT_PULLUP);
  pinMode(14, INPUT_PULLUP);
#endif

  // camera init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return;
  }

  sensor_t *s = esp_camera_sensor_get();
  // initial sensors are flipped vertically and colors are a bit saturated
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);        // flip it back
    s->set_brightness(s, 1);   // up the brightness just a bit
    s->set_saturation(s, -2);  // lower the saturation
  }
  // drop down frame size for higher initial frame rate
  if (config.pixel_format == PIXFORMAT_JPEG) {
    s->set_framesize(s, FRAMESIZE_QVGA);
  }

#if defined(CAMERA_MODEL_M5STACK_WIDE) || defined(CAMERA_MODEL_M5STACK_ESP32CAM)
  s->set_vflip(s, 1);
  s->set_hmirror(s, 1);
#endif

#if defined(CAMERA_MODEL_ESP32S3_EYE)
  s->set_vflip(s, 1);
#endif

// No flash lamp: avoid sharing the camera XCLK's LEDC timer/channel.
#if defined(LED_GPIO_NUM)
  pinMode(LED_GPIO_NUM, OUTPUT);
  digitalWrite(LED_GPIO_NUM, LOW);
#endif

  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED && Serial) {
      Serial.printf("\nWiFi disconnected reason=%u\n", info.wifi_sta_disconnected.reason);
    }
  });
  wifiProfiles.begin("rover-camera");
  WiFi.setSleep(false);
  cameraReady = true;
}

void loop() {
  if (cameraReady) {
    wifiProfiles.poll();
    const bool connected = WiFi.status() == WL_CONNECTED;
    if (connected && !cameraNetworkConnected) {
      if (MDNS.begin("rover-camera")) MDNS.addService("http", "tcp", 80);
      if (!cameraServerStarted) {
        startCameraServer();
        cameraServerStarted = true;
      }
      Serial.print("Camera Ready! Use 'http://");
      Serial.print(WiFi.localIP());
      Serial.println("' to connect");
    } else if (!connected && cameraNetworkConnected) {
      MDNS.end();
    }
    cameraNetworkConnected = connected;
  }
  delay(20);
}
