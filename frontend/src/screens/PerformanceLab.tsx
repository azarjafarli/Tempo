import { ClipboardCheck, Crosshair, History, Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import CheckIn from "../assessments/CheckIn";
import MotorTask from "../assessments/MotorTask";
import PvtTask from "../assessments/PvtTask";
import { Button, Card, CategoryBadge, cx, Notice, ProvenanceBadge, Select } from "../components/ui";
import { useApp } from "../context";
import { api } from "../lib/api";
import { fmt, missionTime } from "../lib/format";
import type { Session } from "../lib/types";

type Tab = "pvt" | "motor" | "checkin";

export default function PerformanceLab() {
  const { crew, selectedCrewId, navigate, params } = useApp();
  const [tab, setTab] = useState<Tab>((params.tab as Tab) || "pvt");
  const [phase, setPhase] = useState<"baseline" | "mission">("mission");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [bump, setBump] = useState(0);
  const me = crew.find((c) => c.id === selectedCrewId)!;

  useEffect(() => {
    api.get<Session[]>(`/api/assessments?crew_id=${selectedCrewId}`).then(setSessions).catch(() => undefined);
  }, [selectedCrewId, bump]);

  useEffect(() => { setPhase(me.code === "LOCAL" && sessions.filter((s) => s.phase === "baseline" && s.status === "valid").length < 3 ? "baseline" : "mission"); }, [me.code, sessions.length]); // eslint-disable-line

  const tabs: { id: Tab; label: string; icon: typeof Keyboard }[] = [
    { id: "pvt", label: "A · Vigilant attention", icon: Keyboard },
    { id: "motor", label: "B · Precision motor", icon: Crosshair },
    { id: "checkin", label: "C · Workload check-in", icon: ClipboardCheck },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-cond text-[40px] font-bold leading-[1.05] text-ink">Take an assessment</h1>
          <p className="mt-1.5 max-w-[68ch] text-[15.5px] text-dim">Three short tasks: a reaction-time test, a precision clicking test and a check-in. Each result is saved and compared with your baseline.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Session type" value={phase} onChange={setPhase}
            options={[{ value: "mission", label: "Mission session (compare)" }, { value: "baseline", label: "Baseline session (build baseline)" }]} />
        </div>
      </div>

      {!me.is_fictional && (
        <Notice>Recording your own measurements. Record at least 3 baseline sessions (5 for an “established” baseline) before mission-session comparisons are interpreted.</Notice>
      )}

      <div role="tablist" aria-label="Assessments" className="flex flex-wrap gap-2">
        {tabs.map((t) => { const Icon = t.icon; return (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cx("flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
              tab === t.id ? "border-cyan/60 bg-cyan-deep/50 text-cyan" : "border-line text-dim hover:text-ink")}>
            <Icon size={15} /> {t.label}
          </button>); })}
      </div>

      <div role="tabpanel">
        {tab === "pvt" && <PvtTask key={`p${selectedCrewId}`} crewId={selectedCrewId!} phase={phase} onSaved={() => setBump((b) => b + 1)} />}
        {tab === "motor" && <MotorTask key={`m${selectedCrewId}`} crewId={selectedCrewId!} phase={phase} onSaved={() => setBump((b) => b + 1)} />}
        {tab === "checkin" && <CheckIn key={`c${selectedCrewId}`} crewId={selectedCrewId!} />}
      </div>

      <Card title="Recorded sessions" icon={<History size={15} />} subtitle="Every session keeps its raw trial-level observations; reopen any of them in Recovery Analysis.">
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-panel"><tr className="text-left text-[11px] text-faint">
              <th className="py-2 font-normal">#</th><th className="font-normal">Assessment</th><th className="font-normal">When</th><th className="font-normal">Phase</th>
              <th className="font-normal">Key result</th><th className="font-normal">Status</th><th className="font-normal">Source</th><th /></tr></thead>
            <tbody>
              {[...sessions].reverse().map((s) => (
                <tr key={s.id} className="border-t border-line/60">
                  <td className="py-2 font-cond tnum text-faint">{s.id}</td>
                  <td>{s.assessment_type === "pvt" ? "Vigilant attention" : "Precision motor"} <span className="text-xs text-faint">({s.mode})</span></td>
                  <td className="text-dim">{s.provenance === "synthetic" ? missionTime(s.mission_time_days) : new Date(s.started_at).toLocaleString()}</td>
                  <td className="text-dim">{s.phase}</td>
                  <td className="font-cond tnum">{s.assessment_type === "pvt" ? `${fmt(s.summary.median_rt_ms as number)} ms` : `${fmt(s.summary.median_movement_time_ms as number)} ms`}</td>
                  <td>{s.status === "valid" ? <span className="text-jade">valid</span> : <CategoryBadge category="invalid_measurement" small />}</td>
                  <td><ProvenanceBadge p={s.provenance} /></td>
                  <td><Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => navigate("analysis", { type: s.assessment_type, session: String(s.id) })}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
