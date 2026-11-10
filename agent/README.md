# agent/ (@arrow/agent)

The agent path, for buyers that are programs rather than people.
- CLI: `npm run arrow -- <list|eval|result|buy|status|decrypt|transfer> ...` (see `npm run arrow -- --help`). Run it through npm; the package has no bin entry.
- MCP server `arrow` over stdio, tools `inspect_before_buy`, `buy`, `get_listing`, `list_listings`, plus the free recovery tools `get_eval_result`, `get_purchase`, `decrypt_purchase` for a payment that settled after the wait ended (`@modelcontextprotocol/sdk` 1.32.2): `tsx agent/src/mcp.ts`.
  Spend guard: testnet by default; mainnet `inspect_before_buy` and `buy` need `ARROW_MCP_ALLOW_MAINNET=1`; `buy` and `decrypt_purchase` need `ARROW_MCP_ALLOW_BUY=1`; each payment is capped by `ARROW_MCP_MAX_USDC` (default 1.00) and the session by `ARROW_MCP_MAX_USDC_TOTAL` (default 5.00).
  Client config: `{"mcpServers":{"arrow":{"command":"node","args":["<repo>/node_modules/tsx/dist/cli.mjs","<repo>/agent/src/mcp.ts"],"env":{"ARROW_NETWORK":"testnet"}}}}` (run `npm ci` in the repo first). It runs the lockfile's tsx; a client starts the server outside the repo, where `npx` would fetch an unpinned one.

Demo purchase #1 is made from here with the public demo viewing key (`--demo-key`).
Add a `bin` entry to package.json only once the entry files exist; otherwise `npm ci` fails on missing bin targets.
