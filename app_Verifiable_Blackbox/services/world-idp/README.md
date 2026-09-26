# Worldによる映像開示

実JobのRaw録画を所有者が登録し、第三者が依頼、承認者がWorld ID for Agentsで承認すると、依頼者のブラウザへ5分間配信します。

## 起動

```powershell
cd services/world-idp
npm ci
Copy-Item .env.example .env
node --env-file=.env scripts/preflight.mjs
npm start
```

`.env` に公式PortalのClient設定、公開HTTPSの `BASE_URL`、承認者コード `OPERATOR_CODE`、共有鍵 `WORLD_INTERNAL_TOKEN`、開示を承認できるJob所有者のウォレット一覧 `WORLD_APPROVER_OWNERS` を設定します。コードと共有鍵はそれぞれ独立した32バイト以上の乱数を使用します。資格情報をチャットやGitへ貼らないでください。

設定済みのClientを取り込む場合は、rootで次を実行できます。共有鍵と承認者コードを生成し、Webと開示サービスへ保存します。

```powershell
node services/world-idp/scripts/setup.mjs --from "D:/path/to/StegaVAR/world-idp/.env" --owner 0xYOUR_JOB_OWNER
```

取り込み済みで所有者だけ設定する場合は `--from` を省略します。承認者コードは `services/world-idp/.local/operator-code.txt` に保存します。`BASE_URL` を更新したらsetupを再実行してWebへ反映し、両サービスを再起動します。

Portalのcallbackは `BASE_URL/auth/world/callback` と完全一致させます。HTTPS入口はこのサービスの127.0.0.1:8787だけへ接続します。Rover Bridgeへ転送しません。

Portalで `The sector cannot change` と表示された場合は、Clientに固定されたsectorのホスト名と新しいCallbackのホスト名が一致していません。同じホスト名のCallback、またはそのsectorホスト名に置いたsector documentを使用する必要があります。ローカルホストから新しいHTTPSホストへ移行する場合は、新しいClientを作成してHTTPSのCallbackを登録してください。

発行されたClient IDとSecretは **`services/world-idp/.env`** の `WORLD_CLIENT_ID` と `WORLD_CLIENT_SECRET` に保存します。現在の接続方式は `WORLD_CLIENT_AUTH=client_secret_basic` です。設定後はWorldサービスを再起動し、Demoの「今回の動画を見る」から開示リンクを作成し直します。Portalへの登録・公式認証の完了は本人の操作が必要です。

Webアプリのroot `.env` には次を設定してWebを再起動します。

```dotenv
WORLD_SERVICE_URL=http://127.0.0.1:8787
WORLD_PUBLIC_URL=https://your-world-service.example
WORLD_INTERNAL_TOKEN=<開示サービスと同じ共有鍵>
```

`MODE=world` で公式接続します。公式イベント環境は模擬IDです。ローカル試験だけの場合は `MODE=rehearsal` と `BASE_URL=http://localhost:8787` を明示します。公式接続失敗時の自動切替はありません。

### Demoと一緒に起動する

設定後の `node scripts/start-sepolia-web.mjs` は、ローカルのWorld開示サービスも起動します。起動済みなら接続して利用します。`--no-world` で自動起動を省略できます。HTTPSトンネルは別途起動しておきます。

一時URLを使う場合の例:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

表示されたHTTPS URLをサービスの `BASE_URL` に設定し、rootで `node services/world-idp/scripts/setup.mjs` を実行します。[World Portal](https://sandbox.auth.world.org/portal)で `https://取得したホスト/auth/world/callback` を登録し、サービスとWebを再起動します。ホスト名がClientのsectorと異なる場合は上記の新規Client作成手順に従います。一時URLはトンネル再起動で変わるため、継続利用には固定URLを使ってください。

### 接続を確認する

支払い完了後の動画画面は、サービス・共有キー・承認対象所有者・公開HTTPS接続を確認してから開示リンクを作成できます。エラー表示に従って設定または接続を修正し、「接続を再確認」を押します。Worldの停止は操作や支払いを止めません。

- `GET /health`: サービス名・接続モード・Sandbox表示だけを返します。
- `GET /internal/health`: 共有キーを持つServerが設定の一致と承認対象の設定有無を確認します。
- 接続確認が成功しても、PortalのCallback設定と公式認証の成功は別途確認が必要です。
- 録画のないJobには開示リンクを作成しません。録画を保存したJobを開いてください。

## 操作

1. 録画を保存したJobの詳細・領収書で「映像の開示リンクを作成」を押します。
2. リンクを閲覧者へ渡します。閲覧者が自分のブラウザで「映像の開示を依頼」を押します。
3. 依頼画面に表示された承認用リンクを承認者へ渡します。
4. 承認者が承認者コードを入力し、対象Job・所有者・映像ハッシュ・閲覧者を確認してWorldで承認します。
5. 元の依頼者の画面に録画が表示されます。取消・期限切れで以後の配信を拒否します。

録画はRaw MJPEGの各フレームと全体ハッシュを照合し、撮影順に表示します。Receiptとの関連付けを表示しますが、映像がオンチェーンで検証されたとは扱いません。再起動すると登録映像・依頼・許可は失効します。所有者はリンクを作り直してください。

`npm test` は模擬署名付きOIDCとローカルHTTPで検証します。公式Sandboxでの認証と保存済み録画の配信は次節の撮影で確認しています。公式認証のキャンセルと、実機操作から支払いまでの有人通し確認は別途必要です。

## 保存済み録画でデモを撮影する

録画があるJobの開示リンクがあれば、Rover・カメラの再接続なしでWorld開示を撮影できます。公式イベントSandboxの接続設定と、Worldサービスの起動が必要です。アプリrootで次を実行します。

```powershell
node scripts/record-world-demo.mjs --invitation "https://your-world-service.example/?asset=YOUR_ASSET_ID"
```

Playwrightが閲覧者と承認者のブラウザを分け、開示依頼、マスクされた承認者コード入力、公式World認証、保存録画の再生、許可取消を英語画面で収録します。承認者コードはサービスの非公開設定から読み込みます。映像と時刻情報はGit対象外の `artifacts/world-demo/<実行日時>/` に保存します。

この手順は保存済みのJob録画を使用し、実機操作や送金を実行しません。公式Sandboxの模擬IDを使うことを画面に表示します。保存済みJob 5で認証成功、映像配信、承認者ブラウザからの配信拒否、取消後の配信拒否を確認しました。本番の人間認証と実機からの一連の決済確認は別途行います。
