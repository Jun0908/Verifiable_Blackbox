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

Webアプリのroot `.env` には次を設定してWebを再起動します。

```dotenv
WORLD_SERVICE_URL=http://127.0.0.1:8787
WORLD_PUBLIC_URL=https://your-world-service.example
WORLD_INTERNAL_TOKEN=<開示サービスと同じ共有鍵>
```

`MODE=world` で公式接続します。公式イベント環境は模擬IDです。ローカル試験だけの場合は `MODE=rehearsal` と `BASE_URL=http://localhost:8787` を明示します。公式接続失敗時の自動切替はありません。

## 操作

1. 録画を保存したJobの詳細・領収書で「映像の開示リンクを作成」を押します。
2. リンクを閲覧者へ渡します。閲覧者が自分のブラウザで「映像の開示を依頼」を押します。
3. 依頼画面に表示された承認用リンクを承認者へ渡します。
4. 承認者が承認者コードを入力し、対象Job・所有者・映像ハッシュ・閲覧者を確認してWorldで承認します。
5. 元の依頼者の画面に録画が表示されます。取消・期限切れで以後の配信を拒否します。

録画はRaw MJPEGの各フレームと全体ハッシュを照合し、撮影順に表示します。Receiptとの関連付けを表示しますが、映像がオンチェーンで検証されたとは扱いません。再起動すると登録映像・依頼・許可は失効します。所有者はリンクを作り直してください。

`npm test` は模擬署名付きOIDCとローカルHTTPで検証します。公式環境での認証成功・キャンセルと、実Jobの有人通し確認は別途必要です。
