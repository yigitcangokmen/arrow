# Seller invite text (draft, nothing sent)

Placeholders are `{{UPPER_SNAKE}}`. `{{NAME}}` is the project or person name; `{{THEIR_DATA}}` is at most 8 words taken from the "why they fit" column of `targets.md` (for Tune Up: "one of your research reports"); `{{THEIR_DATA_SHORT}}` is at most 30 characters; `{{HANDLE}}` is the X handle without the @. Limits: A and B at most 120 words once filled (the fixed text of B is 108 words, so `{{NAME}}` plus `{{THEIR_DATA}}` together may use at most 12 words), R and RB at most 280 weighted characters (URL counts 23). The rates (90% of inspection fees, 98% of sales) must equal the contract config. Do not name the model or the NEAR AI service in any variant.

## A: DM or public e-mail, repo public
> Hi {{NAME}}, I'm building Arrow at NEAR HACKATHON (an independent project, no code shared with yours). Buyers inspect data before paying: you encrypt the file in your browser, the buyer's AI reads it inside a TEE enclave, and a capped verdict comes back (BUY/PASS, two 1-5 scores if you allow). You keep 90% of every inspection fee and 98% of every sale, in USDC, withdrawable to Solana. MetaMask is enough, no NEAR account. Mainnet listings open Nov 13, 03:00 UTC, on /sell or with `npm run arrow -- list` (CSV, JSONL or Markdown, up to 5 MB). Would you list {{THEIR_DATA}}? Repo: https://github.com/yigitcangokmen/arrow

## B: DM or public e-mail, repo still private
> Hi {{NAME}}, I'm building Arrow at NEAR HACKATHON (an independent project, no code shared with yours). Buyers inspect data before paying: you encrypt the file in your browser, the buyer's AI reads it inside a TEE enclave, and a capped verdict comes back (BUY/PASS, two 1-5 scores if you allow). You keep 90% of every inspection fee and 98% of every sale, in USDC, withdrawable to Solana. MetaMask is enough, no NEAR account. Mainnet listings open Nov 13, 03:00 UTC, on /sell or with `npm run arrow -- list` (CSV, JSONL or Markdown, up to 5 MB). Would you list {{THEIR_DATA}}? Reply and I'll send the link on Nov 13.

## R: X reply, repo public
> @{{HANDLE}} Building Arrow at NEAR HACKATHON: a buyer's AI inspects your data in a TEE before paying, and a capped verdict comes back. You keep 98% of sales, 90% of inspection fees. Would you list {{THEIR_DATA_SHORT}}? Opens Nov 13. https://github.com/yigitcangokmen/arrow

## RB: X reply, repo still private
> @{{HANDLE}} Building Arrow at NEAR HACKATHON: a buyer's AI inspects your data in a TEE before paying, and a capped verdict comes back. You keep 98% of sales, 90% of inspection fees. Would you list {{THEIR_DATA_SHORT}}? Opens Nov 13, reply for details.

## Rules for writing a message
- Say it is an independent project and that no code is shared.
- Do not use absolute-privacy wording, "first" claims or "we never see your file", and do not say a refund goes to a wallet: it goes to the buyer's NEAR Intents balance. The file is encrypted in the browser; only the enclave sees plain text, and a 40-row sample goes to a TEE-hosted model (trust table in the repo).
- The seller never sends the file to us.
