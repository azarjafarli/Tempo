import { BookOpen, Database, ExternalLink, FileUp, Layers, RefreshCw, ShieldAlert, Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, chartTheme, Loading, Notice, ProvenanceBadge, Stat } from "../components/ui";
import { api } from "../lib/api";
import type { NasaSummary, Provenance, Reference } from "../lib/types";

interface ProvResp { categories: Record<Provenance, { label: string; description: string }>; references: Reference[] }
interface RecordRow { id: number; source_row: number; eva_number: string; country: string; crew: string; vehicle: string; date_raw: string; duration_raw: string; duration_hours: number; purpose: string }

const LIMITATIONS = [
  "Not a medical device and not a fitness-for-duty determination. It does not diagnose fatigue, illness or injury.",
  "The reaction-time task is inspired by the NASA PVT but is not that validated instrument; browser and keyboard latency vary across hardware.",
  "Flagging thresholds are exploratory statistical rules chosen for this prototype. They have not been validated against any outcome.",
  "The demo crew, mission and assessment histories are synthetic. The live measurements are of whoever uses this computer, not of astronauts.",
  "Scheduling restrictions are reviewer-chosen assumptions. The optimizer does not predict recovery or physiological state.",
  "Historical NASA EVA durations are reference context only. They are never used as labels for recovery, fatigue or injury.",
  "Sleep score and readiness imitate Fitbit's published structure; Fitbit's formulas are proprietary, so ours are documented approximations. They are wellness indicators from synthetic device data, not medical scores.",
];

export default function Research() {
  const [summary, setSummary] = useState<NasaSummary | null>(null);
  const [prov, setProv] = useState<ProvResp | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api.get<NasaSummary>("/api/nasa/eva/summary").then(setSummary).catch((e) => setMsg({ tone: "error", text: e.message }));
    api.get<RecordRow[]>("/api/nasa/eva/records?limit=15").then(setRows).catch(() => undefined);
  };
  useEffect(() => { load(); api.get<ProvResp>("/api/provenance").then(setProv).catch(() => undefined); }, []);

  const importBundled = async () => {
    setBusy(true);
    try { await api.post("/api/nasa/eva/import-bundled"); setMsg({ tone: "info", text: "Bundled NASA CSV re-imported." }); load(); }
    catch (e) { setMsg({ tone: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) { setMsg({ tone: "error", text: "File is larger than 5 MB." }); return; }
    setBusy(true);
    try {
      const content = await f.text();
      await api.post("/api/nasa/eva/import", { filename: f.name, content });
      setMsg({ tone: "info", text: `Imported ${f.name}.` });
      load();
    } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const imp = summary?.import;
  const countries = summary?.by_country ? Object.entries(summary.by_country) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-cond text-[40px] font-bold leading-[1.05] text-ink">Sources, data and limits</h1>
        <p className="mt-1.5 max-w-[68ch] text-[15.5px] text-dim">Where every number in this app comes from, what each NASA source supports, and what the prototype cannot tell you.</p>
      </div>

      <Card title="What NASA already does, and what this adds" icon={<Layers size={15} />}
        subtitle="NASA already tests astronauts against their own baseline. This project builds on that idea and connects it to EVA planning.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="font-cond text-[17px] font-semibold text-ink">Existing NASA tools</h3>
            <ul className="mt-2 divide-y divide-line">
              {prov?.references.filter((r) => r.relation === "related_work").map((r) => (
                <li key={r.key} className="py-2.5 first:pt-0">
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-[14.5px] font-medium text-cyan hover:underline">{r.title} <ExternalLink size={12} className="inline" /></a>
                  <p className="mt-0.5 text-[13px] text-dim">{r.supports.replace(/^Related NASA work\. /, "")}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-cond text-[17px] font-semibold text-ink">What EVA Recovery adds</h3>
            <ol className="mt-2 space-y-3 text-[14px] text-dim">
              <li><strong className="text-ink">Closes the loop to the EVA schedule.</strong> A flagged change goes through a recorded reviewer decision into a constraint-based re-plan of the next spacewalks, or an explanation of why no plan works.</li>
              <li><strong className="text-ink">Built for high-tempo planetary EVAs.</strong> Several demanding surface EVAs in a few days, a precision motor task for suited hand work, and rest tracked between EVAs.</li>
              <li><strong className="text-ink">One reviewer workflow.</strong> Test, flag with visible evidence, doctor’s note, schedule what-if.</li>
            </ol>
            <p className="mt-3 text-[12.5px] text-faint">Based on public sources only; NASA may have internal Artemis tools we cannot see. Our tasks are not validated like NASA’s instruments.</p>
          </div>
        </div>
      </Card>

      <Card title="NASA historical EVA dataset · import workflow" icon={<Database size={15} />} actions={<ProvenanceBadge p="nasa_public_data" long />}
        subtitle="Extra-vehicular Activity (EVA) – US and Russia. The importer reads the file’s header, maps recognized columns, and rejects rows it cannot parse. Nothing is filled in or invented.">
        {!summary ? <Loading /> : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={importBundled} disabled={busy || !summary.bundled_file_available}><RefreshCw size={15} /> Re-import bundled copy</Button>
              <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}><FileUp size={15} /> Import a CSV manually…</Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose NASA EVA CSV file" onChange={(e) => onFile(e.target.files?.[0])} />
              <a href={summary.dataset_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-center text-sm text-cyan underline decoration-dotted">Official dataset page <ExternalLink size={13} /></a>
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            {!summary.imported ? <Notice>No NASA data imported yet. Download the CSV from the official page and import it here.</Notice> : imp && (
              <>
                <div className="grid gap-5 md:grid-cols-4">
                  <Stat label="Valid records" value={imp.rows_valid} sub={`of ${imp.rows_total} rows`} accent="cyan" />
                  <Stat label="Rejected rows" value={imp.rows_rejected} sub="see reasons below" />
                  <Stat label="Median EVA duration" value={`${summary.duration_hours?.median.toFixed(2)} h`} sub={`IQR ${summary.duration_hours?.q1.toFixed(2)}–${summary.duration_hours?.q3.toFixed(2)} h`} />
                  <Stat label="Longest" value={`${summary.duration_hours?.max.toFixed(2)} h`} sub={countries.map(([c, n]) => `${c}: ${n}`).join(" · ")} />
                </div>
                <div className="grid gap-4 text-xs text-dim md:grid-cols-2">
                  <div className="rounded-lg border border-line bg-deck/60 p-3">
                    <div className="mb-1 text-[11px] text-faint">Source & integrity</div>
                    <div>File: <span className="font-cond tnum text-ink">{imp.filename}</span></div>
                    <div>Imported: {new Date(imp.imported_at).toLocaleString()}</div>
                    <div className="break-all">SHA-256: <span className="font-cond tnum">{imp.sha256}</span></div>
                    <div className="mt-1">Retrieved via: {imp.retrieved_via}</div>
                  </div>
                  <div className="rounded-lg border border-line bg-deck/60 p-3">
                    <div className="mb-1 text-[11px] text-faint">Detected columns → mapping</div>
                    <div className="font-cond tnum">{imp.detected_columns.map((c) => `“${c}”`).join(", ")}</div>
                    <div className="mt-1">{Object.entries(imp.column_mapping).map(([k, v]) => <span key={k} className="mr-2 inline-block font-cond tnum text-ink">{k}←{v}</span>)}</div>
                    {imp.rejection_examples.length > 0 && <div className="mt-2">Rejected: {imp.rejection_examples.slice(0, 6).map((r) => `line ${r.line} (${r.reason})`).join("; ")}{imp.rejection_examples.length > 6 ? "…" : ""}</div>}
                  </div>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="h-56" role="img" aria-label="Histogram of historical EVA durations">
                    <div className="mb-1 text-[11px] text-faint">Duration distribution (EVA count)</div>
                    <ResponsiveContainer>
                      <BarChart data={summary.histogram} margin={{ top: 4, right: 4, bottom: 4, left: -16 }}>
                        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="bin" tick={{ ...chartTheme.tick, fontSize: 10 }} stroke={chartTheme.axis} />
                        <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} />
                        <Tooltip {...chartTheme.tooltip} />
                        <Bar dataKey="count" name="EVAs" fill={chartTheme.cyan} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-56" role="img" aria-label="Median EVA duration by decade">
                    <div className="mb-1 text-[11px] text-faint">Median duration by decade (hours)</div>
                    <ResponsiveContainer>
                      <LineChart data={summary.by_decade} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="decade" tick={chartTheme.tick} stroke={chartTheme.axis} />
                        <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} />
                        <Tooltip {...chartTheme.tooltip} formatter={(v: number, _n, p) => [`${v} h (n=${p.payload.n})`, "median"]} />
                        <Line dataKey="median_hours" stroke="#1D2227" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <p className="text-[13px] text-dim">{summary.usage_note}</p>
                <details className="text-xs">
                  <summary className="cursor-pointer text-dim">Preview first parsed records</summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[720px]">
                      <thead><tr className="text-left text-faint">{["Row", "EVA", "Country", "Crew", "Vehicle", "Date", "Duration"].map((h) => <th key={h} className="pb-1 pr-2 font-normal">{h}</th>)}</tr></thead>
                      <tbody>{rows.map((r) => (
                        <tr key={r.id} className="border-t border-line/50 text-dim">
                          <td className="py-1 pr-2 font-cond tnum">{r.source_row}</td><td className="pr-2 font-cond tnum">{r.eva_number}</td><td className="pr-2">{r.country}</td>
                          <td className="pr-2">{r.crew}</td><td className="pr-2">{r.vehicle}</td><td className="pr-2 font-cond tnum">{r.date_raw}</td><td className="pr-2 font-cond tnum">{r.duration_raw}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Sources and what each supports" icon={<BookOpen size={15} />}>
          <ul className="space-y-3">
            {prov?.references.filter((r) => r.relation !== "related_work").map((r) => (
              <li key={r.key} className="rounded-lg border border-line bg-deck/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-cyan hover:underline">{r.title} <ExternalLink size={12} className="inline" /></a>
                  <ProvenanceBadge p={r.provenance} />
                </div>
                <p className="mt-1 text-xs text-dim">{r.supports}</p>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-5">
          <Card title="Data provenance categories" icon={<Tags size={15} />}>
            <ul className="space-y-2.5">
              {prov && (Object.entries(prov.categories) as [Provenance, { label: string; description: string }][]).map(([k, v]) => (
                <li key={k} className="flex gap-3"><div className="w-28 shrink-0"><ProvenanceBadge p={k} /></div><p className="text-xs text-dim">{v.description}</p></li>
              ))}
            </ul>
          </Card>
          <Card title="Scientific limitations" icon={<ShieldAlert size={15} />}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-dim">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-3 text-xs text-faint">Full details: LIMITATIONS.md, DATA_PROVENANCE.md and RESEARCH.md in the project folder.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
