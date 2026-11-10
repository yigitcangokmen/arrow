# Arrow · Gate log (spikes/GATES.md)

One section per gate (PLAN App. A.4). Each gate records result, tx hashes, command, last lines of raw output, chosen path, changed claim. Anything not measured says `NOT MEASURED`. Edited only in the main checkout (W1-07). Times GMT+7 [UTC].

## Tool versions
Recorded by WS1-T01 (S-α), 2026-11-10 14:56 GMT+7 [07:56Z]. Already on the machine before T0 (DEC §K K-08): cargo-near, near-cli-rs, gitleaks, Node 24.15.0, Rust 1.97.1 + wasm32-unknown-unknown, Docker. Installed by WS1-T01: outlayer CLI (`cargo install --git https://github.com/out-layer/outlayer-cli --rev 9898d00cd084b601aa1af65829415fa7c3ce6873 --locked`; HEAD unchanged at install time), wasmtime (`brew install wasmtime`), `wasm32-wasip2` target for 1.97.1.

```
2026-11-10T07:56:48Z
cargo-near-near 0.23.0
near-cli-rs 0.31.1
outlayer 0.2.2
outlayer-cli rev 9898d00cd084b601aa1af65829415fa7c3ce6873
8.30.1
wasmtime 50.0.1 (c307ec81d 2026-10-29)
rustc 1.97.1 (8bab26f4f 2026-07-14)
cargo 1.97.1 (c980f4866 2026-06-30)
targets(1.97.1): aarch64-apple-darwin wasm32-unknown-unknown wasm32-wasip2 
v24.15.0
11.12.1
Docker version 29.4.0, build 9d7ad9f
```

Acceptance: `tools_versions_pinned` PASS · `outlayer_cli_present` PASS.

### S0 · Funding · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S1-a · NEAR AI · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S1-b · OutLayer chain mode (testnet) · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S2 · Testnet token + refund · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S3a · Signature simulation · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S3b · Transfer notification + refund (mainnet) · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S3c · OutLayer composition + B5 (mainnet) · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S4-a · 1Click inbound + Solana dry · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

### S4-b · ECIES/XChaCha/MinHash interop · PENDING · —
- Commands: —
- Evidence: —
- PASS items: —
- Chosen path: —
- Changed claim: —

## K0 decision
PENDING (WS1-T11 fills: result, evidence, chosen path and changed claim per gate; PLAN §4.3 decision table). K0 due min(10 Kas 21:00 + Δ, 11 Kas 09:00) = 11 Kas 05:49 GMT+7 [10 Kas 22:49Z].
