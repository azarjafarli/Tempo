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
    <section className={cx("rounded-[10px] border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-cond text-[19px] font-semibold leading-tight text-ink">
              {icon && <span className="text-faint" aria-hidden>{icon}</span>}
              {title}
            </h2>
            {subtitle && <p className="mt-1 max-w-[72ch] text-[13px] leading-snug text-dim">{subtitle}</p>}
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
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium", small ? "px-2 py-0.5 text-[12px]" : "px-2.5 py-1 text-[13px]", s.cls)}>
      <span className={cx("h-2 w-2 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

/** Provenance is shown by texture: synthetic data is hatched, real data is solid. */
export function ProvenanceBadge({ p, long }: { p: Provenance; long?: boolean }) {
  const s = PROVENANCE_STYLE[p];
  return (
    <span title={s.label} className={cx("inline-flex items-center whitespace-nowrap rounded-[4px] border px-1.5 py-[1px] font-cond text-[12px] font-semibold", s.cls)}>
      {long ? s.label : s.short}
    </span>
  );
}

export function SelfReportedTag() {
  return <span className="whitespace-nowrap rounded-[4px] border border-line bg-panel px-1.5 py-[1px] font-cond text-[12px] font-semibold text-dim">Self-reported</span>;
}

export function DemoScenarioBanner({ text }: { text: string }) {
  return (
    <div role="note" className="hatch flex items-center gap-2.5 rounded-[6px] border border-amber/40 px-3.5 py-2 text-[13px] text-ink">
      <FlaskConical size={15} className="shrink-0 text-amber" aria-hidden />
      <span><strong className="font-semibold">Demo scenario.</strong> {text}</span>
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, type = "button", className, ariaLabel }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "amber" | "danger"; disabled?: boolean;
  type?: "button" | "submit"; className?: string; ariaLabel?: string;
}) {
  const styles = {
    primary: "bg-ink text-white hover:bg-[#33393f] border-ink",
    ghost: "bg-panel text-ink hover:bg-panel2 border-line",
    amber: "bg-amber text-white hover:bg-[#a83a0c] border-amber",
    danger: "bg-panel text-rose hover:bg-rose-deep border-rose/40",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      className={cx("inline-flex items-center justify-center gap-2 rounded-[6px] border px-3.5 py-2 text-[14px] font-semibold transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-void",
        "disabled:cursor-not-allowed disabled:opacity-40", styles, className)}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: "cyan" | "amber" }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-dim">{label}</div>
      <div className={cx("mt-0.5 font-cond text-[30px] font-semibold leading-none tnum", accent === "amber" ? "text-amber" : accent === "cyan" ? "text-cyan" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-[12.5px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

export function Disclosure({ title, children, defaultOpen = false, tone = "cyan" }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; tone?: "cyan" | "amber" }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cx("rounded-[8px] border", tone === "amber" ? "border-amber/40 bg-amber-deep/50" : "border-line bg-deck")}>
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
  const cls = { info: "border-line bg-deck text-dim", warn: "border-amber/40 bg-amber-deep/60 text-ink [&_svg]:text-amber", error: "border-rose/40 bg-rose-deep text-rose" }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "note"} className={cx("flex gap-2.5 rounded-[8px] border px-3.5 py-2.5 text-[13.5px] leading-relaxed", cls)}>
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
    <label htmlFor={id} className={cx("flex flex-col gap-1 text-[13px] text-dim", className)}>
      <span>{label}</span>
      <select id={id} value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}
        className="rounded-[6px] border border-line bg-panel px-3 py-2 text-[14px] text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan">
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
    <label htmlFor={id} className="flex flex-col gap-1 text-[13px] text-dim">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input id={id} type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }}
          className="w-24 rounded-[6px] border border-line bg-panel px-3 py-2 font-cond tnum text-[16px] text-ink focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan" />
        {suffix && <span className="text-dim">{suffix}</span>}
      </div>
    </label>
  );
}

export const chartTheme = {
  grid: "#E3E7E2",
  axis: "#A3ABB2",
  tick: { fill: "#4C565E", fontSize: 12 },
  cyan: "#2B5F8E",
  amber: "#C8460F",
  rose: "#9E2F28",
  jade: "#3F7140",
  dim: "#77818A",
  tooltip: {
    contentStyle: { background: "#ffffff", border: "1px solid #D3D8D2", borderRadius: 6, fontSize: 13, color: "#1D2227", boxShadow: "0 4px 14px rgba(29,34,39,.08)" },
    labelStyle: { color: "#4C565E" },
    itemStyle: { color: "#1D2227" },
  },
};
