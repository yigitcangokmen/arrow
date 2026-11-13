"use client";
import { useEffect, useRef, useState } from "react";
import { StepList, type Step } from "../../../components/StepList.tsx";
import { TxLink } from "../../../components/TxLink.tsx";
import form from "../../../components/form.module.css";
import type { ReplayStep } from "../../../lib/recorded.ts";
import styles from "./recorded.module.css";

/** Real seconds of the run per replayed second. */
const SPEED = 6;

/** Plays the recorded run step by step, faster than real time; the real times stay next to each step. */
export function Replay({ steps }: { steps: ReplayStep[] }) {
  // null: not started (every step shown, done); otherwise the real-run second the replay has reached.
  const [t, setT] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const end = Math.max(...steps.map((s) => s.at)) + 1;

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  function play() {
    if (timer.current) clearInterval(timer.current);
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setT(end);
      return;
    }
    const started = Date.now();
    const from = Math.min(...steps.map((s) => s.at)) - 1;
    setT(from);
    timer.current = setInterval(() => {
      const now = from + ((Date.now() - started) / 1000) * SPEED;
      if (now >= end) {
        setT(end);
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
      } else setT(now);
    }, 200);
  }

  const shown: Step[] = steps.map((s, i) => {
    const next = steps[i + 1];
    const state = t === null ? "done" : t < s.at ? "todo" : next && t < next.at && i > 0 ? "doing" : "done";
    // A step the replay has not reached yet keeps its outcome to itself.
    return { label: s.label, state, detail: state === "todo" ? undefined : [s.clock, s.detail].filter(Boolean).join(" · ") };
  });
  const playing = t !== null && t < end;
  const elapsed = t === null ? null : Math.max(0, Math.round(t));

  return (
    <div className={styles.replay}>
      <div className={styles.bar}>
        <button type="button" className={form.primary} onClick={play} disabled={playing}>
          {playing ? "Playing…" : t === null ? "Play the recorded run" : "Play it again"}
        </button>
        <p className={styles.speed}>
          {elapsed !== null && playing ? <span className="mono">+{elapsed} s of the real run · </span> : null}
          replayed {SPEED}× faster; the real times are next to each step
        </p>
      </div>
      <div aria-live="polite" className="sr-only">{playing ? "Replaying" : t !== null ? "Replay finished" : ""}</div>
      <StepList steps={shown} />
      <ul className={styles.txs} aria-label="Transactions of the recorded run">
        {steps.filter((s) => s.txHash).map((s) => (
          <li key={s.txHash}>{s.label.split(",")[0]}: <TxLink chain="near" network="testnet" hash={s.txHash!} /></li>
        ))}
      </ul>
    </div>
  );
}
