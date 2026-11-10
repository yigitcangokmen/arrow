# S3 mainnet spike runbook (H-08a … H-08e)

Human-run steps for the mainnet payment-layer gates. The agent only prepares and reads; it never signs on mainnet.
Run them in order, from the main checkout, with Node 24:

```bash
cd ~/Desktop/hackathon/near-builds/arrow && source ~/.nvm/nvm.sh && nvm use 24.15.0
```

What exists today:
- `spikes/s3/spike-contract` (package `spike`): `mt_on_transfer` (`refund_all` → refund all, `keep` → keep all, `outlayer` / `outlayer_refund` → OutLayer chain call, then `on_outlayer` decides), `on_outlayer`, `set_wasm` (self only), `last` (view). Unit tests: `cargo test` in that folder. Build: `cargo near build non-reproducible-wasm` → `spikes/s3/spike-contract/target/near/spike.wasm`.
- `spikes/s3/init-mainnet.json`: init args (no secrets). `wasm_url` is the S1-b testnet FastFS copy of `spike-tee.wasm` (the repo is private, so there is no raw GitHub URL).
- `spikes/s3/s3c-b5-negative.ts` (`--prepare`, `--read <tx>`).
- Testnet twin check: the same wasm and the same init JSON deploy and answer `last` on `s3twin.arrowhq.testnet` (deleted afterwards); a direct `mt_on_transfer` from a non-intents account panics with `predecessor must be intents`.

Scripts that come from other workstreams (a step is ready only when its script exists):
- `spikes/s4/s4a-inbound.ts` (WS4-T05) for H-08a.
- `spikes/s3/s3a-simulate.ts` (WS1-T08, needs the WS4-T04 intent builder) for H-08b.
- `spikes/s3/s3b-notify.ts` and `spikes/s3/s3c-outlayer.ts` (WS1-T09 second half, need the WS4-T04 intent builder and RPC helpers) for H-08c and H-08d.

Every value-moving step below also needs the money decision (DEC K-06) approved by the user.

## H-08a · S4-a $2 inbound (1Click)
Preconditions: H-03 DONE (Arrow Buyer EOA on Base has ≥15 USDC and ≥0.0008 ETH). `npx tsx spikes/s4/s4a-inbound.ts --dry` → quote 200.
Run exactly:
```bash
npx tsx spikes/s4/s4a-inbound.ts --amount 2
```
Expected: `/v0/status` SUCCESS in < 120 s; `mt_balance_of(0x…, NEAR USDC)` ≈ 1.99.
Paste to the agent: the deposit address and the time to SUCCESS (the script writes `evidence/mainnet.json`).
If it fails: Arbitrum USDC origin (DEC G-06); rate limit → JWT (DEC E-08).

## H-08b · S3a(ii) funded simulate
Preconditions: H-08a DONE.
Run exactly:
```bash
npx tsx spikes/s3/s3a-simulate.ts --funded
```
Expected: `class: OK` (no signature error, no balance error).
Paste to the agent: the last 5 lines.
If it fails: the agent switches to the manual payload fallback (DEC K-03); H-08c waits.

## H-08c · Spike deploy + S3b notification / refund
Preconditions: H-07 DONE (`arrow-spike.arrowhq.near` exists with ≥1.4 NEAR), H-08b PASS, `spikes/s3/spike-contract/target/near/spike.wasm` exists (the agent built it).
Run exactly:
```bash
near contract deploy arrow-spike.arrowhq.near use-file spikes/s3/spike-contract/target/near/spike.wasm with-init-call new json-args "$(cat spikes/s3/init-mainnet.json)" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
near contract call-function as-read-only arrow-spike.arrowhq.near last json-args '{}' network-config mainnet now
npx tsx spikes/s3/s3b-notify.ts --mode refund_all
npx tsx spikes/s3/s3b-notify.ts --mode keep
```
Expected: `last` → `""`. refund_all: the log shows `S3_NOTIFY sender=0x…` with the msg byte for byte and the buyer balance is unchanged. keep: buyer −0.01, spike +0.01 (inside Intents).
Paste to the agent: the two tx hashes (the scripts write `evidence/mainnet.json`).
If it fails: the agent proposes PAYMENT_PATH=Escrow at K0; H-08d still runs (OutLayer composition is needed for escrow too).

## H-08d · S3c OutLayer composition + B5 negative test
Preconditions: H-08c DONE. Buyer Intents balance ≥0.05 USDC. `NEARAI_API_KEY` (H-01a) is in `.env`.
Run exactly:
```bash
near account export-account arrow-spike.arrowhq.near using-private-key network-config mainnet    # the private key is shown: share it with no one
outlayer login                        # "Account ID:" → arrow-spike.arrowhq.near · "Private key (ed25519:...):" → the key above
outlayer whoami                       # arrow-spike.arrowhq.near (mainnet)
set -a; source .env; set +a
outlayer secrets set "$(jq -cn --arg k "$NEARAI_API_KEY" '{NEARAI_API_KEY:$k}')" --profile arrow --wasm-hash $(cat spikes/s1/release/sha256.txt) --generate PROTECTED_MASTER:hex32 --access allow-all --via arrow-spike.arrowhq.near --build $(cat spikes/s1/release/sha256.txt)
npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer
npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer_refund
npx tsx spikes/s3/s3c-b5-negative.ts --prepare        # run the command it prints exactly (signed by arrowhq.near, 0.02 NEAR deposit, most of it refunded)
npx tsx spikes/s3/s3c-b5-negative.ts --read <tx_hash>
outlayer secrets delete --profile arrow --wasm-hash $(cat spikes/s1/release/sha256.txt)
outlayer logout
```
Expected: (1) `outlayer` → keep, `outlayer_refund` → refund, both < 90 s. (2) B5: `PASS` (OutLayer returned `null` or `pm` is null). (3) attestation 200 on `api.outlayer.ai`.
On testnet (S1-b) the same `--access allow-all --via <contract> --build <H>` form was accepted and the B5-style direct call was refused with "Access denied by access condition".
Paste to the agent: the tx hashes (the scripts write `evidence/mainnet.json`).
If it fails: (1) gas or time → escrow (DEC H-15) plus a min_gas 400 / execute_intents 900 Tgas attempt (DEC H-11). (2) B5 fails → WASM allowlist becomes the primary guard and the trust table gets a row. (3) interface error (deserialize) → the agent compares against the 7-parameter `request_execution` signature (DEC V-11). If OutLayer mainnet refuses the testnet FastFS URL: `outlayer upload spikes/s1/release/spike-tee.wasm` while logged in as arrow-spike (mainnet FastFS), then `near contract call-function as-transaction arrow-spike.arrowhq.near set_wasm json-args '{"wasm_url":"<printed FastFS URL>","wasm_hash":"'$(cat spikes/s1/release/sha256.txt)'"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as arrow-spike.arrowhq.near network-config mainnet sign-with-keychain send`, and re-run the two `s3c-outlayer.ts` lines.

## H-08e · Spike cleanup
Preconditions: the agent has read the H-08c/d results (WS1-T10 DONE).
Run exactly:
```bash
near contract call-function as-transaction intents.near mt_transfer json-args '{"receiver_id":"arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"<spike balance, the agent tells you>"}' prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as arrow-spike.arrowhq.near network-config mainnet sign-with-keychain send
near account delete-account arrow-spike.arrowhq.near beneficiary arrowhq.near network-config mainnet sign-with-keychain send
near account view-account-summary arrow-spike.arrowhq.near network-config mainnet now
```
Expected: the last command says the account does not exist (UNKNOWN_ACCOUNT); arrowhq.near ≈ +1.4 NEAR.
Paste to the agent: the two tx hashes.
If it fails: DeleteAccountWithLargeState is not expected (the state is small); any other error → paste it to the agent.
