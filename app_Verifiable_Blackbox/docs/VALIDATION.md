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
