import { Watch } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, chartTheme, cx, ProvenanceBadge } from "./ui";
import type { Provenance } from "../lib/types";

export interface SleepComponent { key: string; label: string; points: number; max: number; detail: string }
export interface ReadinessComponent { key: string; label: string; score?: number; level?: string; detail: string }
export interface WearableNight {
  date?: string;
  mission_day: number | null; asleep_min: number; deep_min: number; rem_min: number; hrv_ms: number; resting_hr: number; sleeping_hr: number;
  provenance: Provenance; device?: string;
  sleep: { score: number; band: string; components: SleepComponent[]; estimated?: boolean; basis?: string } | null;
  readiness: { score: number | null; band: string; components: ReadinessComponent[]; detail?: string; vendor_score?: boolean };
}
export interface WearableSummary {
  available: boolean; kind?: "device_daily"; latest: WearableNight | null; provenance: Provenance | null;
  series: { date?: string; mission_day: number | null; sleep_score: number | null; readiness: number | null; hrv_ms: number | null; resting_hr: number | null; asleep_h: number | null }[];
  method: { source_note: string; sleep_bands: string; readiness_bands: string; limits: string };
}

/** Colour by band: good bands in moss, middle bands in steel, low bands in international orange. */
export function bandTone(band: string | null | undefined): { text: string; stroke: string; bg: string } {
  switch (band) {
    case "Excellent": case "Good": case "High": return { text: "text-jade", stroke: chartTheme.jade, bg: "bg-jade" };
    case "Fair": case "Moderate": return { text: "text-cyan", stroke: chartTheme.cyan, bg: "bg-cyan" };
    case "Poor": case "Low": return { text: "text-amber", stroke: chartTheme.amber, bg: "bg-amber" };
    default: return { text: "text-faint", stroke: "#AEB6BC", bg: "bg-faint" };
  }
}

/** Three-quarter arc gauge, 0-100. */
export function Gauge({ value, band, size = 132, label }: { value: number | null; band: string; size?: number; label: string }) {
  const r = size / 2 - 9, c = size / 2;
  const start = 135, sweep = 270;
  const pt = (deg: number) => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from), [x2, y2] = pt(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const tone = bandTone(band);
  const v = value ?? 0;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value ?? "not available"} out of 100, ${band}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <path d={arc(start, start + sweep)} fill="none" stroke="#E3E7E2" strokeWidth={9} strokeLinecap="round" />
        {value != null && v > 0 && <path d={arc(start, start + (sweep * Math.min(100, v)) / 100)} fill="none" stroke={tone.stroke} strokeWidth={9} strokeLinecap="round" />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <div className="font-cond text-[40px] font-bold leading-none tnum text-ink">{value ?? "—"}</div>
        <div className={cx("mt-1 font-cond text-[15px] font-semibold", tone.text)}>{band}</div>
      </div>
    </div>
  );
}

function SleepBreakdown({ comps }: { comps: SleepComponent[] }) {
  return (
    <ul className="space-y-2.5">
      {comps.map((c) => (
        <li key={c.key}>
          <div className="flex items-baseline justify-between text-[13.5px]">
            <span className="text-ink">{c.label}</span>
            <span className="font-cond text-[15px] tnum"><strong className="font-semibold">{Math.round(c.points)}</strong><span className="text-faint"> of {c.max}</span></span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-panel2"><div className="h-1.5 rounded-full bg-ink" style={{ width: `${(c.points / c.max) * 100}%` }} /></div>
          <div className="mt-0.5 text-[12px] text-faint">{c.detail}</div>
        </li>
      ))}
    </ul>
  );
}

function ReadinessBreakdown({ comps, detail }: { comps: ReadinessComponent[]; detail?: string }) {
  if (!comps.length) return <p className="text-[13.5px] text-dim">{detail}</p>;
  return (
    <ul className="space-y-2.5">
      {comps.map((c) => {
        if (c.level !== undefined) return <LevelRow key={c.key} c={c} />;
        const score = c.score ?? 0;
        const tone = bandTone(score >= 70 ? "High" : score >= 40 ? "Moderate" : "Low");
        return (
          <li key={c.key}>
            <div className="flex items-baseline justify-between text-[13.5px]">
              <span className="text-ink">{c.label}</span>
              <span className="font-cond text-[15px] font-semibold tnum">{c.score}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-panel2"><div className={cx("h-1.5 rounded-full", tone.bg)} style={{ width: `${score}%` }} /></div>
            <div className="mt-0.5 text-[12px] text-faint">{c.detail}</div>
          </li>
        );
      })}
    </ul>
  );
}

const LEVELS = ["Very Low", "Low", "Medium", "High", "Very High"];

/** A vendor rating (Very low .. Very high) shown as a five-step scale. */
function LevelRow({ c }: { c: ReadinessComponent }) {
  const i = LEVELS.indexOf(c.level ?? "");
  const tone = bandTone(i >= 3 ? "High" : i === 2 ? "Moderate" : i >= 0 ? "Low" : null);
  return (
    <li>
      <div className="flex items-baseline justify-between text-[13.5px]">
        <span className="text-ink">{c.label}</span>
        <span className={cx("font-cond text-[15px] font-semibold", tone.text)}>{c.level}</span>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1" aria-hidden>
        {LEVELS.map((_, k) => <span key={k} className={cx("h-1.5 rounded-full", k <= i ? tone.bg : "bg-panel2")} />)}
      </div>
      {c.detail && <div className="mt-0.5 text-[12px] text-faint">{c.detail}</div>}
    </li>
  );
}

export function WearableTrend({ w, height = 200 }: { w: WearableSummary; height?: number }) {
  const rows = w.series.map((s) => ({ ...s, day: s.mission_day == null ? (s.date ?? "").slice(5) : s.mission_day <= 0 ? `${s.mission_day}` : `D${s.mission_day}` }));
  const device = w.kind === "device_daily";
  return (
    <div style={{ height }} role="img" aria-label="Sleep score and readiness by morning">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tick={chartTheme.tick} stroke={chartTheme.axis} interval={device ? "preserveStartEnd" : 1} minTickGap={16} />
          <YAxis domain={[0, 100]} tick={chartTheme.tick} stroke={chartTheme.axis} />
          <Tooltip {...chartTheme.tooltip} labelFormatter={(l) => (device ? String(l) : String(l).startsWith("D") ? `Mission day ${String(l).slice(1)}` : `Pre-mission day ${l}`)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {device
            ? <Bar dataKey="sleep_score" name="Sleep score (estimated)" fill="#C9D1D8" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            : <Bar dataKey="sleep_score" name="Sleep score" fill="#C9D1D8" radius={[2, 2, 0, 0]} />}
          <Line dataKey="readiness" name="Readiness" stroke="#1D2227" strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Full card: last night's sleep score and this morning's readiness, with breakdowns and the trend. */
export function WearableCard({ w, who, className }: { w: WearableSummary; who: string; className?: string }) {
  if (!w.available || !w.latest) {
    return <Card title="Sleep and readiness" icon={<Watch size={16} />} className={className}><p className="text-[14px] text-dim">No wearable data for {who} yet.</p></Card>;
  }
  const n = w.latest;
  const device = w.kind === "device_daily";
  const when = device ? new Date(`${n.date}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "long" })
    : n.mission_day != null && n.mission_day > 0 ? `mission day ${n.mission_day}` : "the latest pre-mission day";
  return (
    <Card title="Sleep and readiness" icon={<Watch size={16} />} className={className}
      subtitle={device ? `Fitbit / Google Health export, latest score ${when}. Scores out of 100.` : `Wrist wearable, morning of ${when}. Scores out of 100.`}
      actions={w.provenance && <ProvenanceBadge p={w.provenance} long />}>
      <div className="grid gap-6 md:grid-cols-2">
        {n.sleep?.estimated ? (
          <div className="flex gap-5">
            <div className="shrink-0 text-center">
              <Gauge value={n.sleep.score} band={n.sleep.band} label="Estimated sleep score" />
              <div className="-mt-1 text-[13px] font-semibold text-ink">Sleep score</div>
              <div className="text-[12px] text-faint">estimated</div>
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="grid grid-cols-3 gap-3 font-cond tnum">
                <div><div className="font-sans text-[12.5px] text-dim">Overnight HRV</div><div className="text-[24px] font-semibold leading-tight">{n.hrv_ms != null ? Math.round(n.hrv_ms) : "—"}<span className="text-[13px] text-faint"> ms</span></div></div>
                <div><div className="font-sans text-[12.5px] text-dim">Resting HR</div><div className="text-[24px] font-semibold leading-tight">{n.resting_hr != null ? Math.round(n.resting_hr) : "—"}<span className="text-[13px] text-faint"> bpm</span></div></div>
                <div><div className="font-sans text-[12.5px] text-dim">Sleeping HR</div><div className="text-[24px] font-semibold leading-tight">{n.sleeping_hr != null ? Math.round(n.sleeping_hr) : "—"}<span className="text-[13px] text-faint"> bpm</span></div></div>
              </div>
              <p className="mt-3 text-[12.5px] leading-snug text-dim">{n.sleep.basis} Your export has no sleep duration or stages, so this is an estimate rather than a measured sleep score.</p>
            </div>
          </div>
        ) : n.sleep ? (
          <div className="flex gap-5">
            <div className="shrink-0 text-center">
              <Gauge value={n.sleep.score} band={n.sleep.band} label="Sleep score" />
              <div className="-mt-1 text-[13px] font-semibold text-ink">Sleep score</div>
              <div className="text-[12px] text-faint">{Math.floor(n.asleep_min / 60)} h {String(Math.round(n.asleep_min % 60)).padStart(2, "0")} min asleep</div>
            </div>
            <div className="min-w-0 flex-1 pt-1"><SleepBreakdown comps={n.sleep.components} /></div>
          </div>
        ) : (
          <div className="grid grid-cols-3 content-start gap-4 font-cond tnum">
            <div><div className="font-sans text-[13px] text-dim">Overnight HRV</div><div className="text-[30px] font-semibold leading-tight">{n.hrv_ms != null ? Math.round(n.hrv_ms) : "—"}<span className="text-[15px] text-faint"> ms</span></div></div>
            <div><div className="font-sans text-[13px] text-dim">Resting HR</div><div className="text-[30px] font-semibold leading-tight">{n.resting_hr != null ? Math.round(n.resting_hr) : "—"}<span className="text-[15px] text-faint"> bpm</span></div></div>
            <div><div className="font-sans text-[13px] text-dim">Sleeping HR</div><div className="text-[30px] font-semibold leading-tight">{n.sleeping_hr != null ? Math.round(n.sleeping_hr) : "—"}<span className="text-[15px] text-faint"> bpm</span></div></div>
            <p className="col-span-3 font-sans text-[12.5px] text-faint">No sleep score: your export has no sleep duration or sleep stages.</p>
          </div>
        )}
        <div className="flex gap-5">
          <div className="shrink-0 text-center">
            <Gauge value={n.readiness.score} band={n.readiness.band} label="Readiness" />
            <div className="-mt-1 text-[13px] font-semibold text-ink">Readiness</div>
            <div className="text-[12px] text-faint">{n.readiness.vendor_score ? "Fitbit’s own score" : `vs ${who}’s own baseline`}</div>
          </div>
          <div className="min-w-0 flex-1 pt-1"><ReadinessBreakdown comps={n.readiness.components} detail={n.readiness.detail} /></div>
        </div>
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <div className="mb-1 text-[13px] text-dim">{device ? "Every day in your export" : "Every morning, including the pre-mission baseline nights"}</div>
        <WearableTrend w={w} />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-faint">{w.method.source_note} {w.method.limits}</p>
    </Card>
  );
}

/** Compact roster cell. */
export function WearableCell({ w }: { w?: WearableSummary }) {
  if (!w?.available || !w.latest) return <span className="text-dim">No device data</span>;
  const n = w.latest;
  if (!n.sleep) return <span className="text-dim">Readiness {n.readiness.score ?? "—"}</span>;
  const s = bandTone(n.sleep.band), r = bandTone(n.readiness.band);
  return (
    <div className="font-cond text-[15px] leading-snug tnum">
      <div><span className="text-faint">Sleep</span> <span className="font-semibold text-ink">{n.sleep.score}</span> <span className={cx("font-semibold", s.text)}>{n.sleep.band}</span></div>
      <div><span className="text-faint">Readiness</span> <span className="font-semibold text-ink">{n.readiness.score ?? "—"}</span> <span className={cx("font-semibold", r.text)}>{n.readiness.band}</span></div>
      <div className="text-[13px] text-faint">HRV {Math.round(n.hrv_ms)} ms, RHR {Math.round(n.resting_hr)} bpm</div>
    </div>
  );
}
