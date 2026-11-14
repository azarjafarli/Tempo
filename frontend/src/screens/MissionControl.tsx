import { CalendarRange, ClipboardList, LineChart as LineIcon, Moon, NotebookPen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CategoryBadge, chartTheme, cx, DemoScenarioBanner, Loading, Notice, ProvenanceBadge, SelfReportedTag } from "../components/ui";
import { WearableCard, WearableCell, type WearableSummary } from "../components/WearableScores";
import { useApp } from "../context";
import { api } from "../lib/api";
import { fmt, hhmm, hoursToHM, missionTime, signed } from "../lib/format";
import type { Category, Crew, EvaActivity, Mission, MetricResult, SelfReport, Trend } from "../lib/types";

interface Flagged { metric: string; label: string; value: number | null; baseline_median: number | null; difference: number | null; robust_z: number | null; unit: string; consecutive_sessions: number; observations: string[] }
interface RosterAssessment {
  label: string; category: Category; category_label: string; baseline_n: number; baseline_status: string;
  key_metric: string; key_metric_result: MetricResult | null; flagged: Flagged[];
  series: { t: number | null; value: number | null; phase: string; status: string; category: Category }[];
  trend: Trend | null; evaluated_session: { id: number; mission_time_days: number | null; status: string; provenance: string } | null;
  invalid_sessions: number;
}
interface Note { id: number; created_at: string; author: string; status: string; status_label: string; note: string }
interface RosterEntry {
  crew: Crew; assessments: Record<"pvt" | "motor", RosterAssessment>; self_reports: SelfReport[];
  workload: { completed_evas: number; planned_evas: number; completed_hours: number; planned_hours: number; last_eva: EvaActivity | null; next_eva: EvaActivity | null; rest_before_next_hours: number | null; consecutive_eva_days_to_date: number; evas: EvaActivity[] };
  reviewer_notes: Note[]; latest_note: Note | null; assessments_flagged: number; needs_attention: boolean;
  wearable: WearableSummary;
}
interface MissionControlResp { mission: Mission; crew: RosterEntry[]; review_statuses: Record<string, string>; notice: string }

const CAT_COLOR: Record<Category, string> = {
  baseline: chartTheme.cyan, within_baseline: chartTheme.jade, change_worth_reviewing: chartTheme.amber,
  invalid_measurement: chartTheme.rose, insufficient_data: chartTheme.dim,
};

export default function MissionControl() {
  const { crew: allCrew, setSelectedCrewId, navigate } = useApp();
  const [data, setData] = useState<MissionControlResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = () => api.get<MissionControlResp>("/api/mission-control").then((d) => {
    setData(d);
    setSelected((s) => s ?? d.crew[0]?.crew.code ?? null);
  }).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, []);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <Loading label="Loading crew data" />;
  if (!data.mission) return <Notice>No mission loaded. Use “Load demo mission” in the sidebar.</Notice>;

  const entry = data.crew.find((r) => r.crew.code === selected) ?? data.crew[0];
  const flaggedCount = data.crew.filter((r) => r.assessments_flagged > 0).length;
  const openAs = (code: string, screen: "analysis" | "lab", params?: Record<string, string>) => {
    const c = allCrew.find((x) => x.code === code);
    if (c) setSelectedCrewId(c.id);
    navigate(screen, params);
  };

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-cond text-[40px] font-bold leading-[1.05] text-ink">Mission control</h1>
        <p className="mt-1.5 max-w-[72ch] text-[15.5px] text-dim">
          Crew results for the flight surgeon and operations reviewers. {flaggedCount === 0 ? "No crew member has a flagged change right now." :
            `${flaggedCount} of ${data.crew.length} crew members ${flaggedCount === 1 ? "has" : "have"} a change worth reviewing; they are listed first.`}
        </p>
      </div>
      <DemoScenarioBanner text="Fictional crew with synthetic assessment histories and self-reports." />
      <Notice>{data.notice} Sleep score and readiness are wearable-style wellness indicators (0–100); they never decide a flag or a schedule.</Notice>

      <Roster data={data} selected={entry?.crew.code ?? null} onSelect={setSelected} />

      {entry && (
        <CrewDetail key={entry.crew.code} entry={entry} statuses={data.review_statuses} onNotesChanged={load}
          onAnalysis={(type) => openAs(entry.crew.code, "analysis", { type })}
          onPlanner={() => navigate("planner", { crew: entry.crew.code })} />
      )}
    </div>
  );
}

function Spark({ series, median, category }: { series: RosterAssessment["series"]; median: number | null; category: Category }) {
  const pts = series.filter((s) => s.value != null && s.status === "valid");
  if (pts.length < 2) return <span className="text-[12px] text-faint">Not enough data</span>;
  const vals = pts.map((p) => p.value as number).concat(median != null ? [median] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 120, H = 30;
  const x = (i: number) => (i / (pts.length - 1)) * (W - 6) + 3;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="block">
      {median != null && <line x1={0} x2={W} y1={y(median)} y2={y(median)} stroke={chartTheme.cyan} strokeDasharray="3 3" strokeWidth={1} />}
      <polyline fill="none" stroke="#9AA3AA" strokeWidth={1.4} points={pts.map((p, i) => `${x(i)},${y(p.value as number)}`).join(" ")} />
      <circle cx={x(pts.length - 1)} cy={y(last.value as number)} r={3.5} fill={CAT_COLOR[category] ?? chartTheme.dim} />
    </svg>
  );
}

function MetricCell({ a }: { a: RosterAssessment }) {
  const r = a.key_metric_result;
  return (
    <div className="space-y-1.5">
      <CategoryBadge category={a.category} small />
      <div className="flex items-center gap-3">
        <div className="font-cond text-[15px] tnum leading-tight">
          <span className="font-semibold text-ink">{fmt(r?.value, 0)} ms</span>
          <span className="text-faint"> vs {fmt(r?.baseline.median, 0)}</span>
          {r?.difference != null && <div className={cx("text-[13px]", a.category === "change_worth_reviewing" ? "text-amber" : "text-dim")}>{signed(r.difference, 0)} ms</div>}
        </div>
        <Spark series={a.series} median={r?.baseline.median ?? null} category={a.category} />
      </div>
      {a.flagged.length > 0 && <div className="text-[12.5px] leading-snug text-amber">Flagged: {a.flagged.map((f) => f.label.replace(/ \(.*\)$/, "")).join(", ")}</div>}
      {a.category === "invalid_measurement" && <div className="text-[12.5px] text-rose">Latest run invalid; not interpreted</div>}
    </div>
  );
}

function Roster({ data, selected, onSelect }: { data: MissionControlResp; selected: string | null; onSelect: (c: string) => void }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-line bg-panel" aria-label="Crew roster">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] text-[14px]">
          <caption className="sr-only">Crew roster. Select a row to see that crew member's details.</caption>
          <thead>
            <tr className="border-b border-line bg-deck text-left text-[13px] text-dim">
              <th className="py-2.5 pl-5 pr-3 font-medium">Crew member</th>
              <th className="px-3 font-medium">Vigilant attention <span className="text-faint">(median RT)</span></th>
              <th className="px-3 font-medium">Precision motor <span className="text-faint">(median movement)</span></th>
              <th className="px-3 font-medium">Last night <span className="text-faint">(wearable)</span></th>
              <th className="px-3 font-medium">Latest check-in</th>
              <th className="px-3 font-medium">EVA load</th>
              <th className="px-3 font-medium">Data quality</th>
              <th className="px-3 pr-5 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {data.crew.map((r) => {
              const sr = r.self_reports[r.self_reports.length - 1];
              const w = r.workload;
              const active = r.crew.code === selected;
              const invalid = r.assessments.pvt.invalid_sessions + r.assessments.motor.invalid_sessions;
              return (
                <tr key={r.crew.code} onClick={() => onSelect(r.crew.code)}
                  className={cx("cursor-pointer border-b border-line/70 align-top transition-colors last:border-0", active ? "bg-cyan-deep/60" : "hover:bg-deck")}>
                  <td className="relative py-3.5 pl-5 pr-3">
                    {r.assessments_flagged > 0 && <span className="absolute left-0 top-0 bottom-0 w-1 bg-amber" aria-hidden />}
                    <button onClick={(e) => { e.stopPropagation(); onSelect(r.crew.code); }} aria-pressed={active}
                      className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded">
                      <div className="font-cond text-[22px] font-bold leading-none text-ink">{r.crew.code}</div>
                      <div className="mt-1 text-[12.5px] text-dim">{r.crew.role.split(" · ")[0]}</div>
                    </button>
                    <div className="mt-1.5"><ProvenanceBadge p={r.crew.provenance} /></div>
                  </td>
                  <td className="px-3 py-3.5"><MetricCell a={r.assessments.pvt} /></td>
                  <td className="px-3 py-3.5"><MetricCell a={r.assessments.motor} /></td>
                  <td className="whitespace-nowrap px-3 py-3.5"><WearableCell w={r.wearable} /></td>
                  <td className="px-3 py-3.5">
                    {sr ? (
                      <div className="font-cond text-[15px] leading-snug tnum">
                        <div><span className="text-faint">Sleep</span> <span className="font-semibold">{fmt(sr.sleep_hours, 1)} h</span></div>
                        <div><span className="text-faint">Fatigue</span> <span className="font-semibold">{fmt(sr.fatigue)}/10</span> <span className="text-faint">Recovery</span> <span className="font-semibold">{fmt(sr.recovery)}/10</span></div>
                        <div><span className="text-faint">Raw TLX</span> <span className="font-semibold">{fmt(sr.raw_tlx, 0)}</span></div>
                        <div className="mt-1"><SelfReportedTag /></div>
                      </div>
                    ) : <span className="text-dim">None</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 font-cond text-[15px] leading-snug tnum">
                    <div><span className="font-semibold">{w.completed_evas}</span> done, {fmt(w.completed_hours, 1)} h</div>
                    <div className="text-dim">Next {w.next_eva ? `day ${w.next_eva.mission_day}, ${hhmm(w.next_eva.start_hour)}` : "none"}</div>
                    {w.rest_before_next_hours != null && <div className="text-dim">Rest before it {fmt(w.rest_before_next_hours, 1)} h</div>}
                  </td>
                  <td className="px-3 py-3.5 text-[13px] leading-snug">
                    <div>Baseline <span className="font-semibold text-ink">{r.assessments.pvt.baseline_status}</span></div>
                    <div className={invalid ? "text-rose" : "text-dim"}>{invalid} invalid run{invalid === 1 ? "" : "s"}</div>
                  </td>
                  <td className="px-3 py-3.5 pr-5 text-[13px] leading-snug">
                    {r.latest_note ? (
                      <>
                        <div className="font-semibold text-ink">{r.latest_note.status_label}</div>
                        <div className="text-faint">{r.latest_note.author}, {new Date(r.latest_note.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</div>
                      </>
                    ) : <span className={r.assessments_flagged ? "font-semibold text-amber" : "text-faint"}>{r.assessments_flagged ? "Not reviewed yet" : "No review needed"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CrewDetail({ entry, statuses, onNotesChanged, onAnalysis, onPlanner }: {
  entry: RosterEntry; statuses: Record<string, string>; onNotesChanged: () => void;
  onAnalysis: (t: "pvt" | "motor") => void; onPlanner: () => void;
}) {
  const flagged = [...entry.assessments.pvt.flagged.map((f) => ({ ...f, a: "Vigilant attention" })), ...entry.assessments.motor.flagged.map((f) => ({ ...f, a: "Precision motor" }))];
  return (
    <section aria-labelledby="crew-detail" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-6">
        <div>
          <h2 id="crew-detail" className="font-cond text-[32px] font-bold leading-none text-ink">{entry.crew.code}</h2>
          <p className="mt-1.5 text-[14px] text-dim">{entry.crew.display_name}, {entry.crew.role.split(" · ")[0].toLowerCase()}. Qualified for {entry.crew.qualifications.join(", ")}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onAnalysis("pvt")}><LineIcon size={15} /> Open recovery analysis</Button>
          <Button variant="primary" onClick={onPlanner}><CalendarRange size={15} /> Model a restriction for {entry.crew.code}</Button>
        </div>
      </div>

      <WearableCard w={entry.wearable} who={entry.crew.code} />

      <div className="grid gap-5 xl:grid-cols-2">
        {(["pvt", "motor"] as const).map((k) => <MetricChart key={k} a={entry.assessments[k]} onOpen={() => onAnalysis(k)} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title={`Flagged observations (${flagged.length})`} icon={<ClipboardList size={16} />} className="xl:col-span-2"
          subtitle="Each flag needs both an adverse robust z of at least 3 and a change above the metric's minimum. Exploratory rules, not clinical cutoffs.">
          {flagged.length === 0 ? <p className="text-[14px] text-dim">No metric currently meets the flagging rules for {entry.crew.code}.</p> : (
            <ul className="divide-y divide-line">
              {flagged.map((f) => (
                <li key={`${f.a}-${f.metric}`} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold text-ink">{f.label} <span className="font-normal text-faint">({f.a})</span></div>
                    <div className="font-cond text-[15px] tnum text-amber">{signed(f.difference, f.unit === "ratio" ? 3 : f.unit.startsWith("%") ? 2 : 0)} {f.unit === "count" || f.unit === "ratio" ? "" : f.unit}, z {signed(f.robust_z, 1)}</div>
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-dim">{f.observations[0]}</p>
                  {f.consecutive_sessions > 1 && <p className="mt-0.5 text-[13px] font-medium text-amber">Flagged in {f.consecutive_sessions} consecutive sessions.</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <EvaCard entry={entry} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <CheckInCard reports={entry.self_reports} />
        <NotesCard entry={entry} statuses={statuses} onSaved={onNotesChanged} />
      </div>
    </section>
  );
}

function MetricChart({ a, onOpen }: { a: RosterAssessment; onOpen: () => void }) {
  const r = a.key_metric_result;
  const base = r?.baseline;
  const band = base?.median != null && base.scale != null ? [base.median - 3 * base.scale, base.median + 3 * base.scale] : null;
  const rows = a.series.filter((s) => s.value != null).map((s, i) => ({ ...s, i: i + 1, label: missionTime(s.t) }));
  return (
    <Card title={a.label} actions={<CategoryBadge category={a.category} small />}
      subtitle={`${a.key_metric === "median_rt_ms" ? "Median reaction time" : "Median movement time"} per session. Baseline ${base?.status ?? "insufficient"} (n=${base?.n ?? 0}).`}>
      <div className="h-48" role="img" aria-label={`${a.label} across sessions`}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
            <XAxis dataKey="i" tick={chartTheme.tick} stroke={chartTheme.axis} />
            <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} domain={["auto", "auto"]} />
            {band && <ReferenceArea y1={band[0]} y2={band[1]} fill={chartTheme.cyan} fillOpacity={0.07} />}
            {base?.median != null && <ReferenceLine y={base.median} stroke={chartTheme.cyan} strokeDasharray="4 4" />}
            <Tooltip {...chartTheme.tooltip} labelFormatter={(_, p) => (p?.[0]?.payload ? `${p[0].payload.label}, ${p[0].payload.phase}${p[0].payload.status !== "valid" ? ", invalid" : ""}` : "")}
              formatter={(v: number) => [`${v.toFixed(0)} ms`, "value"]} />
            <Line dataKey="value" stroke={chartTheme.dim} strokeOpacity={0.45} dot={false} isAnimationActive={false} />
            <Scatter dataKey="value" isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: { category: Category; status: string } }) => (
                <circle cx={p.cx} cy={p.cy} r={4.5} fill={p.payload?.status !== "valid" ? chartTheme.rose : CAT_COLOR[p.payload?.category ?? "baseline"]} stroke="#fff" strokeWidth={1.5} />
              )} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-dim">
        <span>{a.trend ? `Mission trend ${signed(a.trend.slope_per_day, 0)} ms per day (90% interval ${fmt(a.trend.low, 0)} to ${fmt(a.trend.high, 0)}).` : "Too few mission sessions for a trend."}</span>
        <button onClick={onOpen} className="text-cyan underline decoration-dotted underline-offset-2 hover:text-ink">Full analysis</button>
      </div>
    </Card>
  );
}

function EvaCard({ entry }: { entry: RosterEntry }) {
  const w = entry.workload;
  return (
    <Card title="EVA workload" icon={<CalendarRange size={16} />}>
      <div className="grid grid-cols-2 gap-4 font-cond tnum">
        <div><div className="font-sans text-[13px] text-dim">Completed</div><div className="text-[26px] font-semibold leading-tight">{hoursToHM(w.completed_hours)}</div><div className="font-sans text-[12.5px] text-faint">{w.completed_evas} EVAs</div></div>
        <div><div className="font-sans text-[13px] text-dim">Still planned</div><div className="text-[26px] font-semibold leading-tight">{hoursToHM(w.planned_hours)}</div><div className="font-sans text-[12.5px] text-faint">{w.planned_evas} EVAs</div></div>
        <div><div className="font-sans text-[13px] text-dim">Rest before next EVA</div><div className="text-[26px] font-semibold leading-tight">{w.rest_before_next_hours != null ? `${fmt(w.rest_before_next_hours, 1)} h` : "—"}</div></div>
        <div><div className="font-sans text-[13px] text-dim">Consecutive EVA days</div><div className="text-[26px] font-semibold leading-tight">{w.consecutive_eva_days_to_date}</div><div className="font-sans text-[12.5px] text-faint">up to the last EVA</div></div>
      </div>
      <ul className="mt-4 divide-y divide-line border-t border-line text-[13.5px]">
        {w.evas.map((e) => (
          <li key={e.id} className="flex items-center justify-between py-2">
            <span className="font-semibold">EVA {e.eva_number}</span>
            <span className="font-cond text-[15px] tnum text-dim">Day {e.mission_day}, {hhmm(e.start_hour)}, {fmt(e.duration_hours, 1)} h</span>
            <span className={cx("text-[12.5px]", e.status === "completed" ? "text-faint" : "font-semibold text-ink")}>{e.status}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CheckInCard({ reports }: { reports: SelfReport[] }) {
  const rows = reports.map((r, i) => ({
    i, label: r.mission_day ? `D${r.mission_day}` : "pre", sleep: r.sleep_hours, fatigue: r.fatigue, recovery: r.recovery,
    tlx: r.raw_tlx != null ? r.raw_tlx / 10 : null,
  }));
  return (
    <Card title="Check-ins" icon={<Moon size={16} />} actions={<SelfReportedTag />} className="xl:col-span-2"
      subtitle="Self-reported sleep, fatigue, recovery and Raw TLX (shown divided by 10). Context only; not part of any flag.">
      {rows.length === 0 ? <p className="text-[14px] text-dim">No check-ins yet.</p> : (
        <div className="h-56" role="img" aria-label="Self-reported check-ins over time">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={chartTheme.tick} stroke={chartTheme.axis} />
              <YAxis domain={[0, 10]} tick={chartTheme.tick} stroke={chartTheme.axis} />
              <Tooltip {...chartTheme.tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="sleep" name="Sleep (h)" stroke={chartTheme.cyan} strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="fatigue" name="Fatigue" stroke={chartTheme.amber} strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="recovery" name="Recovery" stroke={chartTheme.jade} strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="tlx" name="Raw TLX ÷ 10" stroke="#1D2227" strokeDasharray="4 3" strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function NotesCard({ entry, statuses, onSaved }: { entry: RosterEntry; statuses: Record<string, string>; onSaved: () => void }) {
  const [author, setAuthor] = useState(() => { try { return localStorage.getItem("eva.reviewer") ?? ""; } catch { return ""; } });
  const [status, setStatus] = useState("follow_up");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const opts = useMemo(() => Object.entries(statuses), [statuses]);
  const save = async () => {
    try {
      await api.post("/api/review-notes", { crew_member_id: entry.crew.id, author, status, note });
      try { localStorage.setItem("eva.reviewer", author); } catch { /* storage unavailable */ }
      setNote("");
      setMsg({ tone: "info", text: "Note saved." });
      onSaved();
    } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); }
  };
  const input = "w-full rounded-[6px] border border-line bg-panel px-3 py-2 text-[14px] text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan";
  return (
    <Card title="Reviewer notes" icon={<NotebookPen size={16} />} subtitle="Human decisions are recorded here. The software makes none.">
      <div className="space-y-3">
        <label className="block text-[13px] text-dim">Your name
          <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80} placeholder="e.g. Flight surgeon on duty" className={cx(input, "mt-1")} />
        </label>
        <fieldset>
          <legend className="text-[13px] text-dim">Decision</legend>
          <div className="mt-1 space-y-1">
            {opts.map(([k, label]) => (
              <label key={k} className={cx("flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-1.5 text-[14px]", status === k ? "border-ink bg-panel2" : "border-line")}>
                <input type="radio" name="review-status" value={k} checked={status === k} onChange={() => setStatus(k)} className="accent-[#1D2227]" /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-[13px] text-dim">Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="What you discussed, decided or want to check next." className={cx(input, "mt-1")} />
        </label>
        <Button onClick={save} disabled={!author.trim() || !note.trim()}>Save note</Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
      {entry.reviewer_notes.length > 0 && (
        <ul className="mt-5 space-y-3 border-t border-line pt-4">
          {entry.reviewer_notes.map((n) => (
            <li key={n.id} className="text-[13.5px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{n.status_label}</span>
                <span className="text-[12.5px] text-faint">{n.author}, {new Date(n.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
              <p className="mt-0.5 text-dim">{n.note}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
