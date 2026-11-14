"""Scoring for the vigilant-attention reaction-time task.

The task is *inspired by* NASA's Psychomotor Vigilance Test (PVT). It is not the
validated NASA PVT instrument. Thresholds below follow common conventions in
the published PVT literature (100 ms anticipation floor, 500 ms lapse), applied
here as exploratory scoring rules only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

ANTICIPATION_MS = 100.0  # responses faster than this are counted as false starts
LAPSE_MS = 500.0         # valid responses at or above this are counted as lapses

MODE_CONFIG: dict[str, dict[str, float]] = {
    # short demonstration run for hackathon judging
    "demo": {"duration_s": 60, "isi_min_ms": 2000, "isi_max_ms": 5000, "timeout_ms": 3000, "min_valid_responses": 8},
    # longer assessment run (3 minutes)
    "standard": {"duration_s": 180, "isi_min_ms": 2000, "isi_max_ms": 7000, "timeout_ms": 3000, "min_valid_responses": 20},
}

MAX_FALSE_START_FRACTION = 0.25
MAX_MISS_FRACTION = 0.34


@dataclass
class PvtScore:
    status: str  # valid | invalid | incomplete
    reasons: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    valid_rts_ms: list[float] = field(default_factory=list)


def _round(v: float | None, nd: int = 1) -> float | None:
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return None
    return round(float(v), nd)


def score_pvt(
    trials: list[dict[str, Any]],
    mode: str = "demo",
    interrupted: bool = False,
    completed: bool = True,
    interruption_reason: str | None = None,
) -> PvtScore:
    """Score a list of raw PVT events.

    Each trial is a dict with ``kind`` in {"response", "false_start", "miss"} and,
    for responses, ``rt_ms``. Responses with rt < ANTICIPATION_MS are reclassified
    as false starts (anticipations).
    """
    if mode not in MODE_CONFIG:
        raise ValueError(f"unknown mode {mode!r}")
    cfg = MODE_CONFIG[mode]

    rts: list[float] = []
    false_starts = 0
    anticipations = 0
    misses = 0
    for t in trials:
        kind = t.get("kind")
        if kind == "response":
            rt = t.get("rt_ms")
            if rt is None or not np.isfinite(rt) or rt < 0:
                continue  # malformed, ignored (counted in data-quality below)
            if rt < ANTICIPATION_MS:
                anticipations += 1
            else:
                rts.append(float(rt))
        elif kind == "false_start":
            false_starts += 1
        elif kind == "miss":
            misses += 1

    total_false = false_starts + anticipations
    n_stimuli = len(rts) + anticipations + misses
    arr = np.asarray(rts, dtype=float)

    metrics: dict[str, Any] = {
        "n_stimuli": n_stimuli,
        "n_valid_responses": int(arr.size),
        "false_starts": int(total_false),
        "anticipations": int(anticipations),
        "misses": int(misses),
        "lapses": int(np.sum(arr >= LAPSE_MS)) if arr.size else 0,
        "median_rt_ms": None,
        "mean_rt_ms": None,
        "rt_iqr_ms": None,
        "rt_mad_ms": None,
        "fastest10_mean_ms": None,
        "slowest10_mean_ms": None,
        "response_speed": None,  # mean of 1/RT in 1/s
    }
    if arr.size:
        q1, q3 = np.percentile(arr, [25, 75])
        med = float(np.median(arr))
        k = max(1, int(round(arr.size * 0.10)))
        s = np.sort(arr)
        metrics.update(
            median_rt_ms=_round(med),
            mean_rt_ms=_round(float(arr.mean())),
            rt_iqr_ms=_round(float(q3 - q1)),
            rt_mad_ms=_round(float(np.median(np.abs(arr - med)))),
            fastest10_mean_ms=_round(float(s[:k].mean())),
            slowest10_mean_ms=_round(float(s[-k:].mean())),
            response_speed=_round(float(np.mean(1000.0 / arr)), 3),
        )

    reasons: list[str] = []
    status = "valid"
    if interrupted:
        status = "invalid"
        reasons.append(
            "Assessment was interrupted" + (f" ({interruption_reason})" if interruption_reason else "")
            + "; timing cannot be trusted."
        )
    if not completed and status == "valid":
        status = "incomplete"
        reasons.append("Assessment did not run to completion.")
    if arr.size < cfg["min_valid_responses"]:
        if status == "valid":
            status = "invalid"
        reasons.append(
            f"Only {arr.size} valid responses; at least {int(cfg['min_valid_responses'])} are required "
            f"in {mode} mode."
        )
    denom = n_stimuli + false_starts
    if denom and total_false / denom > MAX_FALSE_START_FRACTION:
        if status == "valid":
            status = "invalid"
        reasons.append(
            f"Premature responses made up {total_false}/{denom} events "
            f"(> {int(MAX_FALSE_START_FRACTION * 100)}% rule); responses may not reflect the stimulus."
        )
    if n_stimuli and misses / n_stimuli > MAX_MISS_FRACTION:
        if status == "valid":
            status = "invalid"
        reasons.append(
            f"{misses}/{n_stimuli} stimuli received no response (> {int(MAX_MISS_FRACTION * 100)}% rule); "
            "participant may not have been engaged with the task."
        )

    return PvtScore(status=status, reasons=reasons, metrics=metrics, valid_rts_ms=[float(x) for x in rts])
