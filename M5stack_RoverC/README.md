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
ビルドは `.venv/Scripts/pio.exe run -d ../m5stick-rover`（rover-pythonから実行）。
通常のビルドにuploadやFlash消去は含みません。

カメラはArduino CLIと `esp32:esp32@3.1.0` を使用します。機体版の判別とビルド手順は
カメラ実装時に `camera-firmware/README.md` へ記載します。

モーター値・サーボ角度は設定値であり、物理動作の測定ではありません。
操作・停止・映像・機体署名からEvidenceや支払いを自動生成しません。
秘密設定、録画、鍵・Flash backup、ログはGit対象外です。

既存の同プロジェクトのRover実装を基に、提出用の設計に合わせて移植・検証しています。
過去の実機試験結果は、この版の実機確認として引き継ぎません。
