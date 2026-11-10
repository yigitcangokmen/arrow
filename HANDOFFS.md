# Arrow · HANDOFFS (human steps)

Format: PLAN App. A.2. Labels are kept exactly as in the task cards (DEC C-11, W1-21). Times are GMT+7 with UTC in brackets.
**10 Nov times are shifted by Δ = +8:49 (T0 = 2026-11-10 14:49 GMT+7 [07:49Z], DEC §K K-01).** 10 Nov work that shifts past 23:59 rolls into 11 Nov morning (PLAN §4.0(3)). Gates and dues from 11 Nov on keep their own times; hard anchors never move.
**DEC §K changes:** K-02: pushing to the private origin is an agent step (H-10, the push step of H-11, and the push part of H-05/H-17/H-17b are not human steps). K-03: making the repo public is human-only and not approved yet. K-06: money decisions (≈$64 + NEAR AI $10) were approved by the user on 2026-11-10 ~15:30 GMT+7 (DECISIONS §K KU-06; no X Premium); every value-moving step is still a human step and stays here until the human runs it.

## Timed index

| Due GMT+7 [UTC] | H | Owner (card) | Blocks what | Status |
|---|---|---|---|---|
| 10 Kas 16:49 [09:49Z] (was 08:00) | H-01a | WS-1 T02 | WS1-T06 (S1-a), S1-b NEAR AI call, bench | OPEN |
| 10 Kas 17:49 [10:49Z] (was 09:00; latest 20:49 [13:49Z]) | H-02 | WS-1 T09 | H-07, all mainnet gates | OPEN (money approved by the user 2026-11-10, DEC §K KU-06) |
| 10 Kas 17:49 [10:49Z] (was 09:00) | H-03 | WS-4 T08 | H-08a (S4-a) | OPEN (money approved by the user 2026-11-10, DEC §K KU-06) |
| 10 Kas 18:49 [11:49Z] (was 10:00) | H-05 | WS-1 T04 | raw GitHub WasmUrl (S-02 primary); push DONE by agent 15:08 (origin/main 6c7b4d37, K-02) | OPEN (public step only; not approved, K-03) |
| 10 Kas 20:49 [13:49Z] (was 12:00) | H-04 | WS-4 T05 | S4-a Solana dry quote | OPEN (money approved by the user 2026-11-10, DEC §K KU-06) |
| 10 Kas 20:49 [13:49Z] (was 12:00) | H-06 | WS-5 T10 | WS5-T10 hosted deploy | OPEN |
| 10 Kas 21:19 [14:19Z] (was 12:30) | H-07 | WS-1 T09 + WS-4 T09 (relayer key part) | H-08, H-12 | OPEN (money approved by the user 2026-11-10, DEC §K KU-06) |
| 10 Kas 21:49 [14:49Z] (was 13:00) | H-08a | WS-1 T09 + WS-4 T05 | H-08b, S4-a | OPEN (block below; RUNBOOK spikes/s3/RUNBOOK.md) |
| 10 Kas 22:19 [15:19Z] (was 13:30) | H-08b | WS-1 T09 + WS-4 T04 | H-08c, S3a(ii) | OPEN (block below; RUNBOOK spikes/s3/RUNBOOK.md) |
| 10 Kas 22:49 [15:49Z] (was 14:00) | H-08c | WS-1 T09 | H-08d, S3b | OPEN (block below; RUNBOOK spikes/s3/RUNBOOK.md) |
| 11 Kas 00:19 [10 Kas 17:19Z] (was 10 Kas 15:30) | H-08d | WS-1 T09 | H-08e, S3c + B5 | OPEN (block below; RUNBOOK spikes/s3/RUNBOOK.md) |
| 11 Kas 02:49 [10 Kas 19:49Z] (was 10 Kas 18:00) | H-09 | WS-7 T03 | seller outreach | OPEN |
| 11 Kas 04:19 [10 Kas 21:19Z] (was 10 Kas 19:30) | H-08e | WS-1 T09 | spike account cleanup | OPEN (block below; RUNBOOK spikes/s3/RUNBOOK.md) |
| 11 Kas 05:49 [10 Kas 22:49Z] (was 10 Kas 21:00; = K0) | H-24 | WS-1 T11 | K0 (only if triggered) | N/A unless triggered |
| when triggered | H-25 | WS-1 T05 | WS1-T05 testnet faucet fallback | N/A (faucet worked 15:10, block below) |
| 11 Kas 12:00 [05:00Z] | H-07b | WS-1 T11 | H-12 (only if K0 picks Escrow) | N/A unless Escrow |
| 11 Kas 12:00 [05:00Z] | H-W6e | WS-6 T02 | WS6-T02 | DONE: B (KU-10) |
| 11 Kas 15:00 [08:00Z] | H-21 | WS-6 T04 | WS6-T05 | OPEN |
| 11 Kas 23:00 [16:00Z] | H-WS2-a | WS-2 T12b | reproducible build (only if Docker is down) | N/A unless triggered |
| when it appears | H-WS2-b | WS-2 | macOS Keychain prompt | N/A unless triggered |
| daily 13:00 and 21:00 [06:00Z / 14:00Z] | H-10 | WS-1 T14 | push | N/A as human step: agent pushes (K-02) |
| 12 Kas 10:00 [03:00Z] (latest 21:00 [14:00Z]) | H-13a | WS-5 T04 | `/sell` blob upload | OPEN |
| 12 Kas 12:00 [05:00Z] | H-01b | WS-1 T02 | H-12 mainnet secret | OPEN (money approved by the user 2026-11-10, DEC §K KU-06) |
| 12 Kas 18:10 [11:10Z] | H-11 | WS-1 T16 | freeze push; agent pushes (K-02) | N/A as human step: agent pushes (K-02) |
| 12 Kas 18:30-20:30 [11:30-13:30Z] | H-12 | WS-1 T17 | mainnet deploy, H-14 | OPEN |
| 12 Kas 19:30 [12:30Z] | H-W6a | WS-6 T05 | bench blob push (only if triggered) | N/A unless triggered |
| 12 Kas 21:00 [14:00Z] | H-13b | WS-5 T10 | hosted relay/sponsor routes | OPEN |
| 12 Kas 21:00-23:00 [14:00-16:00Z] | H-14 | WS-1 T18 + WS-4 T15 | K4 | OPEN |
| 13 Kas 10:30 [03:30Z] | H-09b | WS-7 T03 | outreach follow-up | OPEN |
| 13 Kas 12:30-13:30 [05:30-06:30Z] | H-15a | WS-5 | first browser purchase before H-15 | OPEN |
| 13 Kas 08:30 [01:30Z] | H-W3-2 | WS-3 T11b | WS3-T12 (only if triggered) | N/A unless triggered |
| 13-14 Kas (only if demand) | H-22 | WS-7 | seller concierge | N/A unless triggered |
| 13 Kas 19:00-23:00 [12:00-16:00Z] | H-15 | WS-1 T19 | K5 | OPEN |
| 14 Kas 06:30 [13 Kas 23:30Z] | H-W6c | WS-6 T08 | H-18 (only if precheck fails) | N/A unless triggered |
| 14 Kas 07:00-09:00 [00:00-02:00Z] | H-18 | WS-6 T08 | WS6-T07 | OPEN |
| 14 Kas 10:00-11:00 [03:00-04:00Z] (latest 14:00 [07:00Z]) | H-16 | WS-1 T20 | K6 lock | OPEN |
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

## H-01b · Mainnet NEAR AI key (doldurulabilir, kilitli secret için) · due 12 Kas 12:00 GMT+7 [05:00Z] · status: OPEN
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
If it fails: ödeme reddi → kripto ile tekrar; 12 Kas 18:00'e kadar olmazsa H-12 H-01a key'iyle yapılır ve trust table'a "mainnet inference key is NOT top-up-able" RISKY satırı girer (ajan yazar)
Result (human fills):

## H-02 · 10 NEAR + arrowhq.near · due 10 Kas 17:49 GMT+7 [10:49Z] (en geç 20:49 [13:49Z]) · status: OPEN
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
Result (human fills):

## H-03 · Base USDC + ETH to "Arrow Buyer" · due 10 Kas 17:49 GMT+7 [10:49Z] · status: OPEN
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
Result (human fills):

## H-04 · Phantom Solana address + USDC ATA · due 10 Kas 20:49 GMT+7 [13:49Z] · status: OPEN
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
Result (human fills):

## H-06 · Vercel login + project link (monorepo root) · due 10 Kas 20:49 GMT+7 [13:49Z] · status: OPEN
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

## H-07 · Mainnet hesapları + relayer FC key · due 10 Kas 21:19 GMT+7 [14:19Z] · status: OPEN
Purpose: Kontrat adı rezervi, v2 yedeği, relayer, spike (DEC D-02, D-04, D-06, D-07; PLAN §0.3-3).
Preconditions: H-02 DONE (arrowhq.near ≥ 9,5 NEAR). Ajan `npx tsx scripts/src/new-near-keypair.ts --env RELAYER_PRIVATE_KEY` koştu ve public key'i bastı (WS4-T08): <RELAYER_PK>. Para kararı (DEC K-06) kullanıcı tarafından onaylandı.
Run exactly:
    near account create-account fund-myself arrow-market.near '0.1 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
    near account create-account fund-myself arrow-market-v2.near '0.1 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
    near account create-account fund-myself arrow-relayer.arrowhq.near '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
    near account create-account fund-myself arrow-spike.arrowhq.near '1.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as arrowhq.near network-config mainnet sign-with-keychain send
    near account add-key arrow-relayer.arrowhq.near grant-function-call-access --allowance unlimited --contract-account-id intents.near --function-names execute_intents use-manually-provided-public-key <RELAYER_PK> network-config mainnet sign-with-keychain send
Expected: 4 hesap view-account-summary'de görünür. Ajan RPC ile relayer key'ini doğrular: FunctionCall, receiver intents.near, method execute_intents, allowance null.
Write result to: Result satırı (tx hash'leri).
If it fails: arrow-market.near alınmışsa → DEC D-02/D-07: arrow-market-v2.near ana kontrat olur, yedek `arrow-market-v3.near`; ajan allowlist'i (I-03) freeze'den önce günceller ve STATUS'a duyurur.
Result (human fills):

## H-05 · İlk push + repo public · due 10 Kas 18:49 GMT+7 [11:49Z] · status: OPEN (public step only; NOT approved, DEC K-03)
Purpose: S1-b ve freeze için public raw GitHub URL (DEC S-01, S-02); commit geçmişi süreç izi. DEC §K: push kısmı ajan işi (K-02) ve yapıldı; repoyu public yapmak insan işi ve kullanıcı henüz onaylamadı (K-03). Ajan beklemiyor: S1-b FastFS URL'siyle koşar, final wasm S-02 yedeğiyle (Vercel static, o da olmazsa FastFS) sabitlenir.
Preconditions (ajan çıktısı, 2026-11-10 15:07-15:08 GMT+7):
    - `bash scripts/secret-scan.sh` → `SECRET_SCAN: PASS` (raw S-04 grep 17 eşleşme, hepsi boş env adı ya da doküman satırı; strict kalıp yok; gitleaks "no leaks found", 3 commit).
    - Plan belgeleri takipte değil: `git ls-files | grep -E "KICKOFF|DECISIONS|PLAN|OPEN-QUESTIONS|^tasks/"` → boş (DEC S-01, W-17). The local maintainer notes file is gitignored.
    - Push DONE (ajan, K-02): `git push -u origin main` → `origin/main = 6c7b4d37` (42595fc bootstrap, aa012ce scaffold + fixtures v1, 6c7b4d3 ledger sync). `gh repo view yigitcangokmen/arrow --json visibility` → `PRIVATE`.
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

## H-08a · S4-a $2 inbound (1Click) · due 10 Kas 21:49 GMT+7 [14:49Z] (was 13:00) · status: OPEN (money approved by the user 2026-11-10, DEC §K KU-06)
Purpose: Base → NEAR Intents 0x hesabı gerçek akışı (S4-a). Script WS4-T05'in. Adımların tamamı `spikes/s3/RUNBOOK.md`'de (WS1-T09, main f8c4c94).
Preconditions: H-03 DONE (Arrow Buyer EOA Base'de ≥15 USDC + ≥0,0008 ETH). `npx tsx spikes/s4/s4a-inbound.ts --dry` → quote 200 (script WS4-T05 ile gelir; 2026-11-10 15:30'da main'de yok). Para kararı (DEC K-06) kullanıcı tarafından onaylandı.
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow && source ~/.nvm/nvm.sh && nvm use 24.15.0
    npx tsx spikes/s4/s4a-inbound.ts --amount 2
Expected: /v0/status SUCCESS < 120 sn; mt_balance_of(0x…, NEAR USDC) ≈ 1,99
Write result to: script evidence/mainnet.json'a yazar; Result satırına deposit adresi + SUCCESS süresi
If it fails: Arbitrum USDC origin (DEC G-06 yedeği); rate limit → JWT (DEC E-08)
Result (human fills):

## H-08b · S3a(ii) fonlu simulate · due 10 Kas 22:19 GMT+7 [15:19Z] (was 13:30) · status: OPEN
Purpose: Fonlu alıcı EOA ile imza + bakiye hatası olmadığını görmek.
Preconditions: H-08a DONE. `spikes/s3/s3a-simulate.ts` main'de (WS-4 ws/4-sdk 045f81b'de yazdı, fonsuz sonuç: yalnızca "insufficient balance"; entegrasyon turunda main'e girer).
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow
    npx tsx spikes/s3/s3a-simulate.ts --funded
Expected: class: OK (imza ve bakiye hatası yok)
Write result to: çıktının son 5 satırı → ajana
If it fails: ajan K-03 yedeğine geçer; H-08c bekler
Result (human fills):

## H-08c · Spike deploy + S3b notification/iade · due 10 Kas 22:49 GMT+7 [15:49Z] (was 14:00) · status: OPEN (money approved by the user 2026-11-10, DEC §K KU-06)
Purpose: mt_on_transfer → [amounts]/[0] → mt_resolve_transfer davranışını mainnet'te görmek (S3b).
Preconditions: H-07 DONE (arrow-spike.arrowhq.near ≥1,4 NEAR), H-08b PASS, `spikes/s3/spike-contract/target/near/spike.wasm` var (ajan ana checkout'ta build etti 2026-11-10 15:29, sha256 e8d455c905b91c24ac0561782ce6d31a73e3c14ee4e44401bc014940cc78f265; aynı wasm + `init-mainnet.json` testnet ikizinde deploy + view + yetkisiz çağrı reddi ile denendi). `spikes/s3/s3b-notify.ts` main'de (WS1-T09'un kalan parçası; WS4-T04 intent builder'ı main'e girince yazılır).
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow
    near contract deploy arrow-spike.arrowhq.near use-file spikes/s3/spike-contract/target/near/spike.wasm with-init-call new json-args "$(cat spikes/s3/init-mainnet.json)" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
    near contract call-function as-read-only arrow-spike.arrowhq.near last json-args '{}' network-config mainnet now
    npx tsx spikes/s3/s3b-notify.ts --mode refund_all
    npx tsx spikes/s3/s3b-notify.ts --mode keep
Expected: `last` → `""`. refund_all: log'da sender=0x… ve msg birebir, alıcı bakiyesi değişmedi. keep: alıcı −0,01, spike +0,01 (Intents içinde)
Write result to: script'ler evidence/mainnet.json'a yazar; Result satırına iki tx hash'i
If it fails: ajan PAYMENT_PATH=Escrow önerir (K0); H-08d yine koşulur (OutLayer bileşimi escrow'da da gerekli)
Result (human fills):

## H-08d · S3c OutLayer bileşimi + B5 negatif testi · due 11 Kas 00:19 GMT+7 [10 Kas 17:19Z] (was 10 Kas 15:30) · status: OPEN (money approved by the user 2026-11-10, DEC §K KU-06)
Purpose: Tek receipt ağacında Intents → spike → OutLayer → karar < 90 sn; başka hesap aynı secrets_ref ile secret alamıyor (B5). Testnet'te (S1-b) aynı erişim biçimi kabul edildi ve doğrudan çağrı "Access denied by access condition" ile reddedildi (spikes/GATES.md S1-b).
Preconditions: H-08c DONE. Alıcı Intents bakiyesi ≥0,05 USDC. `NEARAI_API_KEY` (H-01a) `.env`'de. `spikes/s3/s3c-outlayer.ts` main'de (WS4-T04 sonrası yazılır); `spikes/s3/s3c-b5-negative.ts` main'de (var).
Run exactly:
    cd ~/Desktop/hackathon/near-builds/arrow
    near account export-account arrow-spike.arrowhq.near using-private-key network-config mainnet    # private key ekrana gelir, kimseyle paylaşma
    outlayer login                        # "Account ID:" → arrow-spike.arrowhq.near · "Private key (ed25519:...):" → yukarıdaki private key
    outlayer whoami                       # arrow-spike.arrowhq.near (mainnet)
    set -a; source .env; set +a
    outlayer secrets set "$(jq -cn --arg k "$NEARAI_API_KEY" '{NEARAI_API_KEY:$k}')" --profile arrow --wasm-hash $(cat spikes/s1/release/sha256.txt) --generate PROTECTED_MASTER:hex32 --access allow-all --via arrow-spike.arrowhq.near --build $(cat spikes/s1/release/sha256.txt)
    npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer
    npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer_refund
    npx tsx spikes/s3/s3c-b5-negative.ts --prepare        # bastığı komutu aynen koş (arrowhq.near imzalı, 0,02 NEAR depozito, çoğu iade)
    npx tsx spikes/s3/s3c-b5-negative.ts --read <tx_hash>
    outlayer secrets delete --profile arrow --wasm-hash $(cat spikes/s1/release/sha256.txt)
    outlayer logout
Expected: (1) outlayer: keep, outlayer_refund: iade; ikisi de < 90 sn. (2) B5: PASS (pm null ya da null). (3) attestation 200 (api.outlayer.ai)
Write result to: script'ler evidence/mainnet.json'a yazar; Result satırına tx'ler
If it fails: (1) gas/süre → escrow (DEC H-15) + min_gas 400 / execute_intents 900 Tgas denemesi (DEC H-11). (2) B5 düşer → WASM allowlist birincil, trust table satırı. (3) arayüz hatası (deserialize) → ajan kaynak koddaki 7 parametreli imzayla karşılaştırır (DEC V-11). Mainnet OutLayer testnet FastFS URL'sini reddederse: login'liyken `outlayer upload spikes/s1/release/spike-tee.wasm` (mainnet FastFS), sonra `set_wasm` (komut RUNBOOK H-08d'de) ve iki s3c satırı tekrar.
Result (human fills):

## H-08e · Spike temizliği · due 11 Kas 04:19 GMT+7 [10 Kas 21:19Z] (was 10 Kas 19:30) · status: OPEN
Purpose: ~1,4 NEAR'ı geri almak (DEC D-06).
Preconditions: H-08c/d sonuçları ajan tarafından okundu (WS1-T10 DONE).
Run exactly:
    near contract call-function as-transaction intents.near mt_transfer json-args '{"receiver_id":"arrowhq.near","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"<spike bakiyesi, ajan söyler>"}' prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as arrow-spike.arrowhq.near network-config mainnet sign-with-keychain send
    near account delete-account arrow-spike.arrowhq.near beneficiary arrowhq.near network-config mainnet sign-with-keychain send
    near account view-account-summary arrow-spike.arrowhq.near network-config mainnet now
Expected: son komut "does not exist" (UNKNOWN_ACCOUNT); arrowhq.near ~+1,4 NEAR
Write result to: Result satırı (iki tx)
If it fails: DeleteAccountWithLargeState görülmez (state küçük); başka hata → ajana yapıştır
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
