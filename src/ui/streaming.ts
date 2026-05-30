export type Speed = 'slow' | 'normal' | 'fast' | 'off';

interface SpeedProfile {
  charDelay: number; // ms between ticks
  charsPerTick: number;
  diffLineDelay: number; // ms between diff lines
}

const PROFILES: Record<Speed, SpeedProfile> = {
  slow: { charDelay: 55, charsPerTick: 2, diffLineDelay: 120 },
  normal: { charDelay: 38, charsPerTick: 3, diffLineDelay: 90 },
  fast: { charDelay: 18, charsPerTick: 5, diffLineDelay: 45 },
  off: { charDelay: 0, charsPerTick: 9999, diffLineDelay: 0 },
};

let currentSpeed: Speed = 'normal';

// Epoch-based cancellation: bumping the epoch aborts any in-flight animation
// at its next tick (used for the instant boss-mode switch).
let epoch = 0;
export function bumpEpoch() {
  epoch++;
}
export function epochNow() {
  return epoch;
}

export function setSpeed(s: string) {
  if (s === 'slow' || s === 'normal' || s === 'fast' || s === 'off') currentSpeed = s;
}

export function profile(): SpeedProfile {
  return PROFILES[currentSpeed];
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/** Stream text into an element char-by-char. Calls onTick after each batch (for autoscroll). */
export async function typeInto(el: HTMLElement, text: string, onTick?: () => void): Promise<void> {
  const myEpoch = epoch;
  const p = profile();
  if (p.charDelay === 0) {
    el.textContent = (el.textContent ?? '') + text;
    onTick?.();
    return;
  }
  let i = 0;
  while (i < text.length) {
    if (epoch !== myEpoch) return;
    const next = text.slice(i, i + p.charsPerTick);
    el.textContent = (el.textContent ?? '') + next;
    i += p.charsPerTick;
    onTick?.();
    await sleep(p.charDelay);
  }
}

/** Reveal diff/log lines one at a time. `render(line)` should append a DOM node. */
export async function revealLines<T>(items: T[], render: (item: T) => void, onTick?: () => void): Promise<void> {
  const myEpoch = epoch;
  const p = profile();
  for (const item of items) {
    if (epoch !== myEpoch) return;
    render(item);
    onTick?.();
    await sleep(p.diffLineDelay);
  }
}
