<p align="center"><img src="assets/banner.png" alt="Arrow: inspect before you pay, on NEAR mainnet" width="100%"></p>

<h2 align="center">See the verdict, not the rows.</h2>

<p align="center">Arrow is an <b>inspect-before-pay data market on NEAR</b>. A seller lists an encrypted file. Inside sealed hardware, an AI checks a 40-row sample against what the buyer needs, and the buyer gets a verdict, not the rows: BUY or PASS, with fit and novelty. Then they buy it, or walk away having paid only the inspection fee.</p>

<p align="center">
  <a href="https://github.com/yigitcangokmen/arrow/actions/workflows/ci.yml"><img src="https://github.com/yigitcangokmen/arrow/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://arrow-market.vercel.app"><img src="https://img.shields.io/badge/try%20the%20app-arrow--market.vercel.app-2f81f7" alt="try the app: arrow-market.vercel.app"></a>
  <a href="#status"><img src="https://img.shields.io/badge/NEAR-mainnet-00c08b" alt="NEAR: mainnet"></a>
  <a href="https://nearblocks.io/txns/EqBJFvgJrSipYN3yHaPEm68FvKVPEJLzRb64KtnXk75X"><img src="https://img.shields.io/badge/contract-locked%20(0%20keys)-00c08b" alt="contract: locked (0 keys)"></a>
  <a href="#trust-table"><img src="https://img.shields.io/badge/TEE-Intel%20TDX-6e40c9" alt="TEE: Intel TDX"></a>
  <img src="https://img.shields.io/badge/Rust-1.97.1-b7410e" alt="Rust 1.97.1">
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6" alt="TypeScript 5">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-97ca00" alt="License: MIT"></a>
</p>

<p align="center">🔒 <b>Live on NEAR mainnet · Locked:</b> 0 access keys, not even ours. <a href="https://nearblocks.io/txns/EqBJFvgJrSipYN3yHaPEm68FvKVPEJLzRb64KtnXk75X">Lock tx</a> · verify: 8/8 REQUIRED PROVEN (<code>npm run verify -- --network mainnet</code>)</p>

---

You cannot sell information: to judge its value the buyer must see it, and once they have seen it they have no reason to pay ([Kenneth Arrow, 1962](https://www.nber.org/books-and-chapters/rate-and-direction-inventive-activity-economic-and-social-factors/economic-welfare-and-allocation-resources-invention)). Arrow is a data market on NEAR, named after that paradox, where the buyer does not look: for a small fee, [a fixed model](docs/design.md#near-ai-call) in NEAR AI's TEE judges a sample of the seller's rows against the buyer's criteria, and the buyer gets BUY or PASS, plus fit and novelty from 1 to 5 if the seller allows them ([decision](docs/design.md#decision)), not the rows. On mainnet (live, and locked since 14 Nov: the contract has no access keys, so nobody, the team included, can change it), payment is USDC from Base through NEAR Intents, and when an inspection fails most of the fee comes back ([amounts](#6-who-got-paid)).

```mermaid
flowchart LR
  List["1. Seller lists<br/>an encrypted file"]
  Pay["2. Buyer pays<br/>an inspection fee"]
  Judge["3. An enclave opens it,<br/>a model in NEAR AI's<br/>TEE judges sampled rows"]
  Verdict["4. BUY or PASS (fit and<br/>novelty if the seller<br/>allows), no rows"]
  Buy["5. Buyer pays the<br/>price, gets the key"]
  Walk["or walks away,<br/>out only the fee"]
  Back["enclave fails:<br/>most of the fee back"]
  List --> Pay --> Judge --> Verdict
  Verdict --> Buy
  Verdict --> Walk
  Judge -.-> Back
```

**[The story](#how-it-works) · [Trust table](#trust-table) · [Try it](#try-it-do-x-see-y) · [Live app (mainnet)](https://arrow-market.vercel.app) · [Listings (mainnet)](https://arrow-market.vercel.app/listings) · [Evidence ledger](JUDGES.md) · [Mainnet ledger M1-M17](JUDGES.md#pending-ledger) · [Mainnet contract](https://nearblocks.io/address/arrow-market.near) · [Testnet contract](https://testnet.nearblocks.io/address/arrow-v2.arrowhq.testnet) · [Design notes](docs/design.md)**

## How it works

**Noor**, an on-chain analyst, sells a token unlock schedule and a file of labelled wallets, plus a third listing broken on purpose. **Kai**, research lead at a small fund, already tracks 412 token contracts and 1,000 wallets and will not pay for a file he cannot see. The two names are illustrative, and both accounts are the team's. What each part is trusted with: [Trust table](#trust-table), right after the story; state of the build: [Status](#status).

**The run.** Everything below is one recorded run on NEAR mainnet, 14 Nov 2026 11:25-11:36Z, on `arrow-market.near` with the frozen program `6ad7fed4…`, before the contract was [locked](#status) at 16:16Z. Synthetic data ([fixtures/demo](fixtures/demo/README.md)), driven by `scripts/src/e2e-mainnet.ts` through the CLI's own commands; each transaction is in `evidence/mainnet.json`, and `npm run verify -- --network mainnet` re-reads the evals, the purchase and the refund from the chain. Noor and Kai are NEAR Intents accounts named by their EVM addresses, `0xa54bc401…` and `0xb5ef360e…`. Kai's money came from Base: 5.00 USDC through 1Click ([Base tx](https://basescan.org/tx/0x60ff039b3d3ca5f0759f5981433b45050c5de91a805f2b4406084a4cbf04f419), 31 s), of which 0.50 was moved to Noor inside Intents to pay her listing fees ([tx](https://nearblocks.io/txns/EBC3wjYAPFCXDuEqC5KVaS8tKNcnZ1Me2PtqvxhrUUF)). Every amount below is USDC.

### 1. Noor makes three listings (two files, one broken on purpose)

She encrypts each file on her machine with its own data key, uploads only the ciphertext to a host nobody has to trust, and seals the data key to the Arrow program. She pays a listing fee for each ([Money](#6-who-got-paid)) and asks 2.00 for the file and 0.25 for an inspection. Listing 1 is the 412-row unlock schedule, listing 2 the 1,000 wallet labels, and listing 3 the same labels at a host URL that does not exist, on purpose. Transactions: [1](https://nearblocks.io/txns/AiAWHcvYz4uwKRcAWhUuGwx42tWMRfzbhgLK32fS36EV), [2](https://nearblocks.io/txns/8p7vdybX6v1gY9jZvfL3A4pUNCY4jJGtYtAjZ7nDi6RZ), [3](https://nearblocks.io/txns/DzWVRdfKuryPjQyqbnqUqv2wWodVoRdKHYLbW6ZxBSFx).

```mermaid
sequenceDiagram
  autonumber
  participant Noor as Noor (seller)
  participant Market as Arrow contract
  participant Host as Blob host
  Noor->>Market: read program_pubkey
  Note over Noor: encrypts each file with its<br/>own data key, seals the key<br/>to the program, bound to the<br/>file hash and her account
  Noor->>Host: upload the ciphertext<br/>(not for listing 3)
  Noor->>Market: list: listing fee, price 2.00,<br/>inspection 0.25, URL, sha256,<br/>sealed key, columns, rows
  Market-->>Noor: listings 1, 2 and 3
```

### 2. Kai inspects listing 1: PASS

His criteria (`fixtures/criteria/demo.json`) ask for a "Q1 2027 token unlock schedule with exact dates, amounts and % of supply; I also want audit flags for the vesting contracts", with fit at least 4 and novelty at least 3. They carry a MinHash sketch of the contracts he already tracks, and they are sealed to the program. He pays 0.25. The answer is sealed to his key, and his CLI opens it ([tx](https://nearblocks.io/txns/9VzDbtdtvNX5XSYfGikAzxkiRF4cFNsJaTqWYpsntFcP)):

```text
PASS · fit 2/5 · novelty 1/5
```

He saw no row, and Noor never saw his criteria text.

```mermaid
sequenceDiagram
  autonumber
  participant Kai as Kai (buyer)
  participant Market as Arrow contract
  participant Program as Arrow program
  participant Host as Blob host
  participant Model as NEAR AI model
  Kai->>Market: inspect listing 1, 0.25,<br/>criteria sealed to the program
  Note over Market: leak counter of<br/>listing 1 plus 1
  Market->>Program: request_execution (yield)
  Note over Program: opens the data key and<br/>the criteria with the<br/>program key
  Program->>Host: fetch the ciphertext
  Note over Program: checks sha256, decrypts,<br/>whole-file stats, novelty,<br/>injection scan
  Program->>Model: row sample, aggregates,<br/>criteria text (TLS)
  Model-->>Program: vote, fit_llm, two flags
  Program-->>Market: one fixed-schema<br/>result (resume)
  Kai->>Market: get_eval 1 (view)
  Market-->>Kai: the sealed result. Opened<br/>by his CLI: PASS, fit 2, novelty 1
```

### 3. Kai inspects listing 2: BUY

His criteria (`fixtures/criteria/demo-buy.json`) ask for labelled NEAR DeFi wallets with confidence scores, active August to October 2026, at least 800 rows and at most 1% empty cells. He pays 0.25 again and gets ([tx](https://nearblocks.io/txns/DuoZg5F6RUSrNMbRSZjS3Q7ABMwda2ZbWZkHrfcwhAfD)):

```text
BUY · fit 5/5 · novelty 4/5
```

Why the two answers differ ([decision](docs/design.md#decision)):

```mermaid
flowchart TD
  Flag(["injection or<br/>exfiltration flag from<br/>a scanner or the model?"])
  Guard["PASS, fit 1, novelty 1"]
  Vote(["model voted BUY?"])
  Rule(["fit_rule is 5?<br/>columns, rows, date<br/>window, empty cells"])
  Fit(["fit at least min_fit?<br/>fit = min(fit_llm, fit_rule)"])
  Nov(["novelty at least<br/>min_novelty? Overlap of<br/>Kai's MinHash sketch<br/>with the key column"])
  Buy["BUY"]
  Pass["PASS"]
  Flag -->|"yes"| Guard
  Flag -->|"no"| Vote
  Vote -->|"yes"| Rule
  Rule -->|"yes"| Fit
  Fit -->|"yes"| Nov
  Nov -->|"yes"| Buy
  Vote -->|"no"| Pass
  Rule -->|"no"| Pass
  Fit -->|"no"| Pass
  Nov -->|"no"| Pass
```

- Listing 1: the file has no `vesting_contract_audit` column, so `fit_rule` is 4. 371 of Kai's 412 contracts are already in it, and a MinHash estimate of that overlap puts novelty at 1, below his 3. That is PASS whatever the model voted. The model scored fit 2.
- Listing 2: every structural gate holds (`fit_rule` 5). Only 300 of Kai's 1,000 wallets are in it, and the estimate puts novelty at 4. The model voted BUY with fit 5.

Rerun the rule half on your machine: [Try it](#try-it-do-x-see-y) step 2.

### 4. Kai buys listing 2

Before paying, his CLI downloads the ciphertext and checks its sha256. He pays 2.00 and sends his public viewing key (purchase 1, [tx](https://nearblocks.io/txns/Eaj1mPrtdNBWX6p49aDy9M797dsLZ4hyyi51xaKvyAR6)). The enclave fetches the ciphertext again, checks that its sha256 is the listed one and that the data key opens it, and seals the key to Kai's key. Kai decrypts on his machine. Four hashes are equal: the listed hash, the hash the enclave inspected, the hash it released, and the hash of Kai's download (`npm run verify -- --network mainnet` row R3 checks all four: `9ab5…44`). From here the file is his (trust row After purchase).

```mermaid
sequenceDiagram
  autonumber
  participant Kai as Kai (buyer)
  participant Market as Arrow contract
  participant Program as Arrow program
  participant Host as Blob host
  participant Noor as Noor (seller)
  Kai->>Host: download the ciphertext,<br/>check its sha256
  Kai->>Market: buy listing 2: 2.00 and<br/>his public viewing key
  Market->>Program: request_execution<br/>(release)
  Program->>Host: fetch the ciphertext again
  Note over Program: sha256 is the listed hash,<br/>the data key opens the file
  Program-->>Market: data key sealed to Kai,<br/>and the hash (resume)
  Note over Market: the hash equals<br/>the listing's hash
  Market->>Noor: 1.96 (the treasury<br/>keeps 0.04)
  Kai->>Market: get_purchase 1 (view)
  Market-->>Kai: the sealed data key
  Note over Kai: decrypts on his machine,<br/>all four hashes are equal
```

### 5. Listing 3 fails

Kai pays 0.25 to inspect listing 3. The enclave cannot fetch the file, because its host is missing on purpose, and writes its one fixed error output. The contract settles the inspection as `not_ok`: 0.225 goes back to Kai's NEAR Intents balance and the treasury keeps 0.025 ([tx](https://nearblocks.io/txns/7Gnw32jEcgUwmhdH2T4YtcJoUPS6hdetpTmWpoFqRcos); verify row R5 reads the 225,000 base units off the chain). The failed inspection still counts on listing 3's leak counter (`evals 1/50`). Other failures: [If something fails](#if-something-fails).

```mermaid
sequenceDiagram
  autonumber
  participant Kai as Kai (buyer)
  participant Market as Arrow contract
  participant Program as Arrow program
  participant Host as Blob host
  Kai->>Market: inspect listing 3, 0.25
  Note over Market: leak counter of listing 3<br/>plus 1, never lowered
  Market->>Program: request_execution (yield)
  Program->>Host: fetch the ciphertext
  Host-->>Program: fetch fails (no file)
  Program-->>Market: the one fixed<br/>error output (resume)
  Market-->>Kai: 0.225 back, reason not_ok<br/>(intents.near returns it)
  Note over Market: the treasury<br/>keeps 0.025
```

### 6. Who got paid

- **Money.** The seller sets the price (at least 0.10 USDC) and the inspection fee (at least 0.05 USDC, at most the price; `scripts/deploy/init-mainnet.json`). The treasury keeps 10% of each inspection fee and 2% of each sale. A failed purchase is refunded in full, a failed inspection less the treasury's share. Each listing costs a 0.10 USDC fee to the treasury (`listing_bond`), which is not refunded.

```mermaid
flowchart LR
  Kai["Kai paid 2.75"]
  Noor["Noor<br/>2.41 in, 2.11 net"]
  Treasury["Treasury<br/>0.415"]
  Back["Back in Kai's<br/>NEAR Intents balance"]
  Kai -->|"2.41 = 0.45 + 1.96<br/>inspections 1 and 2,<br/>the sale less 2%"| Noor
  Kai -->|"0.115 = 0.075 + 0.04<br/>10% of three fees,<br/>2% of the sale"| Treasury
  Kai -->|"0.225<br/>inspection 3 failed"| Back
  Noor -->|"0.30<br/>three listing fees"| Treasury
```

Kai's net spend is 2.525: one file he wanted, and an answer that kept 2.00 in his pocket. The run recorded Kai's payments and the listing 3 split; the other splits apply the live fee settings (`get_config`) to the run. Noor then moved 1.00 of her balance to Solana through 1Click ([Solana tx](https://solscan.io/tx/2hkMCjWQWGEGTzVJDUEwANVzRRL5yWpfapAucembXWHovYRWfrCddX2n8dVivtEPa5kk72885tynk8vYQYV7UyHr)): in from Base, out to Solana, with NEAR in the middle.

The same loop also ran from a browser with MetaMask: listing #4 at 1.00, eval #5 BUY, purchase #2 ([tx](https://nearblocks.io/txns/CrAvqbqVgjgPa66nxTVaAid78NU2ojWNz9ZzejLm4fz2)); see [/listings](https://arrow-market.vercel.app/listings).

Check it yourself: each NEAR transaction above opens on nearblocks.io; `npm run arrow -- status --network mainnet` lists the four listings and their leak counters; the `get_eval` command is in J#51 (its testnet form; on mainnet use `arrow-market.near` and `network-config mainnet`).

### The parts

```mermaid
flowchart TB
  Buyer["Buyer<br/>0x… account,<br/>USDC from Base"]
  Seller["Seller<br/>0x… account"]
  Intents["NEAR Intents<br/>intents.near"]
  Host[("Blob host<br/>untrusted")]
  Market["Arrow contract"]
  subgraph TDX["Intel TDX (OutLayer)"]
    Program["Arrow program"]
  end
  subgraph AI["TEE (NEAR AI Cloud)"]
    Model["reader model"]
  end
  Buyer -->|"inspect or buy"| Intents
  Seller -->|"listing, sealed key"| Intents
  Seller -->|"ciphertext"| Host
  Intents -->|"mt_on_transfer"| Market
  Market -->|"request_execution"| Program
  Host -->|"ciphertext"| Program
  Program -->|"sample and criteria,<br/>over TLS"| Model
  Program -.->|"fixed-schema result"| Market
  Market -.->|"payouts, refunds"| Intents
```

*The mainnet design; deployment state: [Status](#status).*

- **TEE:** a trusted execution environment, a processor-isolated machine built so that its host cannot read its memory, and able to prove which code it runs. Arrow uses two: OutLayer's Intel TDX for the Arrow program, and NEAR AI Cloud's for the reader model.
- **OutLayer** holds the program key and returns the program's result to the contract through `request_execution` yield and resume.
- **NEAR Intents:** `intents.near` calls the contract with `mt_on_transfer`, and refunds go back through its `mt_resolve_transfer` ([If something fails](#if-something-fails)). Buyer and seller need no NEAR account; they sign from EVM wallets (trust row Buyer viewing key; [standards](docs/design.md#standards)).

## Trust table

**PROVEN**: a command or transaction shows it today; the parenthesis says where. **RISKY**: true, and a weakness. **NOT PROVEN**: we do not claim it. **TODO**: waits for a [Pending ledger](JUDGES.md#pending-ledger) step. `J#n` is row n of [JUDGES.md](JUDGES.md). Each row counted under its weakest label: 7 PROVEN, 14 RISKY, 4 NOT PROVEN, 0 TODO.

| Part | Who you trust | Can see | Cannot | How to check | Label |
|---|---|---|---|---|---|
| Seller data at rest | Nobody (ciphertext; the blob host is untrusted) | The blob host: the ciphertext and each downloader's IP and user agent. Anyone: the exact plaintext size, column names, row count and the seller's `0x…` account | Decrypt | [Hash binding](docs/design.md#hash-binding); J#14, J#55; mainnet: [M7a-c](JUDGES.md#pending-ledger) listings #1-#3, and purchase #1 where the listed, purchased, downloaded and evaluated hashes match (M10). The hosted site keeps web sellers' ciphertext in a Vercel Blob store only while the hosted demo runs (at least until 2026-11-18, planned until 2026-11-25); a daily job deletes a stored ciphertext that no Arrow listing points to, 24 hours after upload | PROVEN (mainnet) |
| Program key / `PROTECTED_MASTER` | OutLayer keystore (TDX) and the shared OutLayer master | Inside the TEE | Release to a non-Arrow caller, or to an unpinned wasm: on mainnet the secret row's access rule is `WasmHash` `6ad7fed4…` AND caller `arrow-market.near`, never changed since it was made | `WasmHash` + `Predecessor` access condition, read from chain by `npm run verify -- --network mainnet` row I5 (PROVEN on 14 Nov); negative tests: J#11, J#45. The row's owner is `arrow-market.near`, which has no keys since the [lock](https://nearblocks.io/txns/EqBJFvgJrSipYN3yHaPEm68FvKVPEJLzRb64KtnXk75X) (verify row R6), so it can no longer move the rule that ties the key to the wasm hash; I5 shows it never moved (`created_at == updated_at`) | PROVEN (`Predecessor`: testnet echo program, mainnet spike program), NOT PROVEN (`WasmHash`: verify I5 reads the rule from chain, but no call has shown a different wasm refused) |
| OutLayer keystore DAO | Can export keys on "cessation" | Potentially everything, including the buyer's sealed criteria, whose MinHash sketch is unkeyed: up to 128 members of the buyer's list can be recovered | n/a | J#40, J#50 | RISKY |
| Evaluation | Intel TDX (OutLayer worker) | Plaintext inside the TEE | Emit anything outside the schema | J#1-3. Attestation binding: [S1-b](JUDGES.md#gates-already-run) (echo program); J#13, J#48 (Arrow program). The TDX quote is not verified on chain (J#38) | PROVEN (schema: native test) |
| LLM | NEAR AI gateway (TDX) and model TEE (TDX + NVIDIA CC) | Each eval's prompt: the sample, whole-file aggregates and the criteria ([NEAR AI call](docs/design.md#near-ai-call)) | Retain data (NEAR AI's zero-data-retention claim is a trust assumption) | J#37, J#49 | NOT PROVEN |
| Wasm to NEAR AI | TLS (not E2EE) | n/a | n/a | [NEAR AI call](docs/design.md#near-ai-call) | RISKY |
| Time guard | The TDX clock, which the host provides | n/a | n/a | [Limits](docs/design.md#timeouts); J#19. A release refused as late still leaves its `k`, sealed to the buyer, public while the buyer keeps the refund | RISKY |
| OutLayer coordinator (closed source) | Liveness | Encrypted input | Read secrets (OutLayer's design, a trust assumption) | J#16 | PROVEN (refund on `null`: sandbox) |
| `outlayer.near`, `intents.near` contracts | Their owners (both are upgradable); Arrow depends on them | n/a | n/a | Code-hash history: J#39 | RISKY |
| Program bytes | The Arrow site, which serves the wasm URL | The wasm | Change it unnoticed (hash-pinned) | Served from the Arrow site, the same bytes as `release/arrow-tee.wasm`: `curl -s https://arrow-market.vercel.app/program/6ad7fed42691279cbcb43c3e8599fa0ef70ed7c54669e954b5acb31c03e1abc1.wasm \| shasum -a 256` prints `6ad7fed4…`. Set before the lock by set_program tx [`DkHQdN6r…`](https://nearblocks.io/txns/DkHQdN6rXPcem3B5QWwibgGUU6kAXMPHDVtbJMGC3xvP), which moved it there from testnet FastFS; the lock freezes the URL. Availability depends on the site staying up | RISKY |
| Output channel | Schema and rule composition | At most 5.68 bits per eval (scored), 1.59 (verdict-only), on this channel only ([derivation](docs/design.md#leak-bound)) | Free text | J#1-3 | PROVEN |
| Error channel | The enclave: one fixed error output, nothing on stderr | The failure states on chain ([leak bound](docs/design.md#leak-bound)) | Carry data | J#4, J#43 | RISKY (stderr and the fixed output: PROVEN, native harness) |
| Side channels | Not closed | `time_ms` and `instructions` on chain, counted in neither the bound nor the budget. `instructions` follows the work: the dataset size, the content of the sampled rows ([seed](docs/design.md#near-ai-call)), the criteria text, the buyer's `key_column` and `date_column` (so it can reveal a chosen column's non-empty and distinct counts) and, on a failed run, the step where it stopped | n/a | J#35; [measured values](docs/perf.md) | RISKY |
| Leak budget | The contract counter | n/a | n/a | [Rules](docs/design.md#leak-budget); J#15, J#41 | RISKY |
| Decision correctness | Structural gates and the LLM | n/a | Override a failed structural gate | J#5 (gates); J#9, J#53 (semantics) | PROVEN (gates), RISKY (semantics) |
| 1Click and the PoA bridge (Intents Technology) | Short custody during swaps | Swap transactions | n/a | Base USDC (other 1Click origins are untested) arrives as a bridged token (`omft.near`) that 1Click swaps into native NEAR USDC, the only token the market accepts. On mainnet 5.00 USDC came in from Base (4.999784 arrived on Intents, [Base tx](https://basescan.org/tx/0x60ff039b3d3ca5f0759f5981433b45050c5de91a805f2b4406084a4cbf04f419)) and the seller withdrew 1.00 USDC to Solana ([Solana tx](https://solscan.io/tx/2hkMCjWQWGEGTzVJDUEwANVzRRL5yWpfapAucembXWHovYRWfrCddX2n8dVivtEPa5kk72885tynk8vYQYV7UyHr)) ([M5, M13](JUDGES.md#pending-ledger)); `npm run verify -- --network mainnet` row R4 reads both as SUCCESS from 1Click; J#24, J#25 | NOT PROVEN (custody), PROVEN (mainnet: inbound from Base, outbound to Solana) |
| Refund destination | `intents.near` | n/a | n/a | Arrow contract on mainnet: e2e step 8 refunded a failed eval (`arrow_refund` `not_ok`), tx `7Gnw32jEcgUwmhdH2T4YtcJoUPS6hdetpTmWpoFqRcos` ([M12](JUDGES.md#pending-ledger)); spike contract: J#17. Moving a refund back to Base is a separate 1Click withdrawal | PROVEN (mainnet: Arrow contract, spike contract) |
| NEAR AI API key (inside the OutLayer secret) | Billing | Usage volume | See content | If it runs out, evals fail; J#44 | RISKY |
| Gas tank | The operator (tops it up) and OutLayer's NEAR charge | n/a | n/a | `fund_tank` refills it; J#46; [cost, runway and E10](docs/perf.md#gas-tank) | RISKY |
| Relayer account | Whoever holds the keys of `arrow-relayer.arrowhq.near` (the team) | The intents it relays: signer, `msg`, IP | Spend or move user funds: the relayer holds none | The relay server signs only with a function-call key limited to `execute_intents` on `intents.near`. The account's FullAccess key stays with the team (in a laptop's macOS keychain, never on the server), to revoke a leaked server key; whoever holds it can drain the relayer's gas or stop `/api/relay`; J#47. The relay's rate limits are per server instance and protect only the relayer's gas: across instances the worst case is about 0.34 NEAR of gas (its balance down to the 0.65 NEAR floor, then the hosted relay pauses) and no user funds; a signed payment still runs once (J#56) | RISKY |
| Arrow operator | Relayer liveness, gas tank | The ciphertext blobs it hosts; the IP, `0x…` address and listing of every payment relayed through `/api/relay`; relay idempotency entries and rate counters | Decrypt the blobs it hosts (the site it serves can: Arrow web app row); take funds or change the contract or wasm hash after the lock | Locked on 14 Nov, tx [`EqBJFvgJ…`](https://nearblocks.io/txns/EqBJFvgJrSipYN3yHaPEm68FvKVPEJLzRb64KtnXk75X): `npm run verify -- --network mainnet` row R6 PROVEN (0 access keys, 0 `intents.near` keys, 1 DeleteKey signed by `arrow-market.near`); J#21, J#22, J#56. After the lock the team cannot pause the market; a failing market still keeps 10% of each eval fee | PROVEN (mainnet: R6) |
| Arrow web app (served JavaScript) | Whoever deploys the site (a modified deploy is not detectable from the page) | Everything the page handles: the file and its key, the criteria and the viewing-key signature, which derives every verdict key of that wallet | n/a | The CSP runs only scripts that carry the page's per-request nonce (`'strict-dynamic'`, no `'unsafe-inline'` or `'unsafe-eval'`; `curl -sI https://arrow-market.vercel.app/`): that stops an injected script, not a modified deploy. For sensitive data use the CLI; J#52, J#54 | RISKY |
| Buyer viewing key | The buyer's EOA signature ([derivation](docs/design.md#keys)) | Anyone: buyer and seller `0x…` accounts are their EVM (Base) addresses, and `get_eval` shows which account inspected which listing, when, and what it paid | n/a | Any site that obtains the same signature can derive the key; J#51 | RISKY |
| HTTP 402 wrapper | Nothing | n/a | Move funds | [For agents](#for-agents-cli-mcp-http-402); J#27 | PROVEN (`curl -i https://arrow-market.vercel.app/api/x402/1` against the hosted mainnet site) |
| After purchase | The buyer | All data | n/a | J#42 | NOT PROVEN |

**Tracks.** Privacy: the buyer gets the verdict, not the rows (trust rows Output channel, LLM, Buyer viewing key). Agents: MCP tools with spend caps that only the operator sets ([For agents](#for-agents-cli-mcp-http-402)). Also: the LLM cannot produce BUY unless the structural gates pass (trust row Decision correctness; the injection room is [Try it](#try-it-do-x-see-y) step 3).

## Status

As of 2026-11-14, after the mainnet deploy and the lock.

- Mainnet: the Arrow contract `arrow-market.near` is live on mainnet and locked since 14 Nov 16:16Z: lock tx [`EqBJFvgJrSipYN3yHaPEm68FvKVPEJLzRb64KtnXk75X`](https://nearblocks.io/txns/EqBJFvgJrSipYN3yHaPEm68FvKVPEJLzRb64KtnXk75X) deleted its only access key, so it has 0 access keys and 0 `intents.near` keys and nobody, the team included, can change it ([Pending ledger](JUDGES.md#pending-ledger) M15a). Deploy and init: tx `XcbokaMkd1t2pdkxxgwPKsQGV2tQXEM7BK1fPjTfxmW`. The frozen program `6ad7fed4…` ran there: eval tx `9VzDbtdtvNX5XSYfGikAzxkiRF4cFNsJaTqWYpsntFcP`, buy tx `Eaj1mPrtdNBWX6p49aDy9M797dsLZ4hyyi51xaKvyAR6`, refund tx `7Gnw32jEcgUwmhdH2T4YtcJoUPS6hdetpTmWpoFqRcos` ([Pending ledger](JUDGES.md#pending-ledger) M1-M14); `npm run verify -- --network mainnet` reads them and prints `verify: 8/8 REQUIRED PROVEN · exit 0`. Earlier spike runs: [gates](JUDGES.md#gates-already-run).
- Testnet: contract `arrow-v2.arrowhq.testnet` runs the same frozen program `6ad7fed4…`; recorded run [K2](JUDGES.md#gates-already-run); not locked. Pre-freeze listings: [J#57](JUDGES.md#claims).
- Hosted site: [arrow-market.vercel.app](https://arrow-market.vercel.app), on mainnet against `arrow-market.near` (live and locked), with the frozen program's sha embedded; its `/verify?network=mainnet` shows the same rows as `npm run verify -- --network mainnet`. Its `/listings` shows every listing on mainnet, newest first, and the main buttons in the nav and on the home page lead there. `/try` and `?network=testnet` still reach the free testnet demo on `arrow-v2.arrowhq.testnet`; `/try` waits on OutLayer's shared testnet queue before each payment, so a run can take minutes.
- Not yet: the demo video (not recorded) and outside demand (no seller invitation sent; drafts in `docs/outreach/`).
- Repository and CI: private until a human makes it public, so repository links (including the contract's NEP-330 source link) do not resolve yet. All five CI jobs are green; `tee` rebuilds the program natively on x86_64 Linux and in the pinned image and compares both with `release/sha256.txt` ([Build from source](#build-from-source)).

## Try it (do X, see Y)

Node 22.22.2 or later (tested on 24.15.0) and Rust 1.97.1, which `rust-toolchain.toml` pins and rustup installs on the first `cargo` call. No keys, funds or wallet; only step 10 uses a browser. "(network)" marks a step that needs internet; step 2, the first `cargo` call, also needs it once (rustup and crates.io).

Short on time: after step 1, steps 6-8 need no build and finish in under a minute.

1. `git clone https://github.com/yigitcangokmen/arrow && cd arrow && npm ci` (network).
   - See: `added 832 packages` (on macOS arm64; platform-specific packages vary).
   - `npm ci` runs the install scripts of the locked packages; no audit gate stops it.
2. `cargo test -p arrow-core --test demo_bands` (the first build takes minutes).
   - See: `test result: ok. 4 passed`. It reruns the rule half of [story step 3](#3-kai-inspects-listing-2-buy) (`fit_rule` and novelty) on the demo files.
3. `npm run bench:offline`.
   - See: `| Room: stopped by the deterministic layer alone (room has 24 attacks) | 20/24 (83.3%) |`; every live line reads `not run`.
   - All bench data is synthetic and labelled so; the bench criteria have not been reviewed by a person yet (`bench/REVIEW.md`). The team-made dataset is NEAR public-RPC chain statistics (`fixtures/team-made/SOURCE.md`).
4. `cargo test -p arrow-core`.
   - See: `test result: ok.` for the unit tests and each of the four integration test files.
5. `cargo run -p s4-interop --release`. See: `S4-b ecies ts->rs: 8/8 PASS`, `S4-b xchacha ts->rs: 4/4 PASS`, `S4-b minhash ts->rs: 10/10 PASS`, and a last line that starts `S4-b RESULT: PASS`.
   - Other direction and known gaps: J#32.
6. `npm run arrow -- --help`.
   - See: the commands `list`, `eval`, `result`, `buy`, `rehost`, `status`, `decrypt`, `transfer` and the line `exit codes: 0 ok · 1 error · 2 usage · 3 still pending (use status) · 4 refunded · 5 needs a terminal or --yes · 6 leak budget exhausted`.
7. `bash scripts/check-claims.sh && npm run check:judges -- --readme`.
   - See: nothing from the first command, which scans the judge-facing text for the claims we promise not to make (below), then `JUDGES.md: 57 rows, 0 missing` (every path and test name in the ledger exists).
8. `npx tsx spikes/s3/s3a-simulate.ts` (network: a free mainnet `simulate_intents` view, signed with a throwaway key; nothing is sent).
   - See: `class: SIGNATURE_OK_BALANCE_ERROR` (J#26).

9. `npm run verify -- --network mainnet` (network, about 10 s; read-only: the contract's views, the archival RPC, OutLayer's attestation API and 1Click's status, with no keys or funds).
   - See: `[PROVEN]` on R1-R8, I1, I2, I3 and I5, with R6 (the lock) reading `0 access keys · 0 intents.near keys`, and the last line `verify: 8/8 REQUIRED PROVEN · exit 0`. I4, N1 and N2 print `[NOT PROVEN]` and K1-K8 `[RISKY]`; none of them is a REQUIRED row. `--required` prints only R1-R8 and the same last line.
10. Open https://arrow-market.vercel.app/listings in a browser (network).
    - See: "Listings on mainnet." and the cards #4 to #1, the four listings made before the lock (verify row R7), newest first, each labelled SYNTHETIC with "Seller the Arrow team".
    - Click a card title. See: its listing page `/buy/<id>`; for #4, "NEAR DeFi wallet labels (1,000 rows)" with Inspect $0.25, Buy $1 and the steps Wallet, Balance, Criteria, Inspect, Verdict, Buy, Decrypt. Inspecting there pays real USDC from a wallet.
11. `npm run verify -- --network testnet` (network, about a minute).
    - See: `[PROVEN]` on R1, R2, R3, R5, R8 and I1-I5, and the last line `verify: 5/5 REQUIRED PROVEN · exit 0`. Every proof is a run on `arrow-v2.arrowhq.testnet` with the frozen program: Gate K2 and the J#30 run. Verify reads a list, eval, buy or refund run only when the run names this contract. The 2026-11-10 runs predate that field, and some used the first testnet contract `arrow.arrowhq.testnet`, whose ids `arrow-v2` reuses, so verify skips them (J#12-16, J#48).
12. `npm run try:testnet` (network).
    - See (about 2 minutes): `account arrow-judge-<id>.testnet faucet` (or `sponsor`; `reused` on a later run), the PASS scene `PASS · fit 2/5 · novelty 1/5 · out 5.67 bits`, the BUY scene `BUY · fit 5/5 · novelty 4/5 · out 5.67 bits`, `bought listing #14`, `sha256 match ✔ (3 checks)`, and `spent about 2.5 aUSD of test money; nothing real moved` (J#30).

## If something fails

```mermaid
stateDiagram-v2
  state "Returned in full" as Returned
  [*] --> Returned: refused at payment, any Arrow error code
  [*] --> Running: accepted, an eval adds 1 to the leak counter
  Running --> Settled: ok, and the file hash matches the listing
  Running --> Refunded: not_ok, null, bad_output or hash_mismatch
  Returned --> [*]
  Settled --> [*]
  Refunded --> [*]
```

- **Returned:** the contract refuses inside the transfer call, so the token contract gives back the whole amount.
- **Settled:** the verdict or the data key, sealed to the buyer.
- **Refunded:** with the amounts of [Money](#6-who-got-paid).

| What you see | What happened | Where your money is (mainnet: your NEAR Intents balance; testnet: `arrow-usd` in your NEAR account) | Read more |
|---|---|---|---|
| `Node 22.22.2 or newer is needed (found 18.20.8). Run: nvm use` | Node is too old (`try:testnet` and `scripts/check-all.sh` check it) | Nothing was spent | Try it preface |
| Step 8, 9, 11 or 12 ends with a network error | RPC or registry unreachable | Nothing was spent | Try it preface |
| CLI exit 4, `arrow_refund{reason:"not_ok"}` or a `null` result | The enclave failed or timed out | Your NEAR Intents balance, with the amounts of [Money](#6-who-got-paid) | Trust row Refund destination; J#16, J#18; [story step 5](#5-listing-3-fails) |
| `arrow_refund{reason:"hash_mismatch"}` on buy | [Hash binding](docs/design.md#hash-binding) | Your NEAR Intents balance, in full | J#14; [flow 1](docs/flows.md#1-the-file-is-swapped-before-a-purchase-settles) |
| CLI exit 6 | The listing's leak budget is used up; the CLI stops before paying | Nothing was spent | Trust row Leak budget; J#15; [flow 3](docs/flows.md#3-the-leak-budget-is-spent-sales-stay-open) |
| `E10` or `E21` | The gas tank is low (E10), or the listing has too many evals in flight (E21, J#46); the contract refuses the payment | Back in your NEAR Intents balance | Trust row Gas tank |
| `E13` after paying on the CLI or MCP | The listing was sealed to an older program (J#57) | Back in your NEAR Intents balance | [Keys](docs/design.md#keys); [flow 2](docs/flows.md#2-a-listing-sealed-to-an-older-program) |
| CLI exit 3 | The eval or purchase is still running | In flight in the contract | `npm run arrow -- result <id>` or `status` |

## For agents: CLI, MCP, HTTP 402

- **CLI:** `npm run arrow -- <command>`, always through `npm run` (the bare npx package name belongs to an unrelated project). Commands and exit codes: Try it step 6.
- **MCP:** server `arrow` with seven tools: `inspect_before_buy`, `buy`, `get_listing`, `list_listings`, and the free recovery tools `get_eval_result`, `get_purchase`, `decrypt_purchase` (J#28). Client config: [agent/README.md](agent/README.md); it runs the lockfile's tsx. Purchases are written at mode 0600 under `ARROW_MCP_OUT_DIR` (default `~/.config/arrow/purchases`). What an agent cannot do without its operator is in the diagram below.
- **HTTP 402:** `/api/x402/<id>` (a listing id) answers 402 with `accepts` empty on purpose; paying goes through NEAR Intents (`mt_on_transfer`), with no facilitator (J#27).

```mermaid
flowchart TD
  Call["agent calls<br/>inspect_before_buy, buy,<br/>get_eval_result or<br/>decrypt_purchase"]
  Net(["mainnet?"])
  Buy(["buy or decrypt_purchase?"])
  Cap(["pays more than a cap?"])
  Stop["refused"]
  Run["tool runs"]
  Call --> Net
  Net -->|"yes, ALLOW_MAINNET off"| Stop
  Net -->|"no, or allowed"| Buy
  Buy -->|"yes, ALLOW_BUY off"| Stop
  Buy -->|"no, or allowed"| Cap
  Cap -->|"yes"| Stop
  Cap -->|"no, or it does not pay"| Run
```

The variables, all prefixed `ARROW_MCP_`: `ALLOW_MAINNET` and `ALLOW_BUY` are off unless set to 1; `MAX_USDC` caps each payment (default 1.00) and `MAX_USDC_TOTAL` the session (default 5.00). Only the operator sets these variables; a tool argument is not consent. With the defaults, Kai's agent could inspect listing 2 (0.25) but not buy it (2.00) until his operator allowed buying and raised the cap.

## Differences from prior work

| Project | Source | What it does | What Arrow adds |
|---|---|---|---|
| TrustKit / NDAI | [github.com/discordwell/ndai-hackathon](https://github.com/discordwell/ndai-hackathon) · [arXiv 2502.07924](https://arxiv.org/abs/2502.07924) | Two agents negotiate inside an enclave; README: "egress whitelist of the LLM API hosts"; output fields "outcome, price, reason"; escrow on Base/Ethereum Sepolia | The reader model itself runs in a TEE (NEAR AI Cloud); the buyer gets a capped verdict (Output channel row), not free text; refunds by `intents.near` |
| Information Bazaar | [arXiv 2403.14443](https://arxiv.org/abs/2403.14443) · [github.com/tn-learn/info-bazaar](https://github.com/tn-learn/info-bazaar) | Open-source simulated market; LLM agents inspect and then forget | Not a simulation: recorded runs on NEAR mainnet ([Status](#status)) and testnet ([K2](JUDGES.md#gates-already-run)) |
| DeadDrop | [github.com/Hothit1/deaddrop](https://github.com/Hothit1/deaddrop) | Encrypted file sale, escrowed key delivery by a keeper, testnet | DeadDrop guarantees delivery; Arrow lets the buyer judge value before paying |
| Ocean Compute-to-Data | [github.com/oceanprotocol/docs](https://github.com/oceanprotocol/docs) (compute-to-data) | Provider checks datatokens before the job; "results and logs" are returned to the consumer; the consumer writes the algorithm | Inspection before payment, bounded output, natural-language criteria, TEE |
| Sealed Exploit · AgentEscrow · SealedBounty | [@edycutjong on X](https://x.com/edycutjong/status/2117725204403364028) · [@dele_dave on X](https://x.com/dele_dave/status/2117911300516823327) · [@0xJoydeeeep on X](https://x.com/0xJoydeeeep/status/2119815388657774668) | A TEE verdict releases escrow | The condition is the buyer's private criterion over the seller's private data, judged before the buyer pays for the data |
| x402 / Penstock | [github.com/coinbase/x402](https://github.com/coinbase/x402) (spec v2) · [github.com/ace-coderr/penstock](https://github.com/ace-coderr/penstock) | Pay-first paywalls for HTTP and MCP | Complementary ([For agents](#for-agents-cli-mcp-http-402)) |
| Spend firewalls (uprali, Warden, Clear to Pay) | [github.com/aly-coding/uprali-mvp](https://github.com/aly-coding/uprali-mvp) · [@saxxyweb3 on X](https://x.com/saxxyweb3/status/2119774924499800353) · [@joezzyweb3 on X](https://x.com/joezzyweb3/status/2119220897345122339) | Control whom and how much an agent pays | Arrow checks what is being bought |
| Charter · cipherwork | [github.com/Spagero763/charter](https://github.com/Spagero763/charter) · [github.com/wadadawadada/cipherwork](https://github.com/wadadawadada/cipherwork) | Same stack family (NEAR AI, OutLayer, Intents), privacy for one party | Before a purchase the seller does not see the criteria text and the buyer does not see the rows; limits: Side channels and Buyer viewing key rows |

## What we do not claim

<!-- claims:quoted:start -->
- Not zero-knowledge.
- No NEAR MPC CKD.
- Not "nothing leaks".
- Not "no bridge".
- Not "first NDAI".
- The keyless contract plus OutLayer pattern also appears in other hackathon entries. We do not present it as novel.
<!-- claims:quoted:end -->

## Build from source

**Enclave.** `bash scripts/build-tee-docker.sh` (Docker; it builds the committed `HEAD` in a pinned linux/amd64 image, about 1.5 min on Apple silicon after the image pull) prints `6ad7fed42691279cbcb43c3e8599fa0ef70ed7c54669e954b5acb31c03e1abc1`, the value in `release/sha256.txt`, the contract's `program_wasm_hash` and the attested `wasm_hash`. Without Docker, `bash scripts/build-tee.sh` gives the same sha only on `x86_64-unknown-linux-gnu` with rustup: Cargo mixes the build machine's target triple into the hash of every crate that has a build script or a proc-macro dependency, so another host gives other bytes (macOS arm64: `2d2dc4d0…`, which ran on testnet as rc4 before the freeze). Proof of the cause: on a Mac, `RUSTC=scripts/dev/rustc-fixed-host.sh bash scripts/build-tee.sh target/rel-tee-shim` changes only the host line Cargo sees and prints the canonical sha. Flags, toolchain and the proof: [release/BUILD.md](release/BUILD.md).

**Contracts.** `cargo near build reproducible-wasm`, then compare with the code hash of `arrow-market.near` (deployed in tx `XcbokaMkd1t2pdkxxgwPKsQGV2tQXEM7BK1fPjTfxmW`, [M2](JUDGES.md#pending-ledger)): `bash scripts/deploy/mainnet-check.sh post` prints `PASS code_hash = release/contracts/arrow-mainnet.wasm`. The committed `release/contracts/arrow-mainnet.wasm` is that build at `6ae732d` (sha256 `f59f35e7…`, code hash `HXohArFy…`; [release/contracts/BUILD.md](release/contracts/BUILD.md)), and `bash scripts/deploy/mainnet-check.sh wasm` prints `PASS contract_wasm_sha256` and `PASS contract_wasm_fresh`.

## Hackathon rules

- **Code window:** no pre-hackathon code. The first commit is `8ae64ef` (2026-11-10 14:57 +0700), inside the window that opened on 2026-10-19; check with `git log --reverse --format='%h %ad' | head -1`.
- **Existing product on another chain:** none.
- **Templates and libraries:** templates `out-layer/private-dao-example` and `out-layer/ai-example`. Libraries behind a claim: `@phala/dcap-qvl` 0.7.1 (DCAP on `/verify`), `@modelcontextprotocol/sdk` 1.32.2, Next.js 16.4.6. UI components copied in as source from [React Bits](https://reactbits.dev) (MIT + Commons Clause, licence kept in `web/components/reactbits/`): SplitFlapText, Stepper, PixelTransition. Everything else is pinned in `package-lock.json` and `Cargo.lock`.
- **AI code:** Parts of the code were written with AI coding assistants and reviewed by the team.
- **Keys in this repository:** none, except the demo buyer's viewing key, derived in code from the public label `arrow:demo-buyer:public:v1`. It holds no funds and decrypts only demo purchases (`sdk/src/viewingKey.ts`).
- **Other projects:** [Tender](https://github.com/kocality/tender) is another project by team members, independent: no shared code, contracts, accounts or wallets.
- **License:** MIT (`LICENSE`).

## Repo layout

`contracts/` (arrow, arrow-usd, mock-outlayer) · `enclave/` (arrow-core, arrow-tee) · `sdk/` · `web/` (pages `/listings`, `/sell`, `/buy/[id]`, `/seller`, `/verify`, `/trust`, `/attack`, `/try`) · `agent/` · `scripts/` · `bench/` · `fixtures/` · `spikes/` · `release/` · `docs/`
