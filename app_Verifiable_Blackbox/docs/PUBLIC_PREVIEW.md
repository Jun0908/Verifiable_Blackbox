# Public preview

Vercel uses the same pages as the local demonstration, with NEXT_PUBLIC_PUBLIC_PREVIEW=true set for the preview project. Leave this variable unset for the local demo. It is a Next.js build-time variable: rebuild after changing it.

- Ledger opens Monthly sample. The sample-only monthly and CSV routes accept public reads. Live MultiBaas access retains its local restriction.
- StegaVAR reads the published catalog and frames under /stegavar. Playback, Reveal, comparisons, saved analysis, explanatory diagrams and credits require no Python service. Reanalysis remains available locally.
- The dashboard and Rover pages keep their layout, with a read-only wallet and disabled live connection controls. Hosted pages do not poll the local robot, camera or analysis services.
- Do not copy local .env files, signing keys, recordings or private service credentials into Vercel. Do not remove the local API guards.

## Verification

Run the existing ledger and StegaVAR API tests. Run scripts/test-public-preview.test.ts twice, with NEXT_PUBLIC_PUBLIC_PREVIEW unset and true, using scripts/register-ts.mjs and Node's experimental-transform-types option. Check monthly totals, empty months, both CSVs, all six video cases, Reveal, display modes and explanatory diagrams in the deployed browser.

## Validation on 2026-09-26

- Local/default mode: 32 ledger, StegaVAR and mode-boundary tests passed; 25 Rover button/session/camera/gripper tests passed.
- Public mode: 3 mode-boundary tests passed. TypeScript check passed, including after integrating the latest main. Job-flow regression passed after integration.
- Vercel production build passed. Browser checks: monthly default, 120 entries / 3 counterparties / 12.00 mUSDC, empty-month switching, StegaVAR playback and Reveal, moving/stationary saved results and explanatory section. HTTP checks: summary CSV 3 rows, detail CSV 120 rows, 24 image-stream checks across all 6 cases, live Rover API still returns 403 remotely.
- The independent Windows worktree's dev server had API-routing/startup problems; a local production build was stopped after slow compilation. Local browser verification was not completed. No physical Rover, live reanalysis, Phala or Sepolia transaction was exercised. The existing local demo checkout and its secrets were not changed by this task.
