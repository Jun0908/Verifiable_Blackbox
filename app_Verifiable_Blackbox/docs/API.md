# Local demo API

All endpoints return JSON with `Cache-Control: no-store` where state is read. Automation runs on localhost; Host and browser Origin must be loopback and same-origin. No CORS access is enabled. The launcher binds to 127.0.0.1. Secrets stay in server configuration.

| Endpoint | Method/input | Result |
| --- | --- | --- |
| config | GET | Public deployment addresses, chain, verifier mode |
| rpc | POST JSON-RPC | Allowlisted reads and signed raw transaction forwarding; no personal/admin/anvil or unsigned sends |
| faucet | POST client address | Local demo gas and test-token preparation |
| provider | POST action=setBudget or submit, jobId, scenario=success/tampered | Submitted evidence and commitment |
| verify | POST evidence | Signed verdict or verification error |
| settle | POST verdict, signature | Confirmed receipt and payment transaction |

Paths are under `/api/demo/`. Input errors return an `ok:false,error` JSON object. Local boundary violations return 403; blocked RPC methods return 400; upstream failures return 502/503. Contract rejection does not count as payment. Client transaction receipts must contain JobCreated; never infer a new Job ID from an unconfirmed counter read.

Local test keys are public Anvil fixtures. Use `npm run demo:local` for these; the script requires chain 31337 and refuses occupied ports. Privy credentials are optional for the sample preview; set browser-safe IDs in `.env` for interactive wallet signing. Real provider/relayer keys must never use a NEXT_PUBLIC prefix.
