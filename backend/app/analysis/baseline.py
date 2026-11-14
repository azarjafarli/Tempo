"""Personal-baseline comparison engine.

All thresholds in this module are EXPLORATORY STATISTICAL RULES chosen for a
hackathon prototype. They are not clinical cutoffs, have not been validated
against any outcome, and must not be used to judge fitness for duty.

Method (per metric):
  * Baseline = the same person's *valid* sessions marked phase="baseline".
  * Centre = median; spread = MAD (median absolute deviation) scaled by 1.4826
    so it is comparable to a standard deviation for normally distributed data.
  * A spread floor prevents zero or near-zero MAD (e.g. identical baseline
    values) from turning tiny differences into huge z-scores.
  * robust_z = (value - median) / max(1.4826*MAD, floor_abs, floor_rel*|median|)
  * "Functional change worth reviewing" requires BOTH an adverse robust_z of at
    least Z_THRESHOLD AND an absolute adverse change of at least the metric's
    minimum change. Either alone is not enough.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
from scipy import stats

RULE_VERSION = "exploratory-v1"
MAD_SCALE = 1.4826
Z_THRESHOLD = 3.0
MIN_BASELINE_SESSIONS = 3      # below this: "Insufficient data"
ESTABLISHED_BASELINE_SESSIONS = 5  # at or above this: "established", otherwise "provisional"
MIN_TREND_POINTS = 4

CATEGORY_INSUFFICIENT = "insufficient_data"
CATEGORY_WITHIN = "within_baseline"
CATEGORY_REVIEW = "change_worth_reviewing"
CATEGORY_INVALID = "invalid_measurement"

CATEGORY_LABELS = {
    CATEGORY_INSUFFICIENT: "Insufficient data",
    CATEGORY_WITHIN: "Within observed baseline variation",
    CATEGORY_REVIEW: "Functional change worth reviewing",
    CATEGORY_INVALID: "Invalid or incomplete measurement",
}


@dataclass(frozen=True)
class MetricRule:
    key: str
    label: str
    unit: str
    adverse: str            # "up" (higher is worse) or "down" (lower is worse)
    min_change: float       # minimum absolute adverse change to flag
    floor_abs: float        # absolute floor for the spread estimate
    floor_rel: float = 0.0  # relative floor (fraction of |baseline median|)
    decimals: int = 1


METRIC_RULES: dict[str, list[MetricRule]] = {
    "pvt": [
        MetricRule("median_rt_ms", "Median reaction time", "ms", "up", 30.0, 10.0, 0.03, 0),
        MetricRule("rt_iqr_ms", "Reaction-time variability (IQR)", "ms", "up", 25.0, 10.0, 0.0, 0),
        MetricRule("lapses", "Lapses (RT >= 500 ms)", "count", "up", 2.0, 1.0, 0.0, 0),
        MetricRule("false_starts", "Premature responses", "count", "up", 2.0, 1.0, 0.0, 0),
    ],
    "motor": [
        MetricRule("median_movement_time_ms", "Median movement time", "ms", "up", 80.0, 30.0, 0.05, 0),
        MetricRule("mean_endpoint_error_pct", "Mean endpoint error", "% arena width", "up", 0.5, 0.2, 0.0, 2),
        MetricRule("path_efficiency", "Path efficiency", "ratio", "down", 0.05, 0.02, 0.0, 3),
        MetricRule("movement_time_cv", "Movement-time inconsistency (CV)", "ratio", "up", 0.08, 0.03, 0.0, 3),
        MetricRule("misses", "Missed clicks", "count", "up", 2.0, 1.0, 0.0, 0),
    ],
}


def _finite(values: Iterable[Any]) -> list[float]:
    out = []
    for v in values:
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if np.isfinite(f):
            out.append(f)
    return out


def baseline_stats(values: Iterable[Any], rule: MetricRule) -> dict[str, Any]:
    vals = _finite(values)
    n = len(vals)
    if n == 0:
        return {"n": 0, "status": "insufficient", "median": None, "mad": None, "scale": None,
                "min": None, "max": None, "values": [], "zero_variance": False, "outliers": []}
    arr = np.asarray(vals)
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    scale = max(MAD_SCALE * mad, rule.floor_abs, rule.floor_rel * abs(med))
    within_z = (arr - med) / scale
    outliers = [round(v, 3) for v, z in zip(vals, within_z) if abs(z) > 3.5]
    status = (
        "insufficient" if n < MIN_BASELINE_SESSIONS
        else "provisional" if n < ESTABLISHED_BASELINE_SESSIONS
        else "established"
    )
    return {
        "n": n, "status": status, "median": med, "mad": mad, "scale": scale,
        "scale_source": "mad" if MAD_SCALE * mad >= max(rule.floor_abs, rule.floor_rel * abs(med)) else "floor",
        "min": float(arr.min()), "max": float(arr.max()), "values": vals,
        "zero_variance": bool(mad == 0.0), "outliers": outliers,
    }


def _fmt(v: float | None, rule: MetricRule) -> str:
    if v is None:
        return "n/a"
    s = f"{v:.{rule.decimals}f}"
    return f"{s} {rule.unit}" if rule.unit not in ("count", "ratio") else s


def compare_metric(value: Any, baseline_values: Iterable[Any], rule: MetricRule) -> dict[str, Any]:
    b = baseline_stats(baseline_values, rule)
    v = _finite([value])
    out: dict[str, Any] = {
        "metric": rule.key, "label": rule.label, "unit": rule.unit, "adverse_direction": rule.adverse,
        "value": v[0] if v else None, "baseline": b, "difference": None, "percent_difference": None,
        "robust_z": None, "category": CATEGORY_INSUFFICIENT, "flagged": False, "observations": [],
        "rule": {"z_threshold": Z_THRESHOLD, "min_change": rule.min_change, "floor_abs": rule.floor_abs,
                 "floor_rel": rule.floor_rel, "version": RULE_VERSION},
    }
    obs = out["observations"]
    if not v:
        obs.append("Measurement for this metric is missing in the evaluated session.")
        return out
    if b["status"] == "insufficient":
        obs.append(f"Only {b['n']} valid baseline session(s); at least {MIN_BASELINE_SESSIONS} are needed before comparing.")
        return out

    value_f = v[0]
    diff = value_f - b["median"]
    adverse_diff = diff if rule.adverse == "up" else -diff
    z = diff / b["scale"]
    adverse_z = z if rule.adverse == "up" else -z
    out.update(
        difference=diff,
        percent_difference=(diff / b["median"] * 100) if b["median"] not in (0, 0.0) else None,
        robust_z=z,
    )
    obs.append(
        f"Evaluated value {_fmt(value_f, rule)} vs baseline median {_fmt(b['median'], rule)} "
        f"(n={b['n']}, {b['status']} baseline); difference {diff:+.{rule.decimals}f}."
    )
    if b["zero_variance"]:
        obs.append("Baseline values have zero spread (MAD = 0); the documented spread floor was used instead.")
    elif b["scale_source"] == "floor":
        obs.append("Baseline spread is very small; the documented spread floor was used instead of the MAD.")
    if b["outliers"]:
        obs.append(f"Baseline contains outlying value(s) {b['outliers']}; median/MAD limit their influence.")

    exceeds_z = adverse_z >= Z_THRESHOLD
    exceeds_abs = adverse_diff >= rule.min_change
    if exceeds_z and exceeds_abs:
        out["category"] = CATEGORY_REVIEW
        out["flagged"] = True
        obs.append(
            f"Robust z = {z:+.1f} is beyond the exploratory threshold of {Z_THRESHOLD:.1f} in the adverse direction, "
            f"and the change of {adverse_diff:.{rule.decimals}f} exceeds the minimum change of {rule.min_change:g}."
        )
    else:
        out["category"] = CATEGORY_WITHIN
        if exceeds_z and not exceeds_abs:
            obs.append(f"Robust z = {z:+.1f} is large but the absolute change is below the {rule.min_change:g} minimum, so it is not flagged.")
        elif exceeds_abs and not exceeds_z:
            obs.append(f"Absolute change exceeds {rule.min_change:g}, but robust z = {z:+.1f} is within this person's observed baseline spread.")
        elif adverse_z <= -Z_THRESHOLD:
            obs.append(f"Robust z = {z:+.1f}: change is in the favourable direction.")
        else:
            obs.append(f"Robust z = {z:+.1f} is within ±{Z_THRESHOLD:.1f}.")
    return out


def theil_sen_trend(xs: list[float], ys: list[float]) -> dict[str, Any] | None:
    pts = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None and np.isfinite(y)]
    if len(pts) < MIN_TREND_POINTS:
        return None
    x = np.array([p[0] for p in pts], dtype=float)
    y = np.array([p[1] for p in pts], dtype=float)
    if np.ptp(x) == 0:
        return None
    res = stats.theilslopes(y, x, alpha=0.90)
    return {
        "method": "Theil-Sen median slope (90% interval)",
        "slope_per_day": float(res.slope),
        "low": float(res.low_slope),
        "high": float(res.high_slope),
        "n_points": len(pts),
        "interval_excludes_zero": bool(res.low_slope > 0 or res.high_slope < 0),
    }


def session_category(session_status: str, metric_results: list[dict[str, Any]]) -> str:
    if session_status != "valid":
        return CATEGORY_INVALID
    if not metric_results or all(m["category"] == CATEGORY_INSUFFICIENT for m in metric_results):
        return CATEGORY_INSUFFICIENT
    if any(m["flagged"] for m in metric_results):
        return CATEGORY_REVIEW
    return CATEGORY_WITHIN


def evaluate_session(
    session: dict[str, Any], baseline_sessions: list[dict[str, Any]], assessment_type: str
) -> dict[str, Any]:
    """Compare one session's summary metrics with a set of baseline sessions.

    ``session`` and each baseline session need ``status`` and ``summary`` (metrics dict).
    Invalid baseline sessions are excluded. Invalid evaluated sessions are not interpreted.
    """
    rules = METRIC_RULES[assessment_type]
    valid_base = [s for s in baseline_sessions if s.get("status") == "valid" and s.get("id") != session.get("id")]
    excluded = [s.get("id") for s in baseline_sessions if s.get("status") != "valid"]
    if session.get("status") != "valid":
        return {
            "category": CATEGORY_INVALID,
            "category_label": CATEGORY_LABELS[CATEGORY_INVALID],
            "metrics": [],
            "baseline_n": len(valid_base),
            "baseline_excluded_session_ids": excluded,
            "explanation": ["This measurement is invalid or incomplete, so it is not compared with the baseline."]
            + list(session.get("status_reasons") or []),
        }
    metrics = [
        compare_metric(session["summary"].get(r.key), [b["summary"].get(r.key) for b in valid_base], r)
        for r in rules
    ]
    cat = session_category("valid", metrics)
    n = len(valid_base)
    expl: list[str] = []
    if cat == CATEGORY_INSUFFICIENT:
        expl.append(f"{n} valid baseline session(s) available; {MIN_BASELINE_SESSIONS} required for comparison.")
    elif cat == CATEGORY_REVIEW:
        for m in metrics:
            if m["flagged"]:
                expl.extend(f"{m['label']}: {o}" for o in m["observations"])
    else:
        expl.append("No metric met both exploratory flagging conditions.")
    return {
        "category": cat,
        "category_label": CATEGORY_LABELS[cat],
        "metrics": metrics,
        "baseline_n": n,
        "baseline_status": (
            "insufficient" if n < MIN_BASELINE_SESSIONS else "provisional" if n < ESTABLISHED_BASELINE_SESSIONS else "established"
        ),
        "baseline_excluded_session_ids": excluded,
        "explanation": expl,
    }


def rules_documentation() -> dict[str, Any]:
    return {
        "version": RULE_VERSION,
        "disclaimer": "Exploratory statistical rules for a research prototype. Not clinical cutoffs. "
        "Not validated against fatigue, illness, injury or EVA performance outcomes.",
        "z_threshold": Z_THRESHOLD,
        "mad_scale": MAD_SCALE,
        "min_baseline_sessions": MIN_BASELINE_SESSIONS,
        "established_baseline_sessions": ESTABLISHED_BASELINE_SESSIONS,
        "min_trend_points": MIN_TREND_POINTS,
        "metrics": {
            t: [
                {"key": r.key, "label": r.label, "unit": r.unit, "adverse": r.adverse, "min_change": r.min_change,
                 "floor_abs": r.floor_abs, "floor_rel": r.floor_rel}
                for r in rules
            ]
            for t, rules in METRIC_RULES.items()
        },
        "categories": CATEGORY_LABELS,
    }
