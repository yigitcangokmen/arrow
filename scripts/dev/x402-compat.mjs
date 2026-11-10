// V-13 re-check: does the official @x402/core accept our 402 body? Run it from a scratch directory that has
// @x402/core installed (it is not a repo dependency). Usage: node x402-compat.mjs body.json
import { readFileSync } from "node:fs";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { PaymentRequiredV2Schema } from "@x402/core/schemas";

const body = JSON.parse(readFileSync(process.argv[2], "utf8"));
const schema = PaymentRequiredV2Schema.safeParse(body);
console.log(`v2schema ok: ${schema.success}${schema.success ? "" : ` (${schema.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join(", ")})`}`);
try {
  const header = Buffer.from(JSON.stringify(body)).toString("base64");
  decodePaymentRequiredHeader(header);
  console.log("header decode ok: true");
} catch (e) {
  console.log(`header decode ok: false (${e.message})`);
}
