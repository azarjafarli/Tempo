import { createContext, useContext } from "react";
import type { Crew, Mission } from "./lib/types";

export type Screen = "overview" | "lab" | "analysis" | "planner" | "research";

export interface AppState {
  mission: Mission | null;
  crew: Crew[];
  selectedCrewId: number | null;
  setSelectedCrewId: (id: number) => void;
  version: number;
  refresh: () => void;
  navigate: (s: Screen, params?: Record<string, string>) => void;
  params: Record<string, string>;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error("AppCtx missing");
  return v;
}
