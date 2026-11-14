import { Activity, BookOpen, CalendarRange, Gauge, LineChart, Loader2, Rocket, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cx, Select } from "./components/ui";
import { AppCtx, type Screen } from "./context";
import { api } from "./lib/api";
import type { Crew, Mission } from "./lib/types";
import MissionOverview from "./screens/MissionOverview";
import PerformanceLab from "./screens/PerformanceLab";
import RecoveryAnalysis from "./screens/RecoveryAnalysis";
import MissionPlanner from "./screens/MissionPlanner";
import Research from "./screens/Research";

const NAV: { id: Screen; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Mission Overview", icon: Gauge },
  { id: "lab", label: "Performance Lab", icon: Activity },
  { id: "analysis", label: "Recovery Analysis", icon: LineChart },
  { id: "planner", label: "EVA Mission Planner", icon: CalendarRange },
  { id: "research", label: "Research & Data Sources", icon: BookOpen },
];

function parseHash(): { screen: Screen; params: Record<string, string> } {
  const [path, query] = window.location.hash.replace(/^#\/?/, "").split("?");
  const screen = (NAV.find((n) => n.id === path)?.id ?? "overview") as Screen;
  return { screen, params: Object.fromEntries(new URLSearchParams(query || "")) };
}

export default function App() {
  const [{ screen, params }, setRoute] = useState(parseHash);
  const [mission, setMission] = useState<Mission | null>(null);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [profile, setProfile] = useState<"declining" | "stable">("declining");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setRoute(parseHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  useEffect(() => {
    api.get<{ mission: Mission | null; crew: Crew[] }>("/api/mission")
      .then((r) => {
        setMission(r.mission);
        setCrew(r.crew);
        if (r.mission) setProfile(r.mission.scenario_profile);
        setSelectedCrewId((cur) => (cur && r.crew.some((c) => c.id === cur) ? cur : r.mission?.selected_crew_id ?? r.crew[0]?.id ?? null));
        setError(null);
      })
      .catch((e) => setError(`Cannot reach the backend API (${e.message}). Is the FastAPI server running on port 8000?`));
  }, [version]);

  const navigate = useCallback((s: Screen, p?: Record<string, string>) => {
    const q = p ? `?${new URLSearchParams(p).toString()}` : "";
    window.location.hash = `/${s}${q}`;
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const loadDemo = async () => {
    setLoadingDemo(true);
    try {
      await api.post("/api/demo/load", { profile });
      setSelectedCrewId(null);
      refresh();
      navigate("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDemo(false);
    }
  };

  const ctx = useMemo(() => ({ mission, crew, selectedCrewId, setSelectedCrewId, version, refresh, navigate, params }),
    [mission, crew, selectedCrewId, version, refresh, navigate, params]);

  const selected = crew.find((c) => c.id === selectedCrewId);

  return (
    <AppCtx.Provider value={ctx}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-cyan focus:px-3 focus:py-2 focus:text-void">Skip to content</a>
      <div className="flex min-h-full">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-deck/90 backdrop-blur md:flex" aria-label="Primary">
          <div className="flex items-center gap-3 border-b border-line px-5 py-5">
            <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden>
              <rect width="32" height="32" rx="8" fill="#0e1b31" stroke="#1f3352" />
              <circle cx="16" cy="16" r="9" fill="none" stroke="#4fd1e8" strokeWidth="1.6" />
              <path d="M6.5 20.5 Q16 9.5 25.5 12" fill="none" stroke="#f4b544" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="16" cy="16" r="2.4" fill="#4fd1e8" />
            </svg>
            <div>
              <div className="text-sm font-bold tracking-[0.2em] text-ink">EVA RECOVERY</div>
              <div className="text-[11px] tracking-wide text-faint">Mission Readiness Lab</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {NAV.map((n, i) => {
              const Icon = n.icon;
              const active = n.id === screen;
              return (
                <button key={n.id} onClick={() => navigate(n.id)} aria-current={active ? "page" : undefined}
                  className={cx("group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                    active ? "bg-cyan-deep/50 text-cyan" : "text-dim hover:bg-panel hover:text-ink")}>
                  <span className={cx("font-mono text-[10px]", active ? "text-cyan" : "text-faint")}>0{i + 1}</span>
                  <Icon size={17} aria-hidden />
                  <span>{n.label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden />}
                </button>
              );
            })}
          </nav>
          <div className="space-y-3 border-t border-line p-4">
            <Select label="Demo history" value={profile} onChange={(v) => setProfile(v)}
              options={[{ value: "declining", label: "Declining performance" }, { value: "stable", label: "Stable performance" }]} />
            <button onClick={loadDemo} disabled={loadingDemo}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber/60 bg-amber/90 px-3 py-2.5 text-sm font-semibold text-void transition hover:bg-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-amber disabled:opacity-50">
              {loadingDemo ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} Load Demo Mission
            </button>
            <p className="text-[11px] leading-snug text-faint">Reloads the synthetic mission from fixed seeds. Your “Local participant” measurements are kept.</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 md:px-8">
              <nav className="flex gap-1 md:hidden" aria-label="Primary mobile">
                {NAV.map((n) => { const Icon = n.icon; return (
                  <button key={n.id} onClick={() => navigate(n.id)} aria-label={n.label} aria-current={n.id === screen ? "page" : undefined}
                    className={cx("rounded-md p-2", n.id === screen ? "bg-cyan-deep text-cyan" : "text-dim")}><Icon size={18} /></button>); })}
              </nav>
              {mission && (
                <div className="flex items-center gap-2 rounded-full border border-amber/50 bg-amber-deep/70 px-3 py-1 text-xs font-medium text-amber" role="status">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber" aria-hidden />
                  DEMO SCENARIO · synthetic {mission.scenario_profile}-performance history · seed {mission.random_seed}
                </div>
              )}
              <div className="ml-auto flex items-center gap-3">
                {mission && <span className="hidden font-mono text-xs text-dim lg:inline">{mission.name} · Day {mission.current_day}/{mission.num_days}</span>}
                <Select label="" className="[&>span]:hidden" value={selectedCrewId ?? 0}
                  onChange={(v) => setSelectedCrewId(Number(v))}
                  options={crew.map((c) => ({ value: c.id, label: c.display_name }))} />
              </div>
            </div>
          </header>

          <main id="main" className="flex-1 px-5 py-6 md:px-8">
            {error && (
              <div role="alert" className="mb-4 rounded-lg border border-rose/40 bg-rose-deep/60 px-4 py-3 text-sm text-rose">{error}</div>
            )}
            {selected && (
              <div key={`${screen}-${version}`}>
                {screen === "overview" && <MissionOverview />}
                {screen === "lab" && <PerformanceLab />}
                {screen === "analysis" && <RecoveryAnalysis />}
                {screen === "planner" && <MissionPlanner />}
                {screen === "research" && <Research />}
              </div>
            )}
          </main>

          <footer className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-faint md:px-8">
            <ShieldAlert size={12} className="mr-1 inline text-amber" aria-hidden />
            Research and decision-support prototype built for NASA Space Apps 2026. Not a clinically validated fitness-for-duty
            system; it does not diagnose fatigue, illness or injury. Not affiliated with or endorsed by NASA.
          </footer>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
