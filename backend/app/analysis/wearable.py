"""Wearable-style sleep score and readiness score (0-100).

Modeled on how Fitbit publicly describes its scores; Fitbit's exact formulas are proprietary, so the
sub-formulas below are this project's own documented approximations.

Sleep score (Fitbit's published structure): the sum of
  * Time asleep            up to 50 points
  * Deep and REM sleep     up to 25 points
  * Restoration            up to 25 points (sleeping heart rate below daytime resting heart rate,
                                            and little restlessness score higher)
  Bands used by Fitbit: Excellent 90-100, Good 80-89, Fair 60-79, Poor < 60.

Readiness score (Fitbit's current description): resting heart rate, recent sleep and heart-rate
variability, each compared with the person's own baseline. Fitbit does not publish weights or label
cut-offs; here the three components are weighted equally and labelled Low < 40, Moderate 40-69,
High >= 70.

These are wellness-style indicators computed from (synthetic) device data. They are NOT medical
scores, are NOT a fitness-for-EVA determination, and are not used by the flagging rules or the scheduler.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np

SLEEP_GOAL_MIN = 480.0          # 8 h time-asleep goal
DEEP_REM_TARGET_FRACTION = 0.45  # deep + REM share of time asleep that earns full points
RESTORATION_HR_GAP_BPM = 10.0    # sleeping HR this far below daytime RHR earns full HR points
RESTLESS_MAX_PCT = 20.0          # restlessness at or above this earns no restlessness points

READINESS_MIN_BASELINE_NIGHTS = 4
READINESS_RECENT_SLEEP_NIGHTS = 3
MAD_SCALE = 1.4826
FLOORS = {"hrv": 4.0, "rhr": 1.5, "sleep": 4.0}  # minimum spread so a flat baseline cannot explode the score

SLEEP_BANDS = [(90, "Excellent"), (80, "Good"), (60, "Fair"), (0, "Poor")]
READINESS_BANDS = [(70, "High"), (40, "Moderate"), (0, "Low")]


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def band(score: float | None, bands: list[tuple[int, str]]) -> str | None:
    if score is None:
        return None
    return next(label for cut, label in bands if score >= cut)


@dataclass
class Night:
    asleep_min: float
    deep_min: float
    rem_min: float
    sleeping_hr: float
    resting_hr: float
    hrv_ms: float
    restless_pct: float


def sleep_score(n: Night) -> dict[str, Any]:
    time_pts = 50.0 * _clamp(n.asleep_min / SLEEP_GOAL_MIN)
    frac = (n.deep_min + n.rem_min) / n.asleep_min if n.asleep_min > 0 else 0.0
    deep_rem_pts = 25.0 * _clamp(frac / DEEP_REM_TARGET_FRACTION)
    hr_part = _clamp((n.resting_hr - n.sleeping_hr) / RESTORATION_HR_GAP_BPM)
    restless_part = _clamp(1 - n.restless_pct / RESTLESS_MAX_PCT)
    restoration_pts = 25.0 * (0.6 * hr_part + 0.4 * restless_part)
    total = round(time_pts + deep_rem_pts + restoration_pts)
    return {
        "score": int(total), "band": band(total, SLEEP_BANDS),
        "components": [
            {"key": "time_asleep", "label": "Time asleep", "points": round(time_pts, 1), "max": 50,
             "detail": f"{n.asleep_min / 60:.1f} h of an {SLEEP_GOAL_MIN / 60:.0f} h goal"},
            {"key": "deep_rem", "label": "Deep and REM sleep", "points": round(deep_rem_pts, 1), "max": 25,
             "detail": f"{frac * 100:.0f}% of time asleep (full points at {DEEP_REM_TARGET_FRACTION * 100:.0f}%)"},
            {"key": "restoration", "label": "Restoration", "points": round(restoration_pts, 1), "max": 25,
             "detail": f"sleeping HR {n.sleeping_hr:.0f} vs resting HR {n.resting_hr:.0f} bpm, {n.restless_pct:.0f}% restless"},
        ],
    }


def _robust(values: Iterable[float], floor: float) -> tuple[float, float] | None:
    v = np.asarray([x for x in values if x is not None], dtype=float)
    if v.size < READINESS_MIN_BASELINE_NIGHTS:
        return None
    med = float(np.median(v))
    return med, max(MAD_SCALE * float(np.median(np.abs(v - med))), floor)


def _component(value: float, base: tuple[float, float], higher_is_better: bool) -> tuple[int, float]:
    med, scale = base
    z = (value - med) / scale
    good = z if higher_is_better else -z
    # 0 deviation -> 70; each robust SD better/worse moves 15 points; clipped to 0..100
    return int(round(_clamp(70 + 15 * good, 0, 100))), z


def readiness(today: dict[str, Any], recent_sleep_scores: list[float], baseline_nights: list[dict[str, Any]],
              baseline_sleep_scores: list[float]) -> dict[str, Any]:
    """Readiness for one morning, compared with this person's own baseline nights."""
    b_hrv = _robust((n["hrv_ms"] for n in baseline_nights), FLOORS["hrv"])
    b_rhr = _robust((n["resting_hr"] for n in baseline_nights), FLOORS["rhr"])
    b_sleep = _robust(baseline_sleep_scores, FLOORS["sleep"])
    if not (b_hrv and b_rhr and b_sleep) or not recent_sleep_scores:
        return {"score": None, "band": "Calibrating", "components": [],
                "detail": f"Needs at least {READINESS_MIN_BASELINE_NIGHTS} baseline nights."}
    recent = float(np.mean(recent_sleep_scores[-READINESS_RECENT_SLEEP_NIGHTS:]))
    hrv_pts, hrv_z = _component(today["hrv_ms"], b_hrv, True)
    rhr_pts, rhr_z = _component(today["resting_hr"], b_rhr, False)
    sl_pts, sl_z = _component(recent, b_sleep, True)
    total = int(round((hrv_pts + rhr_pts + sl_pts) / 3))
    return {
        "score": total, "band": band(total, READINESS_BANDS),
        "components": [
            {"key": "hrv", "label": "Heart-rate variability", "score": hrv_pts,
             "detail": f"{today['hrv_ms']:.0f} ms vs usual {b_hrv[0]:.0f} ms"},
            {"key": "rhr", "label": "Resting heart rate", "score": rhr_pts,
             "detail": f"{today['resting_hr']:.0f} bpm vs usual {b_rhr[0]:.0f} bpm"},
            {"key": "sleep", "label": f"Recent sleep ({READINESS_RECENT_SLEEP_NIGHTS} nights)", "score": sl_pts,
             "detail": f"average sleep score {recent:.0f} vs usual {b_sleep[0]:.0f}"},
        ],
    }


def score_nights(nights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add sleep and readiness scores to chronologically ordered nights.

    Baseline = nights before the mission (mission_day <= 0). Readiness for mission mornings compares with
    that baseline; for pre-mission mornings it uses the earlier pre-mission nights only.
    """
    out = []
    for n in nights:
        s = sleep_score(Night(n["asleep_min"], n["deep_min"], n["rem_min"], n["sleeping_hr"], n["resting_hr"],
                              n["hrv_ms"], n["restless_pct"]))
        out.append({**n, "sleep": s})
    for i, n in enumerate(out):
        base = [m for m in out[:i] if m["mission_day"] <= 0] if n["mission_day"] <= 0 else [m for m in out if m["mission_day"] <= 0]
        recent = [m["sleep"]["score"] for m in out[max(0, i - READINESS_RECENT_SLEEP_NIGHTS + 1): i + 1]]
        n["readiness"] = readiness(n, recent, base, [m["sleep"]["score"] for m in base])
    return out


def documentation() -> dict[str, Any]:
    return {
        "source_note": "Structure follows Fitbit's public description of its Sleep Score (time asleep 50, deep and REM 25, "
                       "restoration 25) and Daily Readiness (HRV, resting heart rate and recent sleep vs personal baseline). "
                       "Fitbit's formulas are proprietary; these are documented approximations.",
        "sleep_bands": "Excellent 90-100, Good 80-89, Fair 60-79, Poor below 60 (Fitbit's published bands).",
        "readiness_bands": "High 70+, Moderate 40-69, Low below 40 (this project's cut-offs; Fitbit does not publish them).",
        "limits": "Wellness-style indicators from device data. Not medical scores, not a fitness-for-EVA determination, "
                  "and not used by the flagging rules or the scheduler.",
    }
