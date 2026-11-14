import { BookMarked, LineChart as LineIcon, Moon, Sigma, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { EvaluationSummary } from "../components/EvaluationView";
import { Card, CategoryBadge, chartTheme, DemoScenarioBanner, Loading, Notice, ProvenanceBadge, Select, SelfReportedTag } from "../components/ui";
import { WearableTrend, type WearableSummary } from "../components/WearableScores";
import { useApp } from "../context";
import { api } from "../lib/api";
import { CATEGORY_STYLE, digitsFor, fmt, missionTime, signed } from "../lib/format";
import type { Analysis, Category } from "../lib/types";

const CAT_COLOR: Record<Category, string> = {
  baseline: chartTheme.cyan, within_baseline: chartTheme.jade, change_worth_reviewing: chartTheme.amber,
  invalid_measurement: chartTheme.rose, insufficient_data: chartTheme.dim,
};

export default function RecoveryAnalysis() {
  const { selectedCrewId, params, navigate } = useApp();
  const [type, setType] = useState<"pvt" | "motor">((params.type as "pvt" | "motor") || "pvt");
  const [sessionId, setSessionId] = useState<number | null>(params.session ? Number(params.session) : null);
  const [data, setData] = useState<Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<string>("");

  useEffect(() => {
    setData(null);
    setErr(null);
    const q = sessionId ? `&session_id=${sessionId}` : "";
    api.get<Analysis>(`/api/analysis/${selectedCrewId}?type=${type}${q}`).then((d) => {
      setData(d);
      setMetric((m) => (d.rules.metrics[type].some((x) => x.key === m) ? m : d.rules.metrics[type][0].key));
    }).catch((e) => { setErr(e.message); if (sessionId) setSessionId(null); });
  }, [selectedCrewId, type, sessionId]);

  const rule = data?.rules.metrics[type].find((m) => m.key === metric);
  const evalMetric = data?.evaluation.metrics.find((m) => m.metric === metric);
  const series = useMemo(() => (data?.history ?? []).map((h, i) => ({
    i: i + 1, id: h.id, value: h.metrics[metric], category: h.category, phase: h.phase, label: h.provenance === "synthetic" ? missionTime(h.mission_time_days) : new Date(h.started_at).toLocaleString(),
    evaluated: h.id === data?.evaluated_session?.id,
  })), [data, metric]);

  if (err && !data) return <Notice tone="error">{err}</Notice>;
  if (!data) return <Loading label="Computing baseline comparison" />;

  const base = evalMetric?.baseline;
  const band = base?.median != null && base.scale != null ? [base.median - 3 * base.scale, base.median + 3 * base.scale] : null;
  const d = digitsFor(rule?.unit ?? "");
  const synthetic = data.evaluated_session?.provenance === "synthetic" || data.crew.provenance === "synthetic";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-cond text-[40px] font-bold leading-[1.05] text-ink">Compare with {data.crew.code === "LOCAL" ? "your" : `${data.crew.code}’s`} baseline</h1>
          <p className="mt-1.5 max-w-[68ch] text-[15.5px] text-dim">Each result is measured against the same person’s earlier valid sessions, never against other people.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Assessment" value={type} onChange={(v) => { setType(v); setSessionId(null); }}
            options={[{ value: "pvt", label: "Vigilant attention" }, { value: "motor", label: "Precision motor" }]} />
          <Select label="Evaluated session" value={data.evaluated_session?.id ?? 0} onChange={(v) => setSessionId(Number(v))}
            options={data.history.map((h) => ({ value: h.id, label: `#${h.id} · ${h.phase} · ${h.provenance === "synthetic" ? missionTime(h.mission_time_days) : new Date(h.started_at).toLocaleDateString()} · ${h.status}` }))} />
        </div>
      </div>

      {synthetic && <DemoScenarioBanner text="Evaluated data and baseline are synthetic trial-level histories generated from fixed seeds." />}
      <Notice>{data.disclaimer}</Notice>

      <Card title={`Evaluated session #${data.evaluated_session?.id ?? "—"}`} icon={<Sigma size={15} />}
        subtitle={data.evaluated_session ? `${data.evaluated_session.phase} session · ${data.evaluated_session.provenance === "synthetic" ? missionTime(data.evaluated_session.mission_time_days) : new Date(data.evaluated_session.started_at).toLocaleString()} · mode ${data.evaluated_session.mode}` : undefined}
        actions={data.evaluated_session && <ProvenanceBadge p={data.evaluated_session.provenance} long />}>
        <EvaluationSummary evaluation={data.evaluation} warnings={data.warnings} />
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Performance across sessions" icon={<LineIcon size={15} />}
          actions={<Select label="" className="[&>span]:hidden" value={metric} onChange={setMetric} options={data.rules.metrics[type].map((m) => ({ value: m.key, label: m.label }))} />}>
          <div className="h-72" role="img" aria-label={`${rule?.label} for each session`}>
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="i" tick={chartTheme.tick} stroke={chartTheme.axis} label={{ value: "session (chronological)", position: "insideBottom", offset: -2, fill: chartTheme.axis, fontSize: 11 }} />
                <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} domain={["auto", "auto"]} />
                {band && <ReferenceArea y1={band[0]} y2={band[1]} fill={chartTheme.cyan} fillOpacity={0.07} />}
                {base?.median != null && <ReferenceLine y={base.median} stroke={chartTheme.cyan} strokeDasharray="4 4" label={{ value: "baseline median", fill: chartTheme.cyan, fontSize: 10, position: "insideTopLeft" }} />}
                <Tooltip {...chartTheme.tooltip}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof series)[number];
                    return (
                      <div className="rounded-lg border border-line bg-deck px-3 py-2 text-xs">
                        <div className="text-dim">#{p.id} · {p.label} · {p.phase}</div>
                        <div className="font-cond tnum text-ink">{fmt(p.value as number, d)} {rule?.unit}</div>
                        <div style={{ color: CAT_COLOR[p.category] }}>{CATEGORY_STYLE[p.category].label}</div>
                      </div>
                    );
                  }} />
                <Line dataKey="value" stroke={chartTheme.dim} strokeOpacity={0.5} dot={false} isAnimationActive={false} connectNulls />
                <Scatter dataKey="value" isAnimationActive={false}
                  shape={(p: { cx?: number; cy?: number; payload?: (typeof series)[number] }) => (
                    <circle cx={p.cx} cy={p.cy} r={p.payload?.evaluated ? 7 : 4.5} fill={CAT_COLOR[p.payload?.category ?? "baseline"]}
                      stroke={p.payload?.evaluated ? "#1d2227" : "#ffffff"} strokeWidth={p.payload?.evaluated ? 2 : 1.5} style={{ cursor: "pointer" }}
                      onClick={() => p.payload && setSessionId(p.payload.id)} />
                  )} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
            {(["baseline", "within_baseline", "change_worth_reviewing", "invalid_measurement"] as Category[]).map((c) => (
              <span key={c}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />{CATEGORY_STYLE[c].label}</span>
            ))}
            <span>· shaded band = median ± 3 × robust SD (1.4826 × MAD, floored) · click a point to evaluate it</span>
          </div>
        </Card>

        <DistributionCard data={data} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Mission trends (exploratory)" icon={<TrendingUp size={15} />} subtitle="Theil–Sen median slope across valid mission sessions, with a 90% interval. Needs ≥ 4 sessions.">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-faint"><th className="pb-2 font-normal">Metric</th><th className="pb-2 font-normal">Slope / day</th><th className="pb-2 font-normal">90% interval</th><th className="pb-2 font-normal">n</th></tr></thead>
            <tbody>
              {data.rules.metrics[type].map((m) => {
                const t = data.trends[m.key];
                const dd = digitsFor(m.unit);
                return (
                  <tr key={m.key} className="border-t border-line/60">
                    <td className="py-2 text-ink">{m.label}</td>
                    <td className="py-2 font-cond tnum">{t ? signed(t.slope_per_day, Math.max(dd, 1)) : "—"}</td>
                    <td className="py-2 font-cond tnum text-dim">{t ? `${fmt(t.low, Math.max(dd, 1))} … ${fmt(t.high, Math.max(dd, 1))}` : "insufficient data"}</td>
                    <td className="py-2 font-cond tnum text-dim">{t?.n_points ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-faint">With few sessions these intervals are wide; a trend is descriptive, not a forecast.</p>
        </Card>

        <SelfReportCard data={data} />
      </div>

      <Card title="Documented exploratory rules" icon={<BookMarked size={15} />} subtitle={data.rules.disclaimer}>
        <div className="grid gap-4 text-sm text-dim md:grid-cols-3">
          <div><div className="text-[11px] text-faint">Baseline</div>Valid sessions marked “baseline”. &lt; {data.rules.min_baseline_sessions} = insufficient; {data.rules.min_baseline_sessions}–{data.rules.established_baseline_sessions - 1} = provisional; ≥ {data.rules.established_baseline_sessions} = established. Invalid runs excluded.</div>
          <div><div className="text-[11px] text-faint">Statistic</div>robust z = (value − median) / max({data.rules.mad_scale} × MAD, absolute floor, relative floor × |median|). Floors stop zero-variance baselines from inflating z.</div>
          <div><div className="text-[11px] text-faint">Flag</div>“Functional change worth reviewing” only if adverse robust z ≥ {data.rules.z_threshold} <em>and</em> adverse change ≥ the metric’s minimum change.</div>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead><tr className="text-left text-[11px] text-faint"><th className="pb-2 font-normal">Metric</th><th className="pb-2 font-normal">Adverse</th><th className="pb-2 font-normal">Min change</th><th className="pb-2 font-normal">Spread floor</th></tr></thead>
          <tbody>{data.rules.metrics[type].map((m) => (
            <tr key={m.key} className="border-t border-line/60"><td className="py-1.5 text-ink">{m.label}</td><td className="text-dim">{m.adverse === "up" ? "increase" : "decrease"}</td>
              <td className="font-cond tnum">{m.min_change} {m.unit === "count" || m.unit === "ratio" ? "" : m.unit}</td>
              <td className="font-cond tnum text-dim">{m.floor_abs}{m.floor_rel ? ` or ${m.floor_rel * 100}% of median` : ""}</td></tr>))}
          </tbody>
        </table>
      </Card>

      <Card title="Session log" subtitle="Includes invalid and incomplete runs, which are retained for audit and never interpreted.">
        <div className="max-h-72 overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {[...data.history].reverse().map((h) => (
                <tr key={h.id} className="border-t border-line/60 align-top">
                  <td className="py-2 font-cond tnum text-faint">#{h.id}</td>
                  <td className="py-2 text-dim">{h.provenance === "synthetic" ? missionTime(h.mission_time_days) : new Date(h.started_at).toLocaleString()}</td>
                  <td className="py-2 text-dim">{h.phase}</td>
                  <td className="py-2"><CategoryBadge category={h.category} small />
                    {h.status_reasons.length > 0 && h.status !== "valid" && <div className="mt-1 text-[11px] text-rose">{h.status_reasons.join(" ")}</div>}</td>
                  <td className="py-2"><ProvenanceBadge p={h.provenance} /></td>
                  <td className="py-2"><button className="text-xs text-cyan underline decoration-dotted" onClick={() => setSessionId(h.id)}>evaluate</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-faint">Need more data? <button className="text-cyan underline decoration-dotted" onClick={() => navigate("lab")}>Run an assessment in the Performance Lab</button>.</div>
      </Card>
    </div>
  );
}

function DistributionCard({ data }: { data: Analysis }) {
  const dist = data.distribution;
  if (!dist) return <Card title="Distribution"><p className="text-sm text-dim">No data.</p></Card>;
  if (dist.kind === "reaction_time_histogram") {
    const rows = dist.baseline_pooled.map((b, i) => ({ bin: `${dist.bin_edges[i]}`, baseline: +(b * 100).toFixed(2), evaluated: +(dist.evaluated[i] * 100).toFixed(2) }));
    return (
      <Card title="Reaction-time distribution" icon={<Sigma size={15} />}
        subtitle={`Share of responses per 25 ms bin · baseline pooled n=${dist.baseline_n_responses} · evaluated n=${dist.evaluated_n_responses}. Values ≥ 800 ms are grouped in the last bin.`}>
        <div className="h-72" role="img" aria-label="Reaction time histogram, baseline versus evaluated session">
          <ResponsiveContainer>
            <BarChart data={rows} barGap={0} barCategoryGap={1} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bin" tick={chartTheme.tick} stroke={chartTheme.axis} interval={3} label={{ value: "ms", position: "insideBottomRight", offset: -2, fill: chartTheme.axis, fontSize: 11 }} />
              <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} unit="%" />
              <ReferenceLine x="500" stroke={chartTheme.rose} strokeDasharray="4 4" label={{ value: "lapse", fill: chartTheme.rose, fontSize: 10, position: "top" }} />
              <Tooltip {...chartTheme.tooltip} formatter={(v: number) => `${v}%`} labelFormatter={(l) => `${l}–${Number(l) + 25} ms`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="baseline" name="Baseline (pooled)" fill={chartTheme.cyan} fillOpacity={0.5} />
              <Bar dataKey="evaluated" name="Evaluated session" fill={chartTheme.amber} fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Movement time per target" icon={<Sigma size={15} />} subtitle="Evaluated session vs median of valid baseline sessions for each target in the fixed sequence.">
      <div className="h-72" role="img" aria-label="Movement time per target">
        <ResponsiveContainer>
          <BarChart data={dist.targets} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="target" tick={chartTheme.tick} stroke={chartTheme.axis} />
            <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} unit=" ms" />
            <Tooltip {...chartTheme.tooltip} formatter={(v: number) => `${v?.toFixed?.(0)} ms`} labelFormatter={(l) => `Target ${l}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="baseline_median" name="Baseline median" fill={chartTheme.cyan} fillOpacity={0.5} />
            <Bar dataKey="evaluated" name="Evaluated session" fill={chartTheme.amber} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function SelfReportCard({ data }: { data: Analysis }) {
  const [w, setW] = useState<WearableSummary | null>(null);
  useEffect(() => { api.get<WearableSummary>(`/api/wearable/${data.crew.id}`).then(setW).catch(() => setW(null)); }, [data.crew.id]);
  const tlx = data.self_reports.filter((r) => r.raw_tlx != null);
  return (
    <Card title="Sleep, readiness and workload" icon={<Moon size={15} />}
      subtitle="Context shown next to the test results; none of it is part of any flagging rule."
      actions={w?.provenance && <ProvenanceBadge p={w.provenance} />}>
      {w?.available ? <WearableTrend w={w} height={190} /> : <p className="text-sm text-dim">No wearable data for this person.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[13px] text-dim">
        <SelfReportedTag /> Raw TLX workload:
        {tlx.length ? tlx.slice(-5).map((r) => (
          <span key={r.id} className="font-cond text-[15px] tnum text-ink">{r.mission_day ? `D${r.mission_day}` : "pre"} {fmt(r.raw_tlx, 0)}</span>
        )) : <span>none yet</span>}
      </div>
    </Card>
  );
}
