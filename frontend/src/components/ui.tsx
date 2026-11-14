import { AlertTriangle, ChevronDown, FlaskConical, Info, Loader2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { CATEGORY_STYLE, PROVENANCE_STYLE } from "../lib/format";
import type { Category, Provenance } from "../lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className, title, icon, actions, subtitle }: {
  children: ReactNode; className?: string; title?: ReactNode; icon?: ReactNode; actions?: ReactNode; subtitle?: ReactNode;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel/80 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] animate-rise", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-dim">
              {icon && <span className="text-cyan">{icon}</span>}
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-xs text-faint">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function CategoryBadge({ category, small }: { category: Category; small?: boolean }) {
  const s = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.insufficient_data;
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium", small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs", s.cls)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

export function ProvenanceBadge({ p, long }: { p: Provenance; long?: boolean }) {
  const s = PROVENANCE_STYLE[p];
  return (
    <span title={s.label} className={cx("inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", s.cls)}>
      {long ? s.label : s.short}
    </span>
  );
}

export function SelfReportedTag() {
  return <span className="rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-dim">Self-reported</span>;
}

export function DemoScenarioBanner({ text }: { text: string }) {
  return (
    <div role="note" className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber-deep/60 px-3 py-2 text-xs text-amber">
      <FlaskConical size={14} aria-hidden />
      <span><strong className="font-semibold tracking-wide">DEMO SCENARIO</strong> · {text}</span>
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, type = "button", className, ariaLabel }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "amber" | "danger"; disabled?: boolean;
  type?: "button" | "submit"; className?: string; ariaLabel?: string;
}) {
  const styles = {
    primary: "bg-cyan/90 text-void hover:bg-cyan border-cyan",
    ghost: "bg-transparent text-ink hover:bg-panel2 border-line",
    amber: "bg-amber/90 text-void hover:bg-amber border-amber",
    danger: "bg-transparent text-rose hover:bg-rose-deep border-rose/50",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-void",
        "disabled:cursor-not-allowed disabled:opacity-40", styles, className)}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: "cyan" | "amber" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={cx("mt-1 font-mono text-2xl font-semibold tabular-nums", accent === "amber" ? "text-amber" : accent === "cyan" ? "text-cyan" : "text-ink")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-dim">{sub}</div>}
    </div>
  );
}

export function Disclosure({ title, children, defaultOpen = false, tone = "cyan" }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; tone?: "cyan" | "amber" }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cx("rounded-lg border", tone === "amber" ? "border-amber/30 bg-amber-deep/20" : "border-line bg-deck/60")}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-lg">
        <span className="flex items-center gap-2">{title}</span>
        <ChevronDown size={16} className={cx("transition-transform text-dim", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div id={id} className="border-t border-line/60 px-3.5 py-3 text-sm text-dim">{children}</div>}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "error" }) {
  const cls = { info: "border-line bg-deck/70 text-dim", warn: "border-amber/40 bg-amber-deep/40 text-amber", error: "border-rose/40 bg-rose-deep/50 text-rose" }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "note"} className={cx("flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed", cls)}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-dim" role="status">
      <Loader2 className="animate-spin" size={16} aria-hidden /> {label}…
    </div>
  );
}

export function Select<T extends string | number>({ label, value, onChange, options, className }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("flex flex-col gap-1 text-xs text-faint", className)}>
      <span className="uppercase tracking-[0.12em]">{label}</span>
      <select id={id} value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}
        className="rounded-lg border border-line bg-deck px-3 py-2 text-sm text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan">
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 0.5, suffix }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-faint">
      <span className="uppercase tracking-[0.12em]">{label}</span>
      <div className="flex items-center gap-2">
        <input id={id} type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }}
          className="w-24 rounded-lg border border-line bg-deck px-3 py-2 font-mono text-sm text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan" />
        {suffix && <span className="text-dim">{suffix}</span>}
      </div>
    </label>
  );
}

export const chartTheme = {
  grid: "#1f3352",
  axis: "#5d7392",
  tick: { fill: "#8ea3c0", fontSize: 11 },
  cyan: "#4fd1e8",
  amber: "#f4b544",
  rose: "#f07a7a",
  jade: "#5fd3a2",
  dim: "#8ea3c0",
  tooltip: {
    contentStyle: { background: "#0a1426", border: "1px solid #1f3352", borderRadius: 8, fontSize: 12, color: "#dbe6f5" },
    labelStyle: { color: "#8ea3c0" },
    itemStyle: { color: "#dbe6f5" },
  },
};
