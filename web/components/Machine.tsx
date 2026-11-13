"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Cipher } from "./Cipher.tsx";
import PixelTransition from "./reactbits/PixelTransition.tsx";
import SplitFlapText from "./reactbits/SplitFlapText.tsx";
import Stepper, { Step } from "./reactbits/Stepper.tsx";
import styles from "./Machine.module.css";

/** 0 reset · 1 Lock · 2 Sample · 3 Verdict · 4 Decide */
export type MachinePhase = 0 | 1 | 2 | 3 | 4;
export interface MachineVerdict {
  word: "BUY" | "PASS";
  fit?: number;
  novelty?: number;
}
export interface MachinePass {
  verdict: MachineVerdict;
  /** Where the verdict comes from, e.g. "eval #14". */
  caption: string;
  /** The page that checks this verdict from the chain; the caption links to it. */
  href?: string;
  /** The file this pass inspected, when it differs from the machine's `fileName`. */
  fileName?: string;
}

const RAIL = ["Lock", "Sample", "Verdict", "Decide"] as const;

function LockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Tick() {
  return (
    <svg className={styles.tick} aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

class Stop extends Error {}
/** The machine left the screen (or the tab was hidden) in the middle of a pass. */
class Away extends Error {}

/** What a blank board shows: flap glyphs, never an empty or grey tile. */
const IDLE = { word: "····", score: "·" };
/** Scores are 1-5, so a flip never passes through an impossible value. */
const SCORE_GLYPHS = "12345";

/**
 * The product in one picture: a sealed file, a 40-row sample checked in sealed hardware, a split-flap verdict, then buy or walk
 * away. One `data-phase` attribute drives the CSS.
 *
 * - `loop` (home): opens on the first pass's final frame (no-JS, reduced motion and screenshots show a real verdict), holds it, then
 *   plays the other passes and the first one again, each from Lock to Decide, only while in view and while the tab is visible, and
 *   rests on the first pass's final frame. Leaving the screen mid-pass jumps that pass to its final frame, never to a blank board.
 * - `live` (/try) and `replay` (/try/recorded): the page drives `phase`, `verdict` and `caption` from a real run or its recording.
 */
export function Machine(props: {
  mode: "loop" | "live" | "replay";
  label: string;
  fileName: string;
  /** Shown on the Buy button, e.g. "$2". */
  price?: string;
  passes?: MachinePass[];
  phase?: MachinePhase;
  verdict?: MachineVerdict | null;
  caption?: string;
  /** Shows the four-step rail under the machine (the home page); /try and /try/recorded draw their own seven-step rail. */
  rail?: boolean;
  /** live/replay: when set, the file card dissolves into this face (the file the buyer decrypted). */
  unlocked?: ReactNode | null;
  /** live/replay: which choice the run made. The loop derives it from the verdict. */
  decided?: "buy" | "walk" | null;
}) {
  const { mode, passes = [], rail = mode === "loop" } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const [frame, setFrame] = useState<{ phase: MachinePhase; pass: number; instant: boolean }>({ phase: 4, pass: 0, instant: true });

  // The loop: in view and tab visible only; stops for good once it has shown every pass, or when a rail step is clicked.
  useEffect(() => {
    const root = rootRef.current;
    if (mode !== "loop" || !root || passes.length === 0 || reducedMotion()) return;
    let cancelled = false;
    let inView = false;
    let started = false;
    // A pointer over the machine or keyboard focus inside it pauses the loop where it is (WCAG 2.2.2), so a focused link never
    // moves or unmounts under the user.
    let held = false;
    let wake: (() => void) | null = null;
    const visible = () => inView && !document.hidden;
    const ready = () => visible() && !held;
    const poke = () => {
      if ((ready() || cancelled || (held && !visible())) && wake) {
        const w = wake;
        wake = null;
        w();
      }
    };
    const waitReady = async () => {
      while (!ready()) {
        if (cancelled) throw new Stop();
        await new Promise<void>((r) => (wake = r));
        if (cancelled) throw new Stop();
      }
    };
    const sleep = async (ms: number) => {
      let left = ms;
      while (left > 0) {
        if (cancelled) throw new Stop();
        if (!visible()) throw new Away();
        if (held) {
          await new Promise<void>((r) => (wake = r));
          continue;
        }
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, Math.min(left, 250)));
        if (cancelled) throw new Stop();
        left -= performance.now() - t0;
      }
    };
    const show = async (phase: MachinePhase, pass: number, ms: number, instant = false) => {
      setFrame({ phase, pass, instant });
      await sleep(ms);
    };
    // The first frame is pass 0's verdict; hold it, then play the other passes and pass 0 again, each from the start.
    const order = [...passes.keys()].slice(1).concat(0);
    const run = async () => {
      try {
        try {
          await sleep(2600);
        } catch (e) {
          if (!(e instanceof Away)) throw e;
          await waitReady();
        }
        for (const p of order) {
          try {
            await show(0, p, 600, true);
            await show(1, p, 1500);
            await show(2, p, 3100);
            await show(3, p, 1800);
            await show(4, p, 3200);
          } catch (e) {
            if (!(e instanceof Away)) throw e;
            setFrame({ phase: 4, pass: p, instant: true });
            await waitReady();
          }
        }
        setFrame({ phase: 4, pass: 0, instant: true });
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = !!entry?.isIntersecting;
        if (inView && !started) {
          started = true;
          void run();
        }
        poke();
      },
      { threshold: 0.35 },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", poke);
    const hold = () => {
      held = root.matches(":hover") || root.contains(document.activeElement);
      poke();
    };
    const holdEvents = ["pointerenter", "pointerleave", "focusin", "focusout"] as const;
    // focusout fires before the next element has focus: read it after the event.
    const later = () => setTimeout(hold, 0);
    for (const ev of holdEvents) root.addEventListener(ev, ev === "focusout" ? later : hold);
    const stop = () => {
      cancelled = true;
      poke();
    };
    stopRef.current = stop;
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", poke);
      for (const ev of holdEvents) root.removeEventListener(ev, ev === "focusout" ? later : hold);
    };
  }, [mode, passes.length]);

  const phase: MachinePhase = mode === "loop" ? frame.phase : (props.phase ?? 0);
  const instant = mode === "loop" ? frame.instant : false;
  const current = mode === "loop" ? passes[frame.pass] : undefined;
  const verdict = mode === "loop" ? (current?.verdict ?? null) : (props.verdict ?? null);
  // In the loop the caption names the recording from the first frame of every pass, so the machine never looks like live activity,
  // and its link stays mounted while the loop runs (a focused link that unmounts drops keyboard focus to <body>).
  const caption = mode === "loop" ? current?.caption : props.caption;
  const captionHref = mode === "loop" ? current?.href : undefined;
  const shown = phase >= 3 && verdict ? verdict : null;
  // A new pass mounts fresh flaps, so the board clears to blank at once instead of flipping through random letters on the way out;
  // within a pass the flaps flip from blank to the verdict.
  const flapKey = mode === "loop" ? `pass-${frame.pass}` : "run";
  const fileName = (mode === "loop" ? current?.fileName : undefined) ?? props.fileName;
  const decided = mode === "loop" ? (phase === 4 && verdict ? (verdict.word === "BUY" ? "buy" : "walk") : null) : (props.decided ?? null);

  // The sample chip flies from the file into the sealed box when the Sample phase starts.
  useEffect(() => {
    const chip = chipRef.current;
    const stage = stageRef.current;
    const file = fileRef.current;
    const box = boxRef.current;
    if (!chip || !stage || !file || !box) return;
    if (phase !== 2 || instant || reducedMotion()) {
      chip.style.opacity = "0";
      return;
    }
    const s = stage.getBoundingClientRect();
    const f = file.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;
    const x0 = f.left - s.left + f.width / 2 - w / 2;
    const y0 = f.top - s.top + f.height / 2 - h / 2;
    const x1 = b.left - s.left + b.width / 2 - w / 2;
    const y1 = b.top - s.top + b.height / 2 - h / 2;
    chip.style.transition = "none";
    chip.style.left = `${x0}px`;
    chip.style.top = `${y0}px`;
    chip.style.transform = "translate(0, 0)";
    chip.style.opacity = "1";
    void chip.offsetWidth;
    chip.style.transition = "";
    chip.style.transform = `translate(${x1 - x0}px, ${y1 - y0}px)`;
    const t = setTimeout(() => (chip.style.opacity = "0"), 1250);
    return () => clearTimeout(t);
  }, [phase, instant]);

  const jump = (step: number) => {
    stopRef.current();
    setFrame((f) => ({ phase: step as MachinePhase, pass: f.pass, instant: true }));
  };

  const cipherFace = (
    <div className={styles.face}>
      <div className={styles.fileHead}>
        <span className={styles.fileName}><FileIcon /><span className={styles.fileText}>{fileName}</span></span>
        <span className={styles.tag}>synthetic</span>
      </div>
      <div className={styles.rowsWrap}>
        <Cipher className={styles.rows} lines={8} seed={14} />
        <span className={styles.lock}><LockIcon size={22} /></span>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={styles.machine}
      data-phase={phase}
      data-instant={instant ? "" : undefined}
      data-verdict={verdict?.word}
      data-decided={decided ?? undefined}
      role="group"
      aria-label={props.label}
    >
      <div ref={stageRef} className={styles.stage}>
        <div ref={fileRef} className={`${styles.card} ${styles.file}`}>
          {mode !== "loop" ? (
            <PixelTransition
              className={styles.pix}
              aspectRatio="auto"
              firstContent={cipherFace}
              secondContent={<div className={styles.face}>{props.unlocked}</div>}
              active={!!props.unlocked}
              trigger="hover"
              focusable={false}
              gridSize={14}
              pixelColor="var(--pix)"
              animationStepDuration={0.35}
            />
          ) : (
            cipherFace
          )}
        </div>
        <span className={styles.wire} data-on={phase === 2 ? "" : undefined} aria-hidden="true" />
        <div ref={boxRef} className={styles.box}>
          <div className={styles.boxHead}>
            <span className={styles.seal}><LockIcon size={13} />sealed</span>
            <span className={styles.ai} title="The 40-row sample goes from Arrow's program to NEAR AI's model, in its own sealed hardware, over TLS">NEAR AI · 40 rows</span>
          </div>
          <div className={styles.cells} aria-hidden="true">
            {Array.from({ length: 40 }, (_, i) => (
              <i key={i} style={{ ["--i" as string]: i }} />
            ))}
            <span className={styles.beam} />
          </div>
        </div>
        <span className={styles.wire} data-on={phase === 3 ? "" : undefined} aria-hidden="true" />
        <div className={`${styles.card} ${styles.verdict}`}>
          <SplitFlapText
            key={flapKey}
            className={styles.flap}
            text={shown ? shown.word : IDLE.word}
            srLabel={shown ? shown.word : "pending"}
            still={instant}
            padTo={4}
            intro={false}
            fontSize="var(--flap-size)"
            tileColor="var(--flap)"
            textColor={shown?.word === "BUY" ? "var(--flap-buy)" : "var(--flap-ink)"}
            flipDuration={0.11}
            stagger={0.07}
            flipsPerChar={5}
            charset="alpha"
            gap={5}
            tileRadius={7}
            style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
          />
          <div className={styles.scores}>
            <span className={styles.score} title="fit: how well the sample matches what the buyer asked for, 1 to 5">
              fit
              <SplitFlapText key={flapKey} text={shown?.fit ? String(shown.fit) : IDLE.score} srLabel={shown?.fit ? undefined : "pending"} still={instant} padTo={1} intro={false} fontSize={22} tileColor="var(--flap)" textColor="var(--flap-ink)" flipDuration={0.11} flipsPerChar={4} charset={SCORE_GLYPHS} gap={3} tileRadius={5} style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }} />
              <span className={styles.of} aria-hidden="true">/5</span>
            </span>
            <span className={styles.score} title="novelty: how much of the sample is new next to what the buyer already has, 1 to 5">
              novelty
              <SplitFlapText key={flapKey} text={shown?.novelty ? String(shown.novelty) : IDLE.score} srLabel={shown?.novelty ? undefined : "pending"} still={instant} padTo={1} intro={false} fontSize={22} tileColor="var(--flap)" textColor="var(--flap-ink)" flipDuration={0.11} flipsPerChar={4} charset={SCORE_GLYPHS} gap={3} tileRadius={5} style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }} />
              <span className={styles.of} aria-hidden="true">/5</span>
            </span>
          </div>
          <p className={styles.caption}>{caption && captionHref ? <Link href={captionHref}>{caption}</Link> : (caption ?? " ")}</p>
          <div className={styles.decide} aria-hidden="true">
            <span className={styles.buy}><Tick />Buy{props.price ? <small> {props.price}</small> : null}</span>
            <span className={styles.walk}><Tick />Walk away</span>
          </div>
        </div>
        <span ref={chipRef} className={styles.chip} aria-hidden="true" />
      </div>
      {rail ? (
        <div className={styles.rail}>
          <Stepper step={Math.max(1, phase)} label="Steps" onStepChange={mode === "loop" ? jump : undefined}>
            {RAIL.map((t) => (
              <Step key={t} title={t} />
            ))}
          </Stepper>
        </div>
      ) : null}
    </div>
  );
}
