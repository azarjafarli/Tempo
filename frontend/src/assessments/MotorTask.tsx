import { Crosshair, MousePointer2, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EvaluationSummary } from "../components/EvaluationView";
import { Button, Card, chartTheme, Loading, Notice, Stat } from "../components/ui";
import { api } from "../lib/api";
import { fmt } from "../lib/format";
import { isHit, normalize, throttlePush, type Layout, type Pt } from "../lib/motor";
import type { Analysis, Session } from "../lib/types";

type Phase = "ready" | "running" | "interrupted" | "saving" | "done";

export default function MotorTask({ crewId, phase, onSaved }: { crewId: number; phase: "baseline" | "mission"; onSaved?: () => void }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [state, setState] = useState<Phase>("ready");
  const [current, setCurrent] = useState(0);
  const [missFlash, setMissFlash] = useState(0);
  const [result, setResult] = useState<{ session: Session; analysis: Analysis } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const arena = useRef<HTMLDivElement>(null);
  const clicks = useRef<Pt[]>([]);
  const path = useRef<Pt[]>([]);
  const t0 = useRef(0);
  const startedAt = useRef("");
  const running = useRef(false);
  const reason = useRef<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLayout(null);
    api.get<Layout>(`/api/assessments/motor/next-variant?crew_id=${crewId}`).then(setLayout).catch((e) => setError(e.message));
  }, [crewId, reload]);

  const interrupt = useCallback((r: string) => {
    if (!running.current) return;
    running.current = false;
    reason.current = r;
    setState("interrupted");
  }, []);

  useEffect(() => {
    const vis = () => { if (document.visibilityState === "hidden") interrupt("browser tab hidden"); };
    const blur = () => interrupt("browser window lost focus");
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") interrupt("stopped by participant (Escape)"); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("visibilitychange", vis); window.removeEventListener("blur", blur); window.removeEventListener("keydown", esc); };
  }, [interrupt]);

  const save = useCallback(async (interrupted: boolean) => {
    if (!layout) return;
    setState("saving");
    try {
      const r = await api.post<{ session: Session; analysis: Analysis }>("/api/assessments/motor", {
        crew_member_id: crewId, mode: "standard", phase, variant: layout.variant, started_at: startedAt.current,
        completed_at: new Date().toISOString(), interrupted, interruption_reason: reason.current, completed: !interrupted,
        clicks: clicks.current, path: path.current,
        client_info: { userAgent: navigator.userAgent, arenaAspect: layout.aspect, coordinates: "normalized" },
      });
      setResult(r);
      setState("done");
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
      setState("interrupted");
    }
  }, [crewId, layout, phase, onSaved]);

  const begin = () => {
    clicks.current = [];
    path.current = [];
    reason.current = null;
    setResult(null);
    setError(null);
    setCurrent(0);
    t0.current = performance.now();
    startedAt.current = new Date().toISOString();
    running.current = true;
    setState("running");
  };

  const onMove = (e: React.PointerEvent) => {
    if (!running.current || !arena.current) return;
    const p = normalize(e.clientX, e.clientY, arena.current.getBoundingClientRect());
    throttlePush(path.current, { t_ms: Math.round((performance.now() - t0.current) * 10) / 10, ...p });
  };

  const onDown = (e: React.PointerEvent) => {
    if (!running.current || !arena.current || !layout) return;
    e.preventDefault();
    const p = normalize(e.clientX, e.clientY, arena.current.getBoundingClientRect());
    const pt = { t_ms: Math.round((performance.now() - t0.current) * 10) / 10, ...p };
    clicks.current.push(pt);
    path.current.push(pt);
    if (isHit(pt, layout.targets[current], layout.aspect)) {
      const next = current + 1;
      setCurrent(next);
      if (next >= layout.targets.length) {
        running.current = false;
        void save(false);
      }
    } else setMissFlash((m) => m + 1);
  };

  if (!layout) return error ? <Notice tone="error">{error}</Notice> : <Loading label="Preparing target layout" />;
  const tgt = layout.targets[current];

  return (
    <div className="space-y-5">
      <Card title="Precision motor control · target task" icon={<Crosshair size={15} />}
        subtitle={`Click each target as quickly and accurately as you can. ${layout.targets.length} targets in a fixed sequence (layout variant ${layout.variant}: a mirror image with identical distances and target sizes, so every session has equivalent difficulty).`}>
        <div className="mx-auto w-full max-w-4xl">
          <div ref={arena} onPointerMove={onMove} onPointerDown={onDown}
            className="relative w-full select-none overflow-hidden rounded-xl border border-line bg-void grid-bg touch-none"
            style={{ aspectRatio: `${1 / layout.aspect}`, cursor: state === "running" ? "crosshair" : "default" }}
            aria-label="Motor task arena" role="application">
            {state === "ready" && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="mb-3 max-w-sm text-sm text-dim">Use a mouse or trackpad. The timer starts when you press the start marker. Switching tabs or windows invalidates the run.</p>
                  <button onClick={begin}
                    className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-cyan bg-cyan-deep/60 text-cyan animate-pulseRing focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    aria-label="Start motor task"><MousePointer2 size={22} /></button>
                  <p className="mt-2 font-cond tnum text-xs text-faint">START</p>
                </div>
              </div>
            )}
            {state === "running" && tgt && (
              <>
                {current + 1 < layout.targets.length && (
                  <div aria-hidden className="pointer-events-none absolute rounded-full border border-dashed border-faint/50"
                    style={circleStyle(layout, layout.targets[current + 1])} />
                )}
                <div key={current} aria-label={`Target ${current + 1}`}
                  className="pointer-events-none absolute grid place-items-center rounded-full border-2 border-amber bg-amber/25 shadow-[0_0_24px_rgba(244,181,68,0.35)]"
                  style={circleStyle(layout, tgt)}>
                  <span className="font-cond tnum text-[10px] font-bold text-amber">{current + 1}</span>
                </div>
                <div className="absolute left-3 top-2 font-cond tnum text-xs text-faint">target {current + 1}/{layout.targets.length} · misses {missFlash}</div>
              </>
            )}
            {state === "saving" && <div className="absolute inset-0 grid place-items-center text-sm text-dim">Saving pointer data and comparing with baseline…</div>}
            {state === "interrupted" && (
              <div className="absolute inset-0 grid place-items-center bg-void/80">
                <div className="max-w-md text-center">
                  <p className="font-semibold text-rose">Assessment interrupted — {reason.current ?? "save failed"}</p>
                  {error && <p className="mt-1 text-xs text-rose">{error}</p>}
                  <p className="mt-2 text-sm text-dim">This run will be stored as invalid/incomplete and not interpreted.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button variant="ghost" onClick={() => save(true)}><Save size={15} /> Save as invalid run</Button>
                    <Button variant="ghost" onClick={() => { setState("ready"); setReload((r) => r + 1); }}><Trash2 size={15} /> Discard</Button>
                  </div>
                </div>
              </div>
            )}
            {state === "done" && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="text-xs text-faint">Median movement time</div>
                  <div className="font-cond tnum text-5xl font-bold text-cyan">{fmt(result?.session.summary.median_movement_time_ms as number, 0)}<span className="text-xl text-faint"> ms</span></div>
                  <div className="mt-3"><Button variant="ghost" onClick={() => { setState("ready"); setReload((r) => r + 1); }}><RotateCcw size={15} /> Run again</Button></div>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-faint">Pointer positions are stored in normalized arena coordinates (0–1), so resizing the window does not change the measurements. Pointer sampling is throttled to ~60 Hz.</p>
      </Card>
      {state === "done" && result && <MotorResult result={result} />}
    </div>
  );
}

/** Absolute-position a circle of radius r (arena-width units) centred at normalized (x, y). */
function circleStyle(layout: Layout, t: { x: number; y: number }): React.CSSProperties {
  const r = layout.target_radius;
  return {
    left: `${(t.x - r) * 100}%`,
    top: `${(t.y - r / layout.aspect) * 100}%`,
    width: `${2 * r * 100}%`,
    height: `${((2 * r) / layout.aspect) * 100}%`,
  };
}

function MotorResult({ result }: { result: { session: Session; analysis: Analysis } }) {
  const s = result.session.summary as Record<string, number | null>;
  const dist = result.analysis.distribution;
  const data = dist && dist.kind === "movement_time_per_target" ? dist.targets : [];
  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Card title="Session summary" className="xl:col-span-2">
        {result.session.status !== "valid" && <div className="mb-4"><Notice tone="error">This run is <strong>{result.session.status}</strong> and is not interpreted: {result.session.status_reasons.join(" ")}</Notice></div>}
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Completion" value={fmt((s.completion_time_ms ?? 0) / 1000, 1)} sub="seconds" accent="cyan" />
          <Stat label="Median MT" value={fmt(s.median_movement_time_ms, 0)} sub="ms per target" />
          <Stat label="Consistency" value={fmt(s.movement_time_cv, 2)} sub="MT coeff. of variation" />
          <Stat label="Endpoint error" value={fmt(s.mean_endpoint_error_pct, 2)} sub="% of arena width" />
          <Stat label="Path efficiency" value={fmt(s.path_efficiency, 3)} sub="straight / travelled" />
          <Stat label="Misses" value={fmt(s.misses)} sub={`hit rate ${fmt((s.hit_rate ?? 0) * 100, 0)}%`} />
        </div>
        <div className="mt-5 h-48" role="img" aria-label="Movement time per target vs baseline median">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="target" tick={chartTheme.tick} stroke={chartTheme.axis} />
              <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} />
              <Tooltip {...chartTheme.tooltip} formatter={(v: number) => `${v?.toFixed?.(0)} ms`} labelFormatter={(l) => `Target ${l}`} />
              <Legend wrapperStyle={{ fontSize: 11, color: chartTheme.dim }} />
              <Bar dataKey="baseline_median" name="Baseline median" fill={chartTheme.cyan} fillOpacity={0.45} radius={[3, 3, 0, 0]} />
              <Bar dataKey="evaluated" name="This session" fill={chartTheme.amber} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Comparison with personal baseline" className="xl:col-span-3">
        <EvaluationSummary evaluation={result.analysis.evaluation} warnings={result.analysis.warnings} />
      </Card>
    </div>
  );
}
