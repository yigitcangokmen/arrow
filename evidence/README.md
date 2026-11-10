# evidence/

- Written only by the integrator through `scripts/src/evidence-add.ts` (lib: `scripts/src/lib/evidence.ts`), in the main checkout.
- Append-only: `runs[]` entries are never edited or removed.
- Manual fixes go to `corrections[]` with a reason.
- Tx links use only `https://nearblocks.io/txns/<hash>`, `https://basescan.org/tx/<hash>`, `https://solscan.io/tx/<hash>`.
- No secrets, raw data rows, plain K or viewing keys here.
