# Device signatures and ENS

This independent CLI verifies P-256 signatures over a Job identifier and optionally calls an ERC-7913 verifier. It never drives the robot, executes Phala verification, or changes a payment. A valid device signature proves possession of the enrolled key for that identifier; it does not prove work completion.

From the application root after `npm ci` and Contract dependency setup:

```powershell
npm run test:device
npm run test:device-contracts
npm run test:device-local
```

The last command launches its own disposable Anvil and generates `parts/device-signature/local/test-report.html`. It is explicitly a public test fixture; no hardware is contacted.

The shared digest is `SHA-256(abi.encode(SHA-256("DeviceJobSignatureV1"), uint256 chainId, address core, uint256 jobId))`. Public keys are `qx || qy` (64 bytes), signatures are low-S `r || s` (64 bytes), over the digest without hashing it again. Contract, Node and fixture tests check identical encoding and reject another Job, chain, Core or key.

Read a registered key:

```powershell
$env:ENS_RPC_URL = '<Sepolia RPC URL>'
node parts/device-signature/cli.mjs ens --ens vbb-rover-001.eth
```

This reads the onchain `vbb.device.p256` text record through the Sepolia Universal Resolver configured by pinned viem. Missing records, wrong keys, wrong chains, unavailable RPC and resolver failures stop verification; there is no substitute key. The report records the lookup block and time. CCIP URL following is disabled.

Recheck a saved signature with the current ENS key and an ERC-7913 `eth_call`:

```powershell
node parts/device-signature/cli.mjs verify --input parts/device-signature/local/signature.json --ens vbb-rover-001.eth --chain-id 11155111 --core <CORE> --job-id <JOB> --rpc <SEPOLIA_RPC> --verifier <VERIFIER> --report parts/device-signature/local/verified.html
```

Alternatively use `--key trusted-key.json` instead of ENS. The caller must enroll that key independently of the response being verified. Output files refuse overwrite. The report distinguishes fixture, saved signature, and a fresh API request (which may return the device's same-Job cache). RPC failure produces a partial report and a failing command, never an onchain success claim.

With an attended, stopped and DISARMED device running signature-capable firmware, set `ROVER_API_TOKEN` privately and use `cli.mjs key --device http://<IP> --out <KEY_FILE>`, then `cli.mjs sign --device http://<IP> --key <KEY_FILE> --chain-id <CHAIN> --core <CORE> --job-id <JOB> --out <SIGNATURE_FILE> --report <REPORT_FILE>`. These commands only call signature endpoints; they do not ARM, DISARM or move the machine. Do not publish private device configuration or saved signatures. Firmware setup belongs to the separate Rover project.

The Web receipt shows public enrollment information, with per-Job device signature verification remaining **not checked**. This CLI does not automatically change that status or the settlement policy. See [validation](../../docs/VALIDATION.md) for current results.
