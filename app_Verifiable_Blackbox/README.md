# Verifiable Blackbox

A robot dashboard with approval-based demo payment and independent device signature verification, developed task by task. See [architecture](ARCHITECTURE.md) and [tasks](TASKS.md).

## Setup

Run from `app_Verifiable_Blackbox`. Tested with Node 22.22.1 and npm 10.9.4 on Windows. Versions are pinned in workspace manifests and `package-lock.json`.

```powershell
npm ci
npm run typecheck:web
npm run build:web
npm run dev:web
```

Open http://127.0.0.1:3000. No external service or credentials are required for the initial page. Copy `.env.example` only when configuring integrations; actual settings must remain untracked.

Contract setup and local deployment will be added in T03, approval/payment in T04–T06, Phala in T07, Rover in T08–T09, device/ENS verification in T10 and full verification instructions in T11–T12. Solidity is fixed to 0.8.28, EVM to Cancun and Foundry to v1.7.1. Do not treat a passing mock run as a physical robot or real TEE test.
