# Mainnet deploy runbook (H-12)

Deploys the market to `arrow-market.near` (not locked yet; the lock is a later, separate step). A human runs
every signing line, one at a time, in this order. Each line was first run against a testnet twin
(`mainnet-dryrun.arrowhq.testnet`, same wasm, same init JSON, same near-cli-rs 0.31.1 command form with
`sign-with-keychain`); the twin result is written under each step.

**Status: BLOCKED until the K3 wasm freeze** (release/sha256.txt written, `.env` `PROGRAM_WASM_URL` /
`PROGRAM_WASM_SHA256` set to the frozen program), **H-01b** (`.env` `NEARAI_API_KEY_MAINNET` filled) **and the
contract rebuild below** (WS2-T13). Step 0 prints FAIL for each until then.

## Before step 0: rebuild the contract wasm at the final commit (hard precondition)

The wasm in `release/contracts/` embeds the commit it was built from. Any later change to `contracts/arrow` (source,
`Cargo.lock`, `rust-toolchain.toml`) or to the shared wire vectors (`fixtures/{input,output,msg}-vectors.json`) makes it
stale: the frozen program and the fixed SDK then speak a different wire format than the contract (every list fails
`E04`, or every eval and buy returns `ok:false` and refunds `not_ok`). So, once after the fix merge and the freeze, on a
clean tree at the final commit:

    cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/build-contracts.sh --reproducible

It builds twice in Docker, writes `release/contracts/{arrow-mainnet.wasm,SHA256SUMS,BUILD.md}` and records the sha in
`evidence/mainnet.json`. Commit those three files. Then:

    bash scripts/deploy/mainnet-check.sh wasm

Expected: `PASS contract_wasm_sha256` and `PASS contract_wasm_fresh built from <rev>`. A `FAIL contract_wasm_stale` names
the files that changed since the embedded commit: rebuild again. Step 0 runs the same two rows. Nothing below uses a
literal contract sha: the value is whatever `release/contracts/SHA256SUMS` holds.

| What | Value |
|---|---|
| Contract account | `arrow-market.near` (exists, 0.1 NEAR, no code) |
| Owner / payer / treasury | `arrowhq.near` (macOS keychain) |
| Reserve | `arrow-market-v2.near` (exists, 0.1 NEAR): no deploy in H-12 |
| Contract wasm | `release/contracts/arrow-mainnet.wasm`, the reproducible build of the final commit (see above). Its sha256 is the line in `release/contracts/SHA256SUMS`, its code hash the last row of `release/contracts/BUILD.md`. It is not rebuilt during these lines |
| Init argument | `bash scripts/deploy/render-init.sh mainnet` (template `scripts/deploy/init-mainnet.json` + frozen program URL/sha from `.env`) |
| Storage money | `bash scripts/deploy/storage-estimate.sh` → `deposit: <n> NEAR` (wasm bytes × 1e-5 + 0.5, rounded up; the old build was 3.4). Step 0 prints it and step 1 reads it from the script |
| Signing | `sign-with-keychain`: the macOS keychain may ask to allow access; allow it |

`new` refuses a config whose `secrets_ref.account_id` is not the contract itself (`E15 bad config:
secrets_ref`), so the mainnet init JSON can only initialise `arrow-market.near`. If the fallback
`arrow-market-v2.near` is ever used, render the init with
`jq -c '.cfg.secrets_ref.account_id = "arrow-market-v2.near"'` and use v2 in every line.

## Lines (run order)

All lines start in the main checkout. Copy one line, run it, compare with "Expected", then go on.

Numbering: the go-live runbook (kept outside the repo) numbers these lines 0, 2, 3, 4, 5, 6, 7, 8 (its step 1 is the relayer
top-up). Each heading below names both. The evidence ids `h12-deploy-storage`, `-init`, `-tank`, `-pubkey` are the same in
both files.

### 0. Preflight (read-only, signs nothing) · runbook step 0

    cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/deploy/mainnet-check.sh pre

Expected: every row `PASS`, including `contract_wasm_fresh`, `program_frozen`, `program_url_serves_sha`,
`nearai_key_mainnet`, `market_empty arrow-market.near`, `owner_balance arrowhq.near … >= deposit <n> + 1`,
`outlayer_logged_out on mainnet` (9 rows), and `deposit (runbook step 2): <n> NEAR`.

`program_url_serves_sha` is the only guard against a FastFS upload that reported "Upload complete!" while a chunk
transaction never landed, or that stays unindexed (404) for an hour. Upload the frozen program hours before the deploy and check
it, with every chunk tx the upload printed:

    npx tsx scripts/src/fastfs-check.ts --network mainnet --url "$PROGRAM_WASM_URL" --sha "$PROGRAM_WASM_SHA256" --tx <chunk tx>,<chunk tx> --wait 30

It exits 1 unless each tx is FINAL and successful and the URL serves the sha within 30 minutes. If it does not, upload the
file again; do not start step 1.

Twin (2026-11-10): all rows ran; `program_frozen` and `nearai_key_mainnet` FAIL as expected today (no freeze,
H-01b open); testnet `outlayer_logged_out` FAIL is the normal testnet login.

### 1. Storage money (arrowhq.near → arrow-market.near) · runbook step 2

The `guard storage` row refuses when the market already holds more than 1 NEAR or has code, so a second paste of this
line sends nothing (an extra 3.7 NEAR would become tank that nobody can withdraw after the lock).

    cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/deploy/mainnet-check.sh guard storage && DEP=$(bash scripts/deploy/storage-estimate.sh | awk '/^deposit:/{print $2}') && echo "sending $DEP NEAR" && near tokens arrowhq.near send-near arrow-market.near "$DEP NEAR" network-config mainnet sign-with-keychain send

Expected: `sending <n> NEAR` (the value step 0 printed), then `<arrowhq.near> has transferred <n> NEAR to <arrow-market.near> successfully.`

Twin: OK `EVTKMY4N2TmeZVPJx6LC7u9qfCdyGdW4vWF6hKP5aNQC` (arrowhq.testnet → mainnet-dryrun, 3.4 NEAR for the first build).

### 2. Deploy + init · runbook step 3

    cd ~/Desktop/hackathon/near-builds/arrow && shasum -a 256 release/contracts/arrow-mainnet.wasm && I=$(bash scripts/deploy/render-init.sh mainnet) && near contract deploy arrow-market.near use-file release/contracts/arrow-mainnet.wasm with-init-call new json-args "$I" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send

Expected: the sha line equals the one in `release/contracts/SHA256SUMS` (compare by eye; step 0 already checked it against
the tree), then `Contract code has been successfully deployed.` If `render-init.sh` prints an error, nothing is sent.

Twin: OK `29RhuCrmC2gLVoyxDLSHH9h1LpafLjNnjZkZ5d7ukLMG` (first build: code hash 3VQWQdgK…, storage 283 462 bytes). The first try
with the unmodified mainnet JSON, `FM8kHR3yAA5znDoHKGan5uNom7ZgSXXpZcwC9AxeC4ro`, failed with
`E15 bad config: secrets_ref` (the JSON names arrow-market.near, the twin is another account; the deploy action
was rolled back with the failed init). The twin then rendered `secrets_ref.account_id` as its own name; that is the
only difference from the mainnet line.

### 3. Gas tank (0.5 NEAR from arrowhq.near) · runbook step 4

    cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/deploy/mainnet-check.sh guard tank && near contract call-function as-transaction arrow-market.near fund_tank json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0.5 NEAR' sign-as arrowhq.near network-config mainnet sign-with-keychain send

Expected: log `arrow: tank funded 500000000000000000000000`.

Twin: OK `C5vnSJfFBaKm6Z8u7KXDrD82JosSuuCefWyyAdit23oj`, `tank_available` 1.15 NEAR afterwards.

### 4. OutLayer secret (login as arrow-market.near, set the secret for the frozen program) · runbook step 5

**Run `secrets set` once.** It generates a new `PROTECTED_MASTER`, so after step 6 a second run changes the program key and
every listing sealed to the old key stops working. To change only the NEAR AI key use `outlayer secrets update`, which
merges, keeps the access condition (checked on testnet 13 Nov) and, by its help text, keeps `PROTECTED_*`; then run step 6 again and check that
`program_pubkey` did not change.

The key goes from the keychain straight into `outlayer login`; it is never shown. The line stops before
logging in when `NEARAI_API_KEY_MAINNET` is empty.

    cd ~/Desktop/hackathon/near-builds/arrow && ( set -a && . ./.env && set +a && : "${NEARAI_API_KEY_MAINNET:?is empty in .env (H-01b)}" && printf '%s\n%s\n' arrow-market.near "$(near account export-account arrow-market.near using-private-key network-config mainnet 2>/dev/null | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]{80,}')" | outlayer login mainnet >/dev/null && OUTLAYER_NETWORK=mainnet outlayer secrets set "$(jq -cn --arg k "$NEARAI_API_KEY_MAINNET" '{NEARAI_API_KEY:$k}')" --profile arrow --wasm-hash "$PROGRAM_WASM_SHA256" --generate PROTECTED_MASTER:hex32 --access allow-all --via arrow-market.near --build "$PROGRAM_WASM_SHA256" 2>&1 | tail -4 )

Expected: `Logged in as arrow-market.near (mainnet)`, `Calls admitted only from: arrow-market.near`,
`Secrets stored (profile: arrow, keys: NEARAI_API_KEY; protected (TEE): PROTECTED_MASTER)`.

Check (read-only, on chain; `outlayer secrets list` can lag a few seconds):

    near contract call-function as-read-only outlayer.near list_user_secrets json-args '{"account_id":"arrow-market.near"}' network-config mainnet now

Expected: one row, profile `arrow`, accessor `WasmHash` = the frozen sha, access
`And[WasmHash <sha>, Predecessor Whitelist [arrow-market.near]]`.

Twin: OK. With `NEARAI_API_KEY_MAINNET` empty the line stopped at the guard
(`NEARAI_API_KEY_MAINNET: is empty in .env (H-01b)`, no login). Then the same line with the testnet key
(`NEARAI_API_KEY`), `testnet` and the twin name printed the three expected lines; the on-chain row was
`And[WasmHash 73415b8f…, Predecessor Whitelist [mainnet-dryrun.arrowhq.testnet]]`. The twin secret was
deleted afterwards. The same login + secrets form ran on mainnet in H-08d step 1 (arrow-spike, 22:10).

### 5. Log out of mainnet OutLayer, put the testnet login back · runbook step 6

    cd ~/Desktop/hackathon/near-builds/arrow && OUTLAYER_NETWORK=mainnet outlayer logout && printf '%s\n%s\n' arrow-v2.arrowhq.testnet "$(jq -r .private_key ~/.near-credentials/testnet/arrow-v2.arrowhq.testnet.json)" | outlayer login testnet >/dev/null && ls ~/.outlayer/mainnet && outlayer whoami

Expected: `Logged out from mainnet`, an empty `~/.outlayer/mainnet` listing, then
`Account: arrow-v2.arrowhq.testnet`, `Network: testnet` (the live /try market; `arrow.arrowhq.testnet` is locked since the
13 Nov rehearsal).

Twin: OK (`Logged out from testnet`, empty mainnet folder, `Account: arrow.arrowhq.testnet`). Same form as
H-08d step 5 on mainnet.

### 6. Program key (self-signed by arrow-market.near; 0.05 NEAR goes to OutLayer, the unused part comes back) · runbook step 7

    near contract call-function as-transaction arrow-market.near init_program_key json-args '{}' prepaid-gas '300.0 Tgas' attached-deposit '0.05 NEAR' sign-as arrow-market.near network-config mainnet sign-with-keychain send

Expected: the tx succeeds; the key arrives through OutLayer's yield/resume, usually within a minute
(log `arrow: program key set` on the callback receipt).

After any `set_program`, run this step again and wait for `program_pubkey` to be non-null before listing.
A derive that was still in flight when `set_program` ran is ignored (log
`arrow: program key derive failed: stale_program`), so its key never becomes the new program's key.

After any `set_program` also run the verify row for the program hash chain (contract == release == URL == attestation):

    cd ~/Desktop/hackathon/near-builds/arrow && npm run verify -- --network mainnet --pre-lock --only wasm

Expected: `R1 PROVEN`. Evals recorded under the old program keep a different attestation `wasm_hash`, so R1 stays
`NOT PROVEN` until the evidence carries the program of each run (audit STATE-2, group sdk) and one eval has run under
the new program. Do not read a red R1 right after `set_program` as a deploy fault before that fix is on main; the first
half of the row (`hash chain differs: contract … release … url …`) is the part that must be green.

Twin: OK `DD4Q6MX8REqG1BgfzjqDgghEek7b6x4ChKpLhM7zEXEm`: the self-signed call passed `E14`; its callback logged
`arrow: program key derive failed: null`, as expected, because the mainnet config points at `outlayer.near`,
which does not exist on testnet. The full derive path is proven on testnet by `arrow.arrowhq.testnet`
(`testnet.sh pubkey`, program_pubkey 04161f9c…).

### 7. Post-deploy check (read-only) · runbook step 8

    cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/deploy/mainnet-check.sh post

Expected: `PASS` for `config_matches_init (mainnet template, secrets_ref arrow-market.near)`,
`build mainnet, payment notify, result chain, not paused`, `code_hash = release/contracts/arrow-mainnet.wasm`,
`tank_available` ≥ 0.4 NEAR, `secret_row … AND Predecessor arrow-market.near`, `intents_keys_empty` (no key for the
market on intents.near), `market_usdc_idle` (no USDC parked on the market's Intents account), `program_pubkey_130hex 04…`
(waits up to 120 s for the key).

Twin: 5/6 PASS on mainnet-dryrun (pubkey FAIL as explained in step 6). The same script on
`arrow.arrowhq.testnet` (testnet build) passed config, tank, secret row and program_pubkey; build and code hash
FAIL there by design (testnet wasm).

### 8. Nothing on arrow-market-v2.near

No deploy, no secret (reserve only, DEC D-07).

## If a step fails

- Step 1 or 3 fails: nothing is deployed or lost; paste the error to the agent.
- Step 2 fails: the deploy and init are one receipt, so a failed init leaves no code (twin FM8kHR3y…). Paste
  the error. Do not run step 3 onwards.
- Step 4 fails after the login: run step 5 anyway (it logs out), then paste the error.
- Step 6 or 7 shows `program_pubkey` null: the agent reads `list_user_secrets` and the callback log of the
  step 6 tx. A wrong secret can be replaced before the lock (`outlayer secrets update`), never after it.
- The contract is not locked in H-12, so the agent can fix and redeploy the same wasm before the lock.

## After H-12 (agent)

Paste the step 1, 2, 3 and 6 tx hashes. The agent records them (archival RPC fills block and time). The first line sources
`.env`, because `$PROGRAM_WASM_SHA256` and `$PROGRAM_WASM_URL` are empty in a fresh shell and an empty `--set` leaves R1
NOT PROVEN:

    set -a && . ./.env && set +a && npx tsx scripts/src/evidence-add.ts --network mainnet --set contract=arrow-market.near --set "contract_wasm_sha256=$(awk '$2=="arrow-mainnet.wasm"{print $1}' release/contracts/SHA256SUMS)" --set "program_wasm_sha256=$PROGRAM_WASM_SHA256" --set "program_wasm_url=$PROGRAM_WASM_URL"
    npx tsx scripts/src/evidence-add.ts --network mainnet --sender arrowhq.near --run '{"id":"h12-deploy-storage","kind":"deploy","tx":"<step 1 tx>","chain":"near","expect":"<n> NEAR to arrow-market.near (the step 1 value)","observed":"…","script":"scripts/deploy/mainnet.md"}'

(one `--run` per tx: `h12-deploy-storage`, `h12-deploy-init` with sender arrow-market.near, `h12-deploy-tank`,
`h12-deploy-pubkey` with sender arrow-market.near).
