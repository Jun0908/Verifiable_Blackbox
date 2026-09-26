# T12 実機確認（未実施）

ユーザーが後で実機設定を入れる予定のため、今回の実装では書込み・走行・サーボ操作を実施していません。
過去の別フォルダの実機結果は、この提出版の結果として扱いません。

## 設定するファイル

| ファイル | 設定内容 |
|---|---|
| `m5stick-rover/include/secrets.h` | RoverのHome／Hotspot SSID・password・API token |
| `camera-firmware/RoverCamera/secrets.h` | カメラのSSID・password・同じAPI token |
| `rover-python/.env` | Rover URL・同じAPI token |
| `rover-python/config/rover.json` | カメラURL・車輪極性・グリッパー範囲 |

すべてGit対象外です。各 `.example` から作成してください。
`rover-python` で `.venv/Scripts/python.exe preflight.py --ports` を実行すると、
値を表示せず設定有無・token一致・USB一覧を確認できます。シリアルポートは開きません。
`--probe` を明示した場合だけ、認証付きRover statusを読取ります。ARMは行いません。

## 順に確認すること

- [ ] Rover用M5とカメラのUSBを識別し、ポート・チップ・機体版を記録する。
- [ ] ビルド種別を確認して対象へ書き込む。通常の書込みでFlash消去を選ばず、NVSのWi-Fi profile・署名鍵を保持する。
- [ ] 起動時にDISARM・ゼロ設定・I2C正常を確認する。
- [ ] 車輪を浮かせ、`rover-python`で `.venv/Scripts/python.exe rover_client.py motor-test <1..4> --speed 20 --duration 300 --confirm-wheels-raised` を実行し、各輪の向きと停止を確認する。
- [ ] 低速35から前後・左右・斜め・旋回を確認し、車輪極性を校正する。
- [ ] グリッパーの開閉・長押しの閉じ増し・解放時保持・3°ゆるめる・位置保存を確認する。
- [ ] Button A・Web Stop・GUI Stop・入力途絶・Telemetry途絶・ページ離脱・タブ非表示で停止を確認する。
- [ ] Wi-Fi切断、I2C異常、USB復旧後、再接続だけで走行を再開しないことを確認する。
- [ ] 実カメラの映像、切断・再接続、古い画像の消去、録画保存・再生を確認する。
- [ ] Home／Hotspotを明示的に往復し、PC・Rover・カメラの同一LAN接続を確認する。
- [ ] 停止・DISARM中に公開鍵取得・Job署名・P-256照合を行い、再起動後の公開鍵一致を確認する。
- [ ] Web・GUI・Blackboxを一つずつ起動して通し操作する。BlackboxのJob引継ぎ・操作終了表示も確認する。

機体のHTTP応答やゼロ設定値は物理的静止の計測ではありません。停止確認エラーが出た場合は実物を確認します。
実施日時・機体識別・Firmware commit・校正値・観察結果をローカル記録へ残し、確認した項目だけTASKSへ反映します。
