# Phala CloudとSepolia

CLIは`phala@1.1.22`へ固定しています。2026-09-26に公式CLIのhelp、Cloud APIのCPU構成を確認しました。`tdx.small`は1 vCPU / 2GB RAM、diskは20GBを明示します。通常の`check`・E2EにはCloud操作を含みません。

## 配置前

1. `npm ci`、`npm run check`、Local/承認/Docker E2E、simulatorを実行する。
2. Container imageを公開registryへpushし、registry側のdigestを取得する。配置時の`DOCKER_IMAGE`は`repository@sha256:...`へ固定する。
3. `.env.phala.example`を`.env.phala`へコピーし、RPC、Core、Hook、Evaluator、image digest、対象CVMを設定する。開発鍵とsimulator設定は項目自体を入れない。
4. `node --env-file=.env.phala scripts/check-phala-env.mjs`で検査する。秘密値は表示しない。
5. `npx --yes phala@1.1.22 instance-types cpu --json`でリソース、`npx --yes phala@1.1.22 os-images --help`とCloud画面で利用するOSを確認する。guest-agentのSDK 0.5.8互換APIと、Attestationのconfig-id形式を確認する。

## 明示する配置操作

以下の対象CVM・OSは配置前に決定します。既存CVMには`--cvm-id`、新規CVMには固有の`--name`を使用します。初期配置で得たsignerをEvaluatorへ登録する場合、最終Evaluator設定で再配置し、signerとAttestationを確認します。

```powershell
# 既存CVMへの配置例。CVM_IDとPINNED_OSは決定した値に置き換える
npx --yes phala@1.1.22 deploy --cvm-id CVM_ID -c docker-compose.phala.yml -e .env.phala --instance-type tdx.small --disk-size 20G --image PINNED_OS --kms phala --wait --no-dev-os --no-public-logs --public-sysinfo --public-tcbinfo

# 新規の場合は --cvm-id CVM_ID を --name UNIQUE_CVM_NAME に変更
```

`.env.phala`はCLIで暗号化して配置します。CLI認証はPhalaの資格情報ストアを使用し、認証tokenをイメージ・Gitへ含めません。ソースで使用するSDKとguest agent APIの互換性はOS選定時に確認します。

## health・signer・独立Attestation

```powershell
npx --yes phala@1.1.22 cvms get CVM_ID --json
node --env-file=.env.phala scripts/check-phala-live.mjs https://VERIFIER_ENDPOINT .local/expected.json
```

期待値は`attestation.expected.example.json`を参照してください。配置時のapp-compose文書のSHA-256と、信頼するOSリリースのMRTD・RTMR0〜2を記録します。検証対象の応答を期待値として使いません。Compose YAMLファイル単体のhashと、dstackのapp-compose文書のhashは異なります。

`check-phala-live`はread-onlyです。healthのmode/keySource、期待signer、Sepolia chainId、同一blockでのEvaluatorのsigner/Core/Hook、fresh nonceのquoteと期待構成を確認します。取引は送信しません。現行検証はconfig-idの`01 + compose hash + zero padding`形式に限定し、異なる形式は拒否します。

## アプリとSepoliaの通し確認

アプリの`docs/PHALA.md`に従って専用環境を用意します。`DEMO_VERIFIER_MODE=PHALA`、HTTPSの`PHALA_VERIFIER_URL`、Chain・Core・Hook・Evaluator・trusted signerを一致させます。アプリの`scripts/check-live-config.mjs`でread-only確認後、利用者の承認署名で100 mUSDCのJobを実行します。

記録するもの：Job ID、支払いTx、Receipt、Provider残高差、verdict signer、quote検証時刻・期待構成。改ざんJobでは支払いとReceiptなし、同じ承認の再送では残高が増えないことを確認します。Local runnerをSepoliaへ向けないでください。利用者のWallet操作は有人確認です。

## 停止・再起動・復旧

```powershell
npx --yes phala@1.1.22 cvms restart CVM_ID
# 再起動後にcheck-phala-liveを同じ期待signerで再実行
npx --yes phala@1.1.22 cvms stop CVM_ID
npx --yes phala@1.1.22 cvms start CVM_ID
```

app identity・key pathを維持して再起動し、signer一致と新しいnonceのAttestationを記録します。障害時はアプリのJob・Tx保存記録から確認し、結果不明の送金を自動で再送しません。imageや設定を変更して復旧する場合は、対象digest・app-compose hashと期待measurementを再確認して明示配置します。CVM削除は通常手順に含めません。

## 現在の確認範囲

2026-09-26にread-onlyで、既存`verifiable-blackbox-verifier`（`cvm_EKLyN8wG`）は`stopped`、tdx.small / 20GBと確認しました。本フォルダのimageのCloud配置、実quote検証、Sepoliaの有人支払い、CVM再起動試験は未実施です。既存CVMの起動・配置変更は行っていません。

公式参照：[CLI](https://docs.phala.com/phala-cloud/phala-cloud-cli/overview)、[deploy](https://docs.phala.com/phala-cloud/phala-cloud-cli/deploy)、[CVM操作](https://docs.phala.com/phala-cloud/phala-cloud-cli/cvms)。
