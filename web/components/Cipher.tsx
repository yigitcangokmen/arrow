"use client";
import { useEffect, useRef } from "react";

/** A small seeded generator, so the same picture is drawn on every render and redraw. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = "0123456789abcdef";

/**
 * A picture of ciphertext: rows of hex noise drawn on a 2-D canvas. It is not page text and it never resolves into data.
 * Redrawn on resize and when the theme changes, never animated.
 */
export function Cipher({ lines = 8, seed = 7, className }: { lines?: number; seed?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cs = getComputedStyle(canvas);
      ctx.font = `500 11px ${cs.getPropertyValue("--font-mono") || "monospace"}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = cs.color;
      const next = rng(seed);
      const step = height / lines;
      const cols = Math.ceil(width / 6.8);
      for (let i = 0; i < lines; i++) {
        let row = "";
        for (let c = 0; c < cols; c++) row += (c % 5 === 4 ? " " : HEX[Math.floor(next() * 16)]);
        ctx.globalAlpha = i % 2 ? 0.85 : 0.5;
        ctx.fillText(row, 0, i * step + 2);
      }
      ctx.globalAlpha = 1;
    };
    draw();
    // On a cold load Geist Mono may arrive after the first draw: draw once more when the fonts are in.
    let alive = true;
    void document.fonts?.ready.then(() => alive && draw());
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => {
      alive = false;
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener("change", draw);
    };
  }, [lines, seed]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
