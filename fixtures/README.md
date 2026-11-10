# fixtures/

- `blobs/`: ciphertexts of the demo listings (`<sha256>.bin`), also served from `web/public/blobs/`. The host is untrusted because the sha256 is on chain.
- `team-made/`: the team's real dataset (Agent Market catalog + job stats, November 2026), with source URLs and collection date. Labelled "team-made".
- Demo datasets: fictional and labelled "synthetic".
- `minhash-params.json`, `minhash-vectors.json`, `ecies-vectors.json`: shared TS ↔ Rust test vectors.
- `criteria/`: example buyer criteria, including `print-row-1.json` (README step 7) and `demo.json`.

No keys here. The demo buyer viewing key, if kept (KICKOFF.md §2.7), is derived in code from a public label, not stored as a key file.
