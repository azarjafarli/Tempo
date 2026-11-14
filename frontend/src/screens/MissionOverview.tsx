import { ArrowRight, CalendarClock, ClipboardCheck, Database, ListChecks, Moon, Timer, User } from "lucide-react";
import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CategoryBadge, chartTheme, cx, DemoScenarioBanner, Loading, Notice, ProvenanceBadge, SelfReportedTag, Stat } from "../components/ui";
import { useApp } from "../context";
import { api } from "../lib/api";
import { fmt, hhmm, hoursToHM, missionTime, signed } from "../lib/format";
import type { Overview, OverviewAssessment } from "../lib/types";

export default function MissionOverview() {
  const { selectedCrewId, navigate } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.get<Overview>(`/api/overview?crew_id=${selectedCrewId}`).then(setData).catch((e) => setErr(e.message));
  }, [selectedCrewId]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <Loading label="Loading mission" />;
  if (!data.mission) return <Notice>No mission loaded. Use “Load Demo Mission” in the sidebar.</Notice>;
  const { mission, crew } = data;
  const synthetic = crew.provenance === "synthetic";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan">Mission Overview</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{crew.display_name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-dim">
            <User size={14} aria-hidden /> {crew.role} <ProvenanceBadge p={crew.provenance} />
            {crew.qualifications.length > 0 && <span className="text-faint">· {crew.qualifications.join(" · ")}</span>}
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate("lab")}>Run an assessment <ArrowRight size={16} /></Button>
      </div>

      {synthetic ? (
        <DemoScenarioBanner text={`Fictional crew member and mission. Assessment histories are simulated (${mission.scenario_profile}-performance profile, seed ${mission.random_seed}).`} />
      ) : (
        <Notice>
          This profile holds <strong>real measurements recorded on this computer</strong>. It is not part of the fictional mission schedule;
          mission fields below refer to the demo mission timeline.
        </Notice>
      )}

      <Card>
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat label="Current mission day" value={<>{mission.current_day}<span className="text-base text-faint"> / {mission.num_days}</span></>} sub={mission.name} accent="cyan" />
          <Stat label="Last EVA" value={data.last_eva ? hoursToHM(data.last_eva.duration_hours) : "—"}
            sub={data.last_eva ? `EVA ${data.last_eva.eva_number} · Day ${data.last_eva.mission_day} · with ${data.last_eva.crew.filter((c) => c !== crew.code).join(", ")}` : "No completed EVA"} />
          <Stat label="Next scheduled EVA" value={data.next_eva ? `Day ${data.next_eva.mission_day}` : "—"}
            sub={data.next_eva ? `EVA ${data.next_eva.eva_number} · ${hhmm(data.next_eva.start_hour)} · planned ${hoursToHM(data.next_eva.duration_hours)}` : "None planned"} accent="amber" />
          <Stat label="EVAs (this crew member)" value={`${data.eva_count.completed + data.eva_count.planned}`} sub={`${data.eva_count.completed} completed · ${data.eva_count.planned} planned`} />
        </div>
        <MissionTimeline data={data} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {(["pvt", "motor"] as const).map((k) => (
          <AssessmentCard key={k} a={data.assessments[k]} type={k} onOpen={() => navigate("analysis", { type: k })} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Next steps" icon={<ListChecks size={15} />} className="lg:col-span-1">
          <ol className="space-y-2.5 text-sm text-ink">
            {data.next_steps.map((s, i) => (
              <li key={i} className="flex gap-2.5"><span className="mt-0.5 font-mono text-xs text-cyan">{String(i + 1).padStart(2, "0")}</span><span>{s}</span></li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-faint">Suggestions come from documented exploratory rules. They are prompts for human review, not medical advice.</p>
        </Card>

        <Card title="Assessment data quality" icon={<Database size={15} />}>
          <table className="w-full text-sm">
            <caption className="sr-only">Data quality per assessment</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-faint"><th className="pb-2 font-normal">Assessment</th><th className="pb-2 font-normal">Sessions</th><th className="pb-2 font-normal">Invalid</th><th className="pb-2 font-normal">Baseline</th></tr></thead>
            <tbody>
              {data.data_quality.map((q) => (
                <tr key={q.assessment} className="border-t border-line/60">
                  <td className="py-2 text-ink">{q.assessment}</td>
                  <td className="py-2 font-mono">{q.sessions}</td>
                  <td className={cx("py-2 font-mono", q.invalid_or_incomplete ? "text-rose" : "text-dim")}>{q.invalid_or_incomplete}</td>
                  <td className="py-2"><span className={cx("font-mono text-xs", q.baseline_status === "established" ? "text-jade" : q.baseline_status === "provisional" ? "text-amber" : "text-faint")}>{q.baseline_status}</span> <span className="text-xs text-faint">(n={q.valid_baseline_sessions})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-faint">Baseline: 3–4 valid sessions = provisional, 5+ = established. Invalid runs are kept for audit but never interpreted.</p>
        </Card>

        <Card title="Latest check-in" icon={<ClipboardCheck size={15} />} actions={<SelfReportedTag />}>
          {data.latest_self_report ? (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Sleep" value={fmt(data.latest_self_report.sleep_hours, 1, "h")} />
              <Stat label="Raw TLX" value={fmt(data.latest_self_report.raw_tlx, 0)} sub="0–100, unweighted" />
              <Stat label="Fatigue" value={`${fmt(data.latest_self_report.fatigue)}/10`} />
              <Stat label="Recovery" value={`${fmt(data.latest_self_report.recovery)}/10`} />
              <div className="col-span-2 flex items-center gap-2 text-xs text-faint">
                <Moon size={12} aria-hidden /> {data.latest_self_report.mission_day ? `Mission day ${data.latest_self_report.mission_day}` : new Date(data.latest_self_report.recorded_at).toLocaleString()}
                <ProvenanceBadge p={data.latest_self_report.provenance} />
              </div>
            </div>
          ) : <p className="text-sm text-dim">No check-in recorded yet.</p>}
        </Card>
      </div>
    </div>
  );
}

function MissionTimeline({ data }: { data: Overview }) {
  const m = data.mission!;
  const days = Array.from({ length: m.num_days }, (_, i) => i + 1);
  return (
    <div className="mt-6" aria-label="Mission EVA timeline">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-faint"><CalendarClock size={13} aria-hidden /> Five-day EVA timeline</div>
      <div className="grid grid-cols-5 gap-2">
        {days.map((d) => {
          const evas = data.all_evas.filter((e) => e.mission_day === d);
          const isToday = d === m.current_day;
          return (
            <div key={d} className={cx("rounded-lg border p-2.5", isToday ? "border-cyan/60 bg-cyan-deep/25" : "border-line bg-deck/60")}>
              <div className="flex items-center justify-between font-mono text-[11px] text-dim">
                <span>DAY {d}</span>{isToday && <span className="text-cyan">TODAY</span>}
              </div>
              {evas.length === 0 && <div className="mt-2 text-xs text-faint">No EVA</div>}
              {evas.map((e) => {
                const mine = e.crew.includes(data.crew.code);
                return (
                  <div key={e.id} className={cx("mt-2 rounded-md border px-2 py-1.5 text-xs",
                    mine ? (e.status === "completed" ? "border-cyan/40 bg-cyan-deep/40 text-cyan" : "border-amber/40 bg-amber-deep/40 text-amber") : "border-line text-faint")}>
                    <div className="font-semibold">EVA {e.eva_number} · {e.status}</div>
                    <div className="font-mono text-[11px] opacity-80">{hhmm(e.start_hour)} · {e.duration_hours.toFixed(1)} h</div>
                    <div className="truncate text-[11px] opacity-80">{e.crew.join(" + ")}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssessmentCard({ a, type, onOpen }: { a: OverviewAssessment; type: "pvt" | "motor"; onOpen: () => void }) {
  const r = a.key_metric_result;
  const base = r?.baseline;
  const series = a.series.filter((s) => s.value !== null).map((s, i) => ({ ...s, i: i + 1, label: missionTime(s.t) }));
  const unit = "ms";
  const band = base?.median != null && base.scale != null ? [base.median - 3 * base.scale, base.median + 3 * base.scale] : null;
  return (
    <Card title={a.label} icon={<Timer size={15} />} subtitle={type === "pvt" ? "Key metric: median reaction time" : "Key metric: median movement time"}
      actions={<CategoryBadge category={a.category} small />}>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Latest" value={fmt(r?.value ?? (a.evaluated_session?.summary?.[a.key_metric] as number | null), 0, unit)}
          sub={a.evaluated_session ? missionTime(a.evaluated_session.mission_time_days) : "—"} accent={a.category === "change_worth_reviewing" ? "amber" : undefined} />
        <Stat label="Baseline median" value={fmt(base?.median, 0, unit)} sub={base ? `n=${base.n} · ${base.status}` : "—"} />
        <Stat label="Difference" value={signed(r?.difference, 0)} sub={r?.robust_z != null ? `robust z ${signed(r.robust_z, 1)}` : "—"} />
      </div>
      <div className="mt-4 h-44" role="img" aria-label={`${a.label} across sessions`}>
        <ResponsiveContainer>
          <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
            <XAxis dataKey="i" tick={chartTheme.tick} stroke={chartTheme.axis} />
            <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} domain={["auto", "auto"]} />
            {band && <ReferenceArea y1={band[0]} y2={band[1]} fill={chartTheme.cyan} fillOpacity={0.08} />}
            {base?.median != null && <ReferenceLine y={base.median} stroke={chartTheme.cyan} strokeDasharray="4 4" />}
            <Tooltip {...chartTheme.tooltip} labelFormatter={(_, p) => (p?.[0]?.payload ? `${p[0].payload.label} · ${p[0].payload.phase}${p[0].payload.status !== "valid" ? " · INVALID" : ""}` : "")}
              formatter={(v: number) => [`${v.toFixed(0)} ms`, "value"]} />
            <Line dataKey="value" stroke={chartTheme.dim} strokeOpacity={0.45} dot={false} isAnimationActive={false} />
            <Scatter dataKey="value" isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: { phase: string; status: string } }) => (
                <circle cx={p.cx} cy={p.cy} r={4.5}
                  fill={p.payload?.status !== "valid" ? chartTheme.rose : p.payload?.phase === "baseline" ? chartTheme.cyan : chartTheme.amber}
                  stroke="#050b16" strokeWidth={1.5} />
              )} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan" />baseline</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber" />mission</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose" />invalid (not interpreted)</span>
        <span>shaded: baseline median ± 3 robust SD</span>
      </div>
      {a.trend && (
        <p className="mt-3 text-xs text-dim">
          Mission trend ({a.trend.n_points} valid sessions, Theil–Sen): {signed(a.trend.slope_per_day, 0)} ms/day
          <span className="text-faint"> (90% interval {fmt(a.trend.low, 0)} to {fmt(a.trend.high, 0)})</span>
        </p>
      )}
      {a.flagged_metrics.length > 0 && <p className="mt-2 text-xs text-amber">Flagged: {a.flagged_metrics.join(", ")}</p>}
      {a.warnings.map((w) => <p key={w} className="mt-2 text-xs text-amber">{w}</p>)}
      <div className="mt-4"><Button variant="ghost" onClick={onOpen}>Open Recovery Analysis <ArrowRight size={15} /></Button></div>
    </Card>
  );
}
