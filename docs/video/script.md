# Arrow demo video: script (draft)

Two cuts from one set of shots: **full** (YouTube, unlisted, at most 3:00) and **X** (native upload, at most 2:15, no X Premium). The 30-second moment, a PASS verdict, a BUY verdict and the hash line, is in both cuts. Voice-over is English, recorded by a person. This is a draft: segments that depend on the mainnet run are marked with their [Pending ledger](../../JUDGES.md#pending-ledger) ID and every number in `{{BRACES}}` is filled from recorded evidence, never by hand.

## Rules

- Speech at most 2.7 words per second per segment.
- Any sped-up part shows "sped up xN" on screen. Waiting for 1Click or the enclave is the only thing that is sped up.
- Synthetic listings carry the badge "synthetic · seller is us (demo)".
- No face, no name until the closing card. Buyer and seller appear in consecutive scenes, never side by side.
- Say "your NEAR Intents balance", never "your wallet", for refunds. Say that Base USDC arrives as a bridged token (`omft.near`) that 1Click swaps into native NEAR USDC, the only token the market accepts.
- Say "the LLM cannot produce BUY unless the structural gates pass", never a bare "the LLM cannot produce BUY".
- The bit bound (README trust table, Output channel row) is for the verdict output only. When the leak budget is on screen or spoken, say that run time and instruction count are public side channels and that the trust table lists them. A run that leaves no output (`null`) adds one state the budget does not count; `ok:false` is inside the bound.
- Only mainnet footage is called mainnet. A testnet re-run carries the on-screen label "testnet re-run".
- Numbers on screen (room table, demand line, prices, verdict values) are the ones in the README and in `evidence/mainnet.json`.
- Nothing on screen shows `.env`, a seed phrase or a private key.

## Full cut (3:00)

| id | start | end | screen (shot id) | voice-over (English) | on-screen text |
|---|---|---|---|---|---|
| F01 | 0:00 | 0:14 | S01 | Data is hard to sell. To judge a dataset, a buyer has to see it. Once they have seen it, why pay? So buyers pay blind, or not at all. | Arrow's information paradox (1962) |
| F02 | 0:14 | 0:30 | S02 | I'm a fund analyst. This listing claims a token unlock schedule, 412 rows. Before I pay, a TEE-hosted model reads a 40-row sample for me, and I see no row. | synthetic · seller is us (demo) |
| F03 | 0:30 | 0:46 | S03 | Inspection costs {{EVAL_FEE}}. The verdict is PASS, fit {{PASS_FIT}}, novelty {{PASS_NOVELTY}}. I already have most of these entries, and I never saw a row. That was the lemon. | sped up x{{SPEEDUP}} |
| F04 | 0:46 | 1:12 | S04 | Second listing: wallet labels. BUY, fit {{BUY_FIT}}, novelty {{BUY_NOVELTY}}. I pay {{BUY_PRICE}} in USDC from Base through NEAR Intents. The data key is sealed to my key on chain, and the file I download has the same hash the enclave inspected and the seller listed. | listed = inspected = delivered |
| F05 | 1:12 | 1:26 | S05 | The seller lists the file and withdraws USDC to Solana. Neither of us needed a NEAR account. | Solscan link, TODO(M13) |
| F06 | 1:26 | 1:50 | S06 | Can a buyer extract rows? Asking for row one returns PASS, fit one, and no text. Can a seller inject an instruction to answer BUY? In our refusal room, {{ROOM_BUY}} of 24 attacks got BUY. | {{ROOM_BUY}}/24 BUY · false flags on clean BUY/SELL data: {{FALSE_FLAGS}} |
| F07 | 1:50 | 2:05 | S07 | If the enclave fails, intents.near's own refund code returns my payment to my NEAR Intents balance, less ten percent of an inspection fee. It is not instant: the enclave pads a finished eval to at least 45 seconds. | nearblocks link |
| F08 | 2:05 | 2:25 | S08 | Agents get the same flow: a command line, an MCP tool, and an HTTP 402 response. The 402 tells an agent how to inspect and pay. Arrow tells it whether it's worth paying. | the 402 response carries no payment |
| F09 | 2:25 | 2:42 | S09 | NEAR makes this one flow: a TEE model on NEAR AI Cloud, an OutLayer enclave answering the contract, NEAR Intents for payment and refunds. Every listing has an on-chain leak budget for the verdict. Time and instruction count are public; the trust table says so. | leak budget (verdict output only): spent {{SPENT}} / {{BUDGET}} bits · side channels: see trust table |
| F10 | 2:42 | 3:00 | S10 | Every proven claim has a command. Verify prints what is proven, what is not, and what is risky. {{DEMAND_LINE_SPOKEN}} Built at NEAR HACKATHON. Code and steps are in the repo. | {{DEMAND_LINE}} · repo · Built at NEAR HACKATHON |

## X cut (at most 2:15)

| id | start | end | screen (shot id) | voice-over (English) | on-screen text |
|---|---|---|---|---|---|
| X01 | 0:00 | 0:10 | S01 | Data is hard to sell. To judge a dataset, a buyer has to see it. Once they have, why pay? | Arrow's information paradox (1962) |
| X02 | 0:10 | 0:24 | S02 | I'm a fund analyst. This listing claims a token unlock schedule. Before I pay, a TEE-hosted model reads a 40-row sample for me, and I see no row. | synthetic · seller is us (demo) |
| X03 | 0:24 | 0:38 | S03 | Inspection costs {{EVAL_FEE}}. The verdict is PASS, fit {{PASS_FIT}}, novelty {{PASS_NOVELTY}}. I never saw a row. That was the lemon. | sped up x{{SPEEDUP}} |
| X04 | 0:38 | 1:04 | S04 | Second listing: BUY, fit {{BUY_FIT}}, novelty {{BUY_NOVELTY}}. I pay {{BUY_PRICE}} in USDC from Base through NEAR Intents. The file I download has the same hash the enclave inspected and the seller listed. | listed = inspected = delivered |
| X05 | 1:04 | 1:20 | S06 | Can a seller inject an instruction to answer BUY? In our refusal room, {{ROOM_BUY}} of 24 attacks got BUY. Asking for row one returns no text. | {{ROOM_BUY}}/24 BUY |
| X06 | 1:20 | 1:32 | S07 | If the enclave fails, intents.near's own refund code returns my payment to my NEAR Intents balance, less ten percent of an inspection fee. | nearblocks link |
| X07 | 1:32 | 1:48 | S08 | Agents use the same flow through a command line, an MCP tool and an HTTP 402. Arrow tells an agent whether it's worth paying. | the 402 response carries no payment |
| X08 | 1:48 | 2:00 | S09 | A TEE model on NEAR AI Cloud, an OutLayer enclave, and NEAR Intents for payment and refunds. | leak budget (verdict output only): spent {{SPENT}} / {{BUDGET}} bits · side channels: see trust table |
| X09 | 2:00 | 2:14 | S10 | Every proven claim has a command. {{DEMAND_LINE_SPOKEN}} Built at NEAR HACKATHON. | {{DEMAND_LINE}} · repo · Built at NEAR HACKATHON |

## Open items before recording

- `TODO(M7a-M12)` Every segment above needs the Arrow program and contract on mainnet (listing, eval, buy, refund). Until then the footage would be testnet and must carry "testnet re-run".
- `TODO(M13)` F05 needs a real USDC withdrawal to Solana. Only a dry quote exists today. If it is not run, cut F05 and the Solana sentence and move its seconds to F04.
- `TODO(M15a, M17)` S10 is recorded after the lock so the lock row of `verify` reads PROVEN.
- Voice-over placeholders `{{EVAL_FEE}}`, `{{PASS_FIT}}`, `{{PASS_NOVELTY}}`, `{{BUY_FIT}}`, `{{BUY_NOVELTY}}`, `{{BUY_PRICE}}` come from the recorded runs (testnet values: [README example](../../README.md#how-it-works); mainnet fees are set at M7a-c).
