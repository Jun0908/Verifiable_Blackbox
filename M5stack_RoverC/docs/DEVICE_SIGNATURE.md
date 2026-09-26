# 停止中のDevice署名

通常buildに鍵生成・署名APIはありません。
`powershell -File scripts/build-rover.ps1 -Signature` で専用buildを作ります。
書込み・実鍵生成はT12の実機確認時に行います。

`node scripts/check-signature.mjs` はC++の実際のメッセージ組立関数をホストで実行し、
隣のBlackboxアプリの `encodeJob` / `digestJob` と照合します。
`VBB_APP_ROOT` でアプリrootを指定できます。アプリ側のnpm依存が必要です。
公開fixtureのP-256照合と別Job拒否も確認し、実機鍵は使用しません。

実機を停止・DISARMした後、アプリの `parts/device-signature/cli.mjs` から
`/device-signature/key`、`/device-signature` を呼びます。認証は機体の `X-Rover-Token`。
APIはform形式で `chain_id` / `job_id` の32-byte hexと `core` の20-byte hexを受け取ります。
公開鍵は64-byte `qx || qy`、署名は64-byte low-Sの `r || s` です。

ARM中の要求、署名中のARMは409になります。処理中は202を返し、GETで取得します。
NVSの鍵が壊れている場合はerrorとし、自動再生成しません。
同じ要求の直近結果はRAMに保持します。再起動後に同じ署名bytesになる保証はありません。

署名はJob識別情報への機体鍵の署名です。仕事完了・映像の正しさ・物理移動・支払い承認は保証しません。
ENS・ERC-7913・支払いはアプリ側の独立した処理です。
