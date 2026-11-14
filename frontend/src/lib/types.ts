export type Provenance =
  | "nasa_public_data"
  | "local_measurement"
  | "synthetic"
  | "published_reference"
  | "hypothetical_scenario";

export type Category =
  | "insufficient_data"
  | "within_baseline"
  | "change_worth_reviewing"
  | "invalid_measurement"
  | "baseline";

export interface Crew {
  id: number;
  code: string;
  display_name: string;
  role: string;
  qualifications: string[];
  is_fictional: boolean;
  is_schedulable: boolean;
  provenance: Provenance;
}

export interface Mission {
  id: number;
  name: string;
  num_days: number;
  current_day: number;
  selected_crew_id: number;
  scenario_profile: "declining" | "stable";
  random_seed: number;
  provenance: Provenance;
}

export interface Session {
  id: number;
  crew_member_id: number;
  assessment_type: "pvt" | "motor";
  mode: "demo" | "standard";
  phase: "baseline" | "mission";
  mission_day: number | null;
  mission_time_days: number | null;
  started_at: string;
  completed_at: string | null;
  status: "valid" | "invalid" | "incomplete";
  status_reasons: string[];
  provenance: Provenance;
  scenario_label: string | null;
  summary: Record<string, number | null | number[]>;
}

export interface BaselineStats {
  n: number;
  status: "insufficient" | "provisional" | "established";
  median: number | null;
  mad: number | null;
  scale: number | null;
  min: number | null;
  max: number | null;
  values: number[];
  zero_variance: boolean;
  outliers: number[];
}

export interface MetricResult {
  metric: string;
  label: string;
  unit: string;
  adverse_direction: "up" | "down";
  value: number | null;
  baseline: BaselineStats;
  difference: number | null;
  percent_difference: number | null;
  robust_z: number | null;
  category: Category;
  flagged: boolean;
  observations: string[];
  rule: { z_threshold: number; min_change: number; floor_abs: number; floor_rel: number; version: string };
}

export interface Evaluation {
  category: Category;
  category_label: string;
  metrics: MetricResult[];
  baseline_n: number;
  baseline_status?: string;
  baseline_excluded_session_ids?: number[];
  explanation: string[];
  persistence?: Record<string, number>;
}

export interface Trend {
  method: string;
  slope_per_day: number;
  low: number;
  high: number;
  n_points: number;
  interval_excludes_zero: boolean;
}

export interface HistoryItem {
  id: number;
  phase: "baseline" | "mission";
  mission_day: number | null;
  mission_time_days: number | null;
  started_at: string;
  status: string;
  status_reasons: string[];
  provenance: Provenance;
  mode: string;
  category: Category;
  metrics: Record<string, number | null>;
}

export interface SelfReport {
  id: number;
  mission_day: number | null;
  recorded_at: string;
  sleep_hours: number | null;
  fatigue: number | null;
  recovery: number | null;
  raw_tlx: number | null;
  provenance: Provenance;
  [k: string]: unknown;
}

export interface Analysis {
  crew: Crew;
  assessment_type: "pvt" | "motor";
  rules: RulesDoc;
  history: HistoryItem[];
  evaluated_session: (Session & { summary: Record<string, unknown> }) | null;
  evaluation: Evaluation;
  trends: Record<string, Trend | null>;
  distribution:
    | {
        kind: "reaction_time_histogram";
        bin_edges: number[];
        baseline_pooled: number[];
        evaluated: number[];
        baseline_n_responses: number;
        evaluated_n_responses: number;
        evaluated_raw_rts: number[];
      }
    | { kind: "movement_time_per_target"; targets: { target: number; baseline_median: number | null; evaluated: number | null }[] }
    | null;
  warnings: string[];
  self_reports: SelfReport[];
  disclaimer: string;
}

export interface RulesDoc {
  version: string;
  disclaimer: string;
  z_threshold: number;
  mad_scale: number;
  min_baseline_sessions: number;
  established_baseline_sessions: number;
  metrics: Record<string, { key: string; label: string; unit: string; adverse: string; min_change: number; floor_abs: number; floor_rel: number }[]>;
  categories: Record<string, string>;
}

export interface EvaActivity {
  id: number;
  eva_number: number;
  mission_day: number;
  start_hour: number;
  duration_hours: number;
  status: "completed" | "planned";
  crew: string[];
}

export interface OverviewAssessment {
  label: string;
  evaluated_session: Session | null;
  category: Category;
  category_label: string;
  baseline_n: number;
  baseline_status: string;
  key_metric: string;
  key_metric_result: MetricResult | null;
  flagged_metrics: string[];
  series: { t: number | null; value: number | null; phase: string; status: string; category: Category }[];
  trend: Trend | null;
  warnings: string[];
}

export interface Overview {
  mission: Mission | null;
  crew: Crew;
  all_evas: EvaActivity[];
  last_eva: EvaActivity | null;
  next_eva: EvaActivity | null;
  eva_count: { completed: number; planned: number };
  assessments: Record<"pvt" | "motor", OverviewAssessment>;
  data_quality: { assessment: string; sessions: number; invalid_or_incomplete: number; valid_baseline_sessions: number; baseline_status: string; latest_status: string | null }[];
  latest_self_report: SelfReport | null;
  next_steps: string[];
  wearable: import("../components/WearableScores").WearableSummary;
}

export interface Task {
  id: number;
  task_code: string;
  name: string;
  duration_hours: number;
  priority: "high" | "medium" | "low";
  required_qualifications: string[];
  crew_needed: number;
  assigned_crew: string[];
  planned_day: number | null;
  planned_start_hour: number | null;
  earliest_day: number;
  latest_day: number;
  window_start_hour: number;
  window_end_hour: number;
  depends_on: string[];
  is_fixed: boolean;
  status: "planned" | "completed";
}

export interface Placement {
  code: string;
  name: string;
  scheduled: boolean;
  day: number | null;
  start_hour: number | null;
  end_hour?: number | null;
  duration_hours: number;
  crew: string[];
  priority: string;
  status: string;
  is_fixed: boolean;
  required_qualifications: string[];
  depends_on: string[];
}

export interface Conflict {
  type: string;
  tasks: string[];
  crew: string | null;
  day: number | null;
  message: string;
}

export interface PlanView {
  schedule: Placement[];
  conflicts: Conflict[];
  eva_spans: { crew: string; day: number; start_hour: number; end_hour: number; hours: number; limit_hours: number }[];
  rest_intervals: { crew: string; from_day: number; to_day: number; rest_hours: number }[];
}

export interface OptimizeResult {
  scenario_id: number;
  name: string;
  kind: string;
  solver_status: string;
  feasible: boolean;
  scenario: { num_days: number; current_day: number; max_eva_hours: number; min_rest_hours: number; crew_restrictions: Record<string, { max_eva_hours?: number | null; unavailable_days?: number[] }> };
  assumption_notice: string;
  original: PlanView;
  optimized: PlanView | null;
  changes: { task: string; name: string; kinds: string[]; original: { day: number | null; start_hour: number | null; crew: string[] }; optimized: { day: number | null; start_hour: number | null; crew: string[] }; explanation: string[] }[];
  postponed: string[];
  objective?: { total: number; postponement_cost: number; reassignment_cost: number; disruption_cost: number; proven_optimal: boolean; weights: Record<string, unknown> };
  infeasibility?: { conflicting_requirements: string[]; diagnostics: string[]; explanation: string };
  reviewer_note?: string | null;
}

export interface NasaSummary {
  imported: boolean;
  bundled_file_available: boolean;
  dataset_url: string;
  import?: {
    id: number;
    source_url: string;
    retrieved_via: string;
    filename: string;
    sha256: string;
    imported_at: string;
    detected_columns: string[];
    column_mapping: Record<string, string>;
    rows_total: number;
    rows_valid: number;
    rows_rejected: number;
    rejection_examples: { line: number; reason: string; eva_number?: string }[];
  };
  records?: number;
  duration_hours?: { median: number; q1: number; q3: number; max: number; min: number };
  histogram?: { bin: string; count: number }[];
  by_country?: Record<string, number>;
  by_decade?: { decade: string; n: number; median_hours: number }[];
  usage_note?: string;
}

export interface Reference {
  key: string;
  title: string;
  url: string;
  provenance: Provenance;
  supports: string;
}
