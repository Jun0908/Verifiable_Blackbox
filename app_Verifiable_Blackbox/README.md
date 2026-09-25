# Verifiable Blackbox

ロボットの仕事を作成し、操作終了後に利用者が署名して、検証・テスト報酬の支払い・領収書を確認するアプリです。DashboardとRover画面は日英対応です。

検証対象は承認文書とJobの整合性です。実際の移動・運搬・映像の意味を自動判定する機能はありません。機体のP-256署名とENS公開鍵の照合は独立ツールとして提供し、決済条件には含めません。

## セットアップ

このリポジトリの `app_Verifiable_Blackbox` で実行します。Windows、Node **22.22.1**、npm **10.9.4**、Foundry **1.7.1**で確認しています。

```powershell
cd app_Verifiable_Blackbox
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-contracts.ps1
npm run contracts:build
npm run typecheck:web
npm run build:web
```

Foundryの公式リリースから `forge.exe`、`anvil.exe`、`cast.exe` を `.tools/foundry-v1.7.1/` へ配置するか、PATHに追加してください。Solidity依存はスクリプトで固定revisionを取得します。[依存関係と出典](docs/DEPENDENCIES.md)。

## まず動かす

```powershell
# サンプル画面だけ。外部サービス・Wallet不要
npm run dev:web

# 上のサーバーを終了してから実行
# Anvil + Mock Verifier + 模擬Rover + Web
npm run demo:rover
```

http://127.0.0.1:3000 を開きます。ローカルデモは公開AnvilテストWalletとmUSDCを使います。起動時にテストChainを作成し、終了するとChainの状態は失われます。3000・8545・8765番ポートを使い、ほかのプロセスが使用中なら起動を中止します。

1. **Sign in** → **1. Create job**。100 mUSDCをJobへ預けます。
2. **2. Operate robot** → **Connect robot**。模擬Bridgeで方向ボタンを長押しし、離して停止します。
3. **End controls & return to overview**。停止確認後に概要へ戻ります。
4. **Verify & pay**。Job所有者の承認署名、Evidence照合、決済を経て領収書を表示します。
5. **Other options → Test invalid evidence**。別の不正Evidenceを拒否し、領収書が発行されないことを確認できます。

画面の模擬操作は実機の成功を示しません。自由操作はJobや支払いを変更しません。カメラ設定のONも機体をARMしません。[Rover・カメラ・停止動作](docs/ROVER.md)。

## Phala・実機・署名

`npm run demo:rover-phala` は別プロジェクトのPhala LOCAL_DEVも起動します。既定は `../../PhalaNetwork`、上書きは `PHALA_PROJECT_ROOT`。先にそのプロジェクトで依存導入とbuildを行います。[Phala接続手順](docs/PHALA.md)。

実機は人が機体を見られる状態で `npm run demo:rover-hardware` を使用します。Python Bridgeの既定は `../../M5stack_RoverC/rover-python`、上書きは `ROVER_PYTHON_ROOT`。このコマンドの決済はローカルテストChainです。

実Sepolia・Privy・Phalaの設定は `.env.example` を参考に、`apps/web/.env.local` 等の非公開ファイルで指定してください。ブラウザ用RPCには秘密を含めず、上流RPCとProvider・Relayer鍵はServerに保持します。APIはloopback・同一Origin用のデモです。インターネット公開用の認証・運用構成は含みません。

機体署名は [独立CLIの説明](parts/device-signature/README.md) を参照してください。fixture／保存済み署名／今回の機体API応答をレポート上で区別します。

## 検証と資料

```powershell
# 型・Contract・Evidence・履歴・Rover API・機体署名・Mock決済
npm run validate
# 別Phalaプロジェクトがある場合の承認・復旧・LOCAL_DEV E2E
npm run validate:phala
# demo:rover 起動中、模擬Bridge限定のブラウザ通し試験
npm exec -- playwright-core install chromium ffmpeg
npm run test:browser
```

同じ作業場所で複数のNext devを起動しないでください。検証runnerは自分が起動した子プロセスを終了します。実Phala・実機を使う確認は自動試験に含まれません。

- [確認結果・未確認事項](docs/VALIDATION.md)、[タスク](TASKS.md)
- [デモ手順・動画](docs/DEMO.md)、[設計](ARCHITECTURE.md)
- [API](docs/API.md)、[中断・不明なTxの復旧](docs/RECOVERY.md)
- [出典・ライセンス](docs/DEPENDENCIES.md)

ローカル実行時の承認文書・署名・動画原本・秘密設定はGit対象外です。実Phalaへの接続と実機からSepolia決済までの有人確認は、確認結果に明記した残作業です。
