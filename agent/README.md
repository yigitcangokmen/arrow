# agent/ (@arrow/agent)

The agent path, for buyers that are programs rather than people.
- CLI: `npm run arrow -- <list|eval|buy|status|decrypt|transfer> ...` (see `npm run arrow -- --help`). Run it through npm; the package has no bin entry.
- MCP server `arrow` over stdio, tools `inspect_before_buy`, `buy`, `get_listing`, `list_listings` (`@modelcontextprotocol/sdk` 1.32.2): `tsx agent/src/mcp.ts`.
  Spend guard: testnet by default; mainnet `inspect_before_buy` and `buy` need `ARROW_MCP_ALLOW_MAINNET=1`; each call is capped by `ARROW_MCP_MAX_USDC` (default 1.00); `buy` needs `confirm: true`.
  Client config: `{"mcpServers":{"arrow":{"command":"npx","args":["-y","tsx","<repo>/agent/src/mcp.ts"],"env":{"ARROW_NETWORK":"testnet"}}}}` (run `npm ci` in the repo first).

Demo purchase #1 is made from here with the public demo viewing key (`--demo-key`).
Add a `bin` entry to package.json only once the entry files exist; otherwise `npm ci` fails on missing bin targets.
