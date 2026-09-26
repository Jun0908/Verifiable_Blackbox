# 提出版の検証記録

実施日: 2026-09-26。Windows / Python 3.11.9。秘密設定の代わりにダミー設定を使用。
既存の別フォルダでの実機確認は、この版の成功結果に含めていません。

| 対象 | 結果 | 検証範囲 |
|---|---|---|
| Python全体 | 119テスト成功、skipなし | protocol、実HTTP/UDP模擬機体、Controller、Bridge期限、停止失敗、GUI模擬入力、カメラ、録画、ネットワーク、preflight |
| 単体Web / Chromium | 上記テスト内で成功 | 接続、長押し、解放、グリッパーACK、停止、ページ離脱、日英、390px幅、カメラ再接続、WebM保存と320×240再生 |
| Blackbox接続 | 上記テスト内で成功 | 実Next.js route関数→別プロセスの実Python Bridge→loopback模擬Rover。Jobデータ保持、操作終了マーカー、自動決済拒否、署名HTTP client |
| Firmware共有C++ | 成功 | packetサイズ・CRC・session・sequence・時刻wrap・停止条件。固定bytesをPythonと照合 |
| Device署名fixture | 成功 | FirmwareのABI encode / SHA-256 digestとアプリの一致、公開P-256 fixture、別Job拒否 |
| Rover通常Firmware | ビルド成功 | ESP32 core 2.0.16、Flash 1,027,185 bytes |
| Rover署名Firmware | ビルド成功 | ESP32 core 2.0.16、Flash 1,035,305 bytes |
| CamS3 Firmware / 機体版判別スケッチ | 両方ビルド成功 | ESP32 core 3.1.0、PSRAM=opi。カメラ本体の版は未確認 |
| 設定preflight | 未設定を検出、終了code 1 | ネットワーク・USBを開かず、設定値を出力しない |

通常版・署名版の最終ビルドには、HTTP読取待ちと分離した停止監視task、
診断出力のTelemetry反映を含みます。C++ホスト試験は共有protocol・停止判定の試験であり、
実ESP32のtask schedulingやI2C出力、物理停止時間を測定したものではありません。

## 再実行

ルートで以下を実行します。事前にREADMEのセットアップとChromium導入が必要です。
Blackbox連携と署名照合は、隣のアプリのnpm依存も使用します。

```powershell
powershell -File scripts/test-firmware.ps1
node scripts/check-signature.mjs
powershell -File scripts/build-rover.ps1
powershell -File scripts/build-rover.ps1 -Signature
powershell -File scripts/build-camera.ps1
powershell -File scripts/build-camera.ps1 -Detect
cd rover-python
.venv/Scripts/python.exe -m unittest discover -s tests -v
.venv/Scripts/python.exe preflight.py
```

すべて模擬試験／ビルドで、Firmware uploadや実機ARMは含みません。
ブラウザ試験の画像は `.tools/web-desktop.png` と `.tools/web-mobile.png` に生成します（Git対象外）。

## 未確認

- T11: Next.js全画面・Wallet・Chainを起動したJob引継ぎ／操作終了表示の通し確認。
- T12: 書込み、機体版、車輪極性、サーボ範囲、実停止、実ゲームパッド、実映像、実Wi-Fi切替、NVS鍵保持と実署名。

設定後は [HARDWARE_CHECKLIST.md](HARDWARE_CHECKLIST.md) に沿って確認します。
`physicalMovementVerified` と `paymentEnabled` は常にfalseのままです。
