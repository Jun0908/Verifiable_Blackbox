# Verifiable Blackbox

**Turn robot work into evidence businesses can accept and pay for.**

English | [日本語](README.ja.md)

| | |
|---|---|
| **Demo video** | Coming soon |
| **Live app** | Coming soon |
| **Architecture** | [System architecture and component responsibilities](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/docs/ARCHITECTURE.md) |
| **Source code** | [GitHub](https://github.com/Jun0908/Verifiable_Blackbox) |

![Verifiable Blackbox protocol architecture](assets/architecture.png)

## Problem

**Five million robots are working in factories. Who pays for their work, and on what evidence?**

According to the IFR's *World Robotics 2026*, published in September 2026, the global operational stock of industrial robots reached **5 million in 2025**. More than **600,000 new robots were installed that year, up 11%**. Robot work is already economic activity at scale. [IFR: World Robotics 2026](https://ifr.org/ifr-press-releases/news/five-million-robots-now-operate-in-factories-globally)

Adoption of AI in physical systems is expanding too. Deloitte's 2026 survey reports that **58% of respondent companies use physical AI to at least a limited extent**, with adoption **projected to reach 80% within two years**. Conducted in August–September 2025, the survey covered 3,235 business and IT leaders across 24 countries. Physical AI includes physical systems beyond robots. [Deloitte: State of AI in the Enterprise 2026](https://www.deloitte.com/us/en/about/press-room/state-of-ai-report-2026.html)

As deployment grows, businesses still face barriers to trusting these systems in everyday operations.

Capgemini surveyed 1,678 executives across 16 countries and 15 industries in January–February 2026. Respondents reported the following challenges:

| Challenge in adopting or operating physical AI | Respondents |
|---|---:|
| Moving from pilots to scaled deployment is a significant challenge | **76%** |
| Insufficient reliability undermines confident deployment | **71%** |
| Integrating and orchestrating multiple robotic systems is difficult | **66%** |
| Cybersecurity risks are a critical barrier | **53%** |

The survey primarily covered organizations with annual revenue above $1 billion. [Capgemini: Physical AI, p.101; methodology p.105](https://www.capgemini.com/wp-content/uploads/2026/04/Final-Web-Version-Report-Physical-AI.pdf#page=101)

Verifiable Blackbox addresses one part of this trust problem: **acceptance and payment when businesses purchase robot work from another organization.**

A warehouse hires a robotics provider to move goods. A facility outsources cleaning or inspection rounds. The customer needs more than a notification that a machine moved.

**Which job was performed, what evidence was reviewed, who accepted it, and how much was paid?**

When control logs, video, approvals, invoices, and transfers live in separate systems, someone still has to reconcile them. As job volume grows, reviewing each record becomes a burden.

Sharing evidence creates another problem. Factory and warehouse footage can expose equipment, products, site layouts, and employees. Confirming a task should not require broadly disclosing the site where it happened.

**Businesses need a way to connect work evidence, acceptance conditions, and payment—and present the necessary information to the appropriate parties.**

## Solution

Verifiable Blackbox represents robot work as Jobs and **connects evidence, user authorization, verification results, and payment for each job**.

A customer creates a Job with a provider, budget, and deadline. The application binds operation records and authorization to that Job and submits Evidence. A verification service on Phala checks the Evidence against the onchain Job and returns a signed verdict. An Evaluator on Ethereum checks that verdict, releases the escrowed reward, and issues a Receipt that preserves the link to the supporting evidence.

```text
Create a job
    ↓
Bind operation records, evidence, and authorization to the Job
    ↓
Phala checks the Evidence against the onchain Job
    ↓
Ethereum checks the signed verdict and settles payment
    ↓
Trace the job, evidence, and payment through the ledger
```

Our demonstration hardware is a small M5Stack Rover. The intended applications include transport, cleaning, and inspection services delivered by external robotics providers.

The elements to standardize across robot types are the Job, device identity, evidence references, acceptance result, and payment record. Acceptance conditions remain specific to each application: a delivery handoff and cleaning quality require different sensors and evaluation methods.

The current MVP connects evidence to settlement and includes ENS device-signature checks, video embedding and reconstruction, and a payment ledger. Integrating access controls for confidential footage is part of the broader product design.

## Demo

The demo follows one job from its creation to the evidence behind its payment.

1. **Create a Job.** Set the provider, reward, and deadline, then fund the escrow with the mUSDC test token.
2. **Operate the Rover.** Use the browser controls and inspect operation records, stop status, and camera footage.
3. **Check the payment conditions.** Match the user's signed authorization to the session records. The video-based path also considers the motion assessment of that session's recording.
4. **Move from Evidence to settlement.** Follow Phala's signed verdict and the Ethereum contract checks through to the reward and Receipt.
5. **Trace the payment.** Reconcile the Job, Evidence, verification Receipt, and token transfer in the ledger.

On Sepolia, a Job using synthetic Evidence received a Phala verdict and completed a **100 mUSDC payment**.

| Job 1 record | Transaction |
|---|---|
| Job creation | [Creation transaction](https://sepolia.etherscan.io/tx/0xc1900726f694e8669ac014fe1d3eb4a62960368016541f22adedc16bb0b7ea4f) |
| Evidence submission | [Submission transaction](https://sepolia.etherscan.io/tx/0x7d8b0243ba3dd401544d4a7978e00b22bc23e74772e71cc0f18e8f2bbe6741ed) |
| Settlement | [100 mUSDC settlement transaction](https://sepolia.etherscan.io/tx/0x7eaaba65800fe2f03259b63d7bc49afc132e4b2f8cb5d6579f03b19c08050c1a) |

*These transactions demonstrate the settlement path with test Evidence. They do not establish completion of a physical robot task.*

## How it works

### Ethereum — Settle only against a verdict matching the submitted evidence

Each request becomes a Job on our [Core](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/packages/contracts/src/HackathonAgenticCommerce.sol), based on ERC-8183. The demo uses mUSDC, a test ERC-20 token.

[DemoEvidenceHook.sol](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/packages/contracts/src/DemoEvidenceHook.sol) records an evidence commitment against the Job on submission. It rejects zero commitments and duplicate commitment records for the same Job.

[MockTeeEvaluator.sol](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/packages/contracts/src/MockTeeEvaluator.sol) checks the Job ID, provider, evidence commitment, validity window, and signer of an EIP-712 signed verdict. A mismatched commitment reverts with `EvidenceMismatch`; an unexpected signer with `InvalidSigner`; and a consumed verdict with `VerdictAlreadyUsed`.

Once those conditions pass, the Evaluator calls the Core's completion function and issues a Receipt alongside settlement. **The verdict must match both the submitted evidence and the job being paid.**

Sepolia deployments:
[Core](https://sepolia.etherscan.io/address/0xdbf3647280CBd9e4A89D3e0c4b6bea9E6D5677B9) · [Evidence Hook](https://sepolia.etherscan.io/address/0xD26930e003f6bc1Fb087d05E0FC18a82a15F7c66) · [Evaluator](https://sepolia.etherscan.io/address/0xC2262b084A1a3dFD9cd2c6D03489B3c9ecB7d30c)

### Phala — Check consistency between Evidence and the Job

When the Phala verification service receives Evidence, it reads the corresponding Job from the chain. [policy.ts](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/PhalaNetwork/src/policy.ts) checks the Job state, Evaluator, Hook, expected Robot ID, challenge, sequence, timestamps, and evidence commitment.

If those checks pass, [verify.ts](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/PhalaNetwork/src/verify.ts) creates and signs a verdict containing the Job ID, provider, evidence commitment, expiration, and nonce. Phala mode uses the [dstack integration](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/PhalaNetwork/src/dstack-security.ts).

Phala checks record integrity and consistency with the Job; the application handles video motion assessment. A TEE verdict alone does not establish delivery completion or cleaning quality. The onchain Evaluator checks the configured signer, while hardware attestation is checked by a [separate verifier](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/PhalaNetwork/src/attestation-verifier.ts).

### Rover and application — Bind authorization, controls, and recording to one job

The hardware uses an M5StickC Plus2, RoverC Pro, and Unit CamS3-5MP camera. A [Python Bridge](https://github.com/Jun0908/Verifiable_Blackbox/tree/main/M5stack_RoverC) communicates with the hardware, while the Next.js application binds each operation session to its Job.

[payment-gate.ts](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/apps/web/lib/server/rover-session/payment-gate.ts) checks the user's signature, expiration, operation records, and correspondence between the session and analysis result. The video-based path requires a `MOVING` result. Skipping video assessment also requires explicit authorization for that payment condition.

[payment.ts](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/apps/web/lib/server/rover-session/payment.ts) includes a hash of the combined record in the Evidence, then connects submission, Phala verification, and settlement. Video assessment and the recording pipeline retain a trust dependency on the application server.

### ENS and ERC-7913 — Resolve a device name to its signing key

The device is registered as `m5stack-rover-001.eth`, with its P-256 public key stored in the `vbb.device.p256` ENS text record.

[ens.mjs](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/parts/device-signature/ens.mjs) resolves the key from ENS on Sepolia for use with the ERC-7913 signature checks in [DeviceSignatureVerifier.sol](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/parts/device-signature/contracts/DeviceSignatureVerifier.sol).

Reviewers can **check whether a signature corresponds to the key registered under the ENS name**, beyond simply reading a device label. This is currently an independent device-verification feature, separate from settlement conditions.

### Curvegrid — Trace payments back to the records supporting an invoice

The payment ledger retrieves actual Sepolia transaction receipts and events through Curvegrid MultiBaas. [fetch.ts](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/apps/web/lib/server/curvegrid/fetch.ts) checks the chain, transaction success, and block consistency, then passes the records to ledger logic that reconciles Jobs, Evidence, verification Receipts, reward payments, and ERC-20 transfers.

The ledger lets a reviewer move from a payment amount to **the job and verdict that supported it**.

The [monthly aggregation](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/apps/web/lib/server/curvegrid/monthly.ts) demonstrates grouping jobs by counterparty and exporting CSV records for accounting. Actual transaction records and monthly sample data are displayed separately.

### StegaVAR — Embed and reconstruct site footage

The [StegaVAR service](https://github.com/Jun0908/Verifiable_Blackbox/tree/main/app_Verifiable_Blackbox/services/stegavar) uses Python, PyTorch, and LF-VSN to embed Rover footage into cover images and reconstruct it. The interface compares the original footage, embedded output, and recovered footage.

A separate [job-recording analysis implementation](https://github.com/Jun0908/Verifiable_Blackbox/blob/main/app_Verifiable_Blackbox/services/stegavar/scripts/job_recording.py) supplies motion assessments to the application's payment conditions.

Video embedding and access control are separate capabilities. The current public samples do not provide a confidentiality guarantee. The broader design envisions combining World identity checks with business access permissions to disclose evidence to the appropriate parties.

## Technology stack

| Area | Technologies |
|---|---|
| Frontend and API | Next.js, React, TypeScript |
| Wallet and chain access | Privy, viem |
| Smart contracts | Solidity, Foundry, Core/Hook/Evaluator based on ERC-8183, EIP-712 |
| Device identity | ENS, P-256 signatures, ERC-7913 |
| Evidence verification | Phala Cloud, dstack |
| Payment ledger | Curvegrid MultiBaas |
| Video processing | Python, PyTorch, StegaVAR, LF-VSN |
| Hardware | M5StickC Plus2, RoverC Pro, Unit CamS3-5MP, ESP32, PlatformIO |

## Repository

| Component | Responsibility |
|---|---|
| [M5stack_RoverC](https://github.com/Jun0908/Verifiable_Blackbox/tree/main/M5stack_RoverC) | Robot control, camera, recording, Python Bridge, and device signatures |
| [PhalaNetwork](https://github.com/Jun0908/Verifiable_Blackbox/tree/main/PhalaNetwork) | Evidence verification, signed verdicts, and attestation |
| [app_Verifiable_Blackbox](https://github.com/Jun0908/Verifiable_Blackbox/tree/main/app_Verifiable_Blackbox) | Job management, controls, authorization, settlement, ENS checks, ledger, and video processing |
