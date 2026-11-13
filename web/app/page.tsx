import Link from "next/link";
import { ErrorBox } from "../components/ErrorBox.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ListingCard } from "../components/ListingCard.tsx";
import { HonestyLine, SectionHead } from "../components/Section.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { Stage } from "../components/Stage.tsx";
import { TrustBand } from "../components/TrustBand.tsx";
import { bench, benchLive, benchRoom, teamAccounts } from "../generated/data.ts";
import { nativeStopped, readAttackInputs } from "../lib/attack.ts";
import { CONTRACTS, parseNetwork } from "../lib/config.ts";
import { devState } from "../lib/devState.ts";
import { formatUsdc } from "../lib/format.ts";
import { RECORDED_EVAL, RECORDED_RUN_PATH, REPO_URL, shortHash, withNetwork } from "../lib/links.ts";
import { groupHomeListings, loadListingViews } from "../lib/server/listingsPage.ts";
import type { ListingView } from "../lib/server/listingsCache.ts";
import { lastSummary } from "../lib/server/verifyReport.ts";
import styles from "./page.module.css";

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ network?: string; state?: string }> }) {
  const sp = await searchParams;
  const net = parseNetwork(sp.network);
  const forced = devState(new URLSearchParams(sp.state ? { state: sp.state } : {}));

  let listings: ListingView[] = [];
  let failure: string | null = forced === "error" ? "Forced error state (development only)." : null;
  if (!failure && forced !== "loading" && forced !== "empty") {
    try {
      listings = await loadListingViews(net, teamAccounts);
    } catch (e) {
      failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
    }
  }
  const { featured, more } = groupHomeListings(listings, teamAccounts);
  // The example file in "Locked before upload" is the wallet-labels demo listing (the hero's example) when it can be read; otherwise its numbers are left out.
  const example = featured.find((l) => /wallet/i.test(l.displayTitle)) ?? null;
  const attack = readAttackInputs({ bench, room: benchRoom, live: benchLive }).inputs;
  const stopped = nativeStopped(attack);
  const liveRan = attack.summary !== null || attack.roomLive.length > 0;
  const verifyLine = lastSummary(net);
  const inspections = featured.reduce((n, l) => n + l.budget.evalsUsed, 0);

  return (
    <div data-ready="true" className={styles.home}>
      {/* 1. The stage: what it is, the three steps, and the one button. */}
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>A data market on NEAR</p>
          <h1 id="hero-title" className={styles.display}>Inspect before you pay.</h1>
          <p className={styles.heroLede}>
            Let an AI check a dataset before you buy it. You get <b>BUY</b> or <b>PASS</b>, not the rows.
          </p>
          <div className={styles.stageRow}>
            <div className={styles.stage}><Stage /></div>
            <div className={styles.cta}>
              <div className={styles.ctaRow}>
                <Link href="/try" className={styles.big}>Run the demo, free</Link>
                <Link href={RECORDED_RUN_PATH} className={styles.second}>Watch a recorded run</Link>
              </div>
              <p className={styles.caption}>
                <b>No wallet, nothing to install.</b> About 3 minutes on NEAR testnet with synthetic data. Every payment and listing leaves a
                transaction you can open. The recorded run replays, step by step, a run that finished.
              </p>
              <p className={styles.caption}><a href="#trust">Who sees what, and the limits →</a></p>
              <HonestyLine items={["NEAR testnet", "synthetic data", "test money only", "mainnet not deployed yet"]} />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Why it exists. */}
      <section className={styles.paradox} aria-label="Why inspect first">
        <div className={`${styles.wrap} ${styles.paradoxGrid}`}>
          <p className={styles.paradoxLeft}>
            In 1962 the economist Kenneth Arrow described why data is hard to sell: a buyer cannot judge it without seeing it, and once they have
            seen it they have little reason to pay.
          </p>
          <div className={styles.paradoxRight}>
            <p>
              <b>Arrow&apos;s answer: the buyer does not look.</b> For a small fee, an AI looks for them inside sealed hardware and returns a capped
              verdict. Then they decide.
            </p>
            <p className={styles.define}>
              <b>Sealed hardware</b> is a walled-off part of a computer chip, built so that even the machine&apos;s owner cannot read or change the
              program running inside, and so that the chip can sign a report of exactly which program ran.
            </p>
            <details className={styles.judge}>
              <summary>Technical detail</summary>
              <p>
                A trusted execution environment (TEE, also called an enclave). Arrow&apos;s program runs in an Intel TDX TEE on OutLayer&apos;s
                workers; NEAR AI runs its model in Intel TDX with NVIDIA confidential computing. The signed report is a TDX quote: /verify checks
                it in your browser, nothing on chain checks it, and the guarantee rests on Intel&apos;s hardware (trust rows <i>Evaluation</i> and{" "}
                <i>LLM</i>).
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* 3. How it works, for the judge. */}
      <section id="how" className={styles.section} aria-labelledby="how-title">
        <div className={styles.wrap}>
          <SectionHead eyebrow="Under the hood" title="Three things you can check." id="how-title">
            Each one has a transaction or a command behind it. The plain sentence comes first; open &ldquo;Technical detail&rdquo; for the exact
            mechanism.
          </SectionHead>
          <div className={styles.splits}>
            <article className={styles.split}>
              <div className={styles.txt}>
                <span className={styles.n}>Lock</span>
                <h3>Locked before upload.</h3>
                <p>The seller&apos;s browser encrypts the file before it leaves their computer. Arrow hosts only the sealed copy. Arrow&apos;s program hands the key to a buyer once they pay; the two exceptions are under Technical detail.</p>
                <details className={styles.judge}>
                  <summary>Technical detail</summary>
                  <p>
                    ECIES to the program key of a hash-pinned enclave program, held in OutLayer&apos;s keystore. Exceptions: the keystore&apos;s DAO can
                    export keys (trust row <i>OutLayer keystore DAO</i>), and a release published after its time window is refunded while its key,
                    sealed to the buyer, is public (trust row <i>Time guard</i>). The served JavaScript handles the file while it encrypts, so for
                    sensitive data use the CLI.
                  </p>
                </details>
              </div>
              <div className={styles.mock}>
                <div className={styles.widget}>
                  <div className={styles.fileChip}>
                    <span className={styles.ico}><LockIcon /></span>
                    <span><b>wallet-labels-1000.csv</b><span>{example ? `${Number(example.rows_claimed).toLocaleString("en-US")} rows · ${example.columns.length} columns · ` : ""}encrypted in your browser</span></span>
                  </div>
                  <hr />
                  <dl className={styles.kv}>
                    {example ? <div><dt>Fingerprint on chain</dt><dd title={example.blob_sha256}>{shortHash(example.blob_sha256)}</dd></div> : null}
                    {example ? <div><dt>Inspect · buy</dt><dd>${formatUsdc(example.eval_fee)} · ${formatUsdc(example.price)}</dd></div> : null}
                    <div><dt>Label</dt><dd>synthetic</dd></div>
                  </dl>
                  {example ? <p className={styles.widgetCap}>from listing #{String(example.id)} on {net}</p> : null}
                </div>
              </div>
            </article>

            <article className={`${styles.split} ${styles.flip}`}>
              <div className={styles.txt}>
                <span className={styles.n}>Verdict</span>
                <h3>A verdict, not the rows.</h3>
                <p>Arrow&apos;s program, in sealed hardware, sends a 40-row sample and whole-file totals to an AI that runs in its own sealed hardware and compares them with what you asked for. You get BUY or PASS and, if the seller allows scores, a fit score and a novelty score from 1 to 5.</p>
                <details className={styles.judge}>
                  <summary>Technical detail</summary>
                  <p>
                    Intel TDX enclave on OutLayer; NEAR AI&apos;s TEE model, fixed endpoint and model, temperature 0; schema output of at most 51 states
                    (5.67 bits). The 40-row sample leaves the TDX enclave for NEAR AI over TLS, not end-to-end encrypted, and the model attestation
                    on /verify shows the endpoint&apos;s current state, not its state at each inspection.
                    The LLM cannot produce BUY unless the structural gates pass; novelty is computed by code.
                  </p>
                </details>
              </div>
              <div className={styles.mock}>
                <div className={styles.widget}>
                  <p className={styles.k}>What you learn (example)</p>
                  <p className={styles.verdict}><span className={styles.buy}>BUY</span> <small>· fit 5 · novelty 4</small></p>
                  <hr />
                  <dl className={styles.kv}>
                    <div><dt>Possible answers</dt><dd>51</dd></div>
                    <div><dt>Rows shown to you</dt><dd>0</dd></div>
                    <div><dt>If the run fails</dt><dd>2 more outcomes</dd></div>
                  </dl>
                  <hr />
                  <dl className={styles.kv}>
                    <div><dt>Also public</dt><dd>run time, work done</dd></div>
                  </dl>
                  <p className={styles.widgetCap}>51 answers is under 6 bits, about six yes/no answers. The public run time and work done can hint at the data; see the limits below.</p>
                </div>
              </div>
            </article>

            <article className={styles.split}>
              <div className={styles.txt}>
                <span className={styles.n}>Fingerprint</span>
                <h3>Same file, every time.</h3>
                <p>The file&apos;s fingerprint is on chain from the moment it is listed. The sealed hardware reports the fingerprint of what it inspected and of what it delivered. If the delivered file differs, the purchase is refunded. Your browser checks the download too and warns you if it differs.</p>
                <details className={styles.judge}>
                  <summary>Technical detail</summary>
                  <p>
                    <code>listing.blob_sha256 == eval.h == release.h == sha256(downloaded blob)</code>. A release mismatch refunds the purchase with
                    reason <code>hash_mismatch</code>; an inspection of a swapped file stops and refunds as <code>not_ok</code>. The download check
                    runs in your browser after the purchase has settled, so it warns and does not refund. Shown on <Link href="/verify">/verify</Link> and
                    by <code>npm run verify</code>.
                  </p>
                </details>
              </div>
              <div className={styles.mock}>
                <div className={styles.widget}>
                  <p className={styles.k}>Fingerprint check</p>
                  <dl className={styles.kv}>
                    <div><dt>listed</dt><dd>{example ? shortHash(example.blob_sha256) : "on chain"}</dd></div>
                    <div><dt>inspected</dt><dd>must match</dd></div>
                    <div><dt>delivered</dt><dd>must match</dd></div>
                  </dl>
                  <dl className={styles.kv}>
                    <div><dt>If not</dt><dd>refund</dd></div>
                  </dl>
                  <hr />
                  <dl className={styles.kv}>
                    <div><dt>downloaded</dt><dd>checked in your browser</dd></div>
                    <div><dt>If not</dt><dd>warning, no refund</dd></div>
                  </dl>
                </div>
              </div>
            </article>
          </div>

          <div className={styles.rule}>
            <p>
              In the demo listings an inspection costs <span className="mono">$0.25</span> and a purchase <span className="mono">$2</span>. If the sealed hardware
              fails, a purchase comes back in full and an inspection comes back less Arrow&apos;s <span className="mono">10%</span> share of the fee. On mainnet
              it goes to your NEAR Intents balance, a USDC balance held for your wallet on NEAR; on testnet, to your test-token balance.
            </p>
            <Link href={withNetwork(`/verify/${RECORDED_EVAL}`, "testnet")}>See a recorded run, checked from the chain →</Link>
          </div>
        </div>
      </section>

      {/* 4. Who sees what: the dark band, the trust table under it. */}
      <TrustBand verifyLine={verifyLine?.line ?? null} />

      {/* 5. Listings. */}
      <section id="listings" className={styles.section} aria-labelledby="listings-title">
        <div className={styles.wrap}>
          <SectionHead eyebrow={`Listings on ${net}`} title={net === "testnet" ? "Two demo datasets." : `Listings on ${net}.`} id="listings-title">
            {net === "testnet" ? (
              <>
                Both are synthetic and made by the Arrow team. On testnet the buy page is read-only; the demo above runs the same path with a
                throwaway account. Contract <span className="mono">{CONTRACTS[net]}</span>.
              </>
            ) : (
              <>Contract <span className="mono">{CONTRACTS[net]}</span>.</>
            )}
          </SectionHead>
          {forced === "loading" ? (
            <div className={styles.grid}>
              <Skeleton height={220} />
              <Skeleton height={220} />
              <Skeleton height={220} />
            </div>
          ) : failure ? (
            <ErrorBox title={`Could not read the listings on ${net}`} fallback="Check the contract on the explorer, or try the other network with ?network=testnet or ?network=mainnet.">
              <p className="mono">{failure}</p>
            </ErrorBox>
          ) : listings.length === 0 ? (
            <EmptyState title={`No listings on ${net} yet.`}>
              <Link href={withNetwork("/sell", net)}>List a dataset</Link>
            </EmptyState>
          ) : (
            <>
              {featured.length > 0 ? (
                <div className={styles.grid}>
                  {featured.map((l) => (
                    <ListingCard key={String(l.id)} listing={l} network={net} team />
                  ))}
                </div>
              ) : null}
              {featured.length > 0 ? (
                <p className={styles.demand}>
                  Inspections so far on {featured.length === 1 ? "this listing" : `these ${featured.length} listings`}, read from the chain (refunded ones count too):{" "}
                  <span className="mono">{inspections}</span>.
                </p>
              ) : null}
              {more.length > 0 ? (
                <details className={styles.more} open={featured.length === 0}>
                  <summary>
                    <b>Older test listings ({more.length})</b>: made by the team&apos;s tests and by visitors&apos; demo runs; some were sealed to an earlier program and can no longer be inspected.
                  </summary>
                  <div className={styles.grid}>
                    {more.map((l) => (
                      <ListingCard key={String(l.id)} listing={l} network={net} />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* 6. Do not take our word for it. */}
      <section className={`${styles.section} ${styles.sunken}`} aria-labelledby="check-title">
        <div className={styles.wrap}>
          <SectionHead eyebrow="Check it yourself" title="Do not take our word for it." id="check-title" />
          <div className={styles.cols}>
            <div>
              <p className={styles.eyebrow}>Verify</p>
              <h3>Check the claims against the chain.</h3>
              {verifyLine ? <p className={`mono ${styles.proof}`}>{verifyLine.line} <span className={styles.asof}>as of {verifyLine.at}</span></p> : null}
              <p>The verify page runs the same code you can run yourself and labels each row PROVEN, NOT PROVEN or RISKY. NOT PROVEN never counts as passed.</p>
              <p><Link href={withNetwork("/verify", net)}>Open the verify page →</Link></p>
            </div>
            <div>
              <p className={styles.eyebrow}>Attack</p>
              <h3>Attacks we ran.</h3>
              {stopped ? (
                <p>
                  <span className="mono">{stopped.k} of {stopped.n}</span> instructions planted in the data to push the AI toward BUY are caught by a fixed
                  pattern check that runs before the AI, replayed on our own machine.{liveRan ? " The live results are on the attack page." : " The runs in sealed hardware have not happened yet; the page says so."}
                </p>
              ) : null}
              <p><Link href="/try?criteria=print-row-1">Ask it to print row 1 →</Link></p>
              <p><Link href="/attack">Open the attack room →</Link></p>
            </div>
            <div>
              <p className={styles.eyebrow}>Agents</p>
              <h3>Buyers can be programs.</h3>
              <p>
                A command-line tool; a tool server for AI assistants (MCP) with <code>inspect_before_buy</code> and <code>buy</code>; and for each
                listing a web address that always answers HTTP 402 (payment required) with how to inspect the listing and pay through NEAR
                Intents. It takes no payment itself and never returns the file.
              </p>
              <p>
                {REPO_URL ? (
                  <a href={`${REPO_URL}#for-agents-cli-mcp-http-402`} target="_blank" rel="noopener noreferrer">Read the agent guide<span className="sr-only"> (opens in a new tab)</span> →</a>
                ) : featured[0] ? (
                  <Link href={withNetwork(`/buy/${String(featured[0].id)}#agents`, net)}>See a listing&apos;s 402 endpoint →</Link>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
