/**
 * Client-side logic for the vigilant-attention (reaction-time) task.
 * Mirrors backend/app/analysis/pvt.py so the participant sees an immediate summary;
 * the backend re-scores the raw trials and its result is authoritative.
 * Inspired by NASA's Psychomotor Vigilance Test; NOT the validated NASA PVT instrument.
 */
export const ANTICIPATION_MS = 100;
export const LAPSE_MS = 500;

export type PvtMode = "demo" | "standard";
export const PVT_MODES: Record<PvtMode, { durationS: number; isiMin: number; isiMax: number; timeout: number; minValid: number; label: string }> = {
  demo: { durationS: 60, isiMin: 2000, isiMax: 5000, timeout: 3000, minValid: 8, label: "Quick (1 min)" },
  standard: { durationS: 180, isiMin: 2000, isiMax: 7000, timeout: 3000, minValid: 20, label: "Assessment (3 min)" },
};

export interface PvtTrial {
  kind: "response" | "false_start" | "miss";
  t_ms: number;
  rt_ms?: number;
}

export interface PvtSummary {
  n_stimuli: number;
  n_valid_responses: number;
  false_starts: number;
  misses: number;
  lapses: number;
  median_rt_ms: number | null;
  rt_iqr_ms: number | null;
  mean_rt_ms: number | null;
  status: "valid" | "invalid" | "incomplete";
  reasons: string[];
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated percentile matching numpy's default. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function scorePvt(trials: PvtTrial[], mode: PvtMode, interrupted = false, completed = true): PvtSummary {
  const cfg = PVT_MODES[mode];
  const rts: number[] = [];
  let falseStarts = 0;
  let anticipations = 0;
  let misses = 0;
  for (const t of trials) {
    if (t.kind === "response" && typeof t.rt_ms === "number" && Number.isFinite(t.rt_ms) && t.rt_ms >= 0) {
      if (t.rt_ms < ANTICIPATION_MS) anticipations++;
      else rts.push(t.rt_ms);
    } else if (t.kind === "false_start") falseStarts++;
    else if (t.kind === "miss") misses++;
  }
  const totalFalse = falseStarts + anticipations;
  const nStim = rts.length + anticipations + misses;
  const q1 = percentile(rts, 25);
  const q3 = percentile(rts, 75);
  const reasons: string[] = [];
  let status: PvtSummary["status"] = "valid";
  if (interrupted) {
    status = "invalid";
    reasons.push("Assessment was interrupted; timing cannot be trusted.");
  }
  if (!completed && status === "valid") {
    status = "incomplete";
    reasons.push("Assessment did not run to completion.");
  }
  if (rts.length < cfg.minValid) {
    if (status === "valid") status = "invalid";
    reasons.push(`Only ${rts.length} valid responses; at least ${cfg.minValid} are required.`);
  }
  const denom = nStim + falseStarts;
  if (denom && totalFalse / denom > 0.25) {
    if (status === "valid") status = "invalid";
    reasons.push("Too many premature responses.");
  }
  if (nStim && misses / nStim > 0.34) {
    if (status === "valid") status = "invalid";
    reasons.push("Too many stimuli without a response.");
  }
  const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    n_stimuli: nStim,
    n_valid_responses: rts.length,
    false_starts: totalFalse,
    misses,
    lapses: rts.filter((r) => r >= LAPSE_MS).length,
    median_rt_ms: r1(median(rts)),
    rt_iqr_ms: q1 !== null && q3 !== null ? r1(q3 - q1) : null,
    mean_rt_ms: rts.length ? r1(rts.reduce((a, b) => a + b, 0) / rts.length) : null,
    status,
    reasons,
  };
}

/** Random inter-stimulus interval; injectable RNG for tests. */
export function nextIsi(mode: PvtMode, rand: () => number = Math.random): number {
  const c = PVT_MODES[mode];
  return c.isiMin + rand() * (c.isiMax - c.isiMin);
}

/**
 * Keypress gate: decides what a Space press means given the task state.
 * - repeat events (key held down) never count
 * - a press while no stimulus is visible is a false start
 * - only the first press after a stimulus counts as a response
 */
export type PressOutcome = "ignored" | "false_start" | "response";
export function classifyPress(opts: { repeat: boolean; stimulusVisible: boolean; alreadyResponded: boolean; keyIsDown: boolean }): PressOutcome {
  if (opts.repeat || opts.keyIsDown) return "ignored";
  if (!opts.stimulusVisible) return "false_start";
  if (opts.alreadyResponded) return "ignored";
  return "response";
}
