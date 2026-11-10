import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { CONTRACTS, parseNetwork } from "../../lib/config.ts";
import { sellerConfig } from "../../lib/server/config.ts";
import { SellForm } from "./SellForm.tsx";
import styles from "./sell.module.css";
import form from "../../components/form.module.css";

export default async function Sell({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = parseNetwork((await searchParams).network);
  let cfg: Awaited<ReturnType<typeof sellerConfig>> | null = null;
  let failure: string | null = null;
  try {
    cfg = await sellerConfig(new ArrowViews(net, CONTRACTS[net]));
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }
  return (
    <div data-ready="true">
      <h1>Sell data</h1>
      <p className={styles.lead}>
        Your file is encrypted in this browser. Only the ciphertext is uploaded, and the key is sealed to the enclave&apos;s program
        key. You need an EVM wallet and 0.10 USDC on NEAR Intents for the listing bond; no NEAR account.
      </p>
      {net === "testnet" ? (
        <div className={form.band} role="note">
          Payments run on mainnet; use <Link href="/try">/try</Link> for the free testnet flow. This page is read-only on testnet.
        </div>
      ) : null}
      {failure || !cfg ? (
        <ErrorBox title={`Could not read the market contract on ${net}`} fallback="Reload in a minute, or use the CLI: npm run arrow -- list --help">
          <p className="mono">{failure}</p>
        </ErrorBox>
      ) : (
        <SellForm
          network={net}
          programPk={cfg.programPk}
          bond={cfg.bond}
          limits={cfg.limits}
          maxEvalsCap={cfg.maxEvalsCap}
          readOnly={net !== "mainnet"}
        />
      )}
    </div>
  );
}
