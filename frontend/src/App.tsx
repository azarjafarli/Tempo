import { Activity, BookOpen, CalendarRange, Gauge, LineChart, Loader2, Rocket, ShieldAlert, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cx, Select } from "./components/ui";
import { AppCtx, type Screen } from "./context";
import { api } from "./lib/api";
import type { Crew, Mission } from "./lib/types";
import MissionControl from "./screens/MissionControl";
import MissionOverview from "./screens/MissionOverview";
import PerformanceLab from "./screens/PerformanceLab";
import RecoveryAnalysis from "./screens/RecoveryAnalysis";
import MissionPlanner from "./screens/MissionPlanner";
import Research from "./screens/Research";

const NAV: { id: Screen; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Mission overview", icon: Gauge },
  { id: "control", label: "Mission control", icon: Stethoscope },
  { id: "lab", label: "Performance lab", icon: Activity },
  { id: "analysis", label: "Recovery analysis", icon: LineChart },
  { id: "planner", label: "EVA mission planner", icon: CalendarRange },
  { id: "research", label: "Research and data", icon: BookOpen },
];

/** Screens that show one person's data; only these use the header crew picker. */
const PERSON_SCREENS: Screen[] = ["overview", "lab", "analysis"];

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
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
      <div className="flex min-h-full">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-panel md:flex" aria-label="Primary">
          <div className="flex items-center gap-3 px-5 pb-5 pt-6">
            <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
              <circle cx="16" cy="16" r="13" fill="none" stroke="#1D2227" strokeWidth="2" />
              <path d="M3 19.5 Q16 7 29 12.5" fill="none" stroke="#C8460F" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="16" cy="16" r="3" fill="#1D2227" />
            </svg>
            <div className="leading-none">
              <div className="font-cond text-[21px] font-bold text-ink">EVA Recovery</div>
              <div className="mt-1 text-[12.5px] text-faint">Mission readiness lab</div>
            </div>
          </div>
          <nav className="flex-1 px-3">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = n.id === screen;
              return (
                <button key={n.id} onClick={() => navigate(n.id)} aria-current={active ? "page" : undefined}
                  className={cx("relative flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-left text-[14.5px] transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                    active ? "bg-panel2 font-semibold text-ink" : "text-dim hover:bg-deck hover:text-ink")}>
                  {active && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-ink" aria-hidden />}
                  <Icon size={17} aria-hidden className={active ? "text-ink" : "text-faint"} />
                  <span>{n.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="m-3 rounded-[8px] border border-line">
            <div className="p-3">
              <Select label="Crew history" value={profile} onChange={(v) => setProfile(v)}
                options={[{ value: "declining", label: "Declining performance" }, { value: "stable", label: "Stable performance" }]} />
              <button onClick={loadDemo} disabled={loadingDemo}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[6px] bg-ink px-3 py-2 text-[14px] font-semibold text-white transition hover:bg-[#33393f] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 disabled:opacity-50">
                {loadingDemo ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} Reset mission
              </button>
              <p className="mt-2 text-[12px] leading-snug text-dim">Restores the mission to its starting state. Your own measurements are kept.</p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-line bg-void/90 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 md:px-10">
              <nav className="flex gap-1 md:hidden" aria-label="Primary mobile">
                {NAV.map((n) => { const Icon = n.icon; return (
                  <button key={n.id} onClick={() => navigate(n.id)} aria-label={n.label} aria-current={n.id === screen ? "page" : undefined}
                    className={cx("rounded-md p-2", n.id === screen ? "bg-panel text-ink" : "text-dim")}><Icon size={18} /></button>); })}
              </nav>
              <div className="ml-auto flex items-center gap-4">
                {mission && <span className="hidden font-cond text-[16px] text-dim lg:inline">Mission day <strong className="font-semibold text-ink">{mission.current_day}</strong> of {mission.num_days}</span>}
                {PERSON_SCREENS.includes(screen) && selected && (
                  <label className="flex items-center gap-2.5 rounded-[8px] border border-line bg-panel py-1 pl-3 pr-1 text-[13px] text-dim">
                    {screen === "lab" ? "Performing as" : "Viewing"}
                    <span className="font-cond text-[18px] font-bold leading-none text-ink">{selected.code === "LOCAL" ? "You" : selected.code}</span>
                    <select value={selectedCrewId ?? 0} onChange={(e) => setSelectedCrewId(Number(e.target.value))}
                      aria-label={screen === "lab" ? "Crew member performing the assessment" : "Crew member to view"}
                      className="rounded-[6px] border border-line bg-deck px-2 py-1 text-[13px] text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan">
                      {crew.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          </header>

          <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-5 py-8 md:px-10">
            {error && (
              <div role="alert" className="mb-4 rounded-[8px] border border-rose/40 bg-rose-deep px-4 py-3 text-[14px] text-rose">{error}</div>
            )}
            {selected && (
              <div key={`${screen}-${version}`}>
                {screen === "overview" && <MissionOverview />}
                {screen === "control" && <MissionControl />}
                {screen === "lab" && <PerformanceLab />}
                {screen === "analysis" && <RecoveryAnalysis />}
                {screen === "planner" && <MissionPlanner />}
                {screen === "research" && <Research />}
              </div>
            )}
          </main>

          <footer className="border-t border-line px-5 py-4 text-[12.5px] leading-relaxed text-faint md:px-10">
            <ShieldAlert size={13} className="mr-1.5 inline text-amber" aria-hidden />
            A research and decision-support prototype for NASA Space Apps 2026. Crew, mission and their data are simulated. It is not a
            clinically validated fitness-for-duty system and does not diagnose fatigue, illness or injury. Not affiliated with or endorsed by NASA.
          </footer>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
