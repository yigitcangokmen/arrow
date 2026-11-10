# contracts/arrow-usd

Testnet-only NEP-141 (`arrow-usd.arrowhq.testnet`, 6 decimals like USDC). Built on near-contract-standards 5.30.1.

`mint(receiver_id, amount)` is public and capped per call. It lets `npm run try:testnet`, `bench:live` and the hosted `/try` page work without relying on `usdc.fakes.testnet`, which has no mint path (red-team §4.1).

Never deployed on mainnet.
