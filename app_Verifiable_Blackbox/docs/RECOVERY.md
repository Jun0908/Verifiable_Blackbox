# Approval and recovery

The user signs the displayed approval context (chain, Core, evaluator, token, job, owner, provider, amount, expiry and nonce). The hash of this signed document is committed as DemoEvidenceV1.imageHash. It is an approval document, not a camera image or movement measurement.

Server state lives in `apps/web/.demo-reviews/<chain>-<core>/<job>.json`. Phases are review, authorized, submitting, submitted, paying and paid. A per-job directory lock serializes requests across workers; writes use a unique temporary file and rename.

1. After a normal page reload, open the same wallet/chain/job and resume with the same signed approval. A known transaction hash is queried before any further action.
2. If the verifier was unavailable, keep the saved evidence and submission hash. Restore the configured verifier and retry; never switch PHALA to MOCK_TEE silently.
3. `TRANSACTION_RECONCILIATION_REQUIRED` means a submitting/paying phase was saved but the transaction hash was not. Stop retries. Check the exact chain, Core, job, hook commitment, evaluator receipt and role account transaction history. Do not clear the phase and broadcast blindly.
4. `APPROVAL_REQUEST_IN_PROGRESS` may be an active request or a crash lock. Stop the owning application, preserve a backup of the record, inspect chain state, then remove only that job's lock if no writer remains. The application deliberately does not expire locks automatically.
5. If a transaction is found, verify its sender, destination, calldata, status, job and commitment before recording the matching hash in a backed-up record. If no transaction can be established, leave the job pending and seek operator review. Never mark a record paid manually.

Do not commit signed records, lock directories or backups. Real robot checks and the owner's actual wallet signatures require an attended session. POST `/api/demo/rover/complete` always returns 409 PHYSICAL_MOVEMENT_NOT_VERIFIED.
