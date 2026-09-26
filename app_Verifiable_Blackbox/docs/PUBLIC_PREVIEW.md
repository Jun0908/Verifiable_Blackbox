# Public preview

Vercel uses the same pages as the local demonstration, with NEXT_PUBLIC_PUBLIC_PREVIEW=true set for the preview project. Leave this variable unset for the local demo. It is a Next.js build-time variable: rebuild after changing it.

- Ledger opens Monthly sample. The sample-only monthly and CSV routes accept public reads. Live MultiBaas access retains its local restriction.
- StegaVAR reads the published catalog and frames under /stegavar. Playback, Reveal, comparisons, saved analysis, explanatory diagrams and credits require no Python service. Reanalysis remains available locally.
- The dashboard and Rover pages keep their layout, with a read-only wallet and disabled live connection controls. Hosted pages do not poll the local robot, camera or analysis services.
- Do not copy local .env files, signing keys, recordings or private service credentials into Vercel. Do not remove the local API guards.

## Verification

Run the existing ledger and StegaVAR API tests. Run scripts/test-public-preview.test.ts twice, with NEXT_PUBLIC_PUBLIC_PREVIEW unset and true, using scripts/register-ts.mjs and Node's experimental-transform-types option. Check monthly totals, empty months, both CSVs, all six video cases, Reveal, display modes and explanatory diagrams in the deployed browser.
