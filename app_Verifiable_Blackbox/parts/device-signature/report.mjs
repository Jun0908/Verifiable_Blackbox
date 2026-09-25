const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderReport(record, rpcResult = null, {ens = null, signatureSource = null, rpcFailed = false} = {}) {
  // ENS provenance comes only from this invocation's lookup, never record.ens.
  const rows = Object.entries({...(ens ? {'ENS名':ens.name, 'ENSネットワーク':`Sepolia (${ens.chainId})`,
    'ENS取得時刻':ens.resolvedAt, 'ENS取得ブロック':ens.blockNumber, 'ENSレコード':ens.recordKey} : {}),
    Job: record.jobId, Chain: record.chainId, Core: record.core,
    '機体公開鍵': record.publicKey, '署名対象のhash': record.digest,
    'ERC-7913 Verifier': rpcResult?.address ?? '未実施'});
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>機体署名の確認</title><style>body{font:16px/1.7 system-ui;background:#f3f6fa;color:#183048;max-width:900px;margin:40px auto;padding:24px}article{background:white;padding:32px;border-radius:16px}h1{margin-top:0}.ok{color:#06734d}td,th{padding:12px;text-align:left;border-bottom:1px solid #dde3e9}td{word-break:break-all}table{width:100%;border-collapse:collapse}small{color:#526579}</style>
<article><h1>機体署名の確認</h1>${record.testFixture ? '<p><strong>試験用fixtureの結果です。M5Stack実機は使用していません。</strong></p>' : ''}
${ens ? `<h2>${escape(ens.name)}</h2><p class="ok">ENSから取得した公開鍵と機体署名が一致</p>` : '<p>ENS：未使用（登録鍵ファイル等による確認）</p>'}
${signatureSource === 'saved' ? '<p><strong>保存済み署名を再検証しています。今回の実機応答ではありません。</strong></p>' : signatureSource === 'device' ? '<p>署名：今回の機体APIから取得（同じJobのキャッシュ応答を含みます）</p>' : ''}
<p class="ok">P-256署名：登録公開鍵との一致を確認済み</p>
<p>ERC-7913：${rpcResult ? '確認済み（eth_call／チェーンへの記録なし）' : rpcFailed ? '未確認（RPC照会または検証に失敗）' : '未実施（ローカル署名確認のみ）'}</p>
<p>Phala判定・支払い：このツールでは実行・照会していません。</p>
<table>${rows.map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join('')}</table>
<p>このJobについて登録機体鍵が署名したことを確認しました。走行データ・作業成功の証明ではありません。</p>
<small>このHTMLは生成時点の確認記録です。現在のENS登録や実機の存在を保証するものではありません。この確認結果は既存の支払い条件に追加されません。試験用fixtureを入力した場合は実機の確認ではありません。</small></article></html>`;
}
