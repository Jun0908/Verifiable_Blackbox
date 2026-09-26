# Payment ledger

The ledger uses Curvegrid MultiBaas to read selected Sepolia transaction receipts and blocks. The selection in `apps/web/lib/ledger/selection.json` contains Job 1 and its three transactions. The cutoff includes September 26, 2026 in Asia/Tokyo; transactions at or after September 27, 00:00 JST are excluded.

## Connection

Create an API key for an Ethereum Sepolia MultiBaas deployment and add the following to the root `.env`:

```dotenv
MULTIBAAS_URL=https://YOUR_DEPLOYMENT.multibaas.com/api/v0
MULTIBAAS_API_KEY=YOUR_SERVER_API_KEY
LEDGER_CONFIRMATIONS=12
```

These settings are server-only. The key needs access to chain status, transaction receipt and block reads. The ledger does not submit transactions. Contract addresses and selected transaction hashes are configured independently of the application's transaction-signing settings.

## Data checks

```powershell
node --import ./scripts/register-ts.mjs --experimental-transform-types --test scripts/test-ledger-*.test.ts
npm run typecheck:web
```

Payments use `PaymentReleased.amount` and a matching token transfer. Job, Evidence, receipt and payment identifiers are checked before a payment is marked matched. Payment totals and matched totals are separate.

The monthly sample contains 120 usage records for three counterparties totaling 12.00 mUSDC. Sample records are identified in the data and CSV and do not represent unpaid Jobs. Amounts use integer token units; month boundaries use Asia/Tokyo.
