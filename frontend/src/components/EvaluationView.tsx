import { HelpCircle } from "lucide-react";
import { digitsFor, fmt, signed } from "../lib/format";
import type { Evaluation, MetricResult } from "../lib/types";
import { CategoryBadge, cx, Disclosure, Notice } from "./ui";

export function MetricTable({ metrics, persistence }: { metrics: MetricResult[]; persistence?: Record<string, number> }) {
  if (!metrics.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Comparison of the evaluated session with this person's baseline</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
            <th className="pb-2 font-normal">Metric</th>
            <th className="pb-2 font-normal">Evaluated</th>
            <th className="pb-2 font-normal">Baseline median</th>
            <th className="pb-2 font-normal">MAD</th>
            <th className="pb-2 font-normal">Difference</th>
            <th className="pb-2 font-normal">Robust z</th>
            <th className="pb-2 font-normal">Result</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const d = digitsFor(m.unit);
            const u = m.unit === "count" || m.unit === "ratio" ? "" : m.unit;
            return (
              <tr key={m.metric} className="border-t border-line/60 align-top">
                <td className="py-2.5 pr-3 text-ink">
                  {m.label}
                  <div className="text-[11px] text-faint">{m.adverse_direction === "up" ? "higher = adverse" : "lower = adverse"}</div>
                </td>
                <td className="py-2.5 pr-3 font-mono">{fmt(m.value, d, u)}</td>
                <td className="py-2.5 pr-3 font-mono text-dim">{fmt(m.baseline.median, d, u)}<div className="text-[11px] text-faint">n={m.baseline.n} · {m.baseline.status}</div></td>
                <td className="py-2.5 pr-3 font-mono text-dim">{fmt(m.baseline.mad, d)}{m.baseline.zero_variance && <div className="text-[11px] text-amber">zero spread → floor</div>}</td>
                <td className={cx("py-2.5 pr-3 font-mono", m.flagged ? "text-amber" : "text-ink")}>
                  {signed(m.difference, d)}{m.percent_difference != null && <span className="text-[11px] text-faint"> ({signed(m.percent_difference, 0)}%)</span>}
                </td>
                <td className={cx("py-2.5 pr-3 font-mono", m.flagged ? "text-amber" : "text-dim")}>{signed(m.robust_z, 1)}</td>
                <td className="py-2.5">
                  <CategoryBadge category={m.category} small />
                  {persistence && (persistence[m.metric] ?? 0) > 1 && <div className="mt-1 text-[11px] text-amber">flagged in {persistence[m.metric]} consecutive sessions</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function WhyFlagged({ evaluation }: { evaluation: Evaluation }) {
  const flagged = evaluation.metrics.filter((m) => m.flagged);
  const title = (
    <><HelpCircle size={15} className="text-amber" aria-hidden />
      {evaluation.category === "change_worth_reviewing" ? "Why was this flagged?" : "Why this result?"}</>
  );
  return (
    <Disclosure title={title} defaultOpen={evaluation.category === "change_worth_reviewing"} tone={evaluation.category === "change_worth_reviewing" ? "amber" : "cyan"}>
      {evaluation.category === "invalid_measurement" && (
        <ul className="list-disc space-y-1 pl-5">{evaluation.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {evaluation.category === "insufficient_data" && (
        <ul className="list-disc space-y-1 pl-5">{evaluation.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {flagged.length > 0 && (
        <div className="space-y-3">
          <p>A metric is flagged only when <strong className="text-ink">both</strong> exploratory conditions hold: an adverse robust z of at least {flagged[0].rule.z_threshold} <em>and</em> an absolute change at least the metric’s minimum. Supporting observations:</p>
          {flagged.map((m) => (
            <div key={m.metric}>
              <div className="font-medium text-amber">{m.label}</div>
              <ul className="mt-1 list-disc space-y-1 pl-5">{m.observations.map((o) => <li key={o}>{o}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {evaluation.category === "within_baseline" && (
        <div className="space-y-2">
          <p>No metric met both flagging conditions. Per-metric notes:</p>
          <ul className="list-disc space-y-1 pl-5">{evaluation.metrics.map((m) => <li key={m.metric}><span className="text-ink">{m.label}:</span> {m.observations[m.observations.length - 1]}</li>)}</ul>
        </div>
      )}
      <p className="mt-3 text-xs text-faint">These are exploratory statistical rules (version-controlled in the code), not clinical cutoffs. A flag means “worth a human look”; it is not a diagnosis of fatigue, illness or injury.</p>
    </Disclosure>
  );
}

export function EvaluationSummary({ evaluation, warnings }: { evaluation: Evaluation; warnings?: string[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CategoryBadge category={evaluation.category} />
        <span className="text-xs text-faint">Compared with {evaluation.baseline_n} valid baseline session(s){evaluation.baseline_status ? ` · baseline ${evaluation.baseline_status}` : ""}</span>
      </div>
      {warnings?.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      <MetricTable metrics={evaluation.metrics} persistence={evaluation.persistence} />
      <WhyFlagged evaluation={evaluation} />
    </div>
  );
}
