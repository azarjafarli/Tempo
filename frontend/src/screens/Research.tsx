import { BookOpen, Database, ExternalLink, FileUp, Layers, RefreshCw, Watch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, chartTheme, Loading, Notice, ProvenanceBadge, Stat } from "../components/ui";
import { type WearableSummary } from "../components/WearableScores";
import { useApp } from "../context";
import { api } from "../lib/api";
import type { NasaSummary, Provenance, Reference } from "../lib/types";

interface ProvResp { categories: Record<Provenance, { label: string; description: string }>; references: Reference[] }
interface RecordRow { id: number; source_row: number; eva_number: string; country: string; crew: string; vehicle: string; date_raw: string; duration_raw: string; duration_hours: number; purpose: string }

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
        <h1 className="font-cond text-[40px] font-bold leading-[1.05] text-ink">Sources and data</h1>
        <p className="mt-1.5 max-w-[68ch] text-[15.5px] text-dim">Where the data in this app comes from and what each NASA source supports.</p>
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
                  <Stat label="Rejected rows" value={imp.rows_rejected} sub="zero or missing duration" />
                  <Stat label="Median EVA duration" value={`${summary.duration_hours?.median.toFixed(2)} h`} sub={`IQR ${summary.duration_hours?.q1.toFixed(2)}–${summary.duration_hours?.q3.toFixed(2)} h`} />
                  <Stat label="Longest" value={`${summary.duration_hours?.max.toFixed(2)} h`} sub={countries.map(([c, n]) => `${c}: ${n}`).join(" · ")} />
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

      <DeviceImportCard />

      <Card title="Sources and what each supports" icon={<BookOpen size={15} />}>
          <ul className="grid gap-3 md:grid-cols-2">
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
    </div>
  );
}

function DeviceImportCard() {
  const { crew, refresh } = useApp();
  const local = crew.find((c) => c.code === "LOCAL");
  const [w, setW] = useState<WearableSummary | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const load = () => { if (local) api.get<WearableSummary>(`/api/wearable/${local.id}`).then(setW).catch(() => setW(null)); };
  useEffect(load, [local?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const files = await Promise.all(Array.from(list).map(async (f) => ({ filename: f.name, content: await f.text() })));
      const r = await api.post<{ days: number; first_day: string; last_day: string }>("/api/wearable/import-google-health", { files });
      setMsg({ tone: "info", text: `Imported ${r.days} days (${r.first_day} to ${r.last_day}) for the local participant.` });
      load();
      refresh();
    } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  const days = w?.kind === "device_daily" ? w.series : [];
  return (
    <Card title="Your wearable data" icon={<Watch size={15} />}
      subtitle="Import your own Fitbit / Google Health Takeout files for the local participant: Daily Heart Rate Variability, Daily Resting Heart Rate and Daily Readiness (from the “Physical Activity” folder). Only these three files are read; they stay on this computer.">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => ref.current?.click()} disabled={busy}><FileUp size={15} /> Choose CSV files…</Button>
        <input ref={ref} type="file" accept=".csv,text/csv" multiple className="sr-only" aria-label="Choose Google Health CSV files" onChange={(e) => onFiles(e.target.files)} />
        <span className="text-[13.5px] text-dim">
          {days.length ? `${days.length} days imported, ${days[0].date} to ${days[days.length - 1].date}.` : "Nothing imported yet."}
        </span>
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}
