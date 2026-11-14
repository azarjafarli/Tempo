import type { SelfReport } from "../lib/types";
import { fmt } from "../lib/format";

const DIMS: [string, string][] = [
  ["tlx_mental", "Mental demand"], ["tlx_physical", "Physical demand"], ["tlx_temporal", "Temporal demand"],
  ["tlx_performance", "Performance (higher = worse)"], ["tlx_effort", "Effort"], ["tlx_frustration", "Frustration"],
];

/** Latest self-reported workload: Raw TLX and its six NASA-TLX dimensions (0-100). */
export function WorkloadPanel({ report, compact }: { report: SelfReport | null; compact?: boolean }) {
  if (!report || report.raw_tlx == null) return <p className="text-[14px] text-dim">No workload rating yet.</p>;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-cond text-[34px] font-bold leading-none tnum text-ink">{fmt(report.raw_tlx, 0)}</span>
        <span className="text-[13px] text-dim">Raw TLX, out of 100 (unweighted mean of six ratings)</span>
      </div>
      {!compact && (
        <ul className="mt-3 space-y-1.5">
          {DIMS.map(([k, label]) => {
            const v = report[k] as number | null;
            return (
              <li key={k} className="grid grid-cols-[150px_1fr_32px] items-center gap-2 text-[13px]">
                <span className="text-dim">{label}</span>
                <span className="h-1.5 rounded-full bg-panel2"><span className="block h-1.5 rounded-full bg-ink" style={{ width: `${v ?? 0}%` }} /></span>
                <span className="text-right font-cond text-[14px] tnum">{fmt(v, 0)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 text-[12px] text-faint">
        {report.mission_day ? `Mission day ${report.mission_day}` : new Date(report.recorded_at).toLocaleString()}
      </div>
    </div>
  );
}
