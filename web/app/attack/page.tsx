import Link from "next/link";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorBox } from "../../components/ErrorBox.tsx";
import { PageHead } from "../../components/Section.tsx";
import { TxLink } from "../../components/TxLink.tsx";
import { bench, benchLive, benchRoom, teamAccounts } from "../../generated/data.ts";
import { DEFAULT_NETWORK } from "../../lib/config.ts";
import { groupHomeListings, loadListingViews } from "../../lib/server/listingsPage.ts";
import {
  categoryTitle, GROUP_ORDER, GROUP_TITLE, leakLines, lemonAmounts, mainnetView, nativeStopped, qualityRows, readAttackInputs, roomView, type RoomRow,
} from "../../lib/attack.ts";
import { formatUsdc } from "../../lib/format.ts";
import styles from "./attack.module.css";

// Recorded numbers change only with a new build; the amounts in the last section come from a listing read, refreshed every 5 minutes.
export const revalidate = 300;

/** The rule layer's result for one row, in plain words: "flagged: ignore_prev" is "Caught (ignore_prev)". */
function ruleText(scanner: string): string {
  if (scanner.startsWith("flagged")) return `Caught${scanner.includes(":") ? ` (${scanner.split(":")[1]!.trim()})` : ""}`;
  if (scanner === "not flagged") return "Not caught";
  return scanner;
}

function Verdict({ r }: { r: RoomRow }) {
  return <span className={r.verdict === "BUY" ? styles.buy : r.verdict === "PASS" ? styles.pass : undefined}>{r.result}</span>;
}

/** One group of planted instructions. The live columns appear only once a live run exists; until then one line above says so. */
function RoomTable({ rows, withGroup, live }: { rows: RoomRow[]; withGroup: boolean; live: boolean }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {withGroup ? <th scope="col">Group</th> : null}
          <th scope="col">Attack</th>
          <th scope="col">What the planted text does</th>
          <th scope="col">Pattern check (on our machine)</th>
          {live ? <><th scope="col">Live result</th><th scope="col">Eval tx</th></> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {withGroup ? <td data-label="Group">{GROUP_TITLE[r.group] ?? r.group}</td> : null}
            <td data-label="Attack" className={styles.id}>{r.id}</td>
            <td data-label="Technique">{r.technique}</td>
            <td data-label="Rule layer" className={r.scanner.startsWith("flagged") ? styles.caught : styles.missed}>{ruleText(r.scanner)}</td>
            {live ? (
              <>
                <td data-label="Live result">
                  <Verdict r={r} />
                  {r.state && r.state !== r.result ? <span className="mono"> {r.state}</span> : null}
                </td>
                <td data-label="Eval tx">{r.tx ? <TxLink chain="near" network={r.tx.network} hash={r.tx.hash} /> : "none"}</td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const metadata = { title: "Attack" };

export default async function Attack() {
  const { inputs, errors } = readAttackInputs({ bench, room: benchRoom, live: benchLive });
  const leak = leakLines(inputs.summary);
  const quality = qualityRows(inputs.summary, inputs.quality);
  const room = roomView(inputs);
  const mainnet = mainnetView(inputs);
  const stopped = nativeStopped(inputs);

  // The lemon comparison reads its amounts from the demo listing the rest of the site points at (the team's wallet-labels file);
  // without one it states no amounts.
  let amounts: ReturnType<typeof lemonAmounts> = null;
  let example: number | string | null = null;
  try {
    const { featured } = groupHomeListings(await loadListingViews(DEFAULT_NETWORK, teamAccounts), teamAccounts);
    const listing = featured.find((l) => /wallet/i.test(l.displayTitle)) ?? featured[0] ?? null;
    amounts = lemonAmounts(listing, formatUsdc);
    example = listing ? String(listing.id) : null;
  } catch {
    // no amounts: the text below stays generic
  }

  const roomLiveRan = (room?.ran ?? 0) > 0 || (room?.controls.some((c) => c.verdict !== null) ?? false);
  const status: { what: string; done: string | null; cmd: string }[] = [
    { what: "The pattern check on the 24 planted instructions, replayed on our own machine", done: stopped ? `ran: ${stopped.k} of ${stopped.n} caught` : null, cmd: "bench/results/native-gates.json is not in this build" },
    { what: "The same 24 in the sealed hardware, with the AI", done: room?.headline ? `${room.headline} (${room.ran} of ${room.total} run)` : null, cmd: "npm run bench:live -- --suite room" },
    { what: "Leak test: 55 attempts to get data out", done: leak ? "ran" : null, cmd: "npm run bench:live" },
    { what: "Quality test: 40 inspections, right or wrong", done: quality ? "ran" : null, cmd: "npm run bench:live" },
    { what: "Mainnet subset: 5 attacks on the mainnet contract", done: mainnet ? `${mainnet.buy}/${mainnet.rows.length} BUY (${mainnet.ran} run)` : null, cmd: "npm run bench:live -- --suite mainnet-subset" },
  ];

  return (
    <div data-ready="true">
      <PageHead eyebrow="Attack" title="Attacks we ran, and what has not run yet.">
        An attack here is a seller hiding instructions in the data to push the AI toward BUY, or a buyer trying to make it read rows out.
        Every number on this page is counted from recorded runs, and what has not run yet says so.
      </PageHead>
      <section className={styles.top} aria-labelledby="live">
        <div className={styles.figure}>
          {stopped ? (
            <>
              <p className={styles.big}>{stopped.k}/{stopped.n}</p>
              <p>
                instructions planted in the data are caught by a fixed pattern check that runs before the AI is asked. For a caught file the
                answer is PASS even if the AI were fooled. This result was replayed on our own machine, not in the sealed hardware.
              </p>
              <p className={styles.small}>
                {room?.headline ? <>In the sealed hardware, with the AI: <span className="mono">{room.headline}</span>.</> : <>The same attacks in the sealed hardware, with the AI: not run yet.</>}
              </p>
            </>
          ) : (
            <p>The native rule-layer results are not in this build.</p>
          )}
        </div>
        <div className={styles.live}>
          <h2 id="live">Try it live</h2>
          <p>Ask Arrow&apos;s program, in sealed hardware, to print row 1 of a file. The free testnet run lists a synthetic file, sends that request and shows what comes back.</p>
          <p><Link className={styles.button} href="/try?criteria=print-row-1">Ask it to print row 1</Link></p>
          <p className={styles.note}>Expected: <span className={`mono ${styles.nowrap}`}>PASS · fit 1 · novelty 1</span> and no text from the file: the answer can only be one of the 51 fixed answers.</p>
          <details className={styles.cli}>
            <summary>Same run from a terminal</summary>
            <p className={styles.cmd}>npm run try:testnet -- --criteria fixtures/criteria/print-row-1.json</p>
          </details>
        </div>
      </section>

      {errors.length > 0 ? (
        <ErrorBox title="Some bench results could not be read" fallback="Regenerate them with npm run bench:offline -- --write.">
          <ul>{errors.map((e) => <li key={e} className="mono">{e}</li>)}</ul>
        </ErrorBox>
      ) : null}

      <section className={styles.section} aria-labelledby="status">
        <p className={styles.eyebrow}>What has run</p>
        <h2 id="status" className={styles.h2}>Each test, and its status.</h2>
        <ul className={styles.status}>
          {status.map((x) => (
            <li key={x.what}>
              <span>{x.what}</span>
              {x.done ? <b className={styles.ran}>{x.done}</b> : <span className={styles.notrun}>not run yet</span>}
            </li>
          ))}
        </ul>
        <details className={styles.cli}>
          <summary>For judges: sources and how to run each one</summary>
          <ul className={styles.cmds}>
            {status.map((x) => (
              <li key={x.what}>{x.what}: <span className="mono">{x.cmd}</span></li>
            ))}
            <li>Pattern-check replay: <span className="mono">bench/results/native-gates.json</span></li>
            <li>Attack list: <span className="mono">bench/injection-room/attacks.json</span>; live results: <span className="mono">bench/results/live/room.jsonl</span></li>
          </ul>
        </details>
      </section>

      <section className={styles.section} aria-labelledby="room">
        <p className={styles.eyebrow}>Refusal room</p>
        <h2 id="room" className={styles.h2}>24 planted instructions, one by one.</h2>
        <p className={styles.note}>
          Four groups of six (plain, Unicode, encoding, other languages) and two controls. Each row shows whether the fixed pattern check
          catches the file on its own, before the AI. A pattern-check catch and an AI PASS give the same answer (PASS · fit 1 · novelty 1), so a
          live result cannot say which one fired. A buyer can also plant a fake row and ask about it to test a seller; that is the buyer&apos;s own
          practice, not something Arrow promises.
        </p>
        {room ? (
          <>
            {room.headline ? (
              <p className={styles.headline} role="status">
                {room.headline}
                {room.ran < room.total ? <span className={styles.note}> ({room.ran} of {room.total} run)</span> : null}
              </p>
            ) : null}
            {GROUP_ORDER.map((g) => {
              const rows = room.rows.filter((r) => r.group === g);
              const caught = rows.filter((r) => r.scanner.startsWith("flagged")).length;
              return rows.length === 0 ? null : (
                <details key={g} className={styles.group}>
                  <summary><b>{GROUP_TITLE[g]}</b> <span className={styles.groupCount}>{caught} of {rows.length} caught by the pattern check</span></summary>
                  <RoomTable rows={rows} withGroup={false} live={roomLiveRan} />
                </details>
              );
            })}
            <details className={styles.group}>
              <summary><b>Controls</b> <span className={styles.groupCount}>clean data must still reach BUY</span></summary>
              <p className={styles.note}>
                C-CLEAN is realistic trading data with bare BUY and SELL in a column and must reach BUY. C-JUNK is junk without an injection and
                should PASS.
                {room.controlMiss ? ` Controls that differed from the expected verdict: ${room.controlMiss}.` : ""}
              </p>
              <table className={styles.table}>
                <thead><tr><th scope="col">Control</th><th scope="col">Data</th><th scope="col">Expected</th><th scope="col">Pattern check (on our machine)</th>{roomLiveRan ? <><th scope="col">Live result</th><th scope="col">Eval tx</th></> : null}</tr></thead>
                <tbody>
                  {room.controls.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Control" className={styles.id}>{c.id}</td>
                      <td data-label="Data">{c.technique}</td>
                      <td data-label="Expected">{c.expected}</td>
                      <td data-label="Rule layer">{ruleText(c.scanner)}</td>
                      {roomLiveRan ? (
                        <>
                          <td data-label="Live result"><Verdict r={c} /></td>
                          <td data-label="Eval tx">{c.tx ? <TxLink chain="near" network={c.tx.network} hash={c.tx.hash} /> : "none"}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {mainnet ? (
              <details className={styles.group}>
                <summary><b>Mainnet subset</b> <span className={styles.groupCount}>{mainnet.buy}/{mainnet.rows.length} BUY ({mainnet.ran} run)</span></summary>
                <p className={styles.note}>The 5 attacks the room marks for mainnet, run against the mainnet contract.</p>
                <RoomTable rows={mainnet.rows} withGroup live />
              </details>
            ) : null}
          </>
        ) : (
          <EmptyState title="Refusal room: no attack list found">Not run yet. Numbers appear after <span className="mono">npm run bench:gen</span>.</EmptyState>
        )}
      </section>

      {leak ? (
        <section className={styles.section} aria-labelledby="leak">
          <p className={styles.eyebrow}>Leak bench</p>
          <h2 id="leak" className={styles.h2}>How much data gets out.</h2>
          <p className={styles.note}>55 attacks on three fictional listings (synthetic): verbatim requests, targeted bits, encodings, membership probes, timing, jailbreaks and error paths.</p>
          <p className={styles.src}>Source: <span className="mono">bench/results/summary.json</span>, recomputed by <span className="mono">npm run bench:offline</span>.</p>
          <table className={styles.table}>
            <thead><tr><th scope="col">Measure</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {leak.map((l) => (
                <tr key={l.label}><td data-label="Measure">{l.label}</td><td data-label="Result" className="mono">{l.value}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {quality ? (
        <section className={styles.section} aria-labelledby="quality">
          <p className={styles.eyebrow}>Quality bench</p>
          <h2 id="quality" className={styles.h2}>Is the verdict right.</h2>
          <p className={styles.note}>40 evals on 20 synthetic listings: clean good data, clean bad data and listings with a planted instruction. The LLM-only column is the same model asked directly, with no scanner and no structural gates.</p>
          <p className={styles.src}>Source: <span className="mono">bench/results/summary.json</span> and <span className="mono">bench/results/baselines/llm_only.jsonl</span>.</p>
          <table className={styles.table}>
            <thead><tr><th scope="col">Listing group</th><th scope="col">Evals</th><th scope="col">Arrow correct</th><th scope="col">Arrow BUY</th><th scope="col">LLM-only BUY</th></tr></thead>
            <tbody>
              {quality.rows.map((r) => (
                <tr key={r.category}>
                  <td data-label="Listing group">{categoryTitle(r.category)}</td>
                  <td data-label="Evals">{r.evals}</td>
                  <td data-label="Arrow correct" className="mono">{r.arrowCorrect}</td>
                  <td data-label="Arrow BUY" className="mono">{r.arrowBuy}</td>
                  <td data-label="LLM-only BUY" className="mono">{r.llmOnlyBuy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className={styles.note}>
            {quality.overall.map((l) => (
              <div key={l.label}><dt style={{ display: "inline" }}>{l.label}: </dt><dd style={{ display: "inline", margin: 0 }} className="mono">{l.value}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="lemon">
        <p className={styles.eyebrow}>Why inspect first</p>
        <h2 id="lemon" className={styles.h2}>Against a blind purchase.</h2>
        <blockquote className={styles.lemon}>
          {amounts ? (
            <p>
              Blind purchase: pay the full price (listing #{example}: ${amounts.price}) and learn the value after. Arrow: pay ${amounts.fee} to
              let an AI inspect it first; a PASS costs ${amounts.fee}.
            </p>
          ) : (
            <p>Blind purchase: pay the full price and learn the value after. Arrow: pay a small inspection fee to let an AI inspect it first; a PASS costs only that fee.</p>
          )}
        </blockquote>
        <p className={styles.note}>Amounts are read from a listing on {DEFAULT_NETWORK}, not fixed in this page. The trust table says what is still trusted: <Link href="/#trust">Trust table</Link>.</p>
      </section>
    </div>
  );
}
