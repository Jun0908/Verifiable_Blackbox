# Demo walkthrough

Use `npm run demo:rover` for a self-contained local demonstration. Use `npm run demo:rover-phala` when the separate Phala LOCAL_DEV service is installed. Both use test tokens, a public Anvil wallet and simulated Rover responses. The real TEE/hardware flow has not been verified in this checkout.

## Show the success case

1. Point out the **LOCAL DEMO** banner. Sign in and create a Job for 100 mUSDC.
2. Open the Rover screen. **SIMULATED BRIDGE** means no physical robot is connected. The controls are disabled until Connect.
3. Connect, hold Forward, release, then end controls. Only confirmed stop unlocks the next UI step; operation markers are not work evidence.
4. Select **Verify & pay**. The owner signs the Job and payment terms. The server validates the owner, context and deadline, submits the commitment and checks the verifier's signed verdict.
5. Show the paid receipt, payment transaction and verification details. Refresh and sign in again to show reconciliation with the chain.

## Show refusal

Open **Other options → Test invalid evidence** after the paid Job. This creates a separate sample Job with changed evidence. Show **PAYMENT BLOCKED** and the absence of a receipt for that Job. The successful Job remains in history. Do not describe the invalid-evidence case as automatic detection of a stationary robot.

## Explain the components

| Component | What the demonstration establishes |
|---|---|
| Rover bridge | Session/sequence handling, command lease and stopping; mock responses in this recording |
| Owner approval | A signature over the Job, addresses, amount and expiry |
| Evidence / Phala adapter | Commitment consistency and signed verdict validation; LOCAL_DEV is not real TEE |
| Ethereum contracts | Escrow state, 100 mUSDC payout and receipt, replay protection |
| ENS / ERC-7913 tool | An independently enrolled P-256 key signed a Job identifier; separate from payment |

The attestation endpoint obtains a fresh nonce and reports quote/claim information. `quoteVerified=false` means independent Intel quote verification has not been performed. A device signature does not prove movement or delivery. Key storage in the device's NVS is not a Secure Element.

## Recording and evidence

`npm run test:browser` generates a local WebM under `artifacts/browser/`, plus a JSON result. It checks the full flow, refresh, tamper refusal and mobile overflow. It refuses non-local chains and a bridge without `simulated=true`. Browser recordings are ignored by Git; the reviewed screenshots are in [evidence](evidence/).

For a slower walkthrough recording, use `npm run test:browser -- --demo` while the simulated stack runs. The local output is `docs/evidence/demo-local.webm`; this generated file is not included in Git. Read the component table above alongside the recording.

- [Approved payment](evidence/approval-receipt.png)
- [Rejected evidence](evidence/tamper-rejected.png)
- [Camera simulation](evidence/rover-camera.png)
- [Mobile receipt](evidence/receipt-mobile.png)

## Attended checks still required

Restore connectivity to the configured real Phala service (health requests returned ECONNRESET), validate deployment measurements and the quote independently, then exercise actual Privy approval and Sepolia settlement. Observe the Rover stop, camera feed and gripper movement in person. Record the chain/addresses, Job, transaction hashes, timestamp and firmware/service versions. No part of the local recording substitutes for those results.
