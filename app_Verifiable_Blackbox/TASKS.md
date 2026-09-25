# Verifiable Blackbox — Tasks

作成日: 2026-09-26

[ARCHITECTURE.md](ARCHITECTURE.md)に基づき、開発環境、画面、Contract、Evidence検証、決済、実機操作を段階的に実装する。

## 進め方

1タスクごとに、動く範囲、確認結果、残った制約が説明できる変更にする。大きければタスク内のチェック項目でcommitを分ける。開発の変更履歴はGitのログで管理する。

最短の順番は `T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12`。依存関係が満たされればT08はT07より先に進めてもよい。日数は固定しない。

| 段階 | タスク | 成果 |
|---|---|---|
| 画面の骨格 | T01–T02 | 何を作るかと2画面の導線 |
| 支払いの最小構成 | T03–T04 | ローカルの成功／改ざん拒否 |
| 承認と復旧 | T05–T06 | 署名付き承認、領収書、再試行 |
| TEE接続 | T07 | MockとPhalaの違い・検証範囲 |
| 実機操作 | T08–T09 | Rover操作、停止、カメラ、グリッパー |
| 機体の識別 | T10 | ENS公開鍵・独立P-256／ERC-7913検証 |
| 通しデモと公開準備 | T11–T12 | 再現手順、短いデモ動画 |

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
- [ ] 実Phala／SepoliaのchainId・Core・Hook・Evaluator・trusted signerを照合し、実環境用の接続手順を作る。

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

- [ ] READMEにセットアップ・起動方法・承認から支払いまでの操作手順を記載する。
- [ ] 設計・タスクを実装した機能と未実装の範囲に合わせて更新する。
- [ ] 利用するライブラリ・標準参照実装の出典とlicenseを記録する。
- [ ] 公開する差分とGit対象を確認し、秘密設定、署名済み承認文書、ローカル記録、録画原本、生成物が含まれないことを確認する。
- [ ] クリーンな作業場所から公開手順どおりに依存導入・build・Localデモを再現する。
- [ ] 成功例・失敗例・技術ごとの役割・残った限界を示す短い動画と説明文を準備する。

完了条件: 第三者が公開資料からLocalデモを再現でき、実機／Phalaを使うための追加条件も分かる。公開・投稿そのものは別の作業として扱う。

## 将来の拡張

- 実移動距離・荷物運搬・静止を自動判定する検証policy。
- Device署名をEvaluatorの支払い条件へ組み込む設計。
- Secure Elementによる鍵保護、本番資金を扱う決済。

これらはT01〜T12の対象外とし、個別に設計する。最初に着手するのは **T01: 再現可能な開発環境**。
