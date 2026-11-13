import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { HonestyLine, PageHead } from "../../components/Section.tsx";
import { criteria, evidence } from "../../generated/data.ts";
import { CONTRACTS } from "../../lib/config.ts";
import { sellerConfig } from "../../lib/server/config.ts";
import { programHashBand, type TryCriteria } from "../../lib/try/tryFlow.ts";
import { TryFlow } from "./TryFlow.tsx";
import styles from "./try.module.css";

const SCENES: { id: TryCriteria; label: string; expect: string }[] = [
  { id: "demo-buy", label: "Wallet labels", expect: "expected BUY" },
  { id: "demo", label: "Unlock schedule", expect: "expected PASS" },
  { id: "print-row-1", label: "“Print row 1” attack", expect: "verdict only" },
];

const isScene = (v: string | undefined): v is TryCriteria => SCENES.some((s) => s.id === v);

export const metadata = { title: "Try on testnet" };

export default async function Try({ searchParams }: { searchParams: Promise<{ criteria?: string }> }) {
  const sp = await searchParams;
  const chosen: TryCriteria = isScene(sp.criteria) ? sp.criteria : "demo-buy";

  let cfg: Awaited<ReturnType<typeof sellerConfig>> | null = null;
  let failure: string | null = null;
  try {
    cfg = await sellerConfig(new ArrowViews("testnet", CONTRACTS.testnet));
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
      <PageHead eyebrow="The demo" title="Run it here.">
        One tab, no wallet, no funds: a throwaway testnet account lists a synthetic file, pays for an inspection, reads the verdict, buys the
        file and decrypts it. About 3 minutes.
      </PageHead>
      <HonestyLine items={["NEAR testnet", "synthetic data", "test money only", "mainnet not deployed yet"]} />
      <ul className={styles.scenes} aria-label="Scenes">
        {SCENES.map((s) => (
          <li key={s.id}>
            {s.id === chosen ? (
              <span className={`${styles.scene} ${styles.on}`} aria-current="true">{s.label} <small>· {s.expect}</small></span>
            ) : (
              <Link className={styles.scene} href={`/try?criteria=${s.id}`}>{s.label} <small>· {s.expect}</small></Link>
            )}
          </li>
        ))}
      </ul>
      {typeof (criteria[chosen] as { text?: unknown } | undefined)?.text === "string" ? (
        <p className={styles.criteria}>
          The demo buyer asks for: <b>&ldquo;{(criteria[chosen] as { text: string }).text}&rdquo;</b>
        </p>
      ) : null}
      {failure || !cfg || !cfg.programPk ? (
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
      <div className={styles.testnet} role="note">
        <p><b>This is testnet.</b> {programHashBand(cfg?.programWasmHash ?? null, mainnetHash)}</p>
        <p>
          A fresh demo listing costs 0.10 test USDC to inspect and 0.25 to buy, less than the $0.25 and $2 of the demo listings on the home page.
          The throwaway account&apos;s key lives only in this tab and the data is synthetic. <a href="/#trust">Who sees what →</a>
        </p>
      </div>
    </div>
  );
}
