/**
 * Precision motor task helpers. Coordinates are normalized to the arena
 * (x: 0..1 across width, y: 0..1 down height); the arena has a fixed aspect ratio,
 * so resizing the window changes pixels but not measurements.
 */
export interface Pt { t_ms: number; x: number; y: number }
export interface Target { index: number; x: number; y: number; r: number }
export interface Layout { variant: number; aspect: number; target_radius: number; start: { x: number; y: number }; targets: Target[]; index_of_difficulty_bits: number[] }

export function normalize(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

/** Distance in arena-width units. */
export function dist(ax: number, ay: number, bx: number, by: number, aspect: number) {
  return Math.hypot(ax - bx, (ay - by) * aspect);
}

export function isHit(p: { x: number; y: number }, t: Target, aspect: number) {
  return dist(p.x, p.y, t.x, t.y, aspect) <= t.r;
}

export interface MotorPreview { targetsHit: number; misses: number; movementTimes: number[]; medianMt: number | null; completionMs: number | null; meanErrorPct: number | null }

export function previewMotor(layout: Layout, clicks: Pt[]): MotorPreview {
  let current = 0;
  let misses = 0;
  let prevT = 0;
  const mts: number[] = [];
  const errs: number[] = [];
  let last: number | null = null;
  for (const c of [...clicks].sort((a, b) => a.t_ms - b.t_ms)) {
    if (current >= layout.targets.length) break;
    const t = layout.targets[current];
    if (isHit(c, t, layout.aspect)) {
      mts.push(c.t_ms - prevT);
      errs.push(dist(c.x, c.y, t.x, t.y, layout.aspect));
      prevT = c.t_ms;
      last = c.t_ms;
      current++;
    } else misses++;
  }
  const s = [...mts].sort((a, b) => a - b);
  const med = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
  return {
    targetsHit: current,
    misses,
    movementTimes: mts,
    medianMt: med,
    completionMs: last,
    meanErrorPct: errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length) * 100 : null,
  };
}

/** Keep pointer samples at most every `minGapMs` to bound payload size. */
export function throttlePush(buf: Pt[], p: Pt, minGapMs = 16) {
  const last = buf[buf.length - 1];
  if (!last || p.t_ms - last.t_ms >= minGapMs) buf.push(p);
}
