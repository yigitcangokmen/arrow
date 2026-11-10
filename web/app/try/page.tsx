import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import form from "../../components/form.module.css";
import { criteria, evidence } from "../../generated/data.ts";
import { CONTRACTS } from "../../lib/config.ts";
import { sellerConfig } from "../../lib/server/config.ts";
import { programHashBand, type TryCriteria } from "../../lib/try/tryFlow.ts";
import { TryFlow } from "./TryFlow.tsx";
import styles from "./try.module.css";

const SCENES: { id: TryCriteria; label: string }[] = [
  { id: "demo-buy", label: "Wallet labels (BUY scene)" },
  { id: "demo", label: "Unlock schedule (PASS scene)" },
  { id: "print-row-1", label: "Print-row-1 attack (verdict only)" },
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
      <h1>Try it free on testnet</h1>
      <p className={styles.lead}>
        One tab, no wallet, no funds: a throwaway testnet account lists a synthetic file, inspects it, buys it and decrypts it, and the
        page checks that the file you open is the file that was inspected.
      </p>
      <div className={form.band} role="note">{programHashBand(cfg?.programWasmHash ?? null, mainnetHash)}</div>
      <ul className={styles.scenes} aria-label="Scenes">
        {SCENES.map((s) => (
          <li key={s.id}>
            {s.id === chosen ? <span className={styles.current}>{s.label}</span> : <Link href={`/try?criteria=${s.id}`}>{s.label}</Link>}
          </li>
        ))}
      </ul>
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
    </div>
  );
}
