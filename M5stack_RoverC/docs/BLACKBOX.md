# Blackbox接続

アプリrootは `../app_Verifiable_Blackbox`、Python rootはこのフォルダの `rover-python` です。
アプリ側の `scripts/local-stack.mjs --rover` は提出用フォルダを既定で参照し、
起動ごとのtokenとOS／Rover設定だけをPythonへ渡します。
Ethereum秘密鍵、RPC資格情報、Phala設定は渡しません。

別配置ならアプリを起動するPowerShellで設定します。

```powershell
$env:ROVER_PYTHON_ROOT = (Resolve-Path '../M5stack_RoverC/rover-python').Path
$env:ROVER_PYTHON = Join-Path $env:ROVER_PYTHON_ROOT '.venv/Scripts/python.exe'
node scripts/local-stack.mjs --rover
```

アプリは `web_bridge_server.py --camera --no-browser --port <port>` を起動します。
同じ `VBB_BRIDGE_TOKEN` をNext.js ServerとBridgeへ渡し、認証付き `/status` で起動を待ちます。
起動やカメラ接続だけではARMしません。Webの「接続」で初めて機体へ接続します。
画面終了時は `/stop` 後に `/status` が `idle` になるまで待ちます。
プロセス強制終了では停止確認ができないので、通常の停止は画面から先に行ってください。

`start-sepolia-web.mjs` など別launcherを使う場合も、上記 `ROVER_PYTHON_ROOT` を明示してください。
提出版以外を参照する旧既定値に注意してください。

## 模擬接続試験

```powershell
cd rover-python
.venv/Scripts/python.exe -m unittest discover -s tests -p test_blackbox_integration.py -v
```

実際のBridgeを別プロセスで起動し、Blackboxの実際のNext.js route関数から呼び出します。
認証、接続、走行、解放、グリッパー、JPEG中継、カメラOFF、停止、
Job引継ぎデータと操作終了マーカー、自動決済409、署名CLIのHTTP処理を検査します。
Node.js 22.13以降とアプリ側npm依存が必要です。
通信先は試験が起動したloopbackの模擬機体だけです。

これはNext.js route関数の統合試験です。Next.js全画面・Wallet・Chainを起動した
Job作成からの通し試験はアプリ側で別途実施してください。実機との通し確認もT12に残します。

自由操作や停止によって `physicalMovementVerified` / `paymentEnabled` はtrueになりません。
`/api/demo/rover/complete` の自動決済POSTは使用しません。
