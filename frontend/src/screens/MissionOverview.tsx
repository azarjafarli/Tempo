import { ClipboardCheck, Database, ListChecks, Timer, User } from "lucide-react";
import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CategoryBadge, chartTheme, cx, Loading, Notice, ProvenanceBadge, SelfReportedTag, Stat } from "../components/ui";
import { WearableCard } from "../components/WearableScores";
import { WorkloadPanel } from "../components/WorkloadPanel";
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
  if (!data.mission) return <Notice>No mission loaded. Use “Reset mission” in the sidebar.</Notice>;
  const { mission, crew } = data;
  const synthetic = crew.provenance === "synthetic";

  const { headline, detail } = statusText(data);
  return (
    <div className="space-y-8">
      <section aria-labelledby="status-headline">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-[860px]">
            <p className="flex flex-wrap items-center gap-2 text-[14px] text-dim">
              <User size={15} aria-hidden /> {crew.display_name}, {crew.role.replace(" · ", ", ")}
              <ProvenanceBadge p={crew.provenance} />
            </p>
            <h1 id="status-headline" className="mt-2 font-cond text-[44px] font-bold leading-[1.02] text-ink md:text-[52px]">{headline}</h1>
            <p className="mt-3 max-w-[68ch] text-[16px] leading-relaxed text-dim">{detail}</p>
          </div>
          <Button variant="primary" onClick={() => navigate("lab")}>Run an assessment</Button>
        </div>

        {!synthetic && (
          <div className="mt-7">
            <Notice>This profile holds your own measurements recorded on this computer. It is not part of the mission schedule.</Notice>
          </div>
        )}

        <MissionStrip data={data} />

        <dl className="mt-6 grid grid-cols-2 gap-y-5 border-t border-line pt-5 lg:grid-cols-4 lg:divide-x lg:divide-line">
          <div className="pr-6"><Stat label="Last EVA" value={data.last_eva ? hoursToHM(data.last_eva.duration_hours) : "None yet"}
            sub={data.last_eva ? `EVA ${data.last_eva.eva_number} on day ${data.last_eva.mission_day}, with ${data.last_eva.crew.filter((c) => c !== crew.code).join(" and ")}` : "No completed EVA"} /></div>
          <div className="lg:px-6"><Stat label="Next EVA" value={data.next_eva ? `Day ${data.next_eva.mission_day}, ${hhmm(data.next_eva.start_hour)}` : "None planned"} accent={data.next_eva ? "amber" : undefined}
            sub={data.next_eva ? `EVA ${data.next_eva.eva_number}, planned for ${hoursToHM(data.next_eva.duration_hours)}` : undefined} /></div>
          <div className="lg:px-6"><Stat label="EVAs for this crew member" value={`${data.eva_count.completed} of ${data.eva_count.completed + data.eva_count.planned}`} sub="completed so far" /></div>
          <div className="lg:pl-6"><Stat label="Mission" value={`Day ${mission.current_day} of ${mission.num_days}`} sub={mission.name} /></div>
        </dl>
      </section>

      <WearableCard w={data.wearable} who={crew.code === "LOCAL" ? "your" : crew.code} />

      <div className="grid gap-6 xl:grid-cols-2">
        {(["pvt", "motor"] as const).map((k) => (
          <AssessmentCard key={k} a={data.assessments[k]} type={k} onOpen={() => navigate("analysis", { type: k })} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Next steps" icon={<ListChecks size={15} />} className="lg:col-span-1">
          <ol className="space-y-2.5 text-sm text-ink">
            {data.next_steps.map((s, i) => (
              <li key={i} className="flex gap-2.5"><span className="mt-0.5 font-cond tnum text-xs text-cyan">{String(i + 1).padStart(2, "0")}</span><span>{s}</span></li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-faint">Suggestions come from documented exploratory rules. They are prompts for human review, not medical advice.</p>
        </Card>

        <Card title="Assessment data quality" icon={<Database size={15} />}>
          <table className="w-full text-sm">
            <caption className="sr-only">Data quality per assessment</caption>
            <thead><tr className="text-left text-[11px] text-faint"><th className="pb-2 font-normal">Assessment</th><th className="pb-2 font-normal">Sessions</th><th className="pb-2 font-normal">Invalid</th><th className="pb-2 font-normal">Baseline</th></tr></thead>
            <tbody>
              {data.data_quality.map((q) => (
                <tr key={q.assessment} className="border-t border-line/60">
                  <td className="py-2 text-ink">{q.assessment}</td>
                  <td className="py-2 font-cond tnum">{q.sessions}</td>
                  <td className={cx("py-2 font-cond tnum", q.invalid_or_incomplete ? "text-rose" : "text-dim")}>{q.invalid_or_incomplete}</td>
                  <td className="py-2"><span className={cx("font-cond tnum text-xs", q.baseline_status === "established" ? "text-jade" : q.baseline_status === "provisional" ? "text-amber" : "text-faint")}>{q.baseline_status}</span> <span className="text-xs text-faint">(n={q.valid_baseline_sessions})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-faint">Baseline: 3–4 valid sessions = provisional, 5+ = established. Invalid runs are kept for audit but never interpreted.</p>
        </Card>

        <Card title="Latest workload rating" icon={<ClipboardCheck size={15} />} actions={<SelfReportedTag />}
          subtitle="The only self-reported item. Sleep and recovery come from the wearable.">
          <WorkloadPanel report={data.latest_self_report} />
        </Card>
      </div>
    </div>
  );
}

function statusText(data: Overview): { headline: string; detail: string } {
  const who = data.crew.code === "LOCAL" ? "You" : data.crew.code;
  const a = Object.values(data.assessments);
  const review = a.filter((x) => x.category === "change_worth_reviewing");
  const next = data.next_eva;
  const parts = a.filter((x) => x.key_metric_result?.value != null && x.key_metric_result.baseline.median != null).map((x) => {
    const r = x.key_metric_result!;
    const what = x.key_metric === "median_rt_ms" ? "Median reaction time" : "Median movement time";
    return `${what} was ${Math.round(r.value!)} ms against a baseline of ${Math.round(r.baseline.median!)} ms`;
  });
  const detailBase = parts.length ? `${parts.map((x, i) => (i ? x.charAt(0).toLowerCase() + x.slice(1) : x)).join("; ")}.` : "";
  if (review.length) {
    const n = review.length === 1 ? "One functional change" : `${review.length === 2 ? "Two" : review.length} functional changes`;
    return {
      headline: `${who}: ${n.toLowerCase().replace(/^./, (c) => c.toUpperCase())} worth reviewing${next ? ` before EVA ${next.eva_number}` : ""}.`,
      detail: `${detailBase} These exceed the exploratory flagging rules, so a qualified reviewer should look at them${next ? ` before day ${next.mission_day} at ${hhmm(next.start_hour)}` : ""}. This is not a diagnosis.`,
    };
  }
  if (a.some((x) => x.category === "invalid_measurement")) return { headline: `${who}: the latest run is invalid and needs repeating.`, detail: "Invalid runs are kept for audit but never interpreted." };
  if (a.every((x) => x.category === "insufficient_data")) return { headline: `${who}: building a personal baseline.`, detail: "Record at least three baseline sessions per assessment before results are compared." };
  return { headline: `${who}: results are within observed baseline variation.`, detail: `${detailBase} No metric met the exploratory flagging rules.` };
}

const H0 = 6, H1 = 20;

/** Five-day EVA strip drawn to scale: one row per crew member, bars from start to end of each EVA. */
function MissionStrip({ data }: { data: Overview }) {
  const m = data.mission!;
  const days = Array.from({ length: m.num_days }, (_, i) => i + 1);
  const crewCodes = Array.from(new Set(data.all_evas.flatMap((e) => e.crew)));
  if (!crewCodes.length) return null;
  const nowHour = 7.2;
  const pct = (h: number) => ((h - H0) / (H1 - H0)) * 100;
  return (
    <figure className="mt-7" aria-label="Five-day EVA timeline">
      <div className="grid gap-x-1.5" style={{ gridTemplateColumns: `64px repeat(${m.num_days}, minmax(0,1fr))` }}>
        <div />
        {days.map((d) => (
          <div key={d} className={cx("pb-2 font-cond text-[15px]", d === m.current_day ? "font-bold text-ink" : d < m.current_day ? "text-faint" : "text-dim")}>
            Day {d}{d === m.current_day && <span className="ml-1.5 font-semibold text-amber">today</span>}
          </div>
        ))}
        {crewCodes.map((c) => {
          const me = c === data.crew.code;
          return (
            <div key={c} className="contents">
              <div className={cx("flex items-center font-cond text-[15px]", me ? "font-bold text-ink" : "text-faint")}>{c}</div>
              {days.map((d) => (
                <div key={d} className={cx("relative h-9 border-t border-line", d < m.current_day ? "bg-panel2/60" : "bg-panel")}>
                  {data.all_evas.filter((e) => e.mission_day === d && e.crew.includes(c)).map((e) => (
                    <div key={e.id} title={`EVA ${e.eva_number}: ${hhmm(e.start_hour)}–${hhmm(e.start_hour + e.duration_hours)}, ${e.crew.join(" and ")}, ${e.status}`}
                      className={cx("absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-[3px] px-1.5 font-cond text-[12.5px] font-semibold",
                        e.status === "completed"
                          ? me ? "bg-ink text-white" : "bg-[#AEB6BC] text-white"
                          : me ? "border-2 border-ink bg-panel text-ink" : "border border-dashed border-[#AEB6BC] text-faint")}
                      style={{ left: `${pct(e.start_hour)}%`, width: `${(e.duration_hours / (H1 - H0)) * 100}%` }}>
                      EVA {e.eva_number}
                    </div>
                  ))}
                  {d === m.current_day && <div className="absolute top-0 bottom-0 w-[2px] bg-amber" style={{ left: `${pct(nowHour)}%` }} aria-hidden />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 pl-[70px] text-[12.5px] text-faint">
        <span><span className="mr-1.5 inline-block h-2.5 w-4 rounded-[2px] bg-ink align-middle" />Completed</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-4 rounded-[2px] border-2 border-ink align-middle" />Planned</span>
        <span><span className="mr-1.5 inline-block h-3 w-[2px] bg-amber align-middle" />Now</span>
        <span>Each day spans {String(H0).padStart(2, "0")}:00 to {H1}:00</span>
      </figcaption>
    </figure>
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
                  fill={p.payload?.status !== "valid" ? chartTheme.rose : p.payload?.phase === "baseline" ? chartTheme.cyan : "#1D2227"}
                  stroke="#ffffff" strokeWidth={1.5} />
              )} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan" />baseline</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ink" />mission</span>
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
      {a.warnings.filter((w) => !/synthetic/i.test(w)).map((w) => <p key={w} className="mt-2 text-xs text-amber">{w}</p>)}
      <div className="mt-4"><Button variant="ghost" onClick={onOpen}>Open recovery analysis</Button></div>
    </Card>
  );
}
