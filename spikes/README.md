# spikes/

Throwaway code for the day-1 gates (KICKOFF.md §5). Fill in the gate log there.

- `s1/`: `spike-tee` (ai-example + PROTECTED_MASTER + env echo) and a spike contract on testnet.
- `s2/`: arrow-usd `ft_transfer_call` refund, plus sandbox null/timeout tests.
- `s3/`: mainnet stub on `arrow-spike.arrowhq.near`; S3a simulate, S3b execute, S3c OutLayer variant plus the B5 negative test.
- `s4/`: 1Click inbound script; ECIES / XChaCha / MinHash interop tests.

No keys are committed. Delete `arrow-spike.arrowhq.near` after S3 to recover its NEAR.
