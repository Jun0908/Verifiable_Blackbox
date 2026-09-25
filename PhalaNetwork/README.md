# Verifiable Blackbox — Phala Verifier

EvidenceとEthereum上のJobを照合し、合格時だけEIP-712 Verdictへ署名するサービスです。利用者承認はアプリ、支払いとReceipt発行はContractが担当します。物理移動・荷物運搬・Device署名の自動判定は対象外です。

## 開発

Node.js 22.22.1 / npm 10.9.4を使用します。

```powershell
npm ci
npm run check
Copy-Item .env.example .env
# .envへRPC、Contract address、開発用の署名鍵を設定
npm run dev
```

Localは`127.0.0.1:3100`、Webは3000、通常のAnvilは8545です。`npm start`は`.env`を自動読込しません。build後に`node --env-file=.env dist/index.js`でも起動できます。秘密設定はGit対象外です。

## API

- `GET /health`：mode、signer、keySource。quote検証成功を意味しません。
- `POST /verify`：`{"evidence":{...}}`。成功はVerdict、signature、verifier。
- `GET /attestation?nonce=...`：Localでは`attested=false, simulated=false`。

入力はJSON、最大16,384 bytes。失敗は400（入力）、422（Evidence）、503（サービス障害）、404（未対応）。失敗応答にVerdict・署名は入りません。整数のWire出力は10進文字列で、`outcome`のみ数値です。

## ローカル決済試験

隣の`../app_Verifiable_Blackbox`にアプリ依存とFoundry v1.7.1が必要です。別の場所を使う場合は`APP_PROJECT_ROOT`へ絶対パスを設定します。

```powershell
npm run test:evidence-compat
npm run e2e:local
npm run e2e:approval
# または両方を実行
.\scripts\run-local-e2e.ps1
```

`e2e:local`は専用Anvil（8548）とVerifier（3109）を起動し、Contract配置、Evidence提出、HTTP検証、100 mUSDC支払い、Receiptを確認します。改ざん・未提出・別Evaluator・期限切れ・Verdict再使用・完了済みJobを拒否します。結果はGit対象外の`artifacts/local-e2e.json`です。

`e2e:approval`はアプリの承認試験へ`PHALA_PROJECT_ROOT`としてこのフォルダの絶対パスを渡します。Anvil 8547、Verifier 3107、障害試験3108を使い、所有者署名、Verifier障害と復帰、同時要求、二重支払い防止を確認します。既存port使用時は停止し、試験が起動したプロセスだけを終了します。試験の送金先Chainは31337に限定します。

アプリの通常runnerでも`PHALA_PROJECT_ROOT`を設定して`npm run demo:phala-local`を使用できます。アプリの接続先は`PHALA_VERIFIER_URL`です。

## Docker

```powershell
docker compose up --build -d
docker compose ps
docker compose down
npm run e2e:docker
```

Composeは`.env`のLocal設定を使い、hostの`127.0.0.1:3100`へ公開します。Container内は3000です。`DOCKER_RPC_URL`の既定値は`http://host.docker.internal:8545`。Docker Desktopでhost上のAnvilへ接続できます。Linuxではhostから接続できるAnvil待受を別途設定してください。

`e2e:docker`はimageをbuildし、専用Containerのhealth、non-root、書込禁止、再起動、決済・拒否条件を確認して終了します。`.env`をimageに含めません。Phala用Composeはdigest指定とdstack socketを使用します。

## 検証記録

2026-09-26：T01〜T06。クリーンインストール、型チェック、74単体/APIテスト、build、アプリ/Solidity commitment一致、Local決済と承認E2Eが成功。実Phala・Sepoliaの結果は含みません。

[設計](ARCHITECTURE.md) / [Task](TASKS.md)
