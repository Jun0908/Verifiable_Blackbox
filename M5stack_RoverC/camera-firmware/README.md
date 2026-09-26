# Unit CamS3-5MP

Roverとは別のFirmware・USBポート・給電を使います。COM番号やIPは接続時に確認します。

## ビルド（書込みなし）

Arduino CLI 1.5.1、Arduino ESP32 core **3.1.0** を使用します。

```powershell
arduino-cli core install esp32:esp32@3.1.0 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
Copy-Item camera-firmware/RoverCamera/secrets.h.example camera-firmware/RoverCamera/secrets.h
# secrets.hを編集してから、ルートで実行
powershell -File scripts/build-camera.ps1
powershell -File scripts/build-camera.ps1 -Detect
```

`DetectCamera` はハードウェア版の読取用スケッチです。書込み・実機確認はT12で行います。
検出値 `0x01` の新版を対象に、標準カメラdriver、
`esp32:esp32:m5stack_unit_cams3:PSRAM=opi` を選択しています。
旧版 `0xFF` は別driverが必要なため、このビルドをそのまま書き込まないでください。
[M5Stack公式の判別・ビルド手順](https://docs.m5stack.com/en/arduino/m5unitcams3_5mp/program)を参照します。

STA接続後、`http://rover-camera.local/capture` がJPEG、
`http://rover-camera.local:81/stream` がMJPEGです。映像は暗号化・署名されていません。
ネットワーク切替API `/network` は `X-Rover-Token` で認証します。
Home／Hotspotは明示選択し、別profileへ自動fallbackしません。

PC側は最新フレームだけを保持し、切断・2秒以上の遅延で映像を消します。
画面のON/OFFは受信の切替で、カメラ本体の電源は操作しません。
この提出版では実カメラの型番・検出値・映像をまだ確認していません。
