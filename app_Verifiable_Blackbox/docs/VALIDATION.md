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

## T07 - Phala integration (2026-09-26 JST)

`npm run test:phala-local` passed: local chain deployment, Phala LOCAL_DEV, 100 mUSDC payout and receipt, tamper/replay rejection, physical-completion block, origin and RPC restrictions. Signed approval regression also passed with seven malformed remote verdicts and fresh attestation nonces. Quotes are not independently verified.

Read-only Sepolia checks confirmed chain ID, deployed code, Core/Hook/Evaluator relationships and trusted signer. The configured real Phala health endpoint failed twice with ECONNRESET; real TEE settlement remains unverified. No Sepolia transaction was sent.

## T08 - Rover controls (2026-09-26 JST)

Python bridge unit tests: 21 passed using mocked controllers, including lease, stale sequence, telemetry, I2C and stop failures. Web typecheck passed. Browser at 1440px: disconnected controls disabled; Connect enables them; holding Forward reports simulated motors [35,35,35,35]; releasing returns [0,0,0,0]. End controls returns to Overview after idle confirmation. No browser page errors. Hardware was not connected or armed. Camera and gripper UI share this control session; detailed verification follows in T09.

## T09 - Camera and gripper (2026-09-26 JST)

45 Python bridge/camera/gripper/server tests and 5 Web proxy tests passed. Browser simulation: JPEG canvas updates while bridge stays idle (camera does not ARM); frozen frame disappears after 2 seconds and remains hidden. Fixed stale-frame redisplay by retaining the previous frame stamp. UI gripper sequence observed: one open, repeated close during hold, release on key-up, zero motor output throughout. Desktop and 390px screenshots saved in docs/evidence. These are synthetic camera frames and simulated command responses; real actuator movement was not tested.

## T10 - Device signature and ENS (2026-09-26 JST)

18 Node tests and 5 Solidity tests passed (including 256 changed-Job fuzz cases). Disposable Anvil confirmed matching TypeScript/Solidity digest and ERC-7913 eth_call; HTML labels the public fixture. Live read-only Sepolia lookup of vbb-rover-001.eth at block 11780553 matched the saved Job 7 signature and ERC-7913 verifier 0xfD789267D20c5124FA6718D15faa0EF47A5EF13f. This was a saved hardware signature, not a fresh device response. Report remains ignored at parts/device-signature/local/saved-live-report.html; no device request or transaction was sent. Web per-Job signature status remains not checked.

## T11 - Integrated browser flow (2026-09-26 JST)

Playwright exercised local Job 4: owner login, create/fund, scoped Rover handoff, explicit connect, simulated hold/release, confirmed stop, approval signature, Phala LOCAL_DEV, paid receipt, reload/sign-in receipt reconciliation, and tampered sample rejection. Browser page errors: none; 390px layout has no horizontal overflow. Screenshots: approval-receipt.png, tamper-rejected.png, receipt-mobile.png. Browser testing exposed and fixed an early-click hydration issue in local sign-in.

Local launches now isolate approval directories per disposable chain. Rover handoff validates the creation transaction and expiry. The actual Phala endpoint still requires a successful connection; real hardware operation, Privy signing and Sepolia payment in one run remain unverified. A stationary robot is not automatically detected: without owner approval, no payment is authorized.

`npm run validate:phala` passed after integration: Web typecheck, 10 escrow/evidence Contract tests, hash fixture, scoped Job state/history, 5 Rover API tests, 18 device/ENS tests, 5 device Contract tests, disposable ERC-7913 run, approval/outage/retry/concurrency checks, and Phala LOCAL_DEV API E2E. Production build passed; clean-checkout validation is recorded separately under T12.

## T12 - Publication preparation (2026-09-26 JST)

Setup, API, architecture, recovery and demonstration instructions are current. Direct dependency licenses and normalized snapshot hashes are recorded. Tracked-file review found only the environment template, with no runtime approval directory, saved device signatures, private environment, generated dependencies or raw videos. A credential-pattern scan found no matches; public Anvil fixture keys are intentionally included in tests.

The successful local walkthrough is 29.44 seconds, saved privately as `docs/evidence/demo-local.webm` (Phala LOCAL_DEV, simulated Rover, no real hardware). It shows Job 1 creation, hold/release, confirmed stop, signed approval, payment, receipt restoration and tampered evidence rejection; page errors: none. An earlier recording attempt exceeded the cold-compilation timeout during concurrent dependency installation; it was not accepted as the final demo.

A separate clone under `tmp/repro` installed 791 packages with `npm ci`; npm's own log recorded exit 0. Solidity dependencies were fetched from their pinned upstream revisions. At commit `f419924`, `npm run build:web` and `npm run validate` both passed with exit 0, including disposable Anvil deployment, fixture payment, receipt, changed-evidence rejection and replay rejection. No private environment or sibling Phala/Rover project was used for that Mock run. The installed Foundry 1.7.1 toolchain was supplied on PATH; the device test supports that path as well as local binaries. Turbopack's root is explicitly the application root so nested clones do not depend on parent workspace detection.

The real Phala health endpoint was checked once more at approximately 02:27 JST and still returned ECONNRESET. Sepolia read-only contract checks passed before that network step. Real TEE settlement and attended hardware/Privy verification remain incomplete.

The separate clone also passed `demo:rover` plus `test:browser` using MOCK_TEE and the simulated bridge: Job 1 creation, controls, stop confirmation, owner approval, payment, receipt after reload and tamper refusal; no page errors. Its first browser attempt hit a local Anvil request timeout during cold startup; the subsequent run completed successfully. This filesystem showed substantial first-load delays, so allow compilation to finish before demonstrating. All validation-owned services were stopped after the checks. The final Phala approval-isolation regression also passed after pinning its RPC and record directory explicitly.
