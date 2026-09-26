# M5Stack RoverC — Verifiable Blackbox

M5StickC Plus2 / RoverC ProをローカルLANから操作します。設計は
[ARCHITECTURE.md](ARCHITECTURE.md)、進捗は[TASKS.md](TASKS.md)を参照してください。

## セットアップ

Windows / Python 3.11以降で `powershell -ExecutionPolicy Bypass -File setup.ps1`。
依存は `rover-python/requirements*.txt` に固定しています。セットアップは実機へ接続・書込みしません。

```powershell
cd rover-python
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

`rover-python/.env.example` を `.env` へコピーし、探索したURLと機体tokenを設定します。
`config/*.example.json` はPC側設定のひな形です。通常の設定は `config/rover.json`、
ゲームパッド設定は `config/controller.json` に保存します。

Firmwareは `m5stick-rover/include/secrets.h.example` を `secrets.h` にコピーして設定します。
ビルドはルートから `powershell -File scripts/build-rover.ps1`。
packet・停止条件のC++ホスト試験は `powershell -File scripts/test-firmware.ps1`。
通常のビルドにuploadやFlash消去は含みません。

カメラはArduino CLI 1.5.1と `esp32:esp32@3.1.0` を使用します。
[機体版の判別とビルド手順](camera-firmware/README.md)を確認してください。

## 起動

- 単体Web：`start_rover_web.cmd`。画面の「接続」でARMします。
- GUI：`rover-python/start_rover_gui.cmd`。起動後に探索・接続・ARMします。
- [Home／HotspotとUSB復旧](docs/NETWORK.md)
- [Blackbox接続と模擬API試験](docs/BLACKBOX.md)
- [停止中のDevice署名](docs/DEVICE_SIGNATURE.md)
- [実機設定とT12確認チェックリスト](docs/HARDWARE_CHECKLIST.md)
- [検証結果と未確認項目](docs/VALIDATION.md)

ブラウザ試験を実行する前に `.venv/Scripts/python.exe -m playwright install chromium` を実行してください。
全Python試験はloopbackと模擬入力を使用します。GUIを直接起動することとは区別してください。
Web・GUI・Blackboxは一つずつ使用し、終了時はStopで切断します。

モーター値・サーボ角度は設定値であり、物理動作の測定ではありません。
操作・停止・映像・機体署名からEvidenceや支払いを自動生成しません。
秘密設定、録画、鍵・Flash backup、ログはGit対象外です。

既存の同プロジェクトのRover実装を基に、提出用の設計に合わせて移植・検証しています。
過去の実機試験結果は、この版の実機確認として引き継ぎません。
