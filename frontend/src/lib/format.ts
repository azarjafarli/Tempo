import type { Category, Provenance } from "./types";

export const CATEGORY_STYLE: Record<Category, { label: string; cls: string; dot: string }> = {
  insufficient_data: { label: "Insufficient data", cls: "bg-panel2 text-dim border-line", dot: "bg-faint" },
  within_baseline: { label: "Within observed baseline variation", cls: "bg-jade-deep/60 text-jade border-jade/30", dot: "bg-jade" },
  change_worth_reviewing: { label: "Functional change worth reviewing", cls: "bg-amber-deep/70 text-amber border-amber/40", dot: "bg-amber" },
  invalid_measurement: { label: "Invalid or incomplete measurement", cls: "bg-rose-deep/70 text-rose border-rose/30", dot: "bg-rose" },
  baseline: { label: "Baseline session", cls: "bg-cyan-deep/50 text-cyan border-cyan/30", dot: "bg-cyan" },
};

export const PROVENANCE_STYLE: Record<Provenance, { label: string; short: string; cls: string }> = {
  nasa_public_data: { label: "NASA public data", short: "NASA data", cls: "text-cyan border-cyan/40 bg-cyan-deep/40" },
  local_measurement: { label: "Real local measurement", short: "Real · local", cls: "text-jade border-jade/40 bg-jade-deep/40" },
  synthetic: { label: "Synthetic demo data", short: "Synthetic", cls: "text-amber border-amber/40 bg-amber-deep/50" },
  published_reference: { label: "Published reference", short: "Reference", cls: "text-dim border-line bg-panel2" },
  hypothetical_scenario: { label: "Hypothetical scenario", short: "Hypothetical", cls: "text-[#c9a7ff] border-[#c9a7ff]/40 bg-[#2a1f45]/60" },
};

export function fmt(v: number | null | undefined, digits = 0, unit = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return unit ? `${s} ${unit}` : s;
}

export function signed(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;
}

export function hhmm(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hoursToHM(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function missionTime(t: number | null | undefined): string {
  if (t === null || t === undefined) return "—";
  if (t < 0) return `Pre-mission (D${Math.floor(t)})`;
  return `Day ${Math.floor(t)} · ${hhmm((t % 1) * 24)}`;
}

export function digitsFor(unit: string): number {
  if (unit === "ratio") return 3;
  if (unit.startsWith("%")) return 2;
  return 0;
}
