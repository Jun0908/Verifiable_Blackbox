# Verifiable Blackbox — Tasks

更新日: 2026-09-26

## 今回のゴール

**前ボタンを押すだけで操作し、押下記録で1回報酬を支払う。Raw動画のStegaVAR 3択判定は参考結果として表示する。**

約1秒の短い操作も受け付ける。操作前の追加署名・条件確認を要求しない。動画の結果や有無に依存せず、今回のJobで押した記録があれば支払いへ進む。動画判定はそのまま残す。

## 現在の状態

| 機能 | 状態 |
|---|---|
| Web・Wallet・Job作成・Contract・Phala接続（T01〜T12） | 実装済み。模擬EvidenceでPhala検証・Sepolia決済を確認。実機からの有人通し確認はT32に残る |
| 支払台帳・月次集計・CSV（T13〜T17） | 完了 |
| StegaVARの公開映像・比較・再解析（T18〜T24） | 完了。今回撮影したRaw動画の受付もT27で実装済み |
| Privyログインによる所有者確認・操作用セッション・隠し設定（T25） | 実装済み。操作前の追加署名なしで利用できる |
| 前ボタンの押下・解放、録画・前進送信と停止の記録（T26） | 完了。模擬機体で確認 |
| Worldによる映像開示（T34〜T38） | T35〜T37を実装し模擬Jobで確認。公式discovery接続済み。T34・T38の公式ブラウザ認証と実Jobの有人確認が残る |

**前ボタン記録・Raw動画の3択判定・画面表示・押下による支払いを実装済み。模擬Bridgeとローカルチェーンで確認。実機・Privyログイン・実Phala・Sepolia決済の有人通し確認はT32に残る。**

## 進め方

実装・確認の順序は次の5タスク。番号はArchitectureとの対応に使う。

**T26 前ボタン記録 → T27 動画判定 → T30 画面表示 → T29 支払い → T32 通し確認**

各タスクの完了時に必要な試験を行い、commit・Pushする。コミットには追加した機能を書く。実装の詳細は[ARCHITECTURE.md](ARCHITECTURE.md)を参照する。

カメラ確認はT32に、証拠作成（T28）はT29に、ローカル試験（T31）は各タスクの完了確認に含める。

Worldの開示機能は`T34 → T35 → T36 → T37 → T38`で進める。認証・配信の部品は`StegaVAR/world-idp`から再利用し、操作・動画判定・Phala・決済の仕様は変更しない。T34はRoverの有人確認と独立して進められる。

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

## T25 — ログイン情報によるJob所有者の確認

- [x] Privyログイン情報とオンチェーンJobの所有者を裏側で照合する。
- [x] 操作前の確認用署名・条件付き署名をなくし、操作用tokenでセッションを読み込む。
- [x] Job作成時に「前ボタンを押した記録で1回支払う」と表示する。設定の長押しで動画認識をスキップできる。

## T26 — 前ボタンを押して操作する

- [x] 接続後に全方向・アーム・カメラを操作する。方向ボタンを離すと停止する。
- [x] 前ボタンの一瞬の押下でJob完了・支払いへ進む。最小時間は設けず、解放後に届く走行要求を拒否する。
- [x] Job完了・支払い中・支払い後も操作画面を使い続けられる。
- [x] カメラ・解析の不調が操作を妨げないようにし、通信断時の停止を維持する。

## T27 — Raw動画をStegaVARで3択判定する

- [x] 今回のRaw動画をServerからStegaVARへ送る。
- [x] 「動いた／動いていない／判定できていない」をJob・sessionId・動画ハッシュとともに保存する。
- [x] 解析できない理由とスキップを記録する。ボタン押下で動画結果を書き換えない。

## T30 — 操作・動画・支払いを表示する

- [x] 全方向・アーム・カメラ・速度選択を表示し、条件確認・操作用署名・記録開始を不要にする。
- [x] 前ボタンの記録、今回の録画、動画の3択、支払い結果を表示する。
- [x] 概要画面に押下記録と保存済みの支払い状況を表示し、Jobを引き継いで操作画面へ戻れるようにする。再開は押下記録がある場合だけ同じ決済APIを使う。
- [x] 接続中・処理中・再試行の表示と日英・狭い画面に対応する。

## T29 — 前ボタンの記録で1回支払う

- [x] 今回のJobで前ボタンを押した記録があれば支払いへ進む。最小走行時間は要求しない。
- [x] 動画判定・録画・停止応答の成功を支払い条件にしない。押下なしは支払わない。
- [x] Job所有者・Job期限・対象記録を確認し、Phala検証・決済・Receiptへ接続する。再送・再読み込みで二重払いしない。

| 前ボタン | 動画結果 | 報酬 |
|---|---|---|
| 押した | 動いた・動いていない・判定できていない・未実行 | 1回支払う |
| 押していない | すべて | 支払わない |

確認: セッション・ログイン照合・支払い条件の20試験、Pythonの録画・制御45試験、模擬Bridge・実StegaVAR・専用Anvilのブラウザー試験が成功。40msの押下で録画終了前に支払いが始まり、全方向・アームの操作と支払い後の操作継続、押下なしの支払い拒否、解放後の遅延要求拒否、スキップ、解析停止中の支払い、再送・再読み込み、World開示を確認。操作時のpersonal_sign呼び出しは0回。型チェック・production buildも成功。実アカウントでの追加確認にはPrivyの「Return user data in an identity token」をONにする。

## T32 — 実機で通し確認する

実機は動かさず実装と模擬試験まで進める指定のため、次の有人確認は未完了。

- [ ] Privyでログインし、Jobを作成・入金して、追加署名なしで前ボタンを使えることを確認する。
- [ ] 実機を短く操作し、押下記録・Raw動画の参考結果・実Phala検証・Sepolia支払い・Receiptを照合する。
- [ ] 押下なしでは支払わず、動画認識をスキップしても押下があれば1回支払うことを確認する。

## T34 — Worldの公式接続を確認する

依存: `StegaVAR/world-idp`の認証・開示部品。

- [ ] 公式イベント環境の最新仕様、発行済みClient、HTTPS callback・認証方式を照合する。
- [x] 模擬Proofを使う公式環境とWorld未接続のrehearsalを明示する。
- [ ] World認証の成功とキャンセルを実際のブラウザで確認する。
- [x] Backendで署名・claims・state・nonce・PKCE・今回の認証条件を検証する。
- [x] キャンセル、認証失敗、callback再利用では許可を作らないことを確認する（模擬OIDC・ローカルHTTP試験）。
- [x] 秘密情報をBrowserへ渡さず、World障害時にrehearsalへ自動切替しない。

確認: 公式discoveryのissuer・PKCE・認証方式を取得済み。`services/world-idp`へ配置し、秘密設定の取り込み・preflightを追加。公式ブラウザ認証は承認者と公開callbackの確認後に実施する。

完了条件: 公式イベント環境で認証成功とキャンセルを確認でき、検証済み認証結果だけを開示処理へ渡せる。本番の人間認証成功とは混同しない。

## T35 — 実Jobと開示対象の映像を紐付ける

依存: T34。実Jobのセッション・録画はT26・T27の成果物を利用する。

- [x] 固定のデモJobラベルと映像を、実Job・操作sessionId・assetIdへ置き換える。
- [x] 所有者、元録画と配信映像のハッシュ、Receipt参照をServer側で照合する。
- [x] アプリと開示サービスの間に認証付きの登録経路を設ける。
- [x] ブラウザから任意のファイルパス・動画URL・所有者を登録させない。
- [x] 録画なしの場合は開示不可を表示し、サンプル映像で代用しない。
- [x] 映像差し替え時は新しいassetIdと依頼を必要とする。
- [x] Receiptへの関連付けとオンチェーンcommitmentの検証範囲を区別する。

完了条件: 開示対象が実Jobと今回の録画へ結び付き、別Jobの映像へ差し替えられない。提出済みのEvidence Bundleを変更しない。

## T36 — 開示依頼と承認の導線を追加する

依存: T35。

- [x] Job詳細・領収書から「映像の開示を依頼」で開示サービスへ移動できるようにする。
- [x] 対象Job・映像・依頼者・5分間の閲覧期限を承認画面に表示する。
- [x] 承認者コードと対象Jobへの権限を確認し、World認証とは分けて扱う。
- [x] 明示的な承認操作と、その依頼に対するWorld認証結果を結び付ける。
- [x] 許可を対象Job・映像ハッシュ・依頼者セッションへ限定する。
- [x] 所有者自身の録画閲覧と、第三者への開示を区別する。
- [x] 日英表示、拒否、認証キャンセル、再依頼の導線を用意する。

完了条件: 権限を持つ承認者が対象を確認して承認でき、World認証だけで他人の映像を開示できない。

## T37 — 期限付き映像配信と拒否条件を実装する

依存: T36。

- [x] 映像を非公開領域から配信し、通常取得・Range要求の両方で権限を確認する。
- [x] 承認後5分間だけ依頼者セッションへ配信する。
- [x] 未承認、別セッション、拒否、期限切れ、取消後の配信を拒否する。
- [x] 動画、復元フレーム、サムネイル、ダウンロード経路からの迂回を確認する。
- [x] 取消・期限切れ時に画面を閉じ、以後の配信を停止する。
- [x] 再起動時には開示依頼・認証途中の状態・閲覧許可を失効させる。
- [x] 公開StegaVARサンプルと保護対象のJob映像を分離する。

完了条件: 許可された閲覧者だけが期限内に対象映像を取得できる。既に受信・保存した映像の回収を保証する表示はしない。

## T38 — アプリとWorld開示を通し確認する

依存: T37。実機・実Phala・Sepoliaとの一連の確認ではT32の結果を利用する。

- [ ] 録画が保存された実Jobで、支払い・Receiptから開示依頼へ進む。
- [ ] 公式環境でWorld認証・Backend検証・元の依頼者への映像配信を確認する。
- [ ] キャンセル時に映像が開かず、別ブラウザ・期限切れ・取消後も取得できないことを確認する。
- [ ] World未設定・停止・認証失敗がRover操作・Phala・決済へ影響しないことを確認する。
- [ ] 開示操作から送金・再決済が発生しないことを確認する。
- [ ] 日英表示とアプリへの戻り方を確認し、関連試験・型チェック・buildを実行する。
- [ ] 公式案内に沿い、接続に要した時間・問題点・改善提案を短い統合フィードバックへまとめる。

完了条件: 「支払い後、権限を持つ人がWorldで認証して映像を開示する」と「承認が成立しなければ映像を開示しない」を実演できる。公式イベント環境の模擬IDであることを明示する。

実装確認: OIDC・映像登録・期限・取消・別セッション・公開HTTPSと内部接続先の分離について20試験が成功。`node --import ./scripts/register-ts.mjs --experimental-transform-types scripts/test-rover-session-browser.mjs --world`で、専用Anvil・模擬BridgeのJob録画登録、ハッシュ照合、承認後のフレーム再生、別ブラウザ拒否、取消・拒否、日英表示と390px幅を確認。Roverの短い押下・動画スキップ・解析停止中の支払い・二重払い防止も成功。型チェックとproduction buildが成功。実機は動かしておらず、公式認証成功・実PhalaとSepoliaの通し確認は未完了。

人間による準備: `services/world-idp/.env`の`WORLD_APPROVER_OWNERS`にJob所有者を設定し、公開HTTPSとPortalのcallbackを一致させる。設定手順と承認者コードの場所は[開示サービスREADME](../services/world-idp/README.md)を参照。公式画面で承認・キャンセルを行ってT34を確認し、録画がある実JobでT38を実施する。

## 今回の範囲

画面は全方向・アーム・カメラ・速度選択を備える。前ボタンは一瞬の押下でJob完了とし、支払い中・完了後も操作を続けられる。支払い条件は今回のJobの押下記録とし、動画判定は参考表示とする。所有者確認・Jobとの紐付け・二重払い防止はServerで処理する。離した際の停止、通信断時の停止、遅延した走行要求の拒否を維持する。

Worldは第三者への期限付き映像開示に追加する。操作・動画判定・支払い条件は変更しない。認証された承認者の権限と対象依頼をBackendで確認し、World認証を作業完了や送金の条件にはしない。
