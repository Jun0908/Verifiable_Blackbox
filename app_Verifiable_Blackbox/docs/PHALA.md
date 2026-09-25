# Phala connection

`MOCK_TEE` and `PHALA` are explicit modes. There is no automatic fallback. The adapter checks schema, job, provider, commitment, trusted signer, EIP-712 recovery, chain job/hook/evaluator and verdict deadlines before settlement. The contract repeats its own authorization checks.

## Local verification

The separate Phala service defaults to `../../PhalaNetwork` relative to the app root; override with `PHALA_PROJECT_ROOT`. Install its dependencies and run its `npm run build` first. Then run:

```powershell
npm run test:demo-review
npm run test:phala-local
# Keep the local demo running instead:
npm run demo:phala-local
```

The runner owns its Anvil/Web/Phala processes, uses public local test keys, checks vacant ports and matches the service signer to the deployment. Default ports: 8545, 3000, 3100. Override with VBB_RPC_PORT, VBB_WEB_PORT and VBB_PHALA_PORT. Stop other instances of this checkout before launching another Next dev process (one cache lock per checkout).

## Real service / Sepolia checklist

Use a separate ignored environment file with the actual RPC, server signing roles, `DEMO_VERIFIER_MODE=PHALA` and HTTPS PHALA_VERIFIER_URL. Keep upstream RPC credentials in DEMO_RPC_URL/SEPOLIA_RPC_URL and expose only the local `/api/demo/rpc` URL to the browser. Match chainId, Core, Hook, Evaluator and trusted signer against the service health/configuration and on-chain getters. Check contract bytecode and provider/relayer test ETH balances. Never replace one address independently.

Use `scripts/check-live-config.mjs` (read-only) after preparing the environment. Do not run the local deploy script against Sepolia; it only supports chain 31337. Actual Privy login/signature and a testnet payment remain attended checks.

## Attestation meaning

`/api/demo/attestation` requests a fresh nonce. Dstack claims must bind the nonce, evaluator, chain and trusted signer, and match reportData. `quoteVerified` is explicitly false: this adapter collects the quote and checks claims, but does not cryptographically verify the Intel TDX quote. LOCAL_DEV is never labeled real TEE. A real quote must be independently verified with the Phala service's verification tooling and expected deployment measurements; save the time and result separately. No real-TEE verification or testnet payment is claimed by local tests.
