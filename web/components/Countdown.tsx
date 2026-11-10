"use client";
import { useEffect, useState } from "react";

/** Seconds elapsed since `startedAt` (ms epoch), shown as "47 s". Eval waits take about 45-120 s. */
export function Countdown({ startedAt, label = "waiting" }: { startedAt: number; label?: string }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span role="status" className="mono">
      {label} {Math.max(0, Math.floor((now - startedAt) / 1000))} s
    </span>
  );
}
