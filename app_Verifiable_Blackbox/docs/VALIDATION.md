# Validation record

This records checks performed in the submission checkout. Physical movement, fresh device signatures, Privy user approval and real Phala attestation must be identified separately from local fixtures.

## Acceptance inventory

| Task | Checks |
| --- | --- |
| T01 | Clean npm install, pinned dependencies, typecheck, production build, browser load without services |
| T02 | Dashboard/Rover navigation, English/Japanese persistence, sample states, disabled real actions, desktop/390px layout |
| T03 | 100 mUSDC payment, receipt and balances, invalid signature/commitment/expiry/replay rejection, TS/Solidity hash agreement |
| T04 | Owned local chain, client-signed JobCreated, sample submit/verify/settle, tamper rejection, API boundary checks |
| T05 | Owner approval, wrong wallet/job/context/expiry rejection, concurrent/repeated request, persisted recovery and unknown transaction handling |
| T06 | Wallet/chain/core isolation, historical receipts, no sample/closed job handoff, chain refresh |
| T07 | Real local Phala service, matching commitment/signer, invalid response and service failure, attestation labels |
| T08 | Mock bridge session/sequence, release/stop/navigation, timeout/telemetry/I2C failure, occupied ports |
| T09 | Mock JPEG/stale/disconnected state, camera does not arm, gripper release and repeated hold |
| T10 | Fixture P-256/digest, wrong key/job, ENS missing/RPC failure, ERC-7913 eth_call |
| T11 | Full local integration and regression; record external/human-dependent checks separately |
| T12 | Clean reproduction, source/license review, no private artifacts, demo script/video and remaining limits |

## Human-dependent checks

No unattended physical driving is performed. A fresh real-robot run, the owner's interactive Privy approval and a video claiming these real-world results require an attended session. Automated fixture signatures are labeled as such.

## Results

Results will be appended after each task's verification.

### T01 — 2026-09-26
Clean npm ci: 789 packages. Node 22.22.1, npm 10.9.4, Foundry 1.7.1. Pinned Solidity dependencies resolved. Typecheck and production build passed; browser rendered the initial page on loopback with no page errors. npm reported upstream deprecation notices. Dependency installation took about 12 minutes on this filesystem.

### T02 — 2026-09-26
Typecheck passed. Agent-browser confirmed dashboard/rover navigation, Japanese selection retained between routes, sample paid receipt, tamper failure message and disabled real controls. Screenshots at 1440px and 390px inspected; no horizontal overflow at 390px; no page errors. React component/hook and accessible status/disabled control review completed.

### T03 — 2026-09-26
10 Foundry tests passed: 100 mUSDC payment and receipt, wrong signer/provider/commitment, expired verdict/job, replay rejection, demo creation and shared ABI commitment vector. TypeScript parser roundtrip, malformed input and tamper checks passed. Local Anvil deployment succeeded on chain 31337; deployment script refuses other chains. Typecheck passed. Filesystem module reads were slow on their first access; successful runs are recorded after completion.

### T04 — 2026-09-26
Typecheck passed. Local API E2E passed: confirmed JobCreated, 100 mUSDC, receipt, tamper and replay rejection, 409 physical-completion guard, cross-origin rejection and RPC method restrictions. Browser with the explicitly labeled public Anvil test wallet created sample Job 5, paid it and displayed its receipt; altered Job 6 was rejected with no receipt. No browser page errors. Privy interactive login remains an attended check; the local wallet is a separate fixture implementation.

### T05 — 2026-09-26
Anvil + Phala LOCAL_DEV approval integration passed: unsigned/wrong wallet/wrong job/changed context/expired job refused; residual lock refused; unknown submitting/paying state refused; verifier outage preserved evidence and paid nothing; retry and concurrent requests produced exactly one 100 mUSDC payment. API tests confirmed 409 automatic-payment guard and review Origin/input restrictions. Typecheck passed. Recovery procedure is in RECOVERY.md.

### T06 — 2026-09-26
Selected-job and history tests passed for wallet/chain/core separation, history retention, sample/paid exclusion, malformed storage, storage failures and scoped operation markers. Typecheck passed. Browser reopened paid Job 5 from history after a fresh page load; creation receipt and current chain status were checked and local payment/creation hashes rendered without an explorer. Registered information remains separate from per-job device verification.

## T07 ? Phala integration (2026-09-26 JST)

`npm run test:phala-local` passed: local chain deployment, Phala LOCAL_DEV, 100 mUSDC payout and receipt, tamper/replay rejection, physical-completion block, origin and RPC restrictions. Signed approval regression also passed with seven malformed remote verdicts and fresh attestation nonces. Quotes are not independently verified.

Read-only Sepolia checks confirmed chain ID, deployed code, Core/Hook/Evaluator relationships and trusted signer. The configured real Phala health endpoint failed twice with ECONNRESET; real TEE settlement remains unverified. No Sepolia transaction was sent.
