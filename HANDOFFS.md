# Arrow · HANDOFFS (human steps)

Format: PLAN App. A.2. Labels are kept exactly as in the task cards (DEC C-11, W1-21). Times are GMT+7 with UTC in brackets.
**10 Nov times are shifted by Δ = +8:49 (T0 = 2026-11-10 14:49 GMT+7 [07:49Z], DEC §K K-01).** 10 Nov work that shifts past 23:59 rolls into 11 Nov morning (PLAN §4.0(3)). Gates and dues from 11 Nov on keep their own times; hard anchors never move.
**DEC §K changes:** K-02: pushing to the private origin is an agent step (H-10, the push step of H-11, and the push part of H-05/H-17/H-17b are not human steps). K-03: making the repo public is human-only and not approved yet. K-06: money decisions (≈$64 + NEAR AI $10) were approved by the user on 2026-11-10 ~15:30 GMT+7 (DECISIONS §K KU-06; no X Premium); every value-moving step is still a human step and stays here until the human runs it.

## Timed index

| Due GMT+7 [UTC] | H | Owner (card) | Blocks what | Status |
|---|---|---|---|---|
| 10 Kas 16:49 [09:49Z] (was 08:00) | H-01a | WS-1 T02 | WS1-T06 (S1-a), S1-b NEAR AI call, bench | DONE 18:35 (key in .env; testnet OutLayer secret updated 18:37; X Premium: no) |
| 10 Kas 17:49 [10:49Z] (was 09:00; latest 20:49 [13:49Z]) | H-02 | WS-1 T09 | H-07, all mainnet gates | DONE (arrowhq.near created, tx 8n1EmZZ2gkkybgv3bhGjtMayjREip4ABVDQAWkThGqUP, 10.3 NEAR, full-access key in the macOS keychain; read-only RPC 21:46 → 10.3 NEAR, 1 FullAccess key) |
| 10 Kas 17:49 [10:49Z] (was 09:00) | H-03 | WS-4 T08 | H-08a (S4-a) | DONE (Arrow Buyer 0xB5ef…8387 on Base: 15.1 USDC + 0.0016 ETH, orchestrator RPC 21:40, agent `s4a-inbound.ts --dry` 21:47 same; MetaMask import of Arrow Buyer + Arrow Seller 20:51) |
| 10 Kas 18:49 [11:49Z] (was 10:00) | H-05 | WS-1 T04 | raw GitHub WasmUrl (S-02 primary); push DONE by agent 15:08 (origin/main a2438115, K-02) | OPEN (public step only; not approved, K-03) |
| 10 Kas 20:49 [13:49Z] (was 12:00) | H-04 | WS-4 T05 | S4-a Solana dry quote | DONE (Arrow Sol AUcC…WahVj in .env SOLANA_PAYOUT_ADDRESS; 3.3 USDC + 0.002 SOL, USDC ATA exists; agent dry quote 21:45 → 200, 3 USDC in → 2.989698 out, no ATA error) |
| 10 Kas 20:49 [13:49Z] (was 12:00) | H-06 | WS-5 T10 | WS5-T10 hosted deploy | OPEN |
| 10 Kas 21:19 [14:19Z] (was 12:30) | H-07 | WS-1 T09 + WS-4 T09 (relayer key part) | H-08, H-12 | DONE 21:49-22:05 (arrow-market.near 4XThFxSV…, arrow-market-v2.near 8yyb9GYX…, arrow-relayer.arrowhq.near GrVY6srV…, arrow-spike.arrowhq.near 5o1oxf7j…, relayer FC key HxFJxjiz…; setup-relayer --check OK) |
| 10 Kas 21:49 [14:49Z] (was 13:00) | H-08a | WS-1 T09 + WS-4 T05 | H-08b, S4-a | DONE 22:06 (Base 0xaef58959…b9f4, SUCCESS 30 s, Intents +1.999596 USDC; S4-a PASS) |
| 10 Kas 22:19 [15:19Z] (was 13:30) | H-08b | WS-1 T09 + WS-4 T04 | H-08c, S3a(ii) | DONE 22:07 (class OK, intents_executed 1; S3a(ii) PASS) |
| 10 Kas 22:49 [15:49Z] (was 14:00) | H-08c | WS-1 T09 | H-08d, S3b | DONE 22:07-22:08 (deploy ERT9znZx…, refund_all 2oiKhXvj…, keep EVsShxK1…; S3b PASS) |
| 11 Kas 00:19 [10 Kas 17:19Z] (was 10 Kas 15:30) | H-08d | WS-1 T09 | H-08e, S3c + B5 | DONE 22:10-22:14 (keep BTX324Jz…, refund 9NvREUZ1…, B5 Bzzg22r9…; secret deleted, testnet login restored; S3c + B5 PASS) |
| 11 Kas 02:49 [10 Kas 19:49Z] (was 10 Kas 18:00) | H-09 | WS-7 T03 | seller outreach | OPEN |
| 11 Kas 04:19 [10 Kas 21:19Z] (was 10 Kas 19:30) | H-08e | WS-1 T09 | spike account cleanup | DONE 22:15 (USDC 20000 → arrowhq.near 7pQZRaHX…, arrow-spike deleted 6DBnU8na…; arrowhq.near 9.0611 NEAR) |
| 11 Kas 05:49 [10 Kas 22:49Z] (was 10 Kas 21:00; = K0) | H-24 | WS-1 T11 | K0 (only if triggered) | N/A unless triggered |
| when triggered | H-25 | WS-1 T05 | WS1-T05 testnet faucet fallback | N/A (faucet worked 15:10, block below) |
| 11 Kas 12:00 [05:00Z] | H-07b | WS-1 T11 | H-12 (only if K0 picks Escrow) | N/A: K0-mainnet 22:20 picked Notify (FINAL) |
| 11 Kas 12:00 [05:00Z] | H-W6e | WS-6 T02 | WS6-T02 | DONE: B (KU-10) |
| 11 Kas 15:00 [08:00Z] | H-21 | WS-6 T04 + WS-3 T06 (two blocks below: WS-3 pattern review, WS-6 bench review) | WS6-T05, WS3-T06 pattern sign-off | OPEN |
| 11 Kas 23:00 [16:00Z] | H-WS2-a | WS-2 T12b | reproducible build (only if Docker is down) | N/A: not triggered (Docker up, WS2-T12b DONE 18:21) |
| when it appears | H-WS2-b | WS-2 | macOS Keychain prompt | N/A unless triggered |
| daily 13:00 and 21:00 [06:00Z / 14:00Z] | H-10 | WS-1 T14 | push | N/A as human step: agent pushes (K-02) |
| 12 Kas 10:00 [03:00Z] (latest 21:00 [14:00Z]) | H-13a | WS-5 T04 | `/sell` blob upload | DONE 11 Kas ~02:00: store arrow-blobs (store_hJvfN8WAsLpJYjIp, public, iad1) linked to arrow-market for prod/preview/dev; BLOB_READ_WRITE_TOKEN in .env and .env.local |
| 12 Kas 12:00 [05:00Z] | H-01b | WS-1 T02 | H-12 mainnet secret | DONE by decision (DEC §K KU-11): no paid key; NEARAI_API_KEY_MAINNET = the NEAR Builders key |
| 12 Kas 18:10 [11:10Z] | H-11 | WS-1 T16 | freeze push; agent pushes (K-02) | N/A as human step: agent pushes (K-02) |
| 12 Kas 18:30-20:30 [11:30-13:30Z] | H-12 | WS-1 T17 | mainnet deploy, H-14 | OPEN · SUPERSEDED 13 Kas 19:30 GMT+3 by the local go-live runbook (docs/internal/MAINNET-RUNBOOK.md, outside the repo): run its lines, not the ones below (K3 freeze and H-01b are done) |
| 12 Kas 19:30 [12:30Z] | H-W6a | WS-6 T05 | bench blob push (only if triggered) | N/A unless triggered |
| 12 Kas 21:00 [14:00Z] | H-13b | WS-5 T10 | hosted relay/sponsor routes | OPEN |
| 12 Kas 21:00-23:00 [14:00-16:00Z] | H-14 | WS-1 T18 + WS-4 T15 | K4 | OPEN · SUPERSEDED 13 Kas 19:30 GMT+3 by the local go-live runbook (docs/internal/MAINNET-RUNBOOK.md, outside the repo): run its lines, not the ones below |
| 13 Kas 10:30 [03:30Z] | H-09b | WS-7 T03 | outreach follow-up | OPEN |
| 13 Kas 12:30-13:30 [05:30-06:30Z] | H-15a | WS-5 | first browser purchase before H-15 | OPEN |
| 13 Kas 08:30 [01:30Z] | H-W3-2 | WS-3 T11b | WS3-T12 (only if triggered) | N/A: not triggered (WS3-T11b DONE 19:18, every decision rule "no change") |
| 13-14 Kas (only if demand) | H-22 | WS-7 | seller concierge | N/A unless triggered |
| 13 Kas 19:00-23:00 [12:00-16:00Z] | H-15 | WS-1 T19 | K5 | OPEN |
| 14 Kas 06:30 [13 Kas 23:30Z] | H-W6c | WS-6 T08 | H-18 (only if precheck fails) | N/A unless triggered |
| 14 Kas 07:00-09:00 [00:00-02:00Z] | H-18 | WS-6 T08 | WS6-T07 | OPEN |
| 14 Kas 10:00-11:00 [03:00-04:00Z] (latest 14:00 [07:00Z]) | H-16 | WS-1 T20 | K6 lock | OPEN · SUPERSEDED 13 Kas 19:30 GMT+3 by the local go-live runbook (docs/internal/MAINNET-RUNBOOK.md, outside the repo): run its lines, not the ones below; the lock is a separate go/no-go |
| 14 Kas 15:00-19:00 [08:00-12:00Z] | H-17v | WS-7 T06 | video, H-17b | OPEN |
| 14 Kas 15:30 [08:30Z] | H-17 | WS-1 T22 | final push (agent, K-02) + public check (human, K-03) | OPEN (public part only) |
| 14 Kas 19:00 [12:00Z] | H-19 | WS-7 T07 | H-19x | OPEN |
| 14 Kas 19:15 [12:15Z] | H-17b | WS-7 | push after video (agent, K-02) | N/A as human step: agent pushes (K-02) |
| 14 Kas 20:00 [13:00Z] | H-19x | WS-7 T07 | X post, H-20 | OPEN |
| 14 Kas 21:00-22:00 [14:00-15:00Z] | H-20 | WS-7 T07 + WS-4 T17 | K8 submission | OPEN |
| 15-25 Kas | H-23 | WS-1 T22 | hosted demo upkeep | OPEN |
| only if triggered (after freeze) | H-W3-1 | WS-3 | post-freeze enclave change | N/A unless triggered |
| on trigger | H-W6b | WS-6 T06 | testnet/bench NEAR AI credit | N/A unless triggered |
| on trigger | H-W6d | WS-6 T06 | testnet NEAR from browser faucet | N/A unless triggered |

---

## H-01a · NEAR Builders $10 key (testnet/S1/bench) + X Premium · due 10 Kas 16:49 GMT+7 [09:49Z] (T0+2 sa) · status: OPEN
Purpose: S1-a, S1-b, bench ve testnet OutLayer secret'ı bu key'le koşuyor. HACKATHON.md Q-000: NEAR Builders $10'ı AYRI bir API key olarak geliyor, cloud.near.ai hesabına uygulanmıyor ve o dashboard'da görünmüyor.
Preconditions: `.env` dosyası var: `cp .env.example .env` (ajan oluşturdu 2026-11-10 14:59 GMT+7, değer yazmadı; `NEARAI_API_KEY_MAINNET=` satırı da var).
Run exactly:
    1. https://nearbuilders.org/join → kayıt
    2. https://nearbuilders.org/dashboard → "$10 key" / claim credits → çıkan API key'i kopyala
    3. Key'i `~/Desktop/hackathon/near-builds/arrow/.env` içinde `NEARAI_API_KEY=` satırına KENDİN yapıştır (sohbete yapıştırma)
    4. bash spikes/s1/ping.sh
    5. Tek satır cevap: "X Premium: yes|no" (x.com'da video yükleme ekranındaki süre sınırına bakarak; DEC T-08, W-14a)
Expected: `HTTP 200` (ping.sh bakiyeyi ölçmez; S1-a 402 görürse aşağıdaki yedek)
Write result to: bu bloğun Result satırı ("HTTP 200, <saat>, X Premium: no"). Key'in kendisini hiçbir yere yazma.
If it fails: 401 → key yanlış kopyalandı ya da bu key başka bir base URL istiyor (dashboard'da yazan URL'yi Result'a yaz, ajan ping.sh'ı o URL'yle dener ve GATES.md S1-a'ya yazar). 402/429 → kredi yok: H-01b'yi şimdi yap ve testnet için cloud.near.ai'de $5'lık ikinci bir key aç (`NEARAI_API_KEY`'e o yazılır; DEC E-04 yedeği). Ajan bu sırada S1-b'yi `echo` modunda (NEAR AI'sız) başlatır.
Result (human fills):

## H-01b · Mainnet NEAR AI key (doldurulabilir, kilitli secret için) · due 12 Kas 12:00 GMT+7 [05:00Z] · status: SUPERSEDED (KU-11, 2026-11-11): no paid key is bought; the mainnet secret uses the free NEAR Builders key (`NEARAI_API_KEY_MAINNET` = `NEARAI_API_KEY`), which cannot be topped up and has no published expiry; `balances.ts --ops` runs a liveness probe instead of a credit check. The steps below are kept for history only.
Purpose: arrow-market.near'in OutLayer secret'ı kilitten sonra değiştirilemez. Bu yüzden mainnet'e, cloud.near.ai'de kredisi sonradan yüklenebilen ayrı bir key girer (DEC E-04, G-03, B-14). Testnet/bench trafiği bu key'in kredisini tüketmez.
Preconditions: H-01a DONE. Kart ya da kripto ile $10. Para kararı (DEC K-06) kullanıcı tarafından onaylandı.
Run exactly:
    1. https://cloud.near.ai → hesap aç / giriş
    2. Credits → $10 yükle (kart ya da kripto; asgari tutar daha yüksekse onu yükle ve Result'a yaz)
    3. API Keys → Create → ad: arrow-mainnet, süresiz (expiry yok)
    4. Key'i `.env` içinde `NEARAI_API_KEY_MAINNET=` satırına KENDİN yapıştır
    5. NEARAI_API_KEY="$(grep '^NEARAI_API_KEY_MAINNET=' .env | cut -d= -f2-)" bash spikes/s1/ping.sh
Expected: `HTTP 200`; cloud.near.ai dashboard'da bakiye ≥ $9
Write result to: Result satırı ("HTTP 200, bakiye $…, <saat>")
[SUPERSEDED (KU-11)] If it fails: ödeme reddi → kripto ile tekrar; 12 Kas 18:00'e kadar olmazsa H-12 H-01a key'iyle yapılır ve trust table'a "mainnet inference key is NOT top-up-able" RISKY satırı girer (ajan yazar)
Result (human fills):

## H-02 · 10 NEAR + arrowhq.near · due 10 Kas 17:49 GMT+7 [10:49Z] (en geç 20:49 [13:49Z]) · status: DONE
Purpose: Bütün mainnet adımlarının fonu ve hackathon payout hesabı (DEC D-01, D-03, E-01).
Preconditions: near --version → 0.31.1 (ajan doğruladı, WS1-T01). Borsada ≥10,3 NEAR. Para kararı (DEC K-06) kullanıcı tarafından onaylandı.
Run exactly:
    near account create-account fund-later use-auto-generation save-to-folder ~/.near-credentials/implicit
    # çıkan 64-hex implicit adrese borsadan 10,3 NEAR çek (ağ: NEAR)
    near account view-account-summary <implicit-hex> network-config mainnet now
    near account create-account fund-myself arrowhq.near '9.9 NEAR' autogenerate-new-keypair save-to-keychain sign-as <implicit-hex> network-config mainnet sign-with-access-key-file ~/.near-credentials/implicit/<implicit-hex>.json send
    near account view-account-summary arrowhq.near network-config mainnet now
Expected: arrowhq.near ≥ 9,5 NEAR
Write result to: Result satırı (yalnızca hesap adı ve bakiye).
If it fails: Borsa gecikmesi → DEC E-01 yedeği (Base USDC → 1Click → wrap.near → implicit → near_withdraw), önce ajan dry quote alır. En geç saati kaçırırsa mainnet kapıları 11 Kas 12:00'ye kayar (DEC B-01), ajan inşaya devam eder.
Result (human fills): arrowhq.near created from "Arrow NEAR" (implicit fd2407…0f88), tx 8n1EmZZ2gkkybgv3bhGjtMayjREip4ABVDQAWkThGqUP, 10.3 NEAR, full-access key ed25519:Anamy3Lr… in the macOS keychain (save-to-keychain, DEC D-13). Read-only RPC 21:46: amount 10.3 NEAR, one FullAccess key.

## H-03 · Base USDC + ETH to "Arrow Buyer" · due 10 Kas 17:49 GMT+7 [10:49Z] · status: DONE (funding 21:40) · MetaMask import DONE 20:51 GMT+7 (user screenshot: "arrowbuyer" 0xB5ef3…28387, "arrowseller" 0xa54Bc…44B73)
Purpose: fund the generated buyer EOA for S4-a ($2), the e2e-mainnet run and the final run.
Preconditions: `npx tsx scripts/src/new-evm-wallet.ts --role buyer` printed "buyer address: 0x…" (WS4-T08). Money decision (DEC K-06) approved by the user.
Run exactly:
    1. In your exchange / wallet, withdraw on the **Base** network (chain id 8453):
       - 15 USDC (contract 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) → <buyer address>
       - ≈ $3 of ETH → <buyer address>
    2. REQUIRED (latest 13 Kas 12:00 GMT+7; H-15a and H-15 sign in MetaMask): MetaMask → Add account → Import account → paste the value of
       E2E_BUYER_EVM_PRIVATE_KEY and then E2E_SELLER_EVM_PRIVATE_KEY from .env yourself.
       Name them "Arrow Buyer" / "Arrow Seller". Do not use them for anything else (DEC D-09).
Expected: `npx tsx scripts/src/balances.ts` → buyer Base USDC ≥ 15.000000, ETH ≥ 0.0008; MetaMask shows both "Arrow Buyer" and "Arrow Seller" with the addresses the agent printed
Write result to: paste the balances output to the agent (no keys).
If it fails: Arbitrum USDC is the fallback origin (DEC E-02); tell the agent, it switches the S4-a origin asset.
Agent result (15:14 GMT+7 [08:14Z], WS4-T08): buyer address 0xB5ef360E42056049F584fd03BF0fb9b208E28387 (send the Base USDC + ETH here); seller address 0xa54Bc40188a338CAEd807CCA494bB651cF644B73 (no funds needed). Keys are in .env only.
Result (human fills): funded. Orchestrator read-only RPC 21:40: Arrow Buyer on Base = 15.1 USDC + 0.0016 ETH; agent `npx tsx spikes/s4/s4a-inbound.ts --amount 2 --dry` 21:47 → "Base USDC 15.1 · ETH 0.0016 · dry quote 200 · amountOut 1.999596 · timeEstimate 35 s". MetaMask shows "Arrow Buyer" and "Arrow Seller" (20:51).

## H-04 · Phantom Solana address + USDC ATA · due 10 Kas 20:49 GMT+7 [13:49Z] · status: DONE
Purpose: Solana payout target for the 1Click outbound in the demo (S4-a dry, H-15 withdrawal).
Preconditions: Phantom installed. Money decision (DEC K-06) approved by the user (only if the ATA must be created).
Run exactly:
    1. Phantom → add a separate account for Arrow; copy its address.
    2. Write it into `.env` as `SOLANA_PAYOUT_ADDRESS=<address>` (an address, never a key).
    3. If the account has no USDC token account yet: get 0.01 SOL + 0.1 USDC into it.
    4. Tell the agent "H-04 done"; the agent runs (free): npx tsx spikes/s4/s4a-solana-dry.ts
Expected: `dry quote 200 · amountOut ≈ 2.98 · no ATA error`
Write result to: Result line (address only, no keys).
If it fails: ATA error → do step 3; the agent re-runs the dry quote.
Result (human fills): "Arrow Sol" AUcCcG8YvcAW5oYuj6kvmESUoJ9Jrv5DxjXfZnvWahVj in .env SOLANA_PAYOUT_ADDRESS (21:05); 3.3 USDC + 0.002 SOL (orchestrator 21:40). Agent 21:45: Solana RPC getTokenAccountsByOwner (USDC mint EPjF…Dt1v) → one token account, 3.3 USDC; `npx tsx spikes/s4/s4a-solana-dry.ts` → "dry quote 200 · amountIn 3 · amountOut 2.989698 (2989698) · withdrawFee 9951 · timeEstimate 7 s · no ATA error", exit 0, written to spikes/s4/s4a-solana-dry.json (no addresses in the file).

## H-06 · Vercel login + project link (monorepo root) · due 10 Kas 20:49 GMT+7 [13:49Z] · status: DONE 11 Kas ~01:55 (user ran: project miragelabs/arrow-market prj_TDXUNceQ…, rootDirectory web, framework nextjs; GitHub auto-deploy DISCONNECTED on purpose: deploys only by CLI after the audit fixes; .gitignore gained .vercel and .env.local, uncommitted)
Purpose: let WS5-T10 deploy web/ as project arrow-market. Corrects PLAN H-06: Vercel CLI must run from the repo root in a monorepo (Vercel docs, monorepos).
Preconditions: Node 24 (`source ~/.nvm/nvm.sh && nvm use` → v24.15.0); a Vercel account (Hobby is fine). `.vercelignore` is committed on main (DEC S-03; WS1-T04).
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow
    npx -y vercel@65.14.0 login
    npx -y vercel@65.14.0 link --yes --project arrow-market
    npx -y vercel@65.14.0 project update arrow-market --root-directory web --framework nextjs
    # (same thing in the dashboard if the CLI refuses: Project → Settings → Build and Deployment → Root Directory: web;
    #  keep "Include files outside the root directory in the Build Step" ENABLED)
    # Reply to the agent: "agent may run vercel deploy and vercel env add/update for non-secret vars: yes|no"
Expected: `cat .vercel/project.json` shows projectId and orgId at the repo root (not web/.vercel). `npx -y vercel@65.14.0 project inspect arrow-market` shows Root Directory "web".
Write result to: paste the two outputs + the yes/no to the agent; agent records them in STATUS.md.
If it fails: name taken → `npx -y vercel@65.14.0 link --yes --project arrow-market-near` and the same `project update arrow-market-near …` (DEC D-12 fallback). Login blocked → agent continues locally; hosted demo waits. If a `web/.vercel/` folder exists from an earlier attempt, delete it (`rm -rf web/.vercel`).
Result (human fills):

## H-07 · Mainnet accounts + relayer FC key · due 10 Kas 21:19 GMT+7 [14:19Z] · status: DONE 22:05
Purpose: contract name reservation, v2 fallback, relayer, spike (DEC D-02, D-04, D-06, D-07; PLAN §0.3-3). Rewritten 21:52 by S-α as single lines with real values.
Preconditions (agent checked, read-only RPC 21:46): arrowhq.near = 10.3 NEAR with one FullAccess key (H-02, macOS keychain); arrow-market.near, arrow-market-v2.near, arrow-relayer.arrowhq.near and arrow-spike.arrowhq.near are all UNKNOWN_ACCOUNT (free). Relayer FC key generated by the agent 21:47 (`npx tsx scripts/src/new-near-keypair.ts --env RELAYER_PRIVATE_KEY`, WS4-T08/T09): the private key is only in .env `RELAYER_PRIVATE_KEY`, public key **ed25519:3666zmaqi9FFTDZoZhGhkxJEoM19VB3dc6CsPQ1rKq1x** (`setup-relayer.ts` derives the same key from .env). The two top-level `.near` names go through the `near` linkdrop contract (near-cli-rs mainnet config `linkdrop_account_id = "near"`); the agent ran the same command shape on testnet at 21:48 (arrow-h07-twin-2148.testnet created via the `testnet` linkdrop, signed by arrowhq.testnet, then deleted back to arrowhq.testnet). Total from arrowhq.near: 2.9 NEAR + gas. Each `sign-with-keychain` may show a macOS Keychain prompt: allow it.
**Changed amount:** arrow-spike.arrowhq.near gets **1.7 NEAR, not 1.5** (DEC D-06 backported): spike.wasm is 150,703 bytes and mainnet storage is 1e19 yoctoNEAR per byte (EXPERIMENTAL_protocol_config), so the H-08c deploy locks 1.507 NEAR; 1.5 NEAR would fail with LackBalanceForState. All of it comes back in H-08e.
Run exactly (one line per step, in this order):
    1. arrow-market.near (0.1 NEAR, deploy adds 2.6 in H-12):
       near account create-account fund-myself arrow-market.near '0.1 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
       check: near account view-account-summary arrow-market.near network-config mainnet now    → exists, balance 0.1 NEAR, 1 full access key
    2. arrow-market-v2.near (0.1 NEAR reserve, DEC D-07):
       near account create-account fund-myself arrow-market-v2.near '0.1 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
       check: near account view-account-summary arrow-market-v2.near network-config mainnet now    → exists, balance 0.1 NEAR, 1 full access key
    3. arrow-relayer.arrowhq.near (1.0 NEAR, gas only, DEC D-04/K-04):
       near account create-account fund-myself arrow-relayer.arrowhq.near '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
       check: near account view-account-summary arrow-relayer.arrowhq.near network-config mainnet now    → exists, balance 1 NEAR, 1 full access key
    4. arrow-spike.arrowhq.near (1.7 NEAR, returned in H-08e, DEC D-06):
       near account create-account fund-myself arrow-spike.arrowhq.near '1.7 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
       check: near account view-account-summary arrow-spike.arrowhq.near network-config mainnet now    → exists, balance 1.7 NEAR, 1 full access key
    5. relayer FunctionCall key (signs with arrow-relayer.arrowhq.near's keychain key from step 3; intents.near / execute_intents only, unlimited allowance, RT B4):
       near account add-key arrow-relayer.arrowhq.near grant-function-call-access --allowance unlimited --contract-account-id intents.near --function-names execute_intents use-manually-provided-public-key ed25519:3666zmaqi9FFTDZoZhGhkxJEoM19VB3dc6CsPQ1rKq1x network-config mainnet sign-with-keychain send
       check: cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx scripts/src/setup-relayer.ts --network mainnet --account arrow-relayer.arrowhq.near --check    → "FunctionCall key OK · allowance unlimited (null) · receiver intents.near · methods [execute_intents]"
Expected: four accounts exist with the balances above; the relayer has one FullAccess key (keychain) and one FunctionCall key ed25519:3666zm…Kq1x.
Write result to: Result line (the five tx hashes); the agent records them in evidence/mainnet.json (kind deploy).
If it fails: arrow-market.near taken → DEC D-02/D-07: arrow-market-v2.near becomes the main contract, fallback `arrow-market-v3.near`; the agent updates the allowlist (I-03) before the freeze and announces it in STATUS. Step 5 error → paste it; the agent prepares the near-api-js fallback (WS4-T09).
Result (human fills): DONE 21:49-22:05 GMT+7 (human ran it; agent read every tx back from the archival RPC 22:18, all SuccessValue, recorded in evidence/mainnet.json kind deploy). 1. arrow-market.near 4XThFxSVyyw8LnHHm5qNidm6YWBgJSxRz9htuUPMQQdP · 2. arrow-market-v2.near 8yyb9GYXWTTZdoQ8FcszWQUGLRyDqS4cMnG4geoED6mG · 3. arrow-relayer.arrowhq.near GrVY6srViMamYur4QTWBWNwe6ERStfA6hU63mLg6Qa9e · 4. arrow-spike.arrowhq.near 5o1oxf7j2uNB4FVKFubtpFFEaU8LjhY1iTbAYxbnKVJv · 5. relayer FC key HxFJxjiz9iugECLRm8sL2siYCns58EUqA7MUGoLK3gXX (AddKey FunctionCall, allowance null, intents.near, [execute_intents]); `setup-relayer.ts --check` OK. State 22:16: arrow-market.near 0.1, arrow-market-v2.near 0.1, relayer 0.9936 NEAR with one FullAccess + the FC key.

## H-05 · İlk push + repo public · due 10 Kas 18:49 GMT+7 [11:49Z] · status: OPEN (public step only; NOT approved, DEC K-03)
Purpose: S1-b ve freeze için public raw GitHub URL (DEC S-01, S-02); commit geçmişi süreç izi. DEC §K: push kısmı ajan işi (K-02) ve yapıldı; repoyu public yapmak insan işi ve kullanıcı henüz onaylamadı (K-03). Ajan beklemiyor: S1-b FastFS URL'siyle koşar, final wasm S-02 yedeğiyle (Vercel static, o da olmazsa FastFS) sabitlenir.
Preconditions (ajan çıktısı, 2026-11-10 15:07-15:08 GMT+7):
    - `bash scripts/secret-scan.sh` → `SECRET_SCAN: PASS` (raw S-04 grep 17 eşleşme, hepsi boş env adı ya da doküman satırı; strict kalıp yok; gitleaks "no leaks found", 3 commit).
    - Plan belgeleri takipte değil: `git ls-files | grep -E "KICKOFF|DECISIONS|PLAN|OPEN-QUESTIONS|^tasks/"` → boş (DEC S-01, W-17). The local maintainer notes file is gitignored.
    - Takip edilen dosyalarda ve geçmişte yasak kelime yok: `bash scripts/secret-scan.sh --public` → `SECRET_SCAN: PASS` (kelimeler `.git/info/banned-words` içinde, takipte değil)
    - Push DONE (ajan, K-02): `git push -u origin main` → `origin/main = a2438115` (8ae64ef bootstrap, 17294b7 scaffold + fixtures v1, a243811 ledger sync). `gh repo view yigitcangokmen/arrow --json visibility` → `PRIVATE`.
    - Not: `STATUS.md` henüz commit edilmedi (Workstreams tablosu oturum model adlarını içeriyor, DEC K-04); public'ten önce entegratör bu satırları temizleyip commit eder ya da defteri yerel tutar.
Run exactly (ONLY if the user approves making the repo public):
    cd ~/Desktop/hackathon/near-builds/arrow
    bash scripts/secret-scan.sh | tail -1
    git log --oneline origin/main
    gh repo edit yigitcangokmen/arrow --visibility public --accept-visibility-change-consequences
    gh repo view yigitcangokmen/arrow --json visibility
Expected: `SECRET_SCAN: PASS`; `{"visibility":"PUBLIC"}`
Write result to: Result satırı (saat + `git rev-parse --short origin/main`).
If it fails / not approved: repo private kalır. Ajan S1-b'yi testnet FastFS URL'siyle koşar (H-05 "If it fails" yolu, DEC K-03) ve freeze'de Vercel static URL'sine geçer (`.vercelignore`'daki `release/*.wasm` satırı o zaman kaldırılır, `web/public/release/` kullanılır). Kullanıcı public derse S-02 birincil yol (raw GitHub) geri gelir; freeze'den (K3) sonra URL değişmez.
Result (human fills):

## H-W6e · Team-made dataset source decision (Agent Market ToS)  · due 11 Kas 12:00 GMT+7 [05:00Z] · status: DONE (B)
Purpose: Agent Market ToS v2026-10-15 §9.2(h),(j) forbids scraping / collecting content "at scale". Confirm the narrowed dataset or pick fallback B. (Block written by S-epsilon, WS6-T02, 2026-11-10 15:16 GMT+7.)
Preconditions: `fixtures/team-made/SOURCE.md` exists (agent wrote it; it quotes the clauses). Collected 2026-11-10 08:13:58Z to 08:14:34Z, 16 GET, 775 rows, on branch ws/6-data (commit 611b754, not yet merged).
Run exactly:
    open ~/Desktop/hackathon/near-builds/arrow-ws-6/fixtures/team-made/SOURCE.md          # read section "Terms of Service" (≈1 min)
Expected: reply "A" (keep narrowed Agent Market snapshot, 16 published index files, no builder text) or "B" (switch to NEAR chain stats from public RPC; the agent then writes scripts/src/collect-chain-stats.ts).
Write result to: paste "A" or "B" to the WS-6 session; it records it in STATUS.md and SOURCE.md.
If it fails / no answer by 13 Kas 10:00: default "A" stands (it is used in H-15 that evening).
Result (human fills):
B (user delegated the decision to the orchestrator, 2026-11-10 ~16:00 GMT+7; DEC §K KU-10). The Agent Market snapshot commit was dropped from ws/6-data and local main before any push.

## H-09 · Seller invites · due 11 Kas 02:49 GMT+7 [10 Kas 19:49Z] (PLAN 10 Kas 18:00 + Δ 8:49) · status: OPEN
Purpose: send the seller invites (G4). Human-only: messages go out under the lead's X account. Nothing has been sent; every message is a draft. (Block written by S-epsilon, WS7-T02, 2026-11-10.)
Preconditions:
  - docs/outreach/targets.md has 1..15 rows, each with a "ready message" (branch ws/6-data)
    check: npx vitest run scripts/test/outreach.test.ts  → all green
  - repo visibility decides the variant (repo is PRIVATE now, DEC K-03):
    gh repo view yigitcangokmen/arrow --json visibility  → "PUBLIC" = variant A, else B
Run exactly (per row, top to bottom):
  1. Open the row's source link, then https://x.com/<handle>
  2. If a Message (envelope) button exists: click it, paste the row's ready message, Send.
     If not: open the row's hackathon post (source link) → Reply → paste the R variant → Reply.
     If the row's channel is "email (public)": send from the lead's mail client, subject "Arrow: list <their data> on NEAR (inspect before pay)".
  3. Right after sending, fill the row in docs/outreach/log.md: sent_utc (date -u +%FT%RZ), channel, variant, status=sent.
Expected: every target row has status=sent or failed (with a one-word reason: dm-closed, reply-limited, …).
Write result to: docs/outreach/log.md (or paste "T01 sent 11:05Z DM A, T02 …" to the agent).
If it fails: X rate-limits DMs to non-followers → switch that row to the R variant. Do not use GitHub issues.
Result (human fills): <number sent> / <number of rows>, <UTC time of last send>

## H-08a · S4-a $2 inbound (1Click) · due 10 Kas 21:49 GMT+7 [14:49Z] (was 13:00) · status: DONE 22:06
Purpose: real Base → NEAR Intents flow into Arrow Buyer's 0x… Intents account (gate S4-a, K0-mainnet 11 Kas 12:00). Script WS4-T05. Rewritten 21:52 by S-α as one line.
Preconditions (agent checked 21:47): `npx tsx spikes/s4/s4a-inbound.ts --amount 2 --dry` → "buyer (Base + Intents account): 0xb5ef360e42056049f584fd03bf0fb9b208e28387 · Base USDC 15.1 · ETH 0.0016 · dry quote 200 · amountIn 2.0 · amountOut 1.999596 · timeEstimate 35 s". Buyer Intents USDC now "0". Money decision approved (DEC §K KU-06). The run signs a Base ERC-20 transfer with Arrow Buyer's .env key and asks `proceed? [y/N]`: type y.
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx spikes/s4/s4a-inbound.ts --amount 2
Check (read-only):
    near contract call-function as-read-only intents.near mt_balance_of json-args '{"account_id":"0xb5ef360e42056049f584fd03bf0fb9b208e28387","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' network-config mainnet now    → about "1999596" (was "0")
Expected: script ends `S4-a PASS · status SUCCESS in <N> s · intents USDC +1.99… · base tx https://basescan.org/tx/0x…` (target < 120 s).
Write result to: the script writes evidence/mainnet.json; paste its last 10 lines to the agent.
If it fails: REFUNDED/FAILED → paste the output; the agent retries once with slippageTolerance 100, then Arbitrum USDC (DEC K-01, E-02); rate limit → JWT (DEC E-08).
Result (human fills): DONE 22:06 GMT+7. Base tx 0xaef58959048af87eed58e7e062dd88b6e486720ea99a01c01b8ee7f439fdb9f4 (block 55663941, status 1, 2 USDC to the 1Click deposit), status SUCCESS in 30 s, buyer Intents USDC 0 → 1.999596. S4-a PASS (evidence run s4a-inbound-2026-11-10T15-06-34-833Z).

## H-08b · S3a(ii) funded simulate · due 10 Kas 22:19 GMT+7 [15:19Z] (was 13:30) · status: DONE 22:07
Purpose: the funded Arrow Buyer key signs a 0.01 USDC transfer intent and `simulate_intents` (free view, no gas) shows neither a signature nor a balance error. It stays a human step because the signed payload is a real authorization of the buyer's Intents USDC.
Preconditions: H-08a DONE (buyer Intents USDC > 0).
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx spikes/s3/s3a-simulate.ts --funded --gates-line
Check (read-only):
    cd ~/Desktop/hackathon/near-builds/arrow && jq -r '.gate + " " + .class' spikes/s3/s3a-results.json    → "S3a(ii) OK"
Expected: `class: OK`.
Write result to: paste the last 5 lines to the agent.
If it fails: the agent switches to the manual payload fallback (DEC K-03); H-08c waits.
Result (human fills): DONE 22:07 GMT+7. `spikes/s3/s3a-results.json` gate S3a(ii), class OK, error null, intents_executed 1. S3a(ii) PASS.

## H-08c · Spike deploy + S3b notification / refund · due 10 Kas 22:49 GMT+7 [15:49Z] (was 14:00) · status: DONE 22:08
Purpose: see mt_on_transfer → [amounts]/[0] → mt_resolve_transfer on mainnet (S3b).
Preconditions: arrow-spike.arrowhq.near has 1.7 NEAR (H-07 step 4); the relayer FC key passes `setup-relayer.ts --check` (H-07 step 5; s3b sends `execute_intents` from it); H-08b `class: OK`. `spikes/s3/spike-contract/target/near/spike.wasm` exists in the main checkout (150,703 bytes, sha256 e8d455c905b91c24ac0561782ce6d31a73e3c14ee4e44401bc014940cc78f265, checked 21:47; the same wasm + `init-mainnet.json` was deployed on a testnet twin). Agent 21:49: `s3b-notify.ts --mode keep --dry` → `class: SIGNATURE_OK_BALANCE_ERROR` (throwaway EOA, nothing sent).
Run exactly (three lines, in order):
    1. deploy + init:
       cd ~/Desktop/hackathon/near-builds/arrow && near contract deploy arrow-spike.arrowhq.near use-file spikes/s3/spike-contract/target/near/spike.wasm with-init-call new json-args "$(cat spikes/s3/init-mainnet.json)" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
       check: near contract call-function as-read-only arrow-spike.arrowhq.near last json-args '{}' network-config mainnet now    → ""
    2. refund_all:
       cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx spikes/s3/s3b-notify.ts --mode refund_all
       check: near contract call-function as-read-only intents.near mt_balance_of json-args '{"account_id":"arrow-spike.arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' network-config mainnet now    → "0"
    3. keep:
       cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx spikes/s3/s3b-notify.ts --mode keep
       check: near contract call-function as-read-only intents.near mt_balance_of json-args '{"account_id":"arrow-spike.arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' network-config mainnet now    → "10000"
Expected: each script ends `S3b <mode>: PASS (log ok)`; refund_all: `S3_NOTIFY sender=0xb5ef…8387 … msg={"mode":"refund_all"}`, buyer and spike unchanged; keep: buyer −10000, spike +10000 (inside Intents).
Write result to: the scripts write evidence/mainnet.json; Result line: the deploy tx + the two execute_intents tx hashes.
If it fails: the agent proposes PAYMENT_PATH=Escrow at K0; H-08d still runs (OutLayer composition is needed for escrow too).
Result (human fills): DONE 22:07-22:08 GMT+7. deploy ERT9znZxK2EPfrhrVmTpTE3opUE4d1gsvBJuFC71aNGP · refund_all 2oiKhXvjvmNmPtZB3oT2S5t2mNYNox1oTtJz6QsVEvsp (buyer and spike unchanged) · keep EVsShxK1d771UXpucrBFF5C6FryVgE4PfiT12f2PjaHB (buyer −10000, spike +10000). S3_NOTIFY sender/msg match. S3b PASS (WS1-T10 read-back 22:18).

## H-08d · S3c OutLayer composition + B5 negative test · due 11 Kas 00:19 GMT+7 [10 Kas 17:19Z] (was 10 Kas 15:30) · status: DONE 22:14
Purpose: Intents → spike → OutLayer → decision in one receipt tree in < 90 s; another account cannot get the secret with the same secrets_ref (B5). On testnet (S1-b) the same access form was accepted and a direct call was refused with "Access denied by access condition".
Preconditions: H-08c DONE. Buyer Intents USDC ≥ 50000 (0.05). `NEARAI_API_KEY` (H-01a) in .env. wasm sha256 195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e (= spikes/s1/release/sha256.txt = init-mainnet.json wasm_hash). Agent 21:49: `s3c-outlayer.ts --mode outlayer --dry` → `class: SIGNATURE_OK_BALANCE_ERROR`; 21:50: `s3c-b5-negative.ts --prepare` wrote `spikes/s3/out/b5-args.json` (gitignored, used by step 4). Note: `outlayer login mainnet` also makes mainnet the CLI default for every session, so step 5 logs out and puts the testnet login (arrow.arrowhq.testnet) back.
Run exactly (five lines, in order):
    1. outlayer login as arrow-spike (the key goes from the keychain into outlayer, never on screen) + the spike's secret:
       cd ~/Desktop/hackathon/near-builds/arrow && printf '%s\n%s\n' arrow-spike.arrowhq.near "$(near account export-account arrow-spike.arrowhq.near using-private-key network-config mainnet 2>/dev/null | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]{80,}')" | outlayer login mainnet >/dev/null && ( set -a && . ./.env && set +a && OUTLAYER_NETWORK=mainnet outlayer secrets set "$(jq -cn --arg k "$NEARAI_API_KEY" '{NEARAI_API_KEY:$k}')" --profile arrow --wasm-hash 195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e --generate PROTECTED_MASTER:hex32 --access allow-all --via arrow-spike.arrowhq.near --build 195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e )
       check: OUTLAYER_NETWORK=mainnet outlayer whoami && OUTLAYER_NETWORK=mainnet outlayer secrets list | tail -3    → Account arrow-spike.arrowhq.near, Network mainnet; a profile "arrow" row for wasm 195508a1…
    2. S3c keep path:
       cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer
       check: near contract call-function as-read-only intents.near mt_balance_of json-args '{"account_id":"arrow-spike.arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' network-config mainnet now    → "20000"
    3. S3c refund path:
       cd ~/Desktop/hackathon/near-builds/arrow && export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer_refund
       check: near contract call-function as-read-only intents.near mt_balance_of json-args '{"account_id":"arrow-spike.arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' network-config mainnet now    → still "20000"
    4. B5 negative (arrowhq.near calls OutLayer directly with the spike's secrets_ref; 0.02 NEAR deposit, most refunded):
       cd ~/Desktop/hackathon/near-builds/arrow && near contract call-function as-transaction outlayer.near request_execution file-args spikes/s3/out/b5-args.json prepaid-gas '300.0 Tgas' attached-deposit '0.02 NEAR' sign-as arrowhq.near network-config mainnet sign-with-keychain send
       check (paste the tx hash to the agent, it runs): npx tsx spikes/s3/s3c-b5-negative.ts --read <tx_hash>    → "B5: PASS (no secret reached the other caller)"
    5. delete the spike secret, log out of mainnet, restore the testnet CLI login:
       cd ~/Desktop/hackathon/near-builds/arrow && OUTLAYER_NETWORK=mainnet outlayer secrets delete --profile arrow --wasm-hash 195508a1df98783ffe8333f03c48e8158e93d70ad8813aa76d162277dc51151e && OUTLAYER_NETWORK=mainnet outlayer logout && printf '%s\n%s\n' arrow.arrowhq.testnet "$(jq -r .private_key ~/.near-credentials/testnet/arrow.arrowhq.testnet.json)" | outlayer login testnet >/dev/null
       check: ls ~/.outlayer && outlayer whoami    → only "default-network" and "testnet"; Account arrow.arrowhq.testnet, Network testnet
Expected: (1) outlayer → keep, outlayer_refund → refund, both < 90 s, scripts print PASS. (2) B5: PASS (OutLayer returned null or pm is null). (3) attestation 200 on api.outlayer.ai.
Write result to: the scripts write evidence/mainnet.json; Result line: the three tx hashes (steps 2, 3, 4).
If it fails: (1) gas or time → escrow (DEC H-15) + min_gas 400 / execute_intents 900 Tgas attempt (DEC H-11). (2) B5 fails → WASM allowlist becomes the primary guard and the trust table gets a row. (3) deserialize error → the agent compares with the 7-parameter request_execution signature (DEC V-11). If mainnet OutLayer refuses the testnet FastFS URL: while logged in as arrow-spike, `OUTLAYER_NETWORK=mainnet outlayer upload spikes/s1/release/spike-tee.wasm`, then the `set_wasm` line in spikes/s3/RUNBOOK.md, then steps 2-3 again.
Result (human fills): DONE 22:10-22:14 GMT+7. Secrets set on mainnet; keep BTX324JzvDVZJa5dMxbK1bojhqkXZJwx2ii2qfnngP6q (request 2917, attestation 200, enclave 8757 ms, block → result 10.0 s) · refund 9NvREUZ1pEqnjuTY8osX3E51knjCBS3LYCgNgybiezKj (request 2918, enclave 36.6 s, 38.0 s total; the NEAR AI call inside stalled 30 s) · B5 Bzzg22r9tRpUZrbKmJDHSBWLCtgXhEAV3Vj3wuSCwbsf (request 2919, "Access denied by access condition", 0.019 NEAR refunded, `s3c-b5-negative --read` → B5: PASS). Secret deleted, mainnet outlayer logout, testnet login restored. S3c + B5 PASS.

## H-08e · Spike cleanup · due 11 Kas 04:19 GMT+7 [10 Kas 21:19Z] (was 10 Kas 19:30) · status: DONE 22:15
Purpose: move the spike's Intents USDC to arrowhq.near and get the ~1.7 NEAR back (DEC D-06).
Preconditions: H-08d step 5 done (secret deleted); the agent has read the H-08c/d results.
Run exactly (one chained line: the delete must only run after the USDC left the spike; the amount is read live, so no number to fill in):
    A=$(near contract call-function as-read-only intents.near mt_balance_of json-args '{"account_id":"arrow-spike.arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' network-config mainnet now 2>/dev/null | tr -d '"') && echo "spike Intents USDC (6 decimals): $A" && { [ "$A" = "0" ] || near contract call-function as-transaction intents.near mt_transfer json-args "{\"receiver_id\":\"arrowhq.near\",\"token_id\":\"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\",\"amount\":\"$A\"}" prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as arrow-spike.arrowhq.near network-config mainnet sign-with-keychain send; } && near account delete-account arrow-spike.arrowhq.near beneficiary arrowhq.near network-config mainnet sign-with-keychain send
Check (read-only):
    near account view-account-summary arrow-spike.arrowhq.near network-config mainnet now    → "does not exist" (UNKNOWN_ACCOUNT); arrowhq.near ≈ +1.6 NEAR
Expected: mt_transfer and delete succeed; arrowhq.near's Intents USDC = the spike amount (20000 if H-08c/d ran as planned).
Write result to: Result line (both tx hashes).
If it fails: DeleteAccountWithLargeState is not expected (small state); any other error → paste it to the agent. The delete-account form was run on testnet at 21:49 (arrow-h07-twin-2148.testnet).
Result (human fills): DONE 22:15 GMT+7. mt_transfer 20000 → arrowhq.near 7pQZRaHXD9HYMR1uCwFHnttyPr4KgJM6pUmao7giGfQ1 · delete-account 6DBnU8naQHNNdb9XV28boP8RiZcSt3z9mHfnkxAfkMRd. Read-only 22:16: arrow-spike.arrowhq.near UNKNOWN_ACCOUNT, arrowhq.near 9.0611 NEAR and Intents USDC 20000.

## H-12 · Mainnet deploy + secret + init_program_key · due 12 Kas 18:30-20:30 GMT+7 [11:30-13:30Z] · status: OPEN · SUPERSEDED 13 Kas 19:30 GMT+3 by the local go-live runbook (docs/internal/MAINNET-RUNBOOK.md, outside the repo): run its lines, not the ones below. The restore line below logs in as arrow.arrowhq.testnet, which the 13 Nov rehearsal locked; the runbook restores arrow-v2.arrowhq.testnet
Purpose: deploy the market to arrow-market.near, not locked (DEC B-06); arrow-market-v2.near stays a reserve with no deploy (DEC D-07). Rewritten 22:50 by S-α (WS1-T17) as single lines in run order; full runbook with expected output and each step's testnet twin: `scripts/deploy/mainnet.md` (ws/1-gates ea83520, on main after the next merge).
Preconditions: K3 PASS (release/sha256.txt written; `.env` PROGRAM_WASM_URL / PROGRAM_WASM_SHA256 = frozen values); H-01b DONE (`.env` NEARAI_API_KEY_MAINNET filled); step 0 prints PASS on every row. Agent read-only 22:45: arrow-market.near exists, 0.1 NEAR, no code; arrowhq.near 9.0611 NEAR (needs ≥ the step 0 deposit + 0.5 + gas); outlayer not logged in on mainnet; contract wasm = SHA256SUMS and fresh (WS2-T13 reproducible rebuild at the final commit is a hard precondition; `mainnet-check.sh wasm` → PASS contract_wasm_fresh); storage-estimate prints the deposit. Today step 0 FAILs exactly on `program_frozen` and `nearai_key_mainnet`. Each `sign-with-keychain` may show a macOS Keychain prompt: allow it.
Twin: every signing line ran 22:30-22:44 on testnet against mainnet-dryrun.arrowhq.testnet with the same wasm, the same init JSON and the same `sign-with-keychain` form (create Eb6sXMQM…, storage EVTKMY4N…, deploy+init 29RhuCrm…, tank C5vnSJfF…, secret set + logout/restore OK, init_program_key DD4Q6MX8… → "derive failed: null" because outlayer.near does not exist on testnet, self-only check frrHwP7u… → E14, account deleted 2wU5urgX…). Finding: `new` only accepts the mainnet init JSON on arrow-market.near (secrets_ref must be the contract itself; first twin try FM8kHR3y… → E15 secrets_ref), so the twin rendered its own name there.
Run exactly (one line per step, in this order):
    0. preflight (read-only):
       cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/deploy/mainnet-check.sh pre
       → every row PASS, last lines "deposit for step 1: <N> NEAR" (send that amount in step 1) and "PASS outlayer_logged_out on mainnet". Stop on any FAIL.
    1. storage money:
       near tokens arrowhq.near send-near arrow-market.near '<N> NEAR' network-config mainnet sign-with-keychain send   # <N> = the deposit step 0 printed
       → "<arrowhq.near> has transferred <N> NEAR to <arrow-market.near> successfully."
    2. deploy + init:
       cd ~/Desktop/hackathon/near-builds/arrow && shasum -a 256 release/contracts/arrow-mainnet.wasm && I=$(bash scripts/deploy/render-init.sh mainnet) && near contract deploy arrow-market.near use-file release/contracts/arrow-mainnet.wasm with-init-call new json-args "$I" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
       → the sha in release/contracts/SHA256SUMS (rebuilt reproducibly at the final commit, WS2-T13, hard precondition; `bash scripts/deploy/mainnet-check.sh wasm` → PASS contract_wasm_fresh), then "Contract code has been successfully deployed."
    3. gas tank:
       near contract call-function as-transaction arrow-market.near fund_tank json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0.5 NEAR' sign-as arrowhq.near network-config mainnet sign-with-keychain send
       → log "arrow: tank funded 500000000000000000000000"
    4. OutLayer secret (stops before login if NEARAI_API_KEY_MAINNET is empty; the key goes from the keychain into outlayer, never on screen):
       cd ~/Desktop/hackathon/near-builds/arrow && ( set -a && . ./.env && set +a && : "${NEARAI_API_KEY_MAINNET:?is empty in .env (H-01b)}" && printf '%s\n%s\n' arrow-market.near "$(near account export-account arrow-market.near using-private-key network-config mainnet 2>/dev/null | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]{80,}')" | outlayer login mainnet >/dev/null && OUTLAYER_NETWORK=mainnet outlayer secrets set "$(jq -cn --arg k "$NEARAI_API_KEY_MAINNET" '{NEARAI_API_KEY:$k}')" --profile arrow --wasm-hash "$PROGRAM_WASM_SHA256" --generate PROTECTED_MASTER:hex32 --access allow-all --via arrow-market.near --build "$PROGRAM_WASM_SHA256" 2>&1 | tail -4 )
       → "Logged in as arrow-market.near (mainnet)", "Calls admitted only from: arrow-market.near", "Secrets stored (profile: arrow, keys: NEARAI_API_KEY; protected (TEE): PROTECTED_MASTER)"
       check: near contract call-function as-read-only outlayer.near list_user_secrets json-args '{"account_id":"arrow-market.near"}' network-config mainnet now    → one row, profile arrow, WasmHash = frozen sha, access And[WasmHash, Predecessor Whitelist [arrow-market.near]]
    5. log out of mainnet OutLayer, restore the testnet login (run it even if step 4 failed after the login):
       cd ~/Desktop/hackathon/near-builds/arrow && OUTLAYER_NETWORK=mainnet outlayer logout && printf '%s\n%s\n' arrow.arrowhq.testnet "$(jq -r .private_key ~/.near-credentials/testnet/arrow.arrowhq.testnet.json)" | outlayer login testnet >/dev/null && ls ~/.outlayer/mainnet && outlayer whoami
       → "Logged out from mainnet", empty mainnet folder, "Account: arrow.arrowhq.testnet", "Network: testnet"
    6. program key (self-signed):
       near contract call-function as-transaction arrow-market.near init_program_key json-args '{}' prepaid-gas '300.0 Tgas' attached-deposit '0.05 NEAR' sign-as arrow-market.near network-config mainnet sign-with-keychain send
       → tx succeeds; "arrow: program key set" arrives on the callback within about a minute
    7. post check (read-only, waits up to 120 s for the key):
       cd ~/Desktop/hackathon/near-builds/arrow && bash scripts/deploy/mainnet-check.sh post
       → PASS config_matches_init, build mainnet / payment notify / result chain / not paused, code_hash, tank_available, secret_row, program_pubkey_130hex 04…
    8. arrow-market-v2.near: nothing (reserve only).
Expected: steps 1, 2, 3, 6 succeed; step 7 all PASS.
Write result to: paste the tx hashes of steps 1, 2, 3, 6 to the agent; the agent records them with evidence-add (ids h12-deploy-storage, h12-deploy-init, h12-deploy-tank, h12-deploy-pubkey) and sets contract / contract_wasm_sha256 / program_wasm_* in evidence/mainnet.json.
If it fails: step 1 or 3 → nothing deployed or lost, paste the error. Step 2 → deploy and init are one receipt, a failed init leaves no code; paste the error and stop. program_pubkey null after step 7 → paste the step 6 tx; the agent reads list_user_secrets and the callback log (a wrong secret can be replaced with `outlayer secrets update` before the lock, never after). If arrow-market-v2.near must be used: the agent rewrites these lines with v2 and renders the init with secrets_ref = arrow-market-v2.near.
Result (human fills):

## H-25 · Testnet faucet yedeği (yalnızca tetiklenirse) · due ihtiyaç anında · status: N/A (faucet çalıştı 2026-11-10 15:10-15:14: arrowhq.testnet F = 10 tNEAR + 3 süpürme)
Purpose: faucet script'ten çalışmazsa testnet NEAR.
Preconditions: ajan `arrowhq.testnet`'i oluşturamadı ya da sponsor hedefi tutmuyor (STATUS'ta hata satırı).
Run exactly:
    https://near-faucet.io → "NEAR" → alıcı: arrowhq.testnet (ya da ajanın yazdığı hesap) → Request (istek başına 2 tNEAR, rate limited)
    Hesap hiç yoksa: https://testnet.mynearwallet.com → Create account → cüzdanın kendi key'iyle; sonra ajana yalnızca hesap adını söyle
Expected: `near account view-account-summary arrowhq.testnet network-config testnet now` bakiyesi arttı
Write result to: Result satırı
If it fails: NEAR DevHub Telegram (https://t.me/neardev) faucet kanalı; ajan bu arada sandbox testleriyle devam eder
Result (human fills):

## H-14 · e2e-mainnet run · due 12 Kas 21:00-23:00 GMT+7 [14:00-16:00Z] · status: OPEN · SUPERSEDED 13 Kas 19:30 GMT+3 by the local go-live runbook (docs/internal/MAINNET-RUNBOOK.md, outside the repo): run its lines, not the ones below. The 8.0/3.5 USDC H-15 targets below are gone from the spend plan (block written 11 Kas 01:10 by S-δ, WS4-T15; script on main 25061e7, merged round 7)
Purpose: one real mainnet pass of the full flow; produces K4 evidence (evidence/mainnet.json). Spends about $5 plus gas; the spend plan is printed first and nothing moves until you type y.
Preconditions:
    - H-12 done and K3 freeze pushed: `npx tsx scripts/src/e2e-mainnet.ts --network mainnet --dry-plan` prints preflight all OK (today it FAILs on `CodeDoesNotExist arrow-market.near`, as expected before H-12)
    - Buyer Base USDC ≥ 5.5 and ETH ≥ 0.0005 (`npx tsx scripts/src/balances.ts`); `SOLANA_PAYOUT_ADDRESS` set in .env (H-04); `RELAYER_PRIVATE_KEY` and `RELAYER_ACCOUNT_ID=arrow-relayer.arrowhq.near` in .env (H-07)
    - The two e2e ciphertexts must be served over public HTTPS: the first run (or `--dry-plan`) writes them to `fixtures/blobs/e2e/<sha>.bin` and stops. The repo is private (K-03), so raw.githubusercontent.com will not serve them until it is public: use any public HTTPS prefix that serves `<prefix>/<sha>.bin` (Vercel static after H-06, or an `outlayer upload` URL per file) and pass it as `--blob-base`. Preflight checks each URL returns 200 with the right sha256.
Run exactly:
    export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
    cd ~/Desktop/hackathon/near-builds/arrow
    npx tsx scripts/src/e2e-mainnet.ts --network mainnet --relay direct --blob-base <https prefix that serves the .bin files>
    # read the spend plan (it ends with what H-15 still needs), type "y"
Expected: last line `E2E mainnet: 11/11 green` (step 5 may say WARN: BUY scene not reproduced); each step prints a nearblocks/basescan/solscan link; then run the suggested `npm run verify -- --network mainnet --only e2e --pre-lock`.
Write result to: evidence/mainnet.json (the script writes it); paste the last 30 lines to the agent.
If it fails: do not re-run from scratch; paste the output. The agent names the exact `--from-step N` command (earlier listing and eval ids are read back from evidence, so money is not spent twice).
Result (human fills):

## H-20 · Submission · due 14 Kas 21:00-22:00 GMT+7 [14:00-15:00Z] (absolute 15 Kas 06:00) · status: OPEN (block written 11 Kas 01:10 by S-δ, WS4-T17; script on main 4fa0e2b, merged round 7)
Purpose: one submission for Arrow, sent by the human only. The script never sends; it validates and prints the curl command.
Preconditions: repo public (H-05/H-17), X post live (H-19x) so `demoUrl` is known, Q-015 check done (H-19), `docs/submission/idea.txt` final (WS7-T07). `~/.config/arrow/submission-inputs.json` exists with placeholders in `<...>`: replace each one yourself (leadName, email, size, nearAddress, and set q015Approved true after H-19). Add `"demoUrl": "<x post url>"` after H-19x or pass `--demo-url`. Keep the file outside the repo; never paste its contents into chat or git.
Run exactly:
    curl -s https://nearhackathon.com/HACKATHON.md | wc -c        # expect 22529; if different, show the agent first
    npx tsx scripts/src/submission-preview.ts --consent        # reads ~/.config/arrow/submission-inputs.json; any flag overrides a field
    # read the printed payload and the consent sentence; if all correct:
    curl -sS -X POST https://nearhackathon.com/api/applications -H 'Content-Type: application/json' -d @$HOME/.config/arrow/submission.json
Expected: preview ends `payload valid (11 fields, no website) · written ~/.config/arrow/submission.json · NOT SENT`, exit 0; the POST answers HTTP 201.
Write result to: tell the agent "201" (no personal data in git).
If it fails: preview exit 2 lists the missing or invalid fields; exit 3 means HACKATHON.md changed (read it first); POST 400 → fix the fields listed, same requestId; 503 → wait 1 min, same command; 403/409 → stop, tell the agent; never resubmit after 201 (use https://nearhackathon.com/request-changes).
Result (human fills):

## H-21 (WS-3 part) · G5 pattern review · due 11 Kas 15:00 GMT+7 [08:00Z] · status: OPEN
Purpose: a human reads the injection and exfil patterns once before the wasm freeze (WS3-T06 card). Block written by S-β 2026-11-10 16:10 GMT+7 [09:10Z].
Preconditions: WS3-T06 merged to main: DONE 17:34 GMT+7 (main a391c51, 7220e24; was ws/3-enclave 3158151).
Run exactly (in the repo root, ≈15 min):
    cargo run -q -p arrow-core --example explain -- --list-patterns
    cargo test -p arrow-core --test injection_room -- --nocapture 2>&1 | grep "room:"
Expected: the pattern table (11 English + 16 for 8 languages + 1 exfil) and "room: 20/20 regex_expected flagged, 0/4 bypass-by-design also flagged, …".
Write result to: Result line below: "OK" or the list of patterns to change. The agent applies changes before the freeze (12 Kas 18:00).
If it fails / no answer by 12 Kas 12:00: the patterns stay as they are; the freeze goes ahead.
Result (human fills):

## H-21 (WS-6 part) · Bench criteria review (15 min) · due 11 Kas 15:00 GMT+7 [08:00Z] (an 11 Kas time, not shifted by Δ) · status: OPEN
Purpose: DEC C-12. The bench attacks and criteria are agent-written; a human reads them once so the README may say "human-reviewed". Until then bench/README.md says "human review: not done". Block written by S-epsilon, WS6-T04, 2026-11-10 16:55 GMT+7 [09:55Z].
Preconditions: the review list exists: `~/Desktop/hackathon/near-builds/arrow/bench/REVIEW.md` (115 lines; merged to main 17:45 GMT+7 as 7a9fc43, was ws/6-data 56687e1).
Run exactly:
    open ~/Desktop/hackathon/near-builds/arrow/bench/REVIEW.md
    # optional: open ~/Desktop/hackathon/near-builds/arrow/bench/injection-room/README.md
Expected: reply "OK" or a list like "R-P6: make it shorter; L44: drop; Q20: use Spanish". Optional: up to 10 attacks you write yourself (they will be labelled "human-written").
Write result to: paste the reply to the WS-6 session. The agent applies the changes, re-runs `npm run bench:gen -- --check` and `npx vitest run bench/test`, and writes "reviewed by <name>, <date>" in bench/README.md.
If it fails / no answer by 11 Kas 18:00: proceed; bench/README.md keeps saying "human review: not done" (no false claim). Any later change to the datasets means `npm run bench:prepare` must be re-run before the blobs are committed (WS6-T05).
Result (human fills):
