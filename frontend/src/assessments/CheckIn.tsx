import { ClipboardCheck, Send } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, Card, Notice, ProvenanceBadge, SelfReportedTag } from "../components/ui";
import { api } from "../lib/api";
import { fmt } from "../lib/format";
import type { SelfReport } from "../lib/types";

const TLX: { key: string; label: string; q: string; low: string; high: string }[] = [
  { key: "tlx_mental", label: "Mental demand", q: "How mentally demanding was the task?", low: "Very low", high: "Very high" },
  { key: "tlx_physical", label: "Physical demand", q: "How physically demanding was the task?", low: "Very low", high: "Very high" },
  { key: "tlx_temporal", label: "Temporal demand", q: "How hurried or rushed was the pace?", low: "Very low", high: "Very high" },
  { key: "tlx_performance", label: "Performance", q: "How successful were you in accomplishing what you were asked to do?", low: "Perfect", high: "Failure" },
  { key: "tlx_effort", label: "Effort", q: "How hard did you have to work to accomplish your level of performance?", low: "Very low", high: "Very high" },
  { key: "tlx_frustration", label: "Frustration", q: "How insecure, discouraged, irritated, stressed and annoyed were you?", low: "Very low", high: "Very high" },
];

function Slider({ label, value, onChange, min, max, step, low, high, help }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; low: string; high: string; help?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm text-ink">{label}</label>
        <span className="font-cond tnum text-sm text-cyan">{value}</span>
      </div>
      {help && <p className="text-xs text-faint">{help}</p>}
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[#2B5F8E]" aria-valuetext={`${value}`} />
      <div className="flex justify-between text-[11px] text-faint"><span>{low}</span><span>{high}</span></div>
    </div>
  );
}

export default function CheckIn({ crewId }: { crewId: number }) {
  const [tlx, setTlx] = useState<Record<string, number>>(Object.fromEntries(TLX.map((t) => [t.key, 50])));
  const [notes, setNotes] = useState("");
  const [reports, setReports] = useState<SelfReport[]>([]);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const notesId = useId();

  useEffect(() => { api.get<SelfReport[]>(`/api/self-reports?crew_id=${crewId}`).then(setReports).catch(() => undefined); }, [crewId]);

  const raw = Math.round((Object.values(tlx).reduce((a, b) => a + b, 0) / 6) * 10) / 10;

  const submit = async () => {
    try {
      const r = await api.post<{ id: number; reports: SelfReport[] }>("/api/self-reports", {
        crew_member_id: crewId, ...tlx, notes: notes || null,
      });
      setReports(r.reports);
      setMsg({ tone: "info", text: `Workload rating #${r.id} saved.` });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card title="Workload check-in" icon={<ClipboardCheck size={15} />} actions={<SelfReportedTag />} className="xl:col-span-2"
        subtitle="Only perceived workload is self-reported. Sleep and recovery are measured by the wearable and appear as the sleep score and readiness.">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">NASA Task Load Index dimensions <span className="font-normal text-faint">(rate the most recent EVA or work block, 0–100)</span></h3>
            <div className="text-sm">Raw TLX <span className="font-cond tnum text-[22px] font-semibold text-ink">{raw}</span></div>
          </div>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            {TLX.map((t) => (
              <Slider key={t.key} label={t.label} help={t.q} value={tlx[t.key]} onChange={(v) => setTlx({ ...tlx, [t.key]: v })} min={0} max={100} step={5} low={t.low} high={t.high} />
            ))}
          </div>
          <p className="mt-4 text-xs text-faint">
            “Raw TLX” is the unweighted mean of the six ratings. It is <strong>not</strong> the complete weighted NASA-TLX procedure, which adds pairwise comparisons to weight each dimension.
          </p>
        </div>
        <div className="mt-5">
          <label htmlFor={notesId} className="text-xs text-faint">Notes (optional)</label>
          <textarea id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2}
            className="mt-1 w-full rounded-lg border border-line bg-deck px-3 py-2 text-sm text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={submit}><Send size={15} /> Save check-in</Button>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </div>
      </Card>
      <Card title="Workload history" actions={<SelfReportedTag />}>
        <ul className="space-y-2 text-sm">
          {[...reports].reverse().slice(0, 10).map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-deck/60 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-faint">
                <span>{r.mission_day ? `Mission day ${r.mission_day}` : r.provenance === "synthetic" ? "Pre-mission" : new Date(r.recorded_at).toLocaleString()}</span>
                <ProvenanceBadge p={r.provenance} />
              </div>
              <div className="mt-1 font-cond text-[15px] tnum text-ink">Raw TLX <strong className="font-semibold">{fmt(r.raw_tlx, 0)}</strong><span className="text-faint"> of 100</span></div>
            </li>
          ))}
          {reports.length === 0 && <li className="text-dim">No workload ratings yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
