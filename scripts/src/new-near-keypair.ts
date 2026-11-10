// Generates an ed25519 NEAR key pair (WS4-T08). The private key goes to .env (--env NAME) or to a 0600 key file
// outside the repo (--out PATH --account ID). Only the public key is printed.
import { parseArgs } from "node:util";
import { KeyPair } from "near-api-js";
import { EnvKeyExistsError, setEnvSecret } from "./lib/env.ts";
import { writeLegacyCredential } from "./lib/keystore.ts";

const { values } = parseArgs({ options: { env: { type: "string" }, out: { type: "string" }, account: { type: "string" } } });
if (!values.env === !values.out || (values.out && !values.account)) {
  console.error("usage: new-near-keypair.ts --env NAME | --out PATH --account ID");
  process.exit(2);
}

try {
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  if (values.env) {
    setEnvSecret(values.env, kp.toString());
    console.log(`.env: ${values.env} written (value hidden)`);
  } else {
    writeLegacyCredential(values.out!, { account_id: values.account!, public_key: publicKey, private_key: kp.toString() });
    console.log(`key file: ${values.out} written (mode 0600, value hidden)`);
  }
  console.log(`public key: ${publicKey}`);
} catch (e) {
  if (e instanceof EnvKeyExistsError) {
    console.error(`${values.env} already set; refusing to overwrite`);
    process.exit(1);
  }
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
