// Seeded PRNG for bench data generators (WS6 card 2.3). Same name -> same bytes, on every machine.
import { createHash } from "node:crypto";

export type Rng = {
  next: () => number; // [0, 1)
  int: (n: number) => number; // [0, n)
  pick: <T>(xs: readonly T[]) => T;
  shuffle: <T>(xs: T[]) => T[];
};

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function seedFrom(name: string): [number, number, number, number] {
  const h = createHash("sha256").update("arrow/bench/v1/" + name).digest();
  return [h.readUInt32BE(0), h.readUInt32BE(4), h.readUInt32BE(8), h.readUInt32BE(12)];
}

export function rngFor(name: string): Rng {
  const f = sfc32(...seedFrom(name));
  for (let i = 0; i < 15; i++) f();
  const int = (n: number) => Math.floor(f() * n);
  return {
    next: f,
    int,
    pick: (xs) => xs[int(xs.length)]!,
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [xs[i], xs[j]] = [xs[j]!, xs[i]!];
      }
      return xs;
    },
  };
}
