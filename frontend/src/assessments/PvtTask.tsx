import { Keyboard, Play, RotateCcw, Save, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EvaluationSummary } from "../components/EvaluationView";
import { Button, Card, chartTheme, cx, Notice, Select, Stat } from "../components/ui";
import { api } from "../lib/api";
import { fmt } from "../lib/format";
import { classifyPress, LAPSE_MS, nextIsi, PVT_MODES, scorePvt, type PvtMode, type PvtTrial } from "../lib/pvt";
import type { Analysis, Session } from "../lib/types";

type Phase = "idle" | "countdown" | "running" | "interrupted" | "saving" | "done";

interface Props { crewId: number; phase: "baseline" | "mission"; onSaved?: () => void }

export default function PvtTask({ crewId, phase, onSaved }: Props) {
  const [mode, setMode] = useState<PvtMode>("demo");
  const [state, setState] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [feedback, setFeedback] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ session: Session; analysis: Analysis } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trials = useRef<PvtTrial[]>([]);
  const t0 = useRef(0);
  const onset = useRef<number | null>(null);
  const responded = useRef(false);
  const keyDown = useRef(false);
  const timers = useRef<number[]>([]);
  const running = useRef(false);
  const interruptReason = useRef<string | null>(null);
  const startedAt = useRef<string>("");
  const stim = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const raf = useRef<number | null>(null);

  const cfg = PVT_MODES[mode];

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const hideStimulus = () => {
    onset.current = null;
    if (stim.current) stim.current.dataset.on = "0";
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const finish = useCallback(() => {
    running.current = false;
    clearTimers();
    hideStimulus();
    setState("saving");
  }, []);

  const schedule = useCallback(() => {
    if (!running.current) return;
    const isi = nextIsi(mode);
    const now = performance.now();
    if (now - t0.current + isi > cfg.durationS * 1000) {
      later(finish, Math.max(0, cfg.durationS * 1000 - (now - t0.current)));
      return;
    }
    later(() => {
      if (!running.current) return;
      // Show the stimulus in the next animation frame and record onset there (≈ next paint).
      raf.current = requestAnimationFrame(() => {
        if (!running.current || !stim.current) return;
        stim.current.dataset.on = "1";
        onset.current = performance.now();
        responded.current = false;
        const tick = () => {
          if (onset.current === null) return;
          if (counter.current) counter.current.textContent = String(Math.round(performance.now() - onset.current));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
        const myOnset = onset.current;
        later(() => {
          if (onset.current === myOnset && !responded.current && running.current) {
            trials.current.push({ kind: "miss", t_ms: round(myOnset - t0.current) });
            hideStimulus();
            setFeedback({ text: "Missed", tone: "warn" });
            schedule();
          }
        }, cfg.timeout);
      });
    }, isi);
  }, [mode, cfg, finish]);

  const interrupt = useCallback((reason: string) => {
    if (!running.current) return;
    running.current = false;
    interruptReason.current = reason;
    clearTimers();
    hideStimulus();
    setState("interrupted");
  }, []);

  // keyboard handling
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") {
        if (e.key === "Escape" && running.current) interrupt("stopped by participant (Escape)");
        return;
      }
      if (!running.current) return;
      e.preventDefault();
      const now = performance.now();
      const outcome = classifyPress({ repeat: e.repeat, keyIsDown: keyDown.current, stimulusVisible: onset.current !== null, alreadyResponded: responded.current });
      keyDown.current = true;
      if (outcome === "ignored") return;
      if (outcome === "false_start") {
        trials.current.push({ kind: "false_start", t_ms: round(now - t0.current) });
        setFeedback({ text: "Too early — wait for the target", tone: "warn" });
        clearTimers();
        schedule(); // restart the inter-stimulus interval
        return;
      }
      const rt = now - (onset.current as number);
      responded.current = true;
      trials.current.push({ kind: "response", t_ms: round((onset.current as number) - t0.current), rt_ms: round(rt) });
      hideStimulus();
      clearTimers();
      setFeedback({ text: `${Math.round(rt)} ms`, tone: rt < 100 || rt >= LAPSE_MS ? "warn" : "ok" });
      schedule();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        keyDown.current = false;
        if (running.current) e.preventDefault(); // never let Space activate a focused button mid-run
      }
    };
    const vis = () => { if (document.visibilityState === "hidden") interrupt("browser tab hidden"); };
    const blur = () => interrupt("browser window lost focus");
    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up, { capture: true });
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up, { capture: true });
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("blur", blur);
    };
  }, [schedule, interrupt]);

  // elapsed clock
  useEffect(() => {
    if (state !== "running") return;
    const id = window.setInterval(() => setElapsed((performance.now() - t0.current) / 1000), 250);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => () => { running.current = false; clearTimers(); }, []);

  const start = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    trials.current = [];
    interruptReason.current = null;
    setResult(null);
    setError(null);
    setFeedback(null);
    setElapsed(0);
    setState("countdown");
    setCount(3);
    let c = 3;
    const id = window.setInterval(() => {
      c -= 1;
      setCount(c);
      if (c === 0) {
        window.clearInterval(id);
        t0.current = performance.now();
        startedAt.current = new Date().toISOString();
        running.current = true;
        setState("running");
        schedule();
      }
    }, 1000);
    timers.current.push(id);
  };

  const save = useCallback(async (interrupted: boolean) => {
    setState("saving");
    try {
      const r = await api.post<{ session: Session; analysis: Analysis }>("/api/assessments/pvt", {
        crew_member_id: crewId, mode, phase, started_at: startedAt.current, completed_at: new Date().toISOString(),
        interrupted, interruption_reason: interruptReason.current, completed: !interrupted,
        trials: trials.current,
        client_info: { userAgent: navigator.userAgent, timing: "performance.now()", stimulusOnset: "requestAnimationFrame" },
      });
      setResult(r);
      setState("done");
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
      setState(interrupted ? "interrupted" : "done");
    }
  }, [crewId, mode, phase, onSaved]);

  useEffect(() => {
    if (state === "saving" && !result && !error && interruptReason.current === null && trials.current.length >= 0 && !running.current) {
      void save(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const live = scorePvt(trials.current, mode, false, true);

  return (
    <div className="space-y-5">
      <Card title="Vigilant attention · reaction-time task" icon={<Keyboard size={15} />}
        subtitle="Press Space as soon as the orange target appears. Inspired by NASA’s Psychomotor Vigilance Test — this is NOT the validated NASA PVT instrument.">
        <div className="flex flex-wrap items-end gap-4">
          <Select label="Mode" value={mode} onChange={setMode}
            options={(Object.keys(PVT_MODES) as PvtMode[]).map((k) => ({ value: k, label: PVT_MODES[k].label }))} />
          {(state === "idle" || state === "done" || state === "interrupted") && (
            <Button onClick={start}>{state === "idle" ? <Play size={16} /> : <RotateCcw size={16} />} {state === "idle" ? "Start" : "Run again"}</Button>
          )}
          {state === "running" && <Button variant="danger" onClick={() => interrupt("stopped by participant")}><Square size={14} /> Stop (invalidates run)</Button>}
          <div className="ml-auto text-xs text-faint">
            Random delays {cfg.isiMin / 1000}–{cfg.isiMax / 1000} s · no response after {cfg.timeout / 1000} s = miss · response &lt;100 ms = premature · ≥500 ms = lapse
          </div>
        </div>

        <div className="relative mt-5 grid h-72 place-items-center overflow-hidden rounded-xl border border-line bg-void grid-bg"
          aria-live="polite" aria-label="Reaction time task area">
          {state === "idle" && (
            <div className="max-w-md text-center text-sm text-dim">
              <p className="text-ink">Sit comfortably, keep one finger on the <kbd className="rounded border border-line bg-panel2 px-1.5 font-cond tnum">Space</kbd> bar and look at the centre.</p>
              <p className="mt-2">Respond as fast as you can each time the target appears. Don’t press before it appears. Switching tabs or windows invalidates the run.</p>
            </div>
          )}
          {state === "countdown" && <div className="font-cond tnum text-6xl font-bold text-cyan">{count}</div>}
          {(state === "running") && (
            <>
              <div ref={stim} data-on="0" className="grid h-36 w-36 place-items-center rounded-full border-4 border-amber bg-amber/15 opacity-0 data-[on='1']:opacity-100">
                <span ref={counter} className="font-cond tnum text-3xl font-bold text-amber">0</span>
              </div>
              <div className="absolute left-4 top-3 font-cond tnum text-xs text-faint">{elapsed.toFixed(0)} / {cfg.durationS} s</div>
              <div className="absolute right-4 top-3 font-cond tnum text-xs text-faint">{trials.current.filter((t) => t.kind === "response").length} responses</div>
              <div className="absolute bottom-0 left-0 h-1 bg-cyan/60 transition-all" style={{ width: `${Math.min(100, (elapsed / cfg.durationS) * 100)}%` }} />
              {feedback && <div className={cx("absolute bottom-4 font-cond tnum text-sm", feedback.tone === "ok" ? "text-cyan" : "text-amber")}>{feedback.text}</div>}
            </>
          )}
          {state === "saving" && <div className="text-sm text-dim">Saving raw trials and running baseline comparison…</div>}
          {state === "interrupted" && (
            <div className="max-w-md text-center">
              <p className="font-semibold text-rose">Assessment interrupted — {interruptReason.current}</p>
              <p className="mt-2 text-sm text-dim">Timing can’t be trusted once focus is lost, so this run will be stored as <strong>invalid</strong> and never interpreted.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="ghost" onClick={() => save(true)}><Save size={15} /> Save as invalid run</Button>
                <Button variant="ghost" onClick={() => { trials.current = []; setState("idle"); }}><Trash2 size={15} /> Discard</Button>
              </div>
            </div>
          )}
          {state === "done" && result && (
            <div className="text-center">
              <div className="text-xs text-faint">Median reaction time</div>
              <div className="font-cond tnum text-5xl font-bold text-cyan">{fmt(result.session.summary.median_rt_ms as number, 0)}<span className="text-xl text-faint"> ms</span></div>
              <div className="mt-1 text-xs text-dim">Saved as session #{result.session.id} · real local measurement · status: {result.session.status}</div>
            </div>
          )}
        </div>
        {error && <div className="mt-3"><Notice tone="error">Could not save: {error}</Notice></div>}
        {state === "running" && <p className="mt-2 text-xs text-faint">Live (unsaved): {live.n_valid_responses} valid · {live.false_starts} premature · {live.misses} missed. Press Esc to abort.</p>}
        <p className="mt-2 text-[11px] text-faint">Timing uses performance.now(); the target is drawn in a requestAnimationFrame callback, so displayed-onset error is about one display frame (~8–17 ms) plus keyboard latency, which varies by hardware. Compare results only within the same setup.</p>
      </Card>

      {state === "done" && result && <PvtResult result={result} />}
    </div>
  );
}

function round(v: number) { return Math.round(v * 10) / 10; }

function PvtResult({ result }: { result: { session: Session; analysis: Analysis } }) {
  const s = result.session.summary as Record<string, number | null>;
  const rts = result.analysis.distribution && result.analysis.distribution.kind === "reaction_time_histogram" ? result.analysis.distribution.evaluated_raw_rts : [];
  const data = rts.map((rt, i) => ({ i: i + 1, rt }));
  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Card title="Session summary" className="xl:col-span-2">
        {result.session.status !== "valid" && (
          <div className="mb-4"><Notice tone="error">This run is <strong>{result.session.status}</strong> and is not interpreted: {result.session.status_reasons.join(" ")}</Notice></div>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Median RT" value={fmt(s.median_rt_ms, 0)} sub="ms" accent="cyan" />
          <Stat label="IQR" value={fmt(s.rt_iqr_ms, 0)} sub="ms variability" />
          <Stat label="Lapses" value={fmt(s.lapses)} sub="≥ 500 ms" />
          <Stat label="Premature" value={fmt(s.false_starts)} sub="false starts" />
          <Stat label="Missed" value={fmt(s.misses)} sub="no response" />
          <Stat label="Valid responses" value={fmt(s.n_valid_responses)} sub={`of ${s.n_stimuli} stimuli`} />
        </div>
        <div className="mt-5 h-44" role="img" aria-label="Individual reaction times in this session">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="i" tick={chartTheme.tick} stroke={chartTheme.axis} />
              <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} />
              <ReferenceLine y={500} stroke={chartTheme.rose} strokeDasharray="4 4" />
              <Tooltip {...chartTheme.tooltip} formatter={(v: number) => [`${v} ms`, "RT"]} labelFormatter={(l) => `Response ${l}`} />
              <Bar dataKey="rt" radius={[3, 3, 0, 0]}>
                {data.map((d) => <Cell key={d.i} fill={d.rt >= 500 ? chartTheme.rose : chartTheme.cyan} />)}
              </Bar>
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
