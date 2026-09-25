# Verifiable Blackbox — Phala Network Tasks

作成日: 2026-09-26

[ARCHITECTURE.md](ARCHITECTURE.md)に基づき、Evidence検証とVerdict署名を行うサービスを実装する。

## 進め方

1タスクごとに機能と完了条件を確認し、必要に応じてcommitを分ける。開発の変更履歴はGitのログで管理する。Local、simulator、Phala Cloudの検証結果を区別する。

実装順は`T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10`。Phalaの機能はLocalで正常系と拒否条件を確認してから接続する。

2026-09-26：T01〜T09は実装・検証済み。T10はpreflight、read-only接続確認、配置手順を実装済み。Cloud配置・実quote検証・Sepoliaの有人支払い・CVM再起動確認は未実施。Taskごとにcommit・pushし、検証範囲はREADMEへ記録する。

| タスク | 成果 |
|---|---|
| T01 | TypeScriptサービスの開発環境 |
| T02 | Evidence parserとcommitment |
| T03 | Chain照会とPolicy判定 |
| T04 | LOCAL_DEVのVerdict署名 |
| T05 | HTTP APIとエラー処理 |
| T06 | Anvilとアプリを使った決済E2E |
| T07 | Dockerでの起動 |
| T08 | dstack KMSとAttestation取得 |
| T09 | Attestationの独立検証 |
| T10 | Phala CloudとSepoliaの接続確認 |

## T01 — 開発環境と設定

依存: なし。主な成果物: `package.json`、TypeScript設定、`src/config.ts`、`.env.example`、`.gitignore`、`.dockerignore`。

- [x] Node.js、TypeScript、viem、Zod、Vitestの依存関係とlockfileを用意する。
- [x] `dev`、`typecheck`、`test`、`build`、`start`、`check`を用意する。
- [x] Chain、Contract、Policy、TTL、port、本文上限、modeの設定schemaを実装する。
- [x] LOCAL_DEVでは開発鍵を必須にする。設定不正のエラーには値を出さず項目名だけを出す。
- [x] 秘密設定、依存、dist、ログ、試験生成物をGit対象外にする。

完了条件: クリーンインストール、型チェック、buildが成功する。設定欠落や不正な範囲で起動を拒否できる。

## T02 — Evidence形式とcommitment

依存: T01。主な成果物: `src/types.ts`、`src/contracts.ts`、`src/evidence.ts`、`test/fixtures/`。

- [x] `DemoEvidenceV1`、Wire形式、`DemoVerdictV1`、JobSnapshotの型を定義する。
- [x] 10進整数、safe integer、uint64／uint256、bytes32、文字列長、必須項目、未知フィールドを検査する。
- [x] `DEMO_EVIDENCE_V1`を含むABI encodingとKeccak-256を実装する。
- [x] `scenario`から生成するChallengeと、commitmentのfield順序を固定する。
- [x] 固定fixtureを使い、アプリのTypeScriptとContractが同じhashを計算することを確認する。

完了条件: 正常入力のcommitmentが一致する。field変更でhashが変化し、欠落・余分なfield・負数・範囲外・壊れたhashを拒否する。

## T03 — ChainReaderとPolicy

依存: T02。主な成果物: `src/chain.ts`、`src/policy.ts`、`src/errors.ts`、判定試験。

- [x] `ChainReader`を定義し、RPCのchainIdを設定値と照合する。
- [x] blockを取得し、そのblock番号を指定してJobとHookのcommitmentを読み取る。
- [x] Job ID、Submitted、Evaluator、Hook、機体ID、Challenge、Sequence、Checkpointを確認する。
- [x] Evidenceの未来ずれ、最大経過時間、Job期限を検査する。
- [x] 非ゼロのオンチェーンcommitmentと再計算結果を照合する。
- [x] RPC失敗を`SERVICE_ERROR`、Policy不合格を`INVALID_EVIDENCE`へ分類する。

完了条件: 正常Evidenceが通る。各項目の不一致と時刻の境界を個別に試験し、RPC障害を不正Evidenceと混同しない。

## T04 — LOCAL_DEV署名とVerifierService

依存: T03。主な成果物: `src/security.ts`、`src/verify.ts`、署名・Evaluator形式の試験。

- [x] `SecurityProvider`を定義し、開発鍵から署名accountを作る。
- [x] `VerifiableBlackboxDemo`／version `1`／Chain／EvaluatorのEIP-712 domainを定義する。
- [x] Policy合格後だけ、ChainのProviderを使ってPASS Verdictを生成する。
- [x] block timestamp、有効期限、最大TTL 900秒、乱数nonceを設定する。
- [x] Wire応答を生成し、LOCAL_DEVは`attested=false`、`simulated=false`を返す。
- [x] 不正Evidence、Chain取得失敗、有効期間なしでは署名関数が呼ばれないことを試験する。

完了条件: 正常Verdictから期待signerを回復できる。別Chain・別Evaluatorでは署名検証が失敗する。再要求は新しいnonceを生成し、API単体で二重決済防止を保証した扱いにしない。

## T05 — HTTP API

依存: T04。主な成果物: `src/server.ts`、`src/index.ts`、API試験。

- [x] `GET /health`、`POST /verify`、`GET /attestation`を実装する。
- [x] JSON形式、受信bytes上限16,384、nonce文字種と長さを検査する。
- [x] 成功応答と400／422／503／404の共通エラー形式を実装する。
- [x] requestId、no-store、機密情報を含まない実行ログを用意する。
- [x] Localではloopbackにbindし、Containerでは設定で待受を切り替える。
- [x] 初期化失敗時に起動を中止し、SIGINT／SIGTERMでHTTPを終了する。

完了条件: APIから正常Verdictが返る。不正JSON・上限超過・不正Evidence・RPC障害を区別し、失敗応答に署名を含めない。LOCAL_DEVのAttestation応答に実TEEの成功表示を付けない。

## T06 — AnvilとアプリのE2E

依存: T05。主な成果物: `scripts/run-local-e2e.ps1`、`scripts/e2e-local.mjs`、アプリ接続手順。

- [x] `APP_PROJECT_ROOT`でContractの場所を指定できるようにし、既定値は`../app_Verifiable_Blackbox`とする。
- [x] 試験専用AnvilへCore・Hook・mUSDC・Evaluatorを配置し、LOCAL_DEV signerを登録する。
- [x] Job作成・Fund・commitment提出の後に`/verify`を呼び、Verifierの署名でsettleする。
- [x] アプリrunnerへ`PHALA_PROJECT_ROOT`としてこのフォルダの絶対パスを渡し、承認署名→Evidence→Verifier→支払いを確認する。
- [x] 改ざん、未提出Job、別Evaluator、期限切れ、同一Verdictの再使用、完了済みJobへの再検証を試験する。
- [x] runnerが起動したプロセスだけを終了する。port競合では起動を中止する。

完了条件: 正常時に100 mUSDCの支払いとReceiptを確認できる。不正時は支払い・Receiptが増えず、同じJobへの重複支払いも起きない。試験はchainId 31337へ限定する。

## T07 — Containerと起動手順

依存: T05。主な成果物: `Dockerfile`、`docker-compose.yml`、`docker-compose.phala.yml`、README。

- [x] multi-stage buildとruntime依存だけのimageを用意する。
- [x] non-root、read-only filesystem、capabilities削除、tmpfs、healthcheckを設定する。
- [x] Local Composeはhostのloopback 3100へ公開し、ContainerからAnvilへ接続できる設定を用意する。
- [x] Phala Composeはimage digestとdstack socketを指定する構成にする。
- [x] `.env`や開発鍵がimageへ入らないことを確認する。

完了条件: ContainerのhealthとLOCAL_DEVの検証APIが動き、終了・再起動ができる。Docker経由でもT06の決済フローを確認できる。

## T08 — dstack KMSとAttestation取得

依存: T04・T05・T07。主な成果物: dstack版`SecurityProvider`、`scripts/dstack-smoke.mjs`、Attestation試験。

- [x] dstack SDKの版を固定し、app identity・key path・purpose・secp256k1による鍵導出を実装する。
- [x] KMS初期化失敗時の停止と、開発鍵へfallbackしない動作を確認する。
- [x] nonce・signer・Chain・Evaluator・Policy識別子・Compose情報をclaimsへ含める。
- [x] claimsのSHA-256をreportDataとしてquoteを要求し、event log・measurement・app composeを返す。
- [x] 対応するguest agentではversioned attestationを追加で返す。必須のquote取得失敗は503とする。
- [x] simulatorでsignerの再導出一致、nonce変更によるreportData変化、Verdict署名を試験する。

完了条件: simulatorで署名とquote取得が動く。`simulated=true`、`attested=false`であり、hardware quoteを検証済みとは表示しない。

## T09 — Attestationの独立検証

依存: T08。主な成果物: `scripts/verify-attestation.mjs`、正常／改ざん応答の試験。

- [x] CLIが毎回fresh nonceを生成し、claimsのnonceと期待するsigner・Chain・Evaluatorを照合する。
- [x] claims digest、reportData、検証済みquote内のreportDataを照合する。
- [x] hardware quote検証先のAPIまたは検証ライブラリを公式仕様で確認し、成功・失敗条件を固定する。
- [x] 期待Compose hashをCLIへ外部入力し、app compose・claims・quoteのmeasurementと照合する。
- [x] nonce違い、signer違い、claims改ざん、quote検証失敗、Compose違い、検証サービス障害を拒否する。
- [x] simulatorの結果と実hardware quoteの結果を明確に分けて返す。

完了条件: 模擬応答で正常・各改ざん条件を判定できる。実TEEの成功判定は、独立したquote検証と期待構成との照合の両方が通った場合に限る。

## T10 — Phala CloudとSepolia

依存: T06・T07・T08・T09。主な成果物: `scripts/check-phala-env.mjs`、配置・接続・停止・復旧の手順。

- [x] 配置時に公式CLI／SDK仕様と利用可能なCVM構成を確認し、コマンドと利用版を固定する。
- [x] image digest、HTTPS RPC、Chain・Contract、key pathを検査するpreflightを作る。Phala設定では開発鍵とsimulator endpointを拒否する。
- [ ] 対象CVMとリソースを明示して配置する。通常のcheckやLocal E2EではCloudを作成・更新・停止しない。
- [ ] `/health`でmode、keySource、signerを確認し、Evaluatorのtrusted signerと照合する。最終Evaluator設定でAttestationを再取得する。
- [ ] T09のCLIで実hardware quoteと期待Composeを検証する。
- [ ] アプリからSepoliaの正常支払い、改ざん拒否、再提出時の二重支払い防止を確認する。
- [ ] 同じapp identity・key pathで再起動し、signer一致と再取得したAttestationを確認する。
- [x] READMEへLocal、simulator、Cloudの起動・確認・停止手順と検証範囲を記載する。

完了条件: 実Phalaのquote検証、アプリの署名検証、Sepoliaの支払いと拒否条件、再起動後のsigner一致を確認できる。未実施項目は未完了で残す。

## 将来の拡張

- 実機署名・暗号化映像・センサー情報を扱うEvidence schema。
- 物理作業の完了を判定するPolicy。
- 複数機体・複数Policy・鍵失効への対応。
- RPC応答の検証を強化するChain接続方式。

これらはT01〜T10の対象外とし、個別に設計する。次の確認対象は **T10: Phala CloudとSepoliaの実環境確認**。
