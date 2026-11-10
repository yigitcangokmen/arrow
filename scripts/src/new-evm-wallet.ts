// Generates an EVM test wallet and stores its key in .env only (WS4-T08, DEC D-09, D-04).
// Prints the address and nothing else that is secret. Refuses to overwrite an existing key.
import { parseArgs } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { appendTeamEvm } from "./lib/evidence.ts";
import { EnvKeyExistsError, setEnvSecret } from "./lib/env.ts";
import { log } from "./lib/log.ts";

const { values } = parseArgs({ options: { role: { type: "string" } } });
if (values.role !== "buyer" && values.role !== "seller") {
  console.error("usage: new-evm-wallet.ts --role buyer|seller");
  process.exit(2);
}
const role = values.role;
const envName = `E2E_${role.toUpperCase()}_EVM_PRIVATE_KEY`;

try {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  setEnvSecret(envName, pk);
  appendTeamEvm({ role, address: account.address.toLowerCase(), created_utc: new Date().toISOString() });
  log(`${role} address: ${account.address} (Base)`);
  log(`basescan: https://basescan.org/address/${account.address}`);
  log(`.env: ${envName} written (value hidden)`);
} catch (e) {
  if (e instanceof EnvKeyExistsError) {
    console.error(`${envName} already set; refusing to overwrite`);
    process.exit(1);
  }
  throw e;
}
