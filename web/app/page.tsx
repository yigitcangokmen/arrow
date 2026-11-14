import Link from "next/link";
import { ArrowViews } from "@arrow/sdk/contract";
import { AttackGrid } from "../components/AttackGrid.tsx";
import { DecideTile } from "../components/DecideTile.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";
import { Fingerprints } from "../components/Fingerprints.tsx";
import { FlagGrid, FlagLegend } from "../components/FlagGrid.tsx";
import { ListingCard } from "../components/ListingCard.tsx";
import { Machine, type MachinePass } from "../components/Machine.tsx";
import { RefundPath } from "../components/RefundPath.tsx";
import { SightLegend, Sightlines } from "../components/Sightlines.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { bench, benchLive, benchRoom, evidence, teamAccounts } from "../generated/data.ts";
import { readAttackInputs } from "../lib/attack.ts";
import { CONTRACTS, parseNetwork } from "../lib/config.ts";
import { devState } from "../lib/devState.ts";
import { formatUsdc } from "../lib/format.ts";
import { agentCardPath, RECORDED_EVAL, RECORDED_REFUND, RECORDED_RUN, RECORDED_RUN_PATH, REPO_URL, shortHash, TRUST_PATH, txUrl, withNetwork } from "../lib/links.ts";
import { mainnetLockTx, recordedRefundTx, recordedRun } from "../lib/recorded.ts";
import { rpcBusy } from "../lib/rpcBusy.ts";
import { groupHomeListings, lastGoodListings, loadListingViews } from "../lib/server/listingsPage.ts";
import { ttlCache, type ListingView } from "../lib/server/listingsCache.ts";
import { lastSummary } from "../lib/server/verifyReport.ts";
import styles from "./page.module.css";

/**
 * The hero machine's two passes. Both are recorded inspections on arrow-market.near, mainnet, 14 Nov (evidence/mainnet.json, e2e
 * steps 4-5): eval #2 on the wallet-labels listing #2 (tx DuoZg5F6RUSrNMbRSZjS3Q7ABMwda2ZbWZkHrfcwhAfD) said BUY · fit 5/5 · novelty 4/5,
 * eval #1 on the unlock-schedule listing #1 (tx 9VzDbtdtvNX5XSYfGikAzxkiRF4cFNsJaTqWYpsntFcP) said PASS · fit 2/5 · novelty 1/5. Both were
 * paid with the public demo viewing key, so anyone can open the sealed verdicts on chain. The caption says so on the board and links to
 * the page that checks each one from the chain, which links its transaction.
 */
const PASSES: MachinePass[] = [
  { verdict: { word: "BUY", fit: 5, novelty: 4 }, caption: "recorded · mainnet eval #2", href: withNetwork("/verify/2", "mainnet"), fileName: "wallet-labels-1000.csv" },
  { verdict: { word: "PASS", fit: 2, novelty: 1 }, caption: "recorded · mainnet eval #1", href: withNetwork("/verify/1", "mainnet"), fileName: "unlock-schedule-412.csv" },
];

/** The recorded run's fingerprints as the chain holds them now (mainnet listing #2, eval #2, purchase #1); ten-minute cache. */
const recorded = ttlCache<ReturnType<typeof recordedRun>>(600_000, Date.now, 1, { failTtlMs: 60_000 });
async function recordedPrints() {
  try {
    return await recorded("run", async () => {
      const views = new ArrowViews("mainnet", CONTRACTS.mainnet);
      const [listing, ev, purchase] = await Promise.all([views.listing(RECORDED_RUN.listingId), views.eval(RECORDED_RUN.evalId), views.purchase(RECORDED_RUN.purchaseId)]);
      return recordedRun(evidence.mainnet, { listing, eval: ev, purchase });
    });
  } catch {
    return null;
  }
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ network?: string; state?: string }> }) {
  const sp = await searchParams;
  const net = parseNetwork(sp.network);
  const forced = devState(new URLSearchParams(sp.state ? { state: sp.state } : {}));

  let listings: ListingView[] = [];
  let failure: string | null = forced === "error" ? "Forced error state (development only)." : null;
  // While the public RPC is busy, the last listings this server read stand in, with the time they were read.
  let readAt: number | null = null;
  if (!failure && forced !== "loading" && forced !== "empty") {
    try {
      listings = await loadListingViews(net, teamAccounts);
    } catch (e) {
      failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
      const last = rpcBusy(failure) ? lastGoodListings(net) : null;
      if (last) {
        listings = last.views;
        readAt = last.at;
        failure = null;
      }
    }
  }
  const { featured, more } = groupHomeListings(listings, teamAccounts);
  const wallet = featured.find((l) => /wallet/i.test(l.displayTitle)) ?? null;
  const price = wallet ? `$${formatUsdc(wallet.price)}` : "$2";
  const attack = readAttackInputs({ bench, room: benchRoom, live: benchLive }).inputs;
  const native = attack.native;
  const caught = attack.room && native ? attack.room.attacks.map((a) => native[a.id]?.regex_flag === true) : null;
  const verifyLine = lastSummary(net);
  const inspections = featured.reduce((n, l) => n + l.budget.evalsUsed, 0);
  const refundTx = recordedRefundTx(evidence.mainnet);
  const lockTx = mainnetLockTx(evidence.mainnet);
  // The count comes from the last passing mainnet run of /verify in this server instance; before one has run, from the run of 14 Nov.
  const mainnetCheck = lastSummary("mainnet");
  const proven = mainnetCheck?.line.match(/\d+\/\d+ REQUIRED PROVEN/)?.[0];
  const agentPath = agentCardPath(wallet?.id, net);
  const run = await recordedPrints();
  const prints = run?.fingerprints ?? null;

  return (
    <div data-ready="true" className={styles.home}>
      {/* Hero: the machine tells the story; the buttons lead to the real run. */}
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.wrap}>
          {lockTx ? (
            <p className={styles.locked}>
              <b>Locked on mainnet: 0 access keys, not even ours.</b>{" "}
              <a href={txUrl("near", "mainnet", lockTx)} target="_blank" rel="noopener noreferrer">
                Lock tx {shortHash(lockTx)}<span className="sr-only"> (opens in a new tab)</span>
              </a>
              {" · "}
              <Link href={withNetwork("/verify", "mainnet")}>
                Verify it: {proven ? `${proven} (checked ${mainnetCheck!.at})` : "8/8 REQUIRED PROVEN on 14 Nov"}
              </Link>
            </p>
          ) : null}
          <div className={styles.heroRow}>
            <h1 id="hero-title" className={styles.display}>Inspect before <span className={styles.dim}>you pay.</span></h1>
            <div className={styles.heroSide}>
              <p className={styles.lede}>An AI checks a sample: <b>BUY</b> or <b>PASS</b>.</p>
              <div className={styles.ctaRow}>
                <Link href="/try" className={styles.primary}>Run the demo, free</Link>
                <Link href={RECORDED_RUN_PATH} className={styles.second}>Watch a recorded run</Link>
              </div>
            </div>
          </div>
          <div className={styles.machine}>
            <Machine
              mode="loop"
              label="How Arrow works: a sealed file, a 40-row sample that Arrow's program in sealed hardware sends to NEAR AI's model, a verdict, then buy or walk away. The verdicts shown are recorded mainnet inspections; hover or focus pauses the animation."
              fileName="wallet-labels-1000.csv"
              price={price}
              passes={PASSES}
            />
          </div>
        </div>
      </section>

      {/* 01 Decide */}
      <section className={styles.section} aria-labelledby="decide-title">
        <div className={styles.wrap}>
          <div className={styles.head}>
            <p className={styles.eyebrow} data-n="01">Decide</p>
            <h2 id="decide-title" className={styles.h2}>Pay after BUY, <span className={styles.dim}>or walk away.</span></h2>
            <p className={styles.sent}>Your browser unlocks the file and checks its fingerprint.</p>
          </div>
          <div className={styles.decideGrid}>
            <DecideTile fileName="wallet-labels-1000.csv" />
            <Fingerprints
              listed={prints?.listed ?? wallet?.blob_sha256 ?? null}
              inspected={prints?.inspected ?? null}
              delivered={prints?.delivered ?? null}
              href={withNetwork(`/verify/${RECORDED_EVAL}`, "mainnet")}
            />
          </div>
          <details className={styles.fold}>
            <summary>Technical detail</summary>
            <p>
              <code>listing.blob_sha256 == eval.h == release.h == sha256(downloaded blob)</code>. A release mismatch refunds the purchase with
              reason <code>hash_mismatch</code>; an inspection of a swapped file stops and refunds as <code>not_ok</code>. The download check
              runs in your browser after the purchase has settled, so it warns and does not refund. The fingerprints above are those of the
              recorded mainnet run (listing #{RECORDED_RUN.listingId}, eval #{RECORDED_RUN.evalId}, purchase #{RECORDED_RUN.purchaseId}) as the chain holds them now. Shown on{" "}
              <Link href="/verify">/verify</Link> and by <code>npm run verify</code>.
            </p>
          </details>
        </div>
      </section>

      {/* 02 Trust */}
      <section className={styles.section} aria-labelledby="trust-title">
        <div className={styles.wrap}>
          <div className={styles.head}>
            <p className={styles.eyebrow} data-n="02">Trust</p>
            <h2 id="trust-title" className={styles.h2}>Who sees what.</h2>
            <div className={styles.sentSide}>
              <SightLegend />
              <Link className={styles.inline} href={`${TRUST_PATH}#trust-table`}>Trust table →</Link>
            </div>
          </div>
          <Sightlines />
          <details className={styles.fold}>
            <summary>What is sealed hardware?</summary>
            <p>
              <b>Sealed hardware</b> is a walled-off part of a computer chip, built so that even the machine&apos;s owner cannot read or change the
              program running inside, and so that the chip can sign a report of exactly which program ran.
            </p>
            <details className={styles.fold}>
              <summary>Technical detail</summary>
              <p>
                A trusted execution environment (TEE, also called an enclave). Arrow&apos;s program runs in an Intel TDX TEE on OutLayer&apos;s
                workers; NEAR AI runs its model in Intel TDX with NVIDIA confidential computing. The signed report is a TDX quote: /verify checks
                it in your browser, nothing on chain checks it, and the guarantee rests on Intel&apos;s hardware (trust rows <i>Evaluation</i> and{" "}
                <i>LLM</i>). The 40-row sample and whole-file totals leave the TDX enclave for NEAR AI over TLS, not end-to-end encrypted; that
                NEAR AI keeps nothing is its own claim, and the model attestation on /verify shows the endpoint&apos;s current state, not its state
                at each inspection.
              </p>
              <p>
                The LLM cannot produce BUY unless the structural gates pass; novelty is computed by code. The program can write only one of 51
                fixed answers (BUY or PASS, fit 1-5, novelty 1-5), at most 5.67 bits on that output channel; a failed run adds two more outcomes
                on chain (an error output, or no output). Run time and work done are public and are not counted in that figure.
              </p>
              <p>
                The file key is sealed to Arrow&apos;s program and handed to a buyer who pays, with two exceptions: OutLayer&apos;s keystore DAO can
                export keys, and a key released after its time window is refunded while the key, sealed to the buyer, is public. The served
                JavaScript handles the file while it encrypts, so for sensitive data use the CLI.
              </p>
            </details>
          </details>
        </div>
      </section>

      {/* 03 Refunds */}
      <section className={`${styles.section} ${styles.sunken}`} aria-labelledby="refund-title">
        <div className={styles.wrap}>
          <div className={styles.head}>
            <p className={styles.eyebrow} data-n="03">Refunds</p>
            <h2 id="refund-title" className={styles.h2}>A failed run <span className={styles.dim}>pays you back.</span></h2>
            <p className={styles.sent}>A purchase comes back in full; an inspection comes back less Arrow&apos;s 10% share, to your Intents balance.</p>
          </div>
          <RefundPath paid={RECORDED_REFUND.paid} back={RECORDED_REFUND.back} txHref={refundTx ? txUrl("near", "mainnet", refundTx) : null} />
          <details className={styles.fold}>
            <summary>Full rule</summary>
            <p>
              In the demo listings an inspection costs <span className="mono">$0.25</span> and a purchase <span className="mono">$2</span>. If the
              sealed hardware fails, a purchase comes back in full and an inspection comes back less Arrow&apos;s <span className="mono">10%</span>{" "}
              share of the fee. It goes to your NEAR Intents balance, a USDC balance held for your wallet on NEAR. The money moves back
              through <code>intents.near</code>&apos;s own <code>mt_resolve_transfer</code>.
            </p>
            <p>
              The run drawn above is inspection #{RECORDED_REFUND.evalId} on mainnet, on listing #{RECORDED_REFUND.listingId}{" "}
              <bdi>{RECORDED_REFUND.title}</bdi>, whose file host is missing on purpose: the sealed hardware returned an error output
              (<code>not_ok</code>), {RECORDED_REFUND.back} of the {RECORDED_REFUND.paid} in USDC went back to the buyer&apos;s NEAR Intents
              balance and Arrow&apos;s treasury kept {RECORDED_REFUND.kept}.{" "}
              <Link href={withNetwork(`/verify/${RECORDED_REFUND.evalId}`, "mainnet")}>That run, checked from the chain →</Link>
            </p>
          </details>
        </div>
      </section>

      {/* 04 Listings */}
      <section id="listings" className={styles.section} aria-labelledby="listings-title">
        <div className={styles.wrap}>
          <div className={styles.head}>
            <p className={styles.eyebrow} data-n="04">Listings</p>
            <h2 id="listings-title" className={styles.h2}>
              {net === "testnet" ? <>Two demo <span className={styles.dim}>datasets.</span></> : <>Listings on <span className={styles.dim}>{net}.</span></>}
            </h2>
            {featured.length > 0 ? (
              <p className={styles.sent}>
                Inspected <b className="mono">{inspections}</b> {inspections === 1 ? "time" : "times"}, read from the chain.
              </p>
            ) : (
              <p className={styles.sent}>Contract <span className="mono">{CONTRACTS[net]}</span>.</p>
            )}
          </div>
          {forced === "loading" ? (
            <div className={styles.grid}>
              <Skeleton height={180} />
              <Skeleton height={180} />
            </div>
          ) : failure && rpcBusy(failure) ? (
            <EmptyState title={`NEAR ${net} is busy right now.`}>
              <p>The listings are back in a minute. Meanwhile: <Link href={RECORDED_RUN_PATH}>watch a recorded run</Link>.</p>
            </EmptyState>
          ) : failure && /CodeDoesNotExist|does not exist/i.test(failure) ? (
            <EmptyState title={`No market on ${net} yet.`}>
              <p>The demo listings live on testnet: <Link href={withNetwork("/", "testnet")}>see them</Link>.</p>
            </EmptyState>
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
                    <ListingCard key={String(l.id)} listing={l} network={net} team compact />
                  ))}
                </div>
              ) : null}
              {readAt !== null ? (
                <p className={styles.stale} role="status">
                  Last read from the chain at {new Date(readAt).toISOString().slice(11, 16)} UTC; NEAR {net} is busy right now.
                </p>
              ) : null}
              {more.length > 0 ? (
                <details className={styles.fold} open={featured.length === 0}>
                  <summary>Older listings ({more.length})</summary>
                  <p>Made by the team&apos;s tests and by visitors&apos; demo runs; some were sealed to an earlier program and can no longer be inspected.</p>
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

      {/* 05 Check */}
      <section className={`${styles.section} ${styles.sunken}`} aria-labelledby="check-title">
        <div className={styles.wrap}>
          <div className={styles.head}>
            <p className={styles.eyebrow} data-n="05">Check</p>
            <h2 id="check-title" className={styles.h2}>Check it <span className={styles.dim}>yourself.</span></h2>
          </div>
          <div className={styles.tiles}>
            <Link href={withNetwork("/verify", net)} className={styles.tile} title={verifyLine ? `${verifyLine.line} (as of ${verifyLine.at})` : undefined}>
              <span className={styles.tileK}>Verify <Arrow /></span>
              <span className={styles.tileBig}>Every known risk, listed.</span>
              <span className={styles.tileVis}>
                <FlagGrid />
                <FlagLegend />
              </span>
            </Link>
            <Link href="/attack" className={styles.tile}>
              <span className={styles.tileK}>Attack <Arrow /></span>
              {caught ? (
                <>
                  <span className={styles.tileBig}><span className="mono">{caught.filter(Boolean).length}/{caught.length}</span> tricks caught</span>
                  <span className={styles.tileVis}>
                    <AttackGrid caught={caught} />
                    <span className={styles.tileCap}>offline replay · pattern check</span>
                  </span>
                </>
              ) : (
                <span className={styles.tileBig}>Attacks we ran.</span>
              )}
            </Link>
            <a
              href={REPO_URL ? `${REPO_URL}#for-agents-cli-mcp-http-402` : featured[0] ? withNetwork(`/buy/${String(featured[0].id)}#agents`, net) : "#agents"}
              className={styles.tile}
              {...(REPO_URL ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <span className={styles.tileK}>Agents <Arrow /></span>
              <span className={styles.tileBig}>Agents buy too.</span>
              {/* the listing's real 402 answer (web/app/api/x402), shortened */}
              <code className={styles.term}>
                <span><i>GET</i> {agentPath}</span>
                <span><b>402</b> inspect before you pay</span>
              </code>
            </a>
          </div>
          <details id="agents" className={styles.fold}>
            <summary>For agents</summary>
            <p>
              A command-line tool; a tool server for AI assistants (MCP) with <code>inspect_before_buy</code> and <code>buy</code>; and for each
              listing a web address that always answers HTTP 402 (payment required) with how to inspect the listing and pay through NEAR
              Intents. It takes no payment itself and never returns the file.
            </p>
          </details>
        </div>
      </section>

      {/* Closing band: the one next step */}
      <section className={styles.cta} aria-labelledby="cta-title">
        <div className={styles.wrap}>
          <div className={styles.ctaPanel}>
            <h2 id="cta-title" className={styles.h2}>Now <span className={styles.dim}>try it.</span></h2>
            <Link href="/try" className={styles.primary}>Run the demo, free</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
