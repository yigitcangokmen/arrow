import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { RefreshSoon } from "../../components/RefreshSoon.tsx";
import { criteria, evidence } from "../../generated/data.ts";
import { CONTRACTS } from "../../lib/config.ts";
import { RECORDED_RUN_PATH, TRUST_PATH } from "../../lib/links.ts";
import { rpcBusy } from "../../lib/rpcBusy.ts";
import { sellerConfig, type SellerConfig } from "../../lib/server/config.ts";
import { ttlCache } from "../../lib/server/listingsCache.ts";
import { programHashBand, type TryCriteria } from "../../lib/try/tryFlow.ts";
import { TryFlow } from "./TryFlow.tsx";
import styles from "./try.module.css";

const SCENES: { id: TryCriteria; label: string; expect: string | null }[] = [
  { id: "demo-buy", label: "Wallet labels", expect: "expected BUY" },
  { id: "demo", label: "Unlock schedule", expect: "expected PASS" },
  { id: "print-row-1", label: "“Print row 1” attack", expect: null },
];

const isScene = (v: string | undefined): v is TryCriteria => SCENES.some((s) => s.id === v);

export const metadata = { title: "Try on testnet" };

/**
 * The testnet market's config, cached for a minute (a failure for ten seconds). While the public RPC is busy the last good config
 * is used: it changes only when the contract is upgraded, and the run itself reads the chain again at every step.
 */
const configCache = ttlCache<SellerConfig>(60_000, Date.now, 1, { failTtlMs: 10_000 });
let lastConfig: SellerConfig | null = null;
async function testnetConfig(): Promise<SellerConfig> {
  try {
    lastConfig = await configCache("testnet", () => sellerConfig(new ArrowViews("testnet", CONTRACTS.testnet)));
    return lastConfig;
  } catch (e) {
    if (lastConfig && rpcBusy(e instanceof Error ? e.message : String(e))) return lastConfig;
    throw e;
  }
}

export default async function Try({ searchParams }: { searchParams: Promise<{ criteria?: string }> }) {
  const sp = await searchParams;
  const chosen: TryCriteria = isScene(sp.criteria) ? sp.criteria : "demo-buy";

  let cfg: Awaited<ReturnType<typeof sellerConfig>> | null = null;
  let failure: string | null = null;
  try {
    cfg = await testnetConfig();
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }
  let mainnetHash: string | null = null;
  if (cfg?.programWasmHash) {
    try {
      mainnetHash = (await sellerConfig(new ArrowViews("mainnet", CONTRACTS.mainnet))).programWasmHash;
    } catch {
      // mainnet is not deployed yet: the band says so
    }
  }

  return (
    <div data-ready="true">
      <div className={styles.head}>
        <p className={styles.eyebrow}>Demo · free</p>
        <h1 className={styles.h1}>Run it here.</h1>
        <p className={styles.lede}>
          We run every step for you on testnet, with a synthetic file and test money.
        </p>
      </div>
      <ul className={styles.scenes} aria-label="Scenes">
        {SCENES.map((s) => (
          <li key={s.id}>
            {s.id === chosen ? (
              <span className={`${styles.scene} ${styles.on}`} aria-current="true">{s.label}{s.expect ? <small> · {s.expect}</small> : null}</span>
            ) : (
              <Link className={styles.scene} href={`/try?criteria=${s.id}`}>{s.label}{s.expect ? <small> · {s.expect}</small> : null}</Link>
            )}
          </li>
        ))}
      </ul>
      {failure && rpcBusy(failure) ? (
        <div className={styles.busy} role="status">
          <RefreshSoon key={Date.now()} seconds={20} />
          <p className={styles.busyTitle}>Testnet RPC is busy, retrying.</p>
          <p>The public NEAR testnet endpoints are turning requests away for a moment. This page tries again every 20 seconds.</p>
          <p className={styles.busyActs}>
            <Link className={styles.save} href={RECORDED_RUN_PATH}>Watch a recorded run</Link>
            <span>or run it from a terminal: <code>npm run try:testnet</code></span>
          </p>
        </div>
      ) : failure || !cfg || !cfg.programPk ? (
        <ErrorBox title="The testnet market contract is not ready" fallback="Run the same flow from the terminal: npm run try:testnet">
          <p className="mono">{failure ?? "The testnet contract has not published its program key yet."}</p>
        </ErrorBox>
      ) : (
        <TryFlow
          scene={chosen}
          config={{ programPk: cfg.programPk, bond: cfg.bond, programWasmHash: cfg.programWasmHash }}
          evidence={evidence.testnet}
          criteria={criteria}
        />
      )}
      <div className={styles.folds}>
        {typeof (criteria[chosen] as { text?: unknown } | undefined)?.text === "string" ? (
          <details className={styles.fold}>
            <summary>The buyer&apos;s ask</summary>
            <p>
              The demo buyer asks for: <b>&ldquo;{(criteria[chosen] as { text: string }).text}&rdquo;</b>
            </p>
          </details>
        ) : null}
        <details className={styles.fold}>
          <summary>About this testnet run</summary>
          <p><b>This is testnet.</b> {programHashBand(cfg?.programWasmHash ?? null, mainnetHash)}</p>
          <p>
            A fresh demo listing costs 0.10 test USDC to inspect and 0.25 to buy, less than the $0.25 and $2 of the demo listings on the home page.
            The throwaway account&apos;s key lives only in this tab and the data is synthetic. <Link href={TRUST_PATH}>Who sees what →</Link>
          </p>
        </details>
      </div>
    </div>
  );
}
