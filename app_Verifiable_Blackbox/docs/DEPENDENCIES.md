# Reproducible dependencies

- Node 22.22.1 / npm 10.9.4; `.nvmrc`, manifests and npm lockfile are authoritative.
- Next.js 16.3.2 / React 19.2.8 / TypeScript 7.0.2 / viem 2.55.19 / Privy 3.37.4. Verification results for this checkout are recorded in VALIDATION.md.
- Foundry v1.7.1: install the official release from https://github.com/foundry-rs/foundry/releases/tag/v1.7.1 and place Windows executables in `.tools/foundry-v1.7.1/`. Other platforms may put the executables on PATH when using the Node runner introduced with contracts.
- Solidity 0.8.28, EVM Cancun, optimizer 200 runs (`foundry.toml`).
- OpenZeppelin Contracts v5.4.0: `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0` (MIT).
- OpenZeppelin Contracts Upgradeable v5.4.0: `e725abddf1e01cf05ace496e950fc8e243cc7cab` (MIT).
- forge-std v1.12.0: `7117c90c8cf6c68e5acce4f09a6b24715cea4de6` (MIT / Apache-2.0).

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-contracts.ps1` to fetch the exact Solidity dependency revisions. The script refuses to reuse a different revision. Dependencies retain their upstream licenses in `lib/`; generated dependencies and binaries are ignored by Git.

Next.js setup reference: https://nextjs.org/docs/app/getting-started/installation. For this installed release, consult `node_modules/next/dist/docs/` as well.
