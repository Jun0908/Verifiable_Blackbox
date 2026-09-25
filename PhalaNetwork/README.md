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

## dstack simulator

SDKは`@phala/dstack-sdk@0.5.8`に固定し、`getKey(path, purpose, "secp256k1")`を使用します。pathは`verifiable-blackbox/verdict/secp256k1/v1`、purposeは`verifiable-blackbox-verdict`です。SDK更新時は鍵導出互換性を確認してください。

WindowsではWSL内の公式simulator 0.5.3と`socat`を使用できます。`scripts/run-simulator-wsl.sh`は既存のsimulator配布物を一時ディレクトリへ配置し、loopbackの8091に公開します。終了時は自分が起動したプロセスだけを停止します。

```bash
# WSL内、公式simulator導入済みの場合
bash scripts/run-simulator-wsl.sh
```

```powershell
$env:DSTACK_SIMULATOR_ENDPOINT='http://127.0.0.1:8091'
npm run smoke:dstack
```

同じsignerの鍵導出、EIP-712署名、nonce変更によるreportData変化を確認します。simulatorは常に`simulated=true, attested=false, hardwareQuoteVerified=false`です。Cloudは開発鍵なしでdstack socketを使用し、KMS初期化失敗時には起動しません。`attested=true`はサービスの申告値で、独立したquote検証の代わりにはなりません。

参考：[dstack SDKの公式ソース](https://github.com/Dstack-TEE/dstack/tree/next/sdk/js)、[ローカル開発](https://docs.phala.network/dstack/local-development)。実装ではインストールした0.5.8の型・APIを確認しています。

## Attestationの独立検証

```powershell
npm run build
npm run verify:attestation -- https://your-verifier.example .local/expected.json
```

`attestation.expected.example.json`を参考に、期待signer・chainId・Evaluator・Compose hash・OS measurement（MRTD、RTMR0〜2）を別途用意します。Compose hashは配置時の正確なapp-compose文書、OS measurementは信頼するdstack OSのリリース情報から取得してください。検証対象endpointの応答から期待値を採用しません。CLIは毎回32 bytesのfresh nonceを生成します。

検証先は`https://cloud-api.phala.com/api/v1/attestations/verify`に固定。HTTPSでquoteを送り、`quote.verified === true`を必要条件にし、検証済みbodyのreportData全64 bytes、mr_config_id全48 bytes、期待measurementを照合します。Phalaの検証サービスとTLSを信頼するオンライン方式です。応答の`attested`フラグだけでは成功にしません。

`--allow-simulator`を明示した場合だけ、loopback HTTPとsimulatorを許可します。その場合でも`hardwareQuoteVerified=false`で、実TEEの確認結果にはなりません。設定・通信・照合失敗は終了コード1です。

仕様参照：[Phala公式検証手順](https://github.com/Phala-Network/phala-cloud/blob/main/skills/usecase/verify-attestation.md)。このサービスのreportDataは`SHA256(固定順序のclaims JSON) + 32 bytesのゼロ`です。汎用推論APIのreportData形式とは異なります。mr_config_idは`01 + Compose SHA256 + 15 bytesのゼロ`を受け入れます。異なる形式は明示対応するまで拒否します。

## 検証記録

2026-09-26：T01〜T09の実装と検証が完了。クリーンインストール、型チェック、build、アプリ/Solidity commitment一致、Local/Docker決済と承認E2E、公式dstack simulatorの鍵導出・署名・quote取得、Attestation正常/改ざん試験が成功しました。

T10は配置前チェックとread-only接続確認、[配置・停止・復旧手順](docs/PHALA_DEPLOYMENT.md)を実装しました。実Cloud配置・実quote・Sepoliaの有人決済・CVM再起動確認は未実施です。停止中の既存CVMをread-onlyで確認しています。

[設計](ARCHITECTURE.md) / [Task](TASKS.md) / [検証結果](docs/VALIDATION.md)
