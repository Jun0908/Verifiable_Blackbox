# Verifiable Blackbox — Tasks

更新日: 2026-09-26

## 今回のゴール

**前ボタンを押したかを記録し、今回のRaw動画をStegaVARで3択判定して、承認した条件で報酬を支払う。**

通常は動画認識を使う。隠し設定でスキップを承認すれば、「判定できていない」でも前ボタン・前進送信成功・停止確認の記録から支払う。判定結果はそのまま残す。

## 現在の状態

| 機能 | 状態 |
|---|---|
| Web・Wallet・Job作成・Contract・Phala接続（T01〜T12） | 実装済み。模擬EvidenceでPhala検証・Sepolia決済を確認。実機からの有人通し確認はT32に残る |
| 支払台帳・月次集計・CSV（T13〜T17） | 完了 |
| StegaVARの公開映像・比較・再解析（T18〜T24） | 完了。今回撮影したRaw動画の受付もT27で実装済み |
| セッション・所有者署名・隠し設定・停止後の追加承認（T25） | 完了。14件の試験・ブラウザー確認・ビルドが成功 |
| 前ボタンの押下・解放、録画・前進送信と停止の記録（T26） | 完了。模擬機体で確認 |

**前ボタン記録・今回の動画判定・画面表示は実装済み。支払い接続は未完成。隠し設定の承認保存だけでは送金しない。**

## 進め方

残りは次の5タスク。番号はArchitectureとの対応に使う。

**T26 前ボタン記録 → T27 動画判定 → T30 画面表示 → T29 支払い → T32 通し確認**

各タスクの完了時に必要な試験を行い、commit・Pushする。コミットには追加した機能を書く。実装の詳細は[ARCHITECTURE.md](ARCHITECTURE.md)を参照する。

カメラ確認はT32に、証拠作成（T28）はT29に、ローカル試験（T31）は各タスクの完了確認に含める。

## T01 — 再現可能な開発環境

依存: なし。主な成果物: `package.json`、`apps/web/package.json`、`foundry.toml`、`.gitignore`、`README.md`。

- [x] npm workspaces、`apps/web`、TypeScript、Next.js App Routerの最小構成を作る。
- [x] Node／npm／Foundryの利用版、OpenZeppelin等の取得方法と固定revisionを記録する。クリーンインストールを確認して依存関係を固定する。
- [x] `.gitignore`、ダミー値の`.env.example`、セットアップREADMEを作る。秘密設定・履歴・実機データはGit対象外にする。
- [x] `dev:web`、`typecheck:web`、`build:web`を用意し、将来のContract・試験コマンドをREADMEで段階別に記載する。
- [x] 外部サービスなしでWebを起動できる状態を確認する。Rover／Phalaは後続タスクで接続する。

完了条件: アプリrootから依存導入・型チェック・production buildが成功し、空のトップページを表示できる。

## T02 — DashboardとRover画面の骨格

依存: T01。主な成果物: `apps/web/app/page.tsx`、`apps/web/app/rover/page.tsx`、`apps/web/components/`。

- [x] Header、英語／日本語切替、Dashboard、`/rover`、共通のエラー・進捗表示を作る。
- [x] DashboardをJob作成、進捗、履歴、Receipt、サンプル決済に分ける。
- [x] fixtureだけで未作成・Funded・検証中・支払済み・失敗の表示を作る。未接続の操作ボタンは無効化する。
- [x] PC幅と390px幅で導線と主要操作を確認し、fixture表示はsampleと明記する。

完了条件: 外部サービスなしで画面遷移・日英切替ができ、想定フローを説明できる。

## T03 — ContractとEvidence

依存: T01。主な成果物: `packages/contracts/`、`apps/web/lib/contracts.ts`、Evidenceのテストfixture。

- [x] ERC-8183参照実装のsnapshotと出典を管理し、Core拡張、mUSDC、Hook、Evaluatorを実装する。
- [x] ABI、Evidence parser／commitment、Verdict型／EIP-712、Deployment型を実装する。
- [x] 正常／改ざんfixtureを用意し、同一入力に対するTypeScript・Solidityのhash一致を確認する。
- [x] Local AnvilへのdeployとFoundry試験を用意する。ERC-7913はT10で独立追加する。
- [x] 不正署名、commitment不一致、期限切れ、同じVerdictの再使用を拒否する試験を行う。

完了条件: 正常時に100 mUSDCがProviderへ支払われ、Receiptが発行される。不正なケースは送金・Receiptが発生しない。残高とContract状態で検証する。

## T04 — ローカルのWeb決済

依存: T02・T03。主な成果物: `apps/web/app/providers.tsx`、`apps/web/lib/server/`、`apps/web/app/api/demo/`。

- [x] Privy LoginとClient Wallet、Chain確認、公開設定APIを接続する。
- [x] Client署名でJobを作成し、`JobCreated`からJob IDを取得する。
- [x] Provider、Mock Verifier、RelayerをServer専用に分け、サンプルEvidenceのsubmit→verify→settleを実装する。
- [x] config／rpc／faucet／provider／verify／settleの必要APIと入出力・エラーを資料化する。
- [x] Local専用の起動設定と必要なAPI制限を設け、実鍵をBrowserへ渡さない。

完了条件: ブラウザからLocalの成功例と改ざん例を実行できる。Chain上のJob・残高・Receiptと画面が一致する。

## T05 — 署名付き承認と中断からの復旧

依存: T04。主な成果物: `apps/web/lib/demo-review.ts`、`apps/web/lib/server/demo-review.ts`、review API、`scripts/test-demo-review.mjs`。

- [x] `prepare`／`verify-and-pay`を実装し、承認contextと署名文面を定義する。文面には対象Job・支払い条件・承認文書を検証する旨を含める。
- [x] Serverで所有者署名、期限、Chain・Core・Job・Evaluator・Token・Provider・金額を照合する。
- [x] 署名済み承認文書のhashをEvidenceの`imageHash`へ格納する。
- [x] reviewの6段階、排他lock、atomicな保存、送信Tx hashの保存、再照会を実装する。
- [x] 二重クリック・同時要求・再読込・送信結果不明・残留lockの復旧手順を用意する。未知の送信を自動再送しない。
- [x] `/api/demo/rover/complete`のPOSTは409 `PHYSICAL_MOVEMENT_NOT_VERIFIED`を返す。走行指令だけでは支払いに進めない。

完了条件: 正常な所有者承認だけが支払いに進む。署名なし／別Wallet／context変更／期限切れを拒否し、途中再試行でも重複支払いしない。送信結果不明なら復旧待ちになる。操作完了APIからの自動支払いを拒否する。

## T06 — Job進捗・履歴・領収書

依存: T05。主な成果物: `apps/web/lib/`のJob・履歴・機体情報管理、Dashboardの進捗・履歴・領収書コンポーネント。

- [x] 選択中Jobと保存履歴をWallet・Chain・Coreごとに分離する。
- [x] 作成Tx、Job、commitment、検証元、Receipt、支払いTxを表示する。
- [x] 完了済み・サンプル・別WalletのJobを実機仕事として引き継がない。
- [x] 新しいJobに切り替えても前のJobを履歴に残す。画面操作だけで返金・完了した扱いにしない。
- [x] 登録済み機体のENS名／鍵ID表示と、当該Jobの署名照合結果を分ける。照合していないJobは「未照合」とする。

完了条件: 再読込・Wallet切替・Job切替で誤った履歴や支払い状態を表示しない。保存したJobを開いた際にChainの最新状態と照合する。

## T07 — Phalaへの接続

依存: T05。主な成果物: `apps/web/lib/server/verifier.ts`、Attestation API、Phala接続用の設定・E2E runner。

- [x] `MOCK_TEE`／`PHALA`を明示設定にし、Phala障害時の自動fallbackを禁止する。
- [x] 応答schema、入力との一致、trusted signer、EIP-712署名、期限をSettlement前に確認する。
- [x] fresh nonce付きAttestationを取得し、mode／attested／simulated／signerを区別して表示する。quote取得とquote検証済みを混同しない。
- [x] E2E runnerでAnvil＋Phala LOCAL_DEV＋Webを起動し、Evidence commitmentの一致、承認→支払い、不正入力拒否を検証する。
- [x] 実Phala／SepoliaのchainId・Core・Hook・Evaluator・trusted signerを照合し、実環境用の接続手順を作る。2026-09-26の新規デプロイとTEE quote検証を `docs/internal/VALIDATION.md` に記録。

完了条件: LOCAL_DEVでE2E成功。署名不一致・Phala通信失敗・不正Evidenceでは支払わない。実Phala確認は別記録にし、未実施なら未実施と明示する。

## T08 — Rover Bridgeと停止動作

依存: T02・T05・T06。主な成果物: Rover操作コンポーネント、ページ離脱時の停止処理、control API、Web／Bridge launcher。

- [x] launcherの既定Roverパスを`../../M5stack_RoverC/rover-python`とし、`ROVER_PYTHON_ROOT`で上書きできるようにする。
- [x] loopback、起動ごとのBridge token、同一Origin、session／sequenceを保持してcontrol APIを中継する。
- [x] 自由操作とJob操作を実装し、接続ボタンを押す前にはARMしない。
- [x] 速度35／60／85、長押し走行、離して停止、Stop、タブ非表示・ページ離脱時の停止を実装する。
- [x] Bridgeの450ms操作更新切れ・Telemetry切れ・古いsequence・I2C異常時の停止を模擬入力で確認する。
- [x] 停止確認後だけ操作終了を記録する。停止失敗は成功として表示しない。操作からEvidence・支払いは生成しない。
- [x] 3000／8765の競合、Python未導入、機体未接続を起動時に説明する。

完了条件: 模擬Bridgeで正常操作と各停止条件が成立する。自由操作はJob・支払いを変更しない。実機確認の結果は模擬試験と分けて記録する。

## T09 — カメラとグリッパー

依存: T08。主な成果物: カメラ・グリッパーのUI、camera／control API、Bridge接続試験。

- [x] BridgeのJPEGを中継し、カメラURL設定・ON/OFFを用意する。
- [x] 古いフレーム・切断・タブ非表示では映像を消す。取得エラーでも停止操作は使えるようにする。
- [x] 「はなす」は1回、「つかむ」は長押し更新、ボタン解放は`release`へ接続する。
- [x] 走行・アームで同じsession／sequenceと停止処理を使う。アームだけで走行済みフラグを立てない。
- [x] カメラのONや表示だけでARMしない。録画機能は対象外とする。

完了条件: 模擬カメラ／Bridgeで画像更新・切断表示・開閉／解放を確認できる。実機の受信確認と実際の動作確認を区別して記録する。

## T10 — 独立Device署名とENS

依存: T03・T06。主な成果物: `parts/device-signature/`のCLI、Contract、検証レポート、テスト。

- [x] CLI、P-256照合、DeviceSignatureVerifier、HTMLレポートを独立部品として実装する。
- [x] chain／core／jobを含むdigestと署名形式をテストfixture・Contractと照合する。
- [x] ENSの`vbb.device.p256`を読み、取得した公開鍵で検証する。未登録・別鍵・RPC失敗では代替鍵へ切り替えない。
- [x] fixture、保存済み実機署名の再検証、新規実機署名取得をレポート上で区別する。
- [x] 領収書に登録情報を表示しても、当該Jobを照合していなければ未照合を維持する。通常画面への自動署名取得は今回必須にしない。

完了条件: fixtureの正常署名が通り、別Job・別鍵は失敗する。ENS読取とERC-7913の`eth_call`結果を独立レポートで確認できる。署名照合の処理は決済処理から独立している。

## T11 — 全体フローの通し確認

依存: T07・T08・T09・T10。

- [x] Contract・Web・設定・保存先を明示して起動する検証コマンドを整備する。
- [x] 型チェック・build・Contract試験・承認フロー・Bridge／camera／gripper・独立署名の必要な回帰を実行する。
- [x] LocalでJob作成→操作終了→承認署名→Phala LOCAL_DEV→支払い→Receiptを確認する。機体がなければ模擬入力を明記する。
- [x] 改ざん、未承認、別Wallet、署名不一致、期限切れ、Phala停止、二重要求、再起動後の再開、停止失敗を確認する。
- [ ] 実環境ではPhala／Sepoliaと実機を使った同じ導線を確認し、Job・Tx・接続設定・確認時刻を記録する。未確認項目を成功扱いにしない。
- [x] 「動かない機体」のデモは未承認・未払いとして説明する。静止の自動検出で拒否する機能は未実装と明示する。

完了条件: Localの正常／異常系が通り、実機操作から利用者の承認・実Phala検証・Sepolia支払い・Receipt表示まで確認できる。環境未用意の場合はその項目を未完了で残す。

## T12 — ドキュメントとデモの仕上げ

依存: T11。

- [x] READMEにセットアップ・起動方法・承認から支払いまでの操作手順を記載する。
- [x] 設計・タスクを実装した機能と未実装の範囲に合わせて更新する。
- [x] 利用するライブラリ・標準参照実装の出典とlicenseを記録する。
- [x] 公開する差分とGit対象を確認し、秘密設定、署名済み承認文書、ローカル記録、録画原本、生成物が含まれないことを確認する。
- [x] クリーンな作業場所から公開手順どおりに依存導入・build・Localデモを再現する。
- [x] 成功例・失敗例・技術ごとの役割・残った限界を示す短い動画と説明文を準備する。

完了条件: 第三者が公開資料からLocalデモを再現でき、実機／Phalaを使うための追加条件も分かる。公開・投稿そのものは別の作業として扱う。

## T13 — 台帳のデータ処理と設定

依存: アプリのWeb・Contract・領収書の基盤（T01〜T06）。

- [x] Curvegridのイベント照合・金額計算・月次集計・CSV処理をアプリ内のモジュールへ整理する。
- [x] Contract設定、対象Transaction、月次サンプル、Server専用の接続設定を用意する。履歴の契約構成と現在の決済設定を分ける。
- [x] 支払い状態とデータの出所を共通型として定義する。
- [x] Job・イベントの識別子、整数金額、実支払いとサンプルの分離を試験する。

完了条件: 照合・集計・CSVの単体試験が通り、APIキーをBrowserへ渡さない。

## T14 — MultiBaas取得APIとsnapshot

依存: T13。

- [x] 個別取引receipt・blockの取得をNext.jsのAPIへ接続する。対象は最大10 Job・関連40取引とする。
- [x] 手動更新、重複排除、確認数、取得状態、snapshot保存・復元を実装する。
- [x] 未設定・0件・取得失敗・保存済み表示を分ける。
- [x] 同一Origin、同時実行・連続取得の抑制、設定が異なるsnapshotの拒否を実装する。

完了条件: MultiBaasから実支払いを1件以上取得・照合できる。再取得しても増殖せず、障害時にサンプルを実取得として表示しない。

## T15 — 支払実績ページ

依存: T14。

- [x] `/ledger`と共通ナビゲーションの「台帳 / Ledger」を追加する。
- [x] 支払一覧、取得状態、更新ボタン、照合状態を表示する。支払い総額と照合済み金額を分ける。
- [x] 詳細でJob・Evidence・Receipt・送金・Explorerリンクを確認できるようにする。
- [x] 共通Header・日英切替とモバイル表示に対応する。

完了条件: 一つの支払いから根拠まで追え、照合済み・確認待ち・根拠不足・不一致を見分けられる。

## T16 — 月次集計とCSV

依存: T13・T15。

- [x] 月次集計デモのタブ、対象月、取引先別集計、内訳表示を追加する。
- [x] 集計CSV・明細CSVをダウンロードできるようにする。ファイル名と各行にサンプルの出所を含める。
- [x] Asia/Tokyoの月境界、0件、整数計算、CSVのエスケープと数式対策を検証する。
- [x] 実支払いと月次サンプルを別集計にし、支払済みJobを未払いとして再計上しない。

完了条件: 120件・3社・12.00 mUSDCがデータから計算され、画面・内訳・CSVが一致する。

## T17 — 統合確認と仕上げ

依存: T14・T15・T16。

- [x] 実取得、根拠不足、不一致、確認待ち、API停止、再起動後の表示を確認する。
- [x] Job作成・操作・承認・決済・領収書の導線を回帰確認する。
- [x] 型チェック・buildと台帳の関連試験を実行する。
- [x] Architectureとセットアップ手順へ台帳機能の実装内容を反映する。

完了条件: アプリ内で支払実績の取得・根拠確認・月次集計・CSV出力まで操作でき、台帳の障害が決済フローへ影響しない。

## 台帳の確認結果

- MultiBaasからSepolia Job 1の3取引を取得し、100.00 mUSDCの支払いを照合。
- 台帳の単体・取得・保存・異常系24件、Job状態・履歴、Rover API 5件、機体署名18件、Contract 10件を確認。
- 独立したAnvil環境で、承認・期限・Phala障害・再試行・並行要求・支払い1回の成立を確認。
- ブラウザで支払根拠、照合状態4種類、日英切替、390px幅、月次集計、CSVダウンロード、0件の月を確認。
- 実取得snapshotからJob 1を復元し、保存済み表示と照合結果を確認。
- `npm run typecheck:web`と`npm run build:web`が成功。

確認コマンド:

```powershell
node --import ./scripts/register-ts.mjs --experimental-transform-types --test scripts/test-ledger-*.test.ts
node --import ./scripts/register-ts.mjs --experimental-transform-types scripts/check-ledger-live.mjs
node scripts/test-ledger-browser.mjs
```

## T18 — StegaVARのPythonサービスとデータ配置

依存: T01。

- [x] `services/stegavar`に解析・映像生成・設定を配置する。
- [x] Python依存関係とモデルの取得方法を固定する。
- [x] データ保存先を設定可能にし、WebとPythonの参照先を揃える。
- [x] 公開用データ、モデル、中間生成物の配置を分ける。
- [x] `.venv`と実行ログをGit管理から除外する。
- [x] 使用するコード・モデル・映像の出典とライセンスを引き継ぐ。

完了条件: 指定した環境構築手順でPythonサービスが起動し、設定したデータ保存先を参照できる。

確認結果: 専用Python 3.11環境へのハッシュ固定依存導入、source revision・モデルハッシュ検証、動作／静止の実フレーム解析、サービス試験7件を確認。CPUで動作ケース・surfの40フレームを埋込み・復元し、X-CLIPのモデルロードと推論も確認。手順は [サービスREADME](../services/stegavar/README.md) に記載。

## T19 — 公開用のRover映像データ

依存: T18。

- [x] 動いているケースと停止しているケースを選定する。
- [x] 各ケースのカバー、埋込み後、差分、復元映像を配置する。
- [x] manifestと保存済み解析結果を揃える。
- [x] 参照先、フレーム数、ハッシュの整合性を確認する。
- [x] 不要な中間生成物を含めない。

完了条件: 両ケースの表示・解析に必要なデータが揃い、データ欠落とハッシュ不一致を検出できる。

## T20 — StegaVAR画面

依存: T02・T19。

- [x] `/stegavar`を追加し、共通メニューから移動できるようにする。
- [x] 日英切替に対応する。
- [x] ケースとカバー映像の選択を実装する。
- [x] カバー・埋込み後・差分の表示切替を実装する。
- [x] 復元映像の表示、再生・停止・シークを実装する。
- [x] 保存済み解析結果、解析方式、出典を表示する。
- [x] Revealが事前復元した映像の表示であることを説明する。

完了条件: Pythonを起動していなくても、両ケースの映像比較と保存済み結果の閲覧ができる。

## T21 — Next.jsとPythonのAPI接続

依存: T18・T19。

- [x] healthとanalyzeのRoute Handlerを追加する。
- [x] Pythonの接続先をサーバー側の環境変数で管理する。
- [x] ケースIDとシーンIDを許可一覧で検証する。
- [x] Pythonの応答を共通形式へ整形する。
- [x] 解析中、未起動、失敗、タイムアウトを区別する。
- [x] 同時解析1件の制限を維持する。

完了条件: アプリのAPI経由で指定ケースを解析でき、不正な入力とサービス障害を適切な応答で返せる。

## T22 — 画面からの再解析

依存: T20・T21。

- [x] 再解析ボタンと解析中の表示を追加する。
- [x] 保存済み結果と今回の結果を区別する。
- [x] 実行日時、処理時間、解析方式を表示する。
- [x] 応答のケースIDと入力ハッシュを照合する。
- [x] ケース切替後の古い応答による上書きを防ぐ。
- [x] 失敗時も映像と保存済み結果を維持する。
- [x] 状態を確認して手動で再試行できるようにする。

完了条件: 解析成功・失敗・ケース切替のいずれでも、対象の映像と解析結果が取り違えられない。

## T23 — 起動と終了の統合

依存: T18・T22。

- [x] StegaVARを含めて起動できるコマンドを用意する。
- [x] Python環境、データ、必要なモデルの有無を確認する。
- [x] ポート競合と起動済みサービスを識別する。
- [x] Pythonが起動できない場合も映像閲覧を可能にする。
- [x] 起動処理が開始したプロセスを終了できるようにする。
- [x] CPU構成、設定項目、データ生成手順をREADMEに記載する。

完了条件: 一つのコマンドから画面と解析を利用でき、終了時に無関係なプロセスを停止しない。

## T24 — StegaVARの統合確認

依存: T19〜T23。

- [x] 両ケースで再生、比較、Reveal、シークを確認する。
- [x] 日英切替と画面幅に応じた表示を確認する。
- [x] 実Pythonサービスへの再解析を確認する。
- [x] 不正ID、ハッシュ不一致、解析中、未起動、タイムアウト時の動作を確認する。
- [x] 解析中のケース切替で結果が混在しないことを確認する。
- [x] 共通ナビゲーションとWallet状態の維持を確認する。
- [x] StegaVARの操作から決済処理が呼ばれないことを確認する。
- [x] Webの型チェックとビルドを実行する。

完了条件: 映像表示と再解析をアプリ内で利用でき、解析サービスの障害時も閲覧を継続できる。

### StegaVARの確認結果

- 動作／静止 × surf／hike／campの6組・960フレーム、manifest、保存済み結果の整合性を確認。
- Pythonサービス7件、Next.js Adapter 5件の試験で入力・ハッシュ・Origin・同時解析・障害応答を確認。
- ブラウザから6組を実Pythonで再解析し、比較映像と復元映像のシーク位置を画素比較で確認。
- 解析中、503、タイムアウト、入力不一致、解析失敗、ケース切替時の応答照合と結果保持を確認。
- 日英・390px幅、共通ナビゲーション、Wallet iframeの維持、決済APIの呼出しが発生しないことを確認。
- 起動コマンドによるPythonの起動・終了、起動済みWebへの接続、Python未導入時の映像閲覧を確認。
- `npm run typecheck:web`と`npm run build:web`が成功。

```powershell
services/stegavar/.venv/Scripts/python.exe -m unittest discover -s services/stegavar/tests -v
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/publish_data.py --check
node --import ./scripts/register-ts.mjs --experimental-transform-types --test scripts/test-stegavar-api.test.ts
npm run demo:stegavar
node scripts/test-stegavar-browser.mjs
```

## T25 — Job専用セッションと条件付き承認

依存: T08・T09・T24。

- [x] Job専用のsessionIdとランダムnonceを発行する。
- [x] Job、予算、受取先、判定モード、policyHash、実行条件、有効期限を固定する。
- [x] VIDEOを初期値とし、通常画面にはモード選択を表示しない。
- [x] 設定アイコンの長押しで発表者用設定を開き、「動画認識をスキップ」を配置する。
- [x] 隠し設定は認証済みJob所有者だけが使用でき、チェックの初期値はOFF、対象セッションだけに適用する。
- [x] 条件付き支払いの署名文面にsessionId・nonce・判定モード・実行条件のハッシュを含め、SKIP_VIDEOでは操作記録による支払いを明記する。
- [x] SKIP_VIDEOのpolicyは動画解析用設定の準備を必要としない構成にする。
- [x] Wallet署名とJob所有者を検証する。
- [x] 他Job、期限切れ、変更済み条件、使用済み承認を拒否する。
- [x] セッション検査を必須とするJob種別、判定モード、セッション、承認をServer側へ永続化する。
- [x] 開始時の署名済み条件を固定し、次のセッションではスキップ設定をOFFに戻す。

追加する機能:

- [x] 停止確認後にも隠し設定で動画認識をスキップできるようにする。
- [x] 同じJob・sessionId・操作記録のハッシュ・金額・受取先・期限に対する追加スキップ承認を署名・保存する。
- [x] 開始時の署名内容を保持し、追加承認を別レコードとして照合する。再走行や撮り直しを要求しない。
- [x] 前ボタンの記録がない・false・未確定の場合は追加承認を拒否する。決済APIへの接続はT29で行う。

完了条件: 今回のJob・実行条件と操作記録に対する承認だけを受け付け、別セッションへ流用できない。開始前と停止後のスキップ承認に対応し、所有者が明示的に選択した場合だけ有効にする。T26の前ボタン記録とT29の支払い接続は各タスクで実装する。

確認結果:

- `scripts/test-rover-session.test.ts`の14試験で所有者署名、モード変更、他Job、再送、承認の再利用拒否、期限、排他保存、破損データの拒否を確認。追加承認の署名・永続化・再送、押下なし・前進送信失敗・停止未確認・記録変更・未入金Jobの拒否を含む。
- `scripts/test-rover-session-browser.mjs`で専用AnvilとWebを起動し、キーボード・ポインターの長押し、初期値OFF、条件変更時の初期化、署名・保存、日本語390px表示を確認。
- 停止済みVIDEOのテスト記録を使い、押下なしのUI・API拒否、隠し設定からの追加署名、INCONCLUSIVE・開始時の承認・操作記録の保持をブラウザーで確認。T26の前ボタン入力と実機映像の認識はこの試験の対象に含めない。
- 同一Origin・Job所有者の検査、RoverセッションJobの承認・Provider入口の拒否、completeの409、支払い未発生を確認。
- 型チェック・production buildを確認。実機操作とSepolia送金はこのタスクの試験に含めない。

## T26 — 前ボタンの操作を記録する

- [x] 記録開始後、前ボタンを押す／押さずに待つ操作を用意する。解放・時間上限・通信断で停止する。
- [x] 押下・解放、前進送信の成功／失敗、停止確認を同じJob・sessionIdに保存する。観測完了時に押下の有無を確定し、中断は未確定にする。
- [x] 押さない場合もRaw動画を取得する。録画失敗でも操作記録を保持し、動画認識スキップ時はカメラなしで操作できるようにする。

完了条件: **押した／押していない／未確定と、送信・停止の結果を区別して保存できる。** 前ボタンの実記録をT25の追加承認へ接続する。

確認: Pythonの制御・録画試験、14件のセッション試験、ブラウザーでの押下・解放・記録保存、型チェックが成功。実機は動かしていない。

## T27 — Raw動画をStegaVARで3択判定する

- [x] 今回のRaw動画（JPEGフレーム列またはMJPEG）をServerからStegaVARへ送り、CPUのフレーム差分処理で判定する。
- [x] 「動いた（MOVING）／動いていない（STILL）／判定できていない（INCONCLUSIVE）」をJob・sessionId・動画ハッシュとともに返す。
- [x] 映像不足・解析失敗・通信失敗は「判定できていない」と理由を残す。スキップで未実行の場合は未実行と記録する。

完了条件: **今回のRaw動画がStegaVARに届き、同じ実行に対する3択が返る。** 前ボタンの有無を動画判定の答えには使わない。細かな環境調整や埋込み・復元処理は不要。

確認: Python HTTPサービス10件とWeb Adapter 4件の試験でRaw動画の3択・入力照合・通信失敗・スキップを確認。Bridgeは保存済み録画のハッシュを確認して返す。

## T30 — 操作記録・動画・判定を表示する

- [x] 前ボタンを押した／押していない／未確定、今回の動画、3択の判定を同じ画面に表示する。
- [x] 停止後の隠し設定から追加承認できる導線をつなぎ、スキップの有無を実行詳細に表示する。
- [x] 動画なし・判定待ち・判定できない状態を表示し、別Jobの結果を混在させない。

完了条件: **何を操作し、どの動画を判定し、何が返ったかが画面で分かる。** 支払い接続を待たずに完成させる。

確認: ブラウザーから模擬BridgeのJPEG録画を実StegaVAR Pythonへ送り、MOVING・押下記録・録画再生を同じ画面で確認。390px表示、Job切替、未取得・スキップ表示も確認。実機の映像は使用していない。

## T29 — 通常・スキップ両方の支払いを接続する

- [ ] 保存済みの操作記録・所有者承認・動画判定を証拠としてまとめ、Phala検証と支払いAPIへ接続する。
- [ ] 下表の条件で支払う。判定後のスキップは同じ記録への追加承認で受け付け、再走行を要求しない。
- [ ] 対象Job・署名・記録の整合性・期限・未決済状態をServerで確認する。送金結果不明時はTransactionを照合し、二重払いを防ぐ。
- [ ] 支払い結果とReceiptを画面に表示する。動画判定の表示は変更しない。

| 条件 | 支払い |
|---|---|
| 前ボタンあり・前進送信成功・停止確認・有効な所有者承認＋「動いた」 | 支払う |
| 同じ操作・承認条件＋有効なスキップ承認 | 動画の結果・有無に依存せず支払う |
| スキップ承認なし＋「動いていない／判定できていない」 | 保留 |
| 前ボタンなし・未確定、送信失敗、停止未確認、承認不備 | 支払わない |

完了条件: **「判定できていない」でも隠し設定と有効な操作記録・承認で1回だけ支払われる。** PhalaはEvidenceとJobの整合性を確認する。動画判定はアプリ側で行う。

## T32 — 実機で通し確認する

- [ ] 外置きカメラにRoverが映るようにし、動作・静止を判定できる基本設定を確認する。
- [ ] 「押して動いた → 支払い」「押さない → 支払いなし」「判定できない → 隠し設定と追加承認で支払い」を確認する。
- [ ] カメラ・解析サービスが使えない場合のスキップ動作と、緊急停止・二重払い防止を確認する。
- [ ] Privy承認・実Phala検証・Sepolia支払い・Receiptまでを確認し、Transactionと残高を照合する。

完了条件: **通常とスキップの両方を実演できる。** 模擬試験と実機確認の結果を区別して記録する。

## 今回の範囲

所有者署名、Jobとの紐付け、停止確認、二重払い防止を必須とする。Phala・Contractは実装済みの形式へ接続する。

照明・背景・カメラの揺れへの詳細調整、自動復旧、詳細な計測画面、距離・方向の認定、GPU対応は今回のタスクに含めない。
