"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Sets `data-in` on its wrapper the first time it scrolls into view, so CSS can play a one-time draw. No loop, no timer. */
export function InView({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className} data-in={seen ? "" : undefined}>{children}</div>;
}
