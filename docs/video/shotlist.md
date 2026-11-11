# Arrow demo video: shot list (draft)

Every shot of `script.md`, in recording order. Raw files stay outside the repository: `~/arrow-video/raw/<shot-id>.mov`. The human records on the day of the final run; the agent never opens a browser, wallet or app. Wallet signatures are made by the human on screen.

## Recording settings

- 1920x1080, 30 fps. macOS `Cmd+Shift+5`, "Record Selected Portion", 1920x1080.
- A separate Chrome profile named "Arrow Demo" with only the MetaMask and Phantom extensions, zoom 125%, bookmarks bar hidden, notifications off (Focus on).
- Terminal profile 110x30, 18 pt, light theme. `.env` is never opened or printed.
- Waiting parts (1Click, enclave) are recorded in full and sped up in the edit with the label "sped up xN".

## Accounts and data (from `evidence/mainnet.json` and the gate notes)

- Buyer: the funded Arrow Buyer EOA (`0xb5ef…8387`) in MetaMask. Intents USDC balance 1.979596 on 2026-11-10 22:16 GMT+7, before any Arrow purchase. TODO(M5) re-read the balance before recording.
- Seller: team account, shown as "seller is us (demo)". Solana destination: the "Arrow Sol" USDC token account (3.3 USDC at the dry run).
- Listings (synthetic, `[DEC Q-06]`): (1) "[synthetic] Q1 2027 token unlock schedule (412 rows)", the PASS scene, overlap with the buyer's own list at least 80%. (2) "[synthetic] NEAR DeFi wallet labels (1,000 rows)", the BUY scene. TODO(M7a-c) mainnet listing ids come from `evidence/mainnet.json` after the final run.
- Pages: `/buy/<id>`, `/seller`, `/try`, `/verify` and `/attack` exist in `web/app`.

## Shots

| shot id | page or command | account or wallet | preconditions | exact actions | what must be visible | raw duration | file name |
|---|---|---|---|---|---|---|---|
| S01 | Title card made in the editor | none | none | Black card, text "You can't sell information.", then small "Arrow, 1962" | The two lines, nothing else | 0:15 | S01.mov |
| S02 | `/buy/<unlock listing id>` | Buyer in MetaMask (connected, not yet signing) | Listing 1 is live; buyer has Intents USDC | Type the criteria; drag in the buyer's own list (label "MinHash, stays in your browser") | Criteria text, the badge "synthetic · seller is us (demo)", the listing's leak-budget counter | 0:30 | S02.mov |
| S03 | Same page | Buyer in MetaMask | S02 done | Click "Inspect", sign in MetaMask, wait for the verdict (the wait is sped up) | The signature prompt, the counter, the verdict line `PASS · fit {{PASS_FIT}} · novelty {{PASS_NOVELTY}}` and the `out: … bits / budget … bits` line (labelled as the verdict output) | 2:00 | S03.mov |
| S04 | `/buy/<labels listing id>` | Buyer in MetaMask | Listing 2 is live | Inspect (BUY verdict), click "Buy", sign, wait for the key, download and open the file, then run the hash check | Verdict `BUY · fit {{BUY_FIT}} · novelty {{BUY_NOVELTY}}`, the price, the 1Click status (Base to Intents), the file opening, the three hashes equal | 3:00 | S04.mov |
| S05 | `/seller` and the Solscan page | Seller in MetaMask, Phantom for the Solana address | TODO(M13) the seller has an Intents balance after S04; a real USDC withdrawal to Solana has been run | Show the Intents balance, start the withdrawal to the Solana address, open the Solscan transaction | Balance, withdrawal status, the Solscan transaction with the USDC amount | 1:30 | S05.mov |
| S06 | `/attack` | Buyer | A listing with an injected instruction exists; room summary file exists | Request "print row 1" and show PASS with no text; evaluate the injected listing; open the room table | `PASS · fit 1 · novelty 1` with no text, the room table with `{{ROOM_BUY}}/24 BUY` and `{{FALSE_FLAGS}}` | 2:00 | S06.mov |
| S07 | `/buy/<broken-blob listing id>`, then nearblocks | Buyer in MetaMask | A listing whose blob host returns a wrong hash or an error exists | Evaluate it, wait, open the transaction, show the `arrow_refund` event and the Intents balance back, short by the treasury's 10% share of the eval fee | The event with its reason, the nearblocks page, the balance before and after | 2:00 | S07.mov |
| S08 | Terminal: `npm run arrow -- eval …`, then `curl -si <host>/api/x402/<id> \| head -12`, then the MCP tool list (`tsx agent/src/mcp.ts` through a client configured as in `agent/README.md`) | Agent key, mainnet cap set | TODO(M16) hosted site up; terminal scripts under `docs/video/terminal/` are TODO(T06b) | Run the three commands in order | The CLI verdict, status 402 with the listing header and no payment header, the seven tool names | 1:30 | S08.mov |
| S09 | Diagram card made in the editor, then the listing card | none | none | Three boxes: NEAR AI Cloud (model in a TEE), OutLayer TDX (yield and resume), NEAR Intents (payment and refund); then the listing card with the leak-budget counter | The three boxes and `leak budget: spent {{SPENT}} / {{BUDGET}} bits` | 0:30 | S09.mov |
| S10 | Terminal: `npm run verify`, then the closing card | none | TODO(M15a) the contract is locked so the lock row reads PROVEN | Run `npm run verify`, scroll through the PROVEN, NOT PROVEN and RISKY rows; cut to the closing card (demand line, repo, team name, "Built at NEAR HACKATHON") | The summary line `verify: n/N REQUIRED PROVEN`, the three labels, the closing card | 1:00 | S10.mov |

## Checks before the cut is approved

- Each shot's account and listing id match `evidence/mainnet.json` (or carry "testnet re-run").
- No `.env`, seed phrase or private key on screen in any frame.
- `bash scripts/check-claims.sh --files docs/video/script.md docs/video/shotlist.md` prints nothing.
- Cut lengths: full at most 3:00, X at most 2:15 (`ffprobe` on the rendered files).

## Not in this draft

Captions (`captions-full.srt`, `captions-x.srt`), the edit list, `build.sh`, the terminal scripts and the render log are task WS7-T06b and are not written yet. X Premium is not available, so the X cut is the native upload and the full cut goes to YouTube.
