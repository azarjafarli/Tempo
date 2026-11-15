import { AlertOctagon, CheckCircle2, History, Lock, Pencil, Play, Scale, ShieldAlert, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, cx, Loading, Notice, NumberField, ProvenanceBadge, Select } from "../components/ui";
import { useApp } from "../context";
import { api } from "../lib/api";
import { hhmm } from "../lib/format";
import type { Crew, Mission, OptimizeResult, Placement, PlanView, Task } from "../lib/types";

interface TasksResp {
  mission: Mission; crew: Crew[]; tasks: Task[];
  defaults: { max_eva_hours: number; min_rest_hours: number };
  historical_reference: { records: number; duration_hours: { median: number; q1: number; q3: number; max: number }; note: string } | null;
}

type Kind = "original" | "reduced_workload" | "longer_rest";
const PRESETS: { kind: Kind; title: string; text: string }[] = [
  { kind: "original", title: "1 · Original plan", text: "Baseline constraints only: validates the plan as written." },
  { kind: "reduced_workload", title: "2 · Reduced workload", text: "A reviewer limits one astronaut’s EVA hours or days." },
  { kind: "longer_rest", title: "3 · Longer rest interval", text: "A reviewer requires a longer minimum rest between EVA days." },
];

const PRI_STYLE: Record<string, string> = {
  high: "border-amber/60 bg-amber-deep/70 text-amber",
  medium: "border-cyan/50 bg-cyan-deep/60 text-cyan",
  low: "border-line bg-panel2 text-dim",
};

export default function MissionPlanner() {
  const [data, setData] = useState<TasksResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { params } = useApp();
  const [kind, setKind] = useState<Kind>("reduced_workload");
  const [maxH, setMaxH] = useState(7.5);
  const [rest, setRest] = useState(12);
  const [crewCode, setCrewCode] = useState(params.crew || "VEGA");
  const [crewMax, setCrewMax] = useState(3);
  const [unavail, setUnavail] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<{ id: number; name: string; kind: string; solver_status: string; created_at: string }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => api.get<TasksResp>("/api/schedule/tasks").then((d) => { setData(d); setMaxH(d.defaults.max_eva_hours); }).catch((e) => setErr(e.message));
  const loadHistory = () => api.get<typeof history>("/api/schedule/scenarios").then(setHistory).catch(() => undefined);
  useEffect(() => {
    void load();
    // Open a saved scenario on arrival so the comparison is never empty (prefer the reduced-workload one).
    api.get<typeof history>("/api/schedule/scenarios").then((h) => {
      setHistory(h);
      const pick = h.find((x) => x.kind === "reduced_workload") ?? h[0];
      if (pick && !params.crew) api.get<OptimizeResult>(`/api/schedule/scenarios/${pick.id}`).then((r) => setResult((cur) => cur ?? r)).catch(() => undefined);
    }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (k: Kind) => {
    setKind(k);
    setResult(null);
    if (k === "original") { setRest(12); setUnavail([]); }
    if (k === "reduced_workload") { setRest(12); setCrewMax(3); setUnavail([]); }
    if (k === "longer_rest") { setRest(18); setUnavail([]); }
  };

  const loosened = maxH >= 7 && rest <= 16.5 && !(kind === "reduced_workload" && (crewMax < 7 || unavail.length > 0));

  const run = async () => {
    setRunning(true);
    setErr(null);
    const restrictions = kind === "reduced_workload" ? { [crewCode]: { max_eva_hours: crewMax, unavailable_days: unavail } } : {};
    const parts = [`max ${maxH} h/day`, `rest ≥ ${rest} h`];
    if (kind === "reduced_workload") parts.unshift(`${crewCode} limited to ${crewMax} h/day${unavail.length ? `, off day ${unavail.join(",")}` : ""}`);
    const name = parts.join(", ");
    try {
      const r = await api.post<OptimizeResult>("/api/schedule/optimize", {
        name, kind, max_eva_hours: maxH, min_rest_hours: rest, crew_restrictions: restrictions, reviewer_note: note || null,
      });
      setResult(r);
      void loadHistory();
    } catch (e) { setErr((e as Error).message); }
    finally { setRunning(false); }
  };

  const openSaved = async (id: number) => {
    try { setResult(await api.get<OptimizeResult>(`/api/schedule/scenarios/${id}`)); } catch (e) { setErr((e as Error).message); }
  };

  if (!data) return err ? <Notice tone="error">{err}</Notice> : <Loading label="Loading EVA plan" />;
  const m = data.mission;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-cond text-[40px] font-bold leading-[1.05] text-ink">Test a schedule change</h1>
        <p className="mt-1.5 max-w-[68ch] text-[15.5px] text-dim">See how a reviewer’s restriction, such as fewer EVA hours or longer rest, would reshape the five-day lunar EVA plan.</p>
      </div>
      <Notice tone="warn">
        <ShieldAlert size={14} className="mr-1 inline" />
        <strong>The planner never decides that anyone is unfit.</strong> A medical or operational reviewer chooses a hypothetical restriction to investigate.
        All recovery-related restrictions are user-provided planning assumptions, not validated physiological predictions. Outputs are hypothetical scenarios, not observations.
      </Notice>

      <Card title="Scenario" icon={<Scale size={15} />} subtitle="Pick a comparison, set the reviewer’s assumptions, then run the OR-Tools CP-SAT optimizer.">
        <div className="grid gap-3 md:grid-cols-3">
          {PRESETS.map((p) => (
            <button key={p.kind} onClick={() => applyPreset(p.kind)} aria-pressed={kind === p.kind}
              className={cx("rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                kind === p.kind ? "border-cyan/70 bg-cyan-deep/40" : "border-line bg-deck/60 hover:border-faint")}>
              <div className={cx("text-sm font-semibold", kind === p.kind ? "text-cyan" : "text-ink")}>{p.title}</div>
              <div className="mt-1 text-xs text-dim">{p.text}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-5">
          <NumberField label="Max EVA hours / crew / day" value={maxH} onChange={setMaxH} min={1} max={12} step={0.5} suffix="h" />
          <NumberField label="Minimum rest between EVA days" value={rest} onChange={setRest} min={0} max={24} step={0.5} suffix="h" />
          {kind === "reduced_workload" && (
            <>
              <Select label="Restricted astronaut" value={crewCode} onChange={setCrewCode} options={data.crew.map((c) => ({ value: c.code, label: c.display_name }))} />
              <NumberField label="Their max EVA hours / day" value={crewMax} onChange={setCrewMax} min={0} max={12} step={0.5} suffix="h" />
              <fieldset className="flex flex-col gap-1 text-xs text-faint">
                <legend className="">Unavailable days</legend>
                <div className="mt-1 flex gap-1.5">
                  {Array.from({ length: m.num_days }, (_, i) => i + 1).filter((d) => d >= m.current_day).map((d) => (
                    <label key={d} className={cx("cursor-pointer rounded-md border px-2.5 py-1.5 font-cond tnum text-xs", unavail.includes(d) ? "border-amber bg-amber-deep text-amber" : "border-line text-dim")}>
                      <input type="checkbox" className="sr-only" checked={unavail.includes(d)} onChange={() => setUnavail(unavail.includes(d) ? unavail.filter((x) => x !== d) : [...unavail, d])} />D{d}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </div>
        <label className="mt-4 flex flex-col gap-1 text-xs text-faint">
          <span className="">Reviewer note (who chose this assumption and why)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Flight surgeon review after flagged vigilance change — exploring reduced load"
            className="rounded-lg border border-line bg-deck px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan" />
        </label>
        {loosened && (
          <div className="mt-4"><Notice>
            These limits are looser than the current plan needs (it uses at most 7 EVA hours a day and has at least
            16.5 h of rest between EVA days), so the optimizer will keep the plan unchanged. Tighten them to see changes,
            for example a maximum of 5 h or a minimum rest of 18 h.
          </Notice></div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={running}><Play size={15} /> {running ? "Optimizing…" : "Run optimization"}</Button>
          {err && <span className="text-sm text-rose">{err}</span>}
          {data.historical_reference && (
            <span className="ml-auto flex items-center gap-2 text-xs text-dim">
              <ProvenanceBadge p="nasa_public_data" /> Historical US/Russian EVAs (n={data.historical_reference.records}): median {data.historical_reference.duration_hours.median.toFixed(1)} h,
              IQR {data.historical_reference.duration_hours.q1.toFixed(1)}–{data.historical_reference.duration_hours.q3.toFixed(1)} h · context only
            </span>
          )}
        </div>
      </Card>

      {result && <ResultView result={result} crew={data.crew} numDays={m.num_days} currentDay={m.current_day} />}

      <TaskTable data={data} editing={editing} setEditing={setEditing} onSaved={() => { void load(); setResult(null); }} />

      {history.length > 0 && (
        <Card title="Saved scenarios" icon={<History size={15} />} subtitle="Every run is stored with its parameters and solver result.">
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button key={h.id} onClick={() => openSaved(h.id)}
                className="rounded-lg border border-line bg-deck/60 px-3 py-1.5 text-left text-xs hover:border-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                <span className="font-cond tnum text-faint">#{h.id}</span> <span className="text-ink">{h.name}</span> <span className={h.solver_status === "INFEASIBLE" ? "text-rose" : "text-jade"}>{h.solver_status}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ResultView({ result, crew, numDays, currentDay }: { result: OptimizeResult; crew: Crew[]; numDays: number; currentDay: number }) {
  const changed = useMemo(() => new Map(result.changes.map((c) => [c.task, c.kinds])), [result]);
  return (
    <div className="space-y-5">
      <Card title={`Result · ${result.name}`} icon={result.feasible ? <CheckCircle2 size={15} /> : <AlertOctagon size={15} />}
        actions={<ProvenanceBadge p="hypothetical_scenario" long />}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={cx("rounded-full border px-3 py-1 text-sm font-semibold", result.feasible ? "border-jade/50 bg-jade-deep/60 text-jade" : "border-rose/50 bg-rose-deep/60 text-rose")}>
            {result.feasible ? "Feasible schedule found" : "Infeasible"} · solver {result.solver_status}
          </span>
          <span className="text-xs text-dim">max {result.scenario.max_eva_hours} h/day · rest ≥ {result.scenario.min_rest_hours} h
            {Object.entries(result.scenario.crew_restrictions).map(([c, r]) => ` · ${c}: ${r.max_eva_hours ?? "—"} h/day${r.unavailable_days?.length ? `, unavailable D${r.unavailable_days.join(",D")}` : ""}`)}</span>
          {result.objective && (
            <span className="ml-auto font-cond tnum text-xs text-dim">objective {result.objective.total} = postpone {result.objective.postponement_cost} + reassign {result.objective.reassignment_cost} + disruption {result.objective.disruption_cost}{result.objective.proven_optimal ? " · proven optimal" : ""}</span>
          )}
        </div>
        {result.feasible && result.changes.length === 0 && (
          <div className="mt-3"><Notice>No changes were needed: the original plan already meets every limit in this scenario. Only stricter limits make the optimizer move, reassign or postpone tasks.</Notice></div>
        )}
        {result.reviewer_note && <p className="mt-3 text-xs text-dim">Reviewer note: “{result.reviewer_note}”</p>}
        <p className="mt-2 text-xs text-faint">{result.assumption_notice}</p>
        {!result.feasible && result.infeasibility && (
          <div className="mt-4 space-y-3">
            <Notice tone="error">{result.infeasibility.explanation}</Notice>
            {result.infeasibility.conflicting_requirements.length > 0 && (
              <div><div className="text-[11px] text-faint">Minimal set of conflicting requirements</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">{result.infeasibility.conflicting_requirements.map((r) => <li key={r}>{r}</li>)}</ul></div>
            )}
            {result.infeasibility.diagnostics.length > 0 && (
              <div><div className="text-[11px] text-faint">Diagnostics</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-dim">{result.infeasibility.diagnostics.map((r) => <li key={r}>{r}</li>)}</ul></div>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Gantt title="Original plan" plan={result.original} crew={crew} numDays={numDays} currentDay={currentDay} changed={changed} side="original" />
        {result.optimized ? <Gantt title="Optimized alternative" plan={result.optimized} crew={crew} numDays={numDays} currentDay={currentDay} changed={changed} side="optimized" />
          : <Card title="Optimized alternative"><p className="text-sm text-dim">No feasible alternative under these assumptions. See the explanation above.</p></Card>}
      </div>

      {result.feasible && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card title={`Changes & why (${result.changes.length})`} className="xl:col-span-2">
            {result.changes.length === 0 ? <p className="text-sm text-dim">No changes needed — the original plan already satisfies this scenario.</p> : (
              <ul className="space-y-3">
                {result.changes.map((c) => (
                  <li key={c.task} className="rounded-lg border border-line bg-deck/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-cond tnum text-sm text-cyan">{c.task}</span><span className="text-sm text-ink">{c.name}</span>
                      {c.kinds.map((k) => <span key={k} className={cx("rounded border px-1.5 py-0.5 font-cond tnum text-[10px]", k === "postponed" ? "border-rose/50 text-rose" : "border-amber/50 text-amber")}>{k.replace("_", " ")}</span>)}
                    </div>
                    <div className="mt-1 font-cond tnum text-xs text-dim">
                      D{c.original.day ?? "—"} {hhmm(c.original.start_hour)} [{c.original.crew.join("+")}] → {c.optimized.day ? `D${c.optimized.day} ${hhmm(c.optimized.start_hour)} [${c.optimized.crew.join("+")}]` : "postponed beyond plan"}
                    </div>
                    <ul className="mt-2 space-y-0.5 text-xs text-dim">{c.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="space-y-5">
            <Card title="Planning conflicts in original">
              {result.original.conflicts.length === 0 ? <p className="text-sm text-jade">None under this scenario.</p> : (
                <ul className="space-y-1.5 text-xs text-rose">{result.original.conflicts.map((c, i) => <li key={i}>• {c.message}</li>)}</ul>
              )}
              <p className="mt-3 text-xs text-faint">Optimized plan conflicts: {result.optimized?.conflicts.length ?? "—"}</p>
            </Card>
            <Card title="Postponed tasks">
              {result.postponed.length === 0 ? <p className="text-sm text-jade">None.</p> : <p className="font-cond tnum text-sm text-rose">{result.postponed.join(", ")}</p>}
            </Card>
            <RestTable plan={result.optimized!} currentDay={currentDay} min={result.scenario.min_rest_hours} />
          </div>
        </div>
      )}
    </div>
  );
}

function RestTable({ plan, currentDay, min }: { plan: PlanView; currentDay: number; min: number }) {
  return (
    <Card title="Rest intervals (optimized)">
      <table className="w-full text-xs">
        <tbody>
          {plan.rest_intervals.map((r, i) => (
            <tr key={i} className="border-t border-line/60">
              <td className="py-1 font-cond tnum text-ink">{r.crew}</td><td className="text-dim">D{r.from_day}→D{r.to_day}</td>
              <td className={cx("text-right font-cond tnum", r.to_day >= currentDay && r.rest_hours < min ? "text-rose" : "text-jade")}>{r.rest_hours.toFixed(1)} h</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const H0 = 7, H1 = 19;

function Gantt({ title, plan, crew, numDays, currentDay, changed, side }: {
  title: string; plan: PlanView; crew: Crew[]; numDays: number; currentDay: number; changed: Map<string, string[]>; side: "original" | "optimized";
}) {
  const days = Array.from({ length: numDays }, (_, i) => i + 1);
  const conflictTasks = new Set(side === "original" ? plan.conflicts.flatMap((c) => c.tasks) : []);
  const blocks = (code: string, d: number) => plan.schedule.filter((p) => p.scheduled && p.day === d && p.crew.includes(code));
  return (
    <Card title={title} subtitle={`Rows: crew · columns: mission days (${String(H0).padStart(2, "0")}:00–${H1}:00)`}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] gap-1" style={{ gridTemplateColumns: `72px repeat(${numDays}, minmax(0,1fr))` }}>
          <div />
          {days.map((d) => <div key={d} className={cx("pb-1 text-center font-cond tnum text-[11px]", d === currentDay ? "text-cyan" : "text-faint")}>Day {d}{d < currentDay && " ✓"}</div>)}
          {crew.map((c) => (
            <div key={c.code} className="contents">
              <div className="flex items-center font-cond tnum text-xs text-ink">{c.code}</div>
              {days.map((d) => {
                const span = plan.eva_spans.find((s) => s.crew === c.code && s.day === d);
                return (
                  <div key={d} className={cx("relative h-14 rounded-md border", d < currentDay ? "border-line/50 bg-deck/30" : "border-line bg-deck/70")}>
                    {blocks(c.code, d).map((p) => <Block key={p.code} p={p} changed={changed.get(p.code)} conflict={conflictTasks.has(p.code)} side={side} />)}
                    {span && <div className={cx("absolute bottom-0.5 right-1 font-cond tnum text-[9px]", span.hours > span.limit_hours + 1e-9 ? "text-rose" : "text-faint")}>{span.hours.toFixed(1)}/{span.limit_hours > 12 ? "∞" : span.limit_hours}h</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-amber/60 bg-amber-deep" />high</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-cyan/50 bg-cyan-deep" />medium</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-line bg-panel2" />low</span>
        {side === "original" ? <span className="text-rose">red outline = violates scenario</span> : <span className="text-amber">dashed = changed by optimizer</span>}
        <span><Lock size={10} className="inline" /> fixed</span>
      </div>
    </Card>
  );
}

function Block({ p, changed, conflict, side }: { p: Placement; changed?: string[]; conflict: boolean; side: string }) {
  const left = ((p.start_hour! - H0) / (H1 - H0)) * 100;
  const width = (p.duration_hours / (H1 - H0)) * 100;
  return (
    <div title={`${p.code} ${p.name} · ${hhmm(p.start_hour)}–${hhmm(p.start_hour! + p.duration_hours)} · ${p.crew.join("+")} · ${p.priority}${changed ? ` · ${changed.join(", ")}` : ""}`}
      className={cx("absolute top-1.5 bottom-4 overflow-hidden rounded border px-0.5 text-[9px] leading-tight",
        p.status === "completed" ? "border-line bg-panel2/60 text-faint" : PRI_STYLE[p.priority],
        conflict && "ring-2 ring-rose", side === "optimized" && changed && "border-dashed border-2")}
      style={{ left: `${Math.max(0, left)}%`, width: `${width}%` }}>
      <span className="font-cond tnum font-semibold">{p.code}</span>{p.is_fixed && <Lock size={8} className="ml-0.5 inline" />}
    </div>
  );
}

function TaskTable({ data, editing, setEditing, onSaved }: { data: TasksResp; editing: string | null; setEditing: (c: string | null) => void; onSaved: () => void }) {
  return (
    <Card title="EVA task list (editable)" icon={<Pencil size={15} />} subtitle="Edit planned tasks; completed tasks are historical and locked. Changes apply to the original plan used by every scenario.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead><tr className="text-left text-[11px] text-faint">
            {["ID", "Task", "Dur.", "Priority", "Qualifications", "Assigned crew", "Planned", "Permitted window", "Depends on", "Fixed", ""].map((h) => <th key={h} className="pb-2 pr-2 font-normal">{h}</th>)}
          </tr></thead>
          <tbody>
            {data.tasks.map((t) => editing === t.task_code
              ? <EditRow key={t.task_code} t={t} data={data} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />
              : (
                <tr key={t.task_code} className={cx("border-t border-line/60", t.status === "completed" && "text-faint")}>
                  <td className="py-2 pr-2 font-cond tnum text-cyan">{t.task_code}</td>
                  <td className="pr-2">{t.name}{t.status === "completed" && <span className="ml-1 text-[10px]">· done</span>}</td>
                  <td className="pr-2 font-cond tnum">{t.duration_hours}h</td>
                  <td className="pr-2"><span className={cx("rounded border px-1.5 py-0.5 text-[11px]", PRI_STYLE[t.priority])}>{t.priority}</span></td>
                  <td className="pr-2 text-xs">EVA{t.required_qualifications.length ? ` + ${t.required_qualifications.join(", ")}` : ""}</td>
                  <td className="pr-2 font-cond tnum text-xs">{t.assigned_crew.join(" + ")}</td>
                  <td className="pr-2 font-cond tnum text-xs">D{t.planned_day} {hhmm(t.planned_start_hour)}</td>
                  <td className="pr-2 font-cond tnum text-xs">D{t.earliest_day}–D{t.latest_day}, {hhmm(t.window_start_hour)}–{hhmm(t.window_end_hour)}</td>
                  <td className="pr-2 font-cond tnum text-xs">{t.depends_on.join(", ") || "—"}</td>
                  <td className="pr-2">{t.is_fixed ? <Lock size={13} className="text-amber" aria-label="fixed" /> : ""}</td>
                  <td>{t.status !== "completed" && <button className="rounded p-1 text-dim hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan" aria-label={`Edit ${t.task_code}`} onClick={() => setEditing(t.task_code)}><Pencil size={14} /></button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EditRow({ t, data, onCancel, onSaved }: { t: Task; data: TasksResp; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...t });
  const [err, setErr] = useState<string | null>(null);
  const codes = data.crew.map((c) => c.code);
  const inp = "rounded border border-line bg-deck px-1.5 py-1 font-cond tnum text-xs text-ink focus:border-cyan focus:outline-none";
  const save = async () => {
    try {
      await api.put(`/api/schedule/tasks/${t.task_code}`, {
        name: f.name, duration_hours: f.duration_hours, priority: f.priority, assigned_crew: f.assigned_crew, planned_day: f.planned_day,
        planned_start_hour: f.planned_start_hour, earliest_day: f.earliest_day, latest_day: f.latest_day, is_fixed: f.is_fixed,
        depends_on: f.depends_on, required_qualifications: f.required_qualifications,
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <tr className="border-t border-cyan/40 bg-cyan-deep/10">
        <td className="py-2 pr-2 font-cond tnum text-cyan">{t.task_code}</td>
        <td className="pr-2"><input aria-label="Name" className={cx(inp, "w-44 font-sans")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></td>
        <td className="pr-2"><input aria-label="Duration hours" type="number" step={0.25} min={0.25} max={8} className={cx(inp, "w-16")} value={f.duration_hours} onChange={(e) => setF({ ...f, duration_hours: Number(e.target.value) })} /></td>
        <td className="pr-2"><select aria-label="Priority" className={inp} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task["priority"] })}>{["high", "medium", "low"].map((p) => <option key={p}>{p}</option>)}</select></td>
        <td className="pr-2"><input aria-label="Qualifications (comma separated)" className={cx(inp, "w-28")} value={f.required_qualifications.join(",")} onChange={(e) => setF({ ...f, required_qualifications: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></td>
        <td className="pr-2">
          {[0, 1].map((i) => (
            <select key={i} aria-label={`Crew ${i + 1}`} className={cx(inp, "mr-1")} value={f.assigned_crew[i] ?? ""}
              onChange={(e) => { const a = [...f.assigned_crew]; a[i] = e.target.value; setF({ ...f, assigned_crew: a }); }}>
              {codes.map((c) => <option key={c}>{c}</option>)}
            </select>
          ))}
        </td>
        <td className="pr-2 whitespace-nowrap">
          <select aria-label="Planned day" className={inp} value={f.planned_day ?? 1} onChange={(e) => setF({ ...f, planned_day: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>D{d}</option>)}</select>
          <input aria-label="Planned start hour" type="number" step={0.25} min={0} max={23.75} className={cx(inp, "ml-1 w-16")} value={f.planned_start_hour ?? 8} onChange={(e) => setF({ ...f, planned_start_hour: Number(e.target.value) })} />
        </td>
        <td className="pr-2 whitespace-nowrap">
          <select aria-label="Earliest day" className={inp} value={f.earliest_day} onChange={(e) => setF({ ...f, earliest_day: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>D{d}</option>)}</select>–
          <select aria-label="Latest day" className={inp} value={f.latest_day} onChange={(e) => setF({ ...f, latest_day: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>D{d}</option>)}</select>
        </td>
        <td className="pr-2"><input aria-label="Depends on (comma separated task IDs)" className={cx(inp, "w-20")} value={f.depends_on.join(",")} onChange={(e) => setF({ ...f, depends_on: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></td>
        <td className="pr-2"><input aria-label="Fixed" type="checkbox" checked={f.is_fixed} onChange={(e) => setF({ ...f, is_fixed: e.target.checked })} className="accent-[#f4b544]" /></td>
        <td className="whitespace-nowrap">
          <button onClick={save} className="mr-1 rounded border border-cyan/60 px-2 py-1 text-xs text-cyan hover:bg-cyan-deep">Save</button>
          <button onClick={onCancel} aria-label="Cancel" className="rounded p-1 text-dim hover:text-ink"><X size={14} /></button>
        </td>
      </tr>
      {err && <tr><td colSpan={11} className="pb-2 text-xs text-rose"><Undo2 size={12} className="mr-1 inline" />{err}</td></tr>}
    </>
  );
}
