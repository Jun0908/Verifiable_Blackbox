# 検証結果 — 2026-09-26

| 対象 | 結果 |
|---|---|
| Node 22.22.1 / npm 10.9.4、`npm ci` | 成功、依存audit 0件 |
| `npm run check` | 型チェック、109テスト、build成功 |
| `npm run test:evidence-compat` | Verifier・アプリ・Solidityの固定commitment一致 |
| Foundry `EvidenceEncodingTest` | Solidityで同じhashを計算、1テスト成功 |
| `npm run e2e:local` | HTTP検証、100 mUSDC支払い、Receipt成功 |
| `npm run e2e:approval` | 所有者承認、別Job/別Wallet拒否、障害・復帰、同時要求、二重支払い防止が成功 |
| `npm run e2e:docker` | Containerのhealth、non-root、書込禁止、再起動、100 mUSDC決済と拒否条件が成功 |
| 公式dstack simulator 0.5.3 + SDK 0.5.8 | 同じsigner導出、EIP-712署名、nonceに結び付いたquote取得が成功 |
| 独立Attestation検証 | 模擬応答で正常、nonce/signature identity/Chain/Evaluator/Policy/claims/Compose/reportData/measurementの不一致、検証サービス障害を確認 |
| Phala CLI 1.1.22 | help、CPU構成、既存CVMのread-only取得を確認 |

Local・Dockerの決済試験はchainId 31337限定です。改ざん、未提出、別Evaluator、期限切れ、同じVerdictの再使用、完了済みJobへの再検証では支払い・Receiptが増えません。アプリの承認試験では、Verifier応答の7種類の不正条件も支払い前に拒否します。

simulatorの出力は`simulated=true, attested=false, hardwareQuoteVerified=false`です。Attestation単体試験のquote verifierは模擬応答であり、実Intel quote検証の実績には含めません。

実Phalaへの本image配置、実quoteと期待構成の照合、Sepoliaの有人承認・支払い、CVM再起動後のsigner一致は未実施です。既存CVMは停止中と確認しました。クラウドの操作対象を決めてからT10の残りを確認します。

試験生成物は`artifacts/`（Git対象外）へ保存します。秘密設定や実取引用の鍵は記録・commitしません。
