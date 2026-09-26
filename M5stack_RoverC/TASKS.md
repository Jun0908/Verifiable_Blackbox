# Verifiable Blackbox — M5Stack RoverC Tasks

作成日: 2026-09-26

[ARCHITECTURE.md](ARCHITECTURE.md)に基づき、機体制御からアプリ接続までを実装する。変更履歴はGitのログで管理する。

## 進め方

実装順は`T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12`。依存関係が満たされればGUI・カメラ・署名は個別に進められる。模擬試験、ビルド、Firmware書込み、実機動作確認を区別し、確認した項目だけを完了にする。

| タスク | 成果 |
|---|---|
| T01 | 開発環境・設定テンプレート |
| T02 | Rover Firmwareと停止処理 |
| T03 | Python通信・Controller・診断CLI |
| T04 | HTTP Bridgeと操作期限 |
| T05 | 単体Webとグリッパー |
| T06 | GUIとゲームパッド |
| T07 | カメラFirmwareと映像受信 |
| T08 | 単体Web録画 |
| T09 | Home／Hotspot切替と復旧 |
| T10 | 停止中のDevice署名 |
| T11 | Blackboxとの接続 |
| T12 | 実機校正・停止試験・通し確認 |

## T01 — 開発環境と設定

依存: なし。

- [x] PlatformIO、Arduino CLI、Python仮想環境、Python試験環境を用意し、SDK・board・依存関係を固定する。
- [x] FirmwareとPythonのディレクトリ、設定テンプレート、起動スクリプト、READMEを作る。
- [x] Wi-Fi・API token・カメラURL・車輪極性・サーボ範囲を設定項目として分離する。
- [x] 秘密設定、録画、ログ、Flash backup、生成物をGit対象外にする。

完了条件: クリーンな作業場所で依存を導入し、模擬設定によるPython試験とFirmwareビルド準備を再現できる。通常のセットアップで実機へ書き込まない。

## T02 — Rover Firmwareと停止処理

依存: T01。

- [x] M5StickC Plus2、I2C `0x38`、4輪モーター、S1／S2サーボを初期化し、起動時ゼロ出力・DISARMにする。
- [x] mecanum mixer、速度上限、車輪極性、出力ramp、サーボ範囲を実装する。
- [x] 認証付きstatus・ARM・DISARM・Stop・設定・時間制限付き診断APIを実装する。
- [x] UDP探索・34-byte指令・36-byte Telemetry・CRC・session・sequence検査を実装する。
- [x] Button A、1000ms操作timeout、Wi-Fi切断、I2C異常、診断時間満了時の停止を実装する。

完了条件: Firmwareがビルドでき、packet fixtureと状態遷移試験で無効指令の拒否、ゼロ出力、復帰条件を確認できる。実機の方向・停止確認はT12で行う。

## T03 — Python通信とController

依存: T02。

- [x] `models.py`、`protocol.py`、`api.py`、`mixer.py`、`control.py`を実装する。
- [x] Firmwareと共通の固定packetを使い、encoding・decoding・CRC・flagsを試験する。
- [x] 探索、ARM session取得、25Hz送信、最新Telemetry読取、終了時Stopを実装する。
- [x] 古いマウス／サーボ入力の再送期限を1秒にし、通信を画面描画から分離する。
- [x] CLIのdiscover・status・stopと、条件を明示して実行するpulse・motor-test・servo-testを分ける。

完了条件: 模擬HTTP／UDPで接続・指令・状態受信・切断を確認できる。別session、CRC不正、古い応答を正常操作として使わない。

## T04 — HTTP Bridgeと操作期限

依存: T03。

- [x] `web_bridge_server.py`と`RoverWebBridge`を作り、loopbackと起動ごとのBearer tokenでAPIを提供する。
- [x] activate・drive・release・stop、Web session、単調増加sequenceを実装する。
- [x] 450ms更新切れでゼロ指令とrelease待ち、800ms Telemetry切れで停止・切断、60秒無操作で切断する。
- [x] 停止の要求中・完了・確認失敗を状態として分ける。
- [x] 起動時にはARMせず、`physicalMovementVerified=false`、`paymentEnabled=false`を返す。

完了条件: 模擬時計とControllerで正常操作・遅延・再送・通信断・停止失敗を試験できる。期限切れ後のdriveだけでは操作が再開しない。

## T05 — 単体Webとグリッパー

依存: T04。

- [ ] `--web`で起動するHTML・CSS・JavaScript、日英切替、接続・方向・速度・停止UIを作る。
- [ ] 長押し更新、pointer解放・取消、タブ非表示・ページ離脱時の停止を接続する。
- [ ] グリッパーの開く・段階的に閉じる・releaseを同じsession／sequenceへ接続する。
- [ ] 受信確認後に次の角度へ進み、更新切れや解放では閉じ増しを止める。
- [ ] Host・Origin・token・本文上限を検査する。

完了条件: 模擬Bridgeのブラウザ操作で長押し・解放・停止・アーム操作が成立する。画面表示だけではARMせず、操作によってJobや支払いを変更しない。

## T06 — GUIとゲームパッド

依存: T03。

- [ ] PySide6画面、自動探索・接続・ARM、接続状態、Stop、日英切替を作る。
- [ ] pygame-ceによる入力読取を分離し、250msの入力期限と中立確認を実装する。
- [ ] 前後・横・斜め・旋回、速度3段階、gripper、Stopの割当と設定画面を作る。
- [ ] GUIの短押し・長押し、1°閉じ増し、3°ゆるめる、把持位置保存・呼出を実装する。
- [ ] 接続直後のゼロ入力、Telemetry切れ、Controller切断、GUI終了時の停止を試験する。

完了条件: ゲームパッドなしでも操作でき、模擬入力で中立復帰・入力停止・GUI描画停止時に古い指令が続かない。実際のゲームパッドと機体の確認はT12で行う。

## T07 — カメラFirmwareと映像受信

依存: T01・T04・T05。GUIへの表示はT06にも依存。

- [ ] CamS3-5MPのハードウェア版確認、board／PSRAM設定、カメラFirmwareのビルドを用意する。
- [ ] STA接続、JPEG／MJPEG、mDNSを実装する。
- [ ] `CameraStream`と`WebCamera`で受信・再接続・最新画像保持を実装する。
- [ ] GUIと単体Webに映像・URL設定・受信ON/OFFを追加し、2秒以上古い映像を消す。
- [ ] camera APIをアプリ中継でも使えるようにし、カメラ接続からARMを呼ばない。

完了条件: カメラFirmwareがビルドでき、模擬MJPEGで画像更新・切断・再接続・設定保存を確認できる。映像受信停止が走行の停止操作を妨げない。

## T08 — 単体Web録画

依存: T07。

- [ ] ブラウザで音声なしWebM録画、REC表示、経過時間、停止操作を提供する。
- [ ] カメラOFF・切断・タブ非表示・10分／容量上限で録画を終了する。
- [ ] 認証付き保存APIでContent-Type・サイズ・WebM headerを確認し、Server側のファイル名で保存する。
- [ ] 不完全なuploadを処理し、保存失敗時にブラウザ保存の導線を出す。

完了条件: 短い録画を保存・再生でき、保存先が`recordings/`内に限定される。録画失敗でも走行・停止処理が動作する。

## T09 — Home／Hotspot切替と復旧

依存: T02・T03・T07。

- [ ] Roverとカメラにprofileの保存・読取・認証付き明示切替APIを実装する。
- [ ] 切替前に機体を停止し、ネットワーク処理中も停止処理を継続する。
- [ ] WindowsのPC接続先選択と両機器の探索・疎通確認を専用moduleへ分ける。
- [ ] USBシリアルによるprofile選択と、他OSでの手動接続手順を用意する。
- [ ] profile未設定、接続先不在、DHCP待ち、片方だけ接続できた状態を区別する。

完了条件: 模擬試験で設定保持と明示切替が成立する。失敗時に別profileへ自動で切り替えず、機体を停止状態に保つ。実ネットワーク試験はT12で確認する。

## T10 — 停止中のDevice署名

依存: T02。

- [ ] `m5stick-c-plus2-signature`環境とfeature flagを追加し、通常buildと分ける。
- [ ] P-256鍵のNVS生成・再読込、公開鍵取得、Job識別情報のhash・low-S署名を実装する。
- [ ] 認証付き署名API、busy／ready／error、直近要求のキャッシュを実装する。
- [ ] ARM中の署名、署名中のARMを拒否し、鍵破損時に自動再生成しない。
- [ ] 署名処理を別taskで動かし、停止・watchdogを塞がない。

完了条件: 通常buildと署名buildが成功し、固定fixtureのdigestをアプリ側と照合できる。実鍵生成・再起動後の公開鍵一致・署名確認はT12で実施する。

## T11 — Blackboxアプリとの接続

依存: T04・T05・T07・T10。

- [ ] アプリlauncherの`ROVER_PYTHON_ROOT`／`ROVER_PYTHON`からこのPython環境を起動する手順を用意する。
- [ ] `--camera --no-browser`、起動token、port、起動待ち、終了処理をアプリと照合する。
- [ ] Next.js経由のdrive・release・stop・gripper・cameraを模擬機体で確認する。
- [ ] アプリのJob引継ぎと操作終了表示を確認し、自由操作や停止から自動決済しないことを検証する。
- [ ] 停止中の署名APIをアプリの独立署名CLIから呼ぶ試験を用意する。ENS／ERC-7913はアプリ側で検証する。

完了条件: 模擬環境でアプリから接続・操作・停止・映像表示まで通る。BridgeへEthereumの秘密鍵を渡さず、署名確認と支払いの処理が独立している。

## T12 — 実機校正・停止試験・通し確認

依存: T05・T06・T07・T08・T09・T10・T11。

- [ ] 接続機器・USBポート・Firmware種別を確認して書き込み、Wi-Fi設定と署名鍵を保持する。Flash消去は通常の書込み手順に含めない。
- [ ] 車輪を浮かせて各輪の向き・極性・停止を確認し、低速から前後・横・旋回とグリッパー範囲を校正する。
- [ ] Button A、Web Stop、GUI Stop、入力途絶、Telemetry途絶、ページ離脱の停止・復帰を確認する。
- [ ] カメラの実映像、再接続、録画再生、Home／Hotspot切替を確認する。
- [ ] DISARM中の実機署名、P-256照合、再起動後の公開鍵保持を確認する。
- [ ] 単体Web・GUI・Blackboxを一つずつ起動して通し確認し、対象機器・起動・校正・復旧手順をREADMEへまとめる。

完了条件: 実機の走行・開閉・停止・映像・録画・接続切替・署名が各画面から利用できる。模擬試験だけで実機確認を完了扱いにせず、未確認項目はチェックを残す。

## 将来の拡張

- encoder等による実速度・距離計測、把持力・接触の検出。
- Device署名付きの走行ログ・画像Evidenceと物理作業の検証。
- Secure Element、Secure Boot、Flash Encryption、鍵失効。
- 認証・暗号化を強化した機体通信、複数機体の管理。

これらはT01〜T12の対象外とし、個別に設計する。
