# contracts/mock-outlayer

Sandbox-only stand-in for `outlayer.near.request_execution`, used to test red-team B3. Real OutLayer returns a successful `null` on failure or yield timeout, not a `PromiseError`.

Modes, selected by the input:
- `null`: resolve with `null`.
- `never`: never resume, so the yield times out after `fast_forward(201)`.
- `ok:<json>`: resolve with the given payload.

Not deployed anywhere.
