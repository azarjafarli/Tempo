"""Precision motor-control task: fixed target layout and scoring.

Coordinates are normalized to the task arena: x in [0, 1] across the width,
y in [0, 1] down the height. The arena is rendered with a fixed aspect ratio
(ARENA_ASPECT = height / width), so distances are converted to
"arena-width units" before any geometry is computed. Resizing the browser
window therefore changes pixels but not the measured quantities.

Equivalent difficulty across sessions: every session uses the same base
sequence of targets. Sessions rotate between four mirror variants (identity,
mirror-x, mirror-y, both). Mirroring preserves every inter-target distance and
target size, so the movement-distance/target-width profile (and therefore the
Fitts-style index of difficulty of each movement) is identical, while reducing
pure memorization of screen positions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

ARENA_ASPECT = 10 / 16  # height / width
TARGET_RADIUS = 0.032   # in arena-width units
START_POINT = (0.5, 0.5)

BASE_TARGETS: list[tuple[float, float]] = [
    (0.18, 0.22), (0.80, 0.30), (0.35, 0.78), (0.62, 0.55),
    (0.12, 0.60), (0.88, 0.80), (0.50, 0.15), (0.25, 0.42),
    (0.72, 0.12), (0.58, 0.88), (0.90, 0.48), (0.40, 0.30),
]

MAX_MISSES_PER_TARGET = 2.0
MAX_SINGLE_MOVEMENT_MS = 8000.0


def layout(variant: int) -> dict[str, Any]:
    v = variant % 4
    mx, my = v in (1, 3), v in (2, 3)
    targets = []
    for i, (x, y) in enumerate(BASE_TARGETS):
        targets.append({"index": i, "x": 1 - x if mx else x, "y": 1 - y if my else y, "r": TARGET_RADIUS})
    return {
        "variant": v,
        "aspect": ARENA_ASPECT,
        "target_radius": TARGET_RADIUS,
        "start": {"x": START_POINT[0], "y": START_POINT[1]},
        "targets": targets,
        "index_of_difficulty_bits": movement_difficulties(targets),
    }


def dist(ax: float, ay: float, bx: float, by: float) -> float:
    """Distance in arena-width units between normalized points."""
    return math.hypot(ax - bx, (ay - by) * ARENA_ASPECT)


def movement_difficulties(targets: list[dict[str, Any]]) -> list[float]:
    ids = []
    px, py = START_POINT
    for t in targets:
        d = dist(px, py, t["x"], t["y"])
        ids.append(round(math.log2(d / (2 * t["r"]) + 1), 4))  # Shannon formulation
        px, py = t["x"], t["y"]
    return ids


@dataclass
class MotorScore:
    status: str
    reasons: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    movement_times_ms: list[float] = field(default_factory=list)
    data_quality: list[str] = field(default_factory=list)


def score_motor(
    variant: int,
    clicks: list[dict[str, Any]],
    path: list[dict[str, Any]],
    interrupted: bool = False,
    completed: bool = True,
    interruption_reason: str | None = None,
) -> MotorScore:
    """Score a motor session.

    ``clicks``: [{t_ms, x, y}] in chronological order (normalized coords). A click
    counts as a hit if it lands inside the *current* target; otherwise it is a miss.
    ``path``: [{t_ms, x, y}] pointer samples.
    """
    lay = layout(variant)
    targets = lay["targets"]
    n = len(targets)

    hits: list[dict[str, Any]] = []
    misses = 0
    current = 0
    for c in sorted(clicks, key=lambda c: c["t_ms"]):
        if current >= n:
            break
        t = targets[current]
        if dist(c["x"], c["y"], t["x"], t["y"]) <= t["r"]:
            hits.append({**c, "target": current})
            current += 1
        else:
            misses += 1

    samples = sorted(path, key=lambda p: p["t_ms"])
    sample_t = np.array([p["t_ms"] for p in samples], dtype=float) if samples else np.zeros(0)

    mts: list[float] = []
    errors: list[float] = []
    efficiencies: list[float] = []
    prev_t = 0.0
    prev_xy = START_POINT
    for h in hits:
        tg = targets[h["target"]]
        mts.append(float(h["t_ms"] - prev_t))
        errors.append(dist(h["x"], h["y"], tg["x"], tg["y"]))
        if sample_t.size:
            lo, hi = np.searchsorted(sample_t, [prev_t, h["t_ms"]], side="left")
            seg = [prev_xy] + [(p["x"], p["y"]) for p in samples[lo:hi]] + [(h["x"], h["y"])]
            travelled = sum(dist(*seg[i], *seg[i + 1]) for i in range(len(seg) - 1))
            straight = dist(prev_xy[0], prev_xy[1], h["x"], h["y"])
            if travelled > 1e-6 and hi - lo >= 2:
                efficiencies.append(min(1.0, straight / travelled))
        prev_t = float(h["t_ms"])
        prev_xy = (h["x"], h["y"])

    mt = np.asarray(mts)
    metrics: dict[str, Any] = {
        "n_targets": n,
        "targets_hit": len(hits),
        "misses": misses,
        "hit_rate": round(len(hits) / (len(hits) + misses), 3) if (hits or misses) else None,
        "completion_time_ms": round(float(hits[-1]["t_ms"]), 1) if hits else None,
        "median_movement_time_ms": round(float(np.median(mt)), 1) if mt.size else None,
        "mean_movement_time_ms": round(float(mt.mean()), 1) if mt.size else None,
        "movement_time_cv": round(float(mt.std(ddof=1) / mt.mean()), 3) if mt.size >= 3 and mt.mean() > 0 else None,
        "mean_endpoint_error_pct": round(float(np.mean(errors)) * 100, 2) if errors else None,
        "path_efficiency": round(float(np.mean(efficiencies)), 3) if efficiencies else None,
        "variant": lay["variant"],
    }

    reasons: list[str] = []
    dq: list[str] = []
    status = "valid"
    if interrupted:
        status = "invalid"
        reasons.append("Assessment was interrupted" + (f" ({interruption_reason})" if interruption_reason else "") + ".")
    if len(hits) < n:
        if status == "valid":
            status = "incomplete"
        reasons.append(f"Only {len(hits)} of {n} targets were completed.")
    if not completed and status == "valid":
        status = "incomplete"
        reasons.append("Assessment did not run to completion.")
    if misses > MAX_MISSES_PER_TARGET * n:
        if status == "valid":
            status = "invalid"
        reasons.append(f"{misses} misses exceeds the {int(MAX_MISSES_PER_TARGET * n)}-miss rule for a {n}-target run.")
    if mt.size and mt.max() > MAX_SINGLE_MOVEMENT_MS:
        if status == "valid":
            status = "invalid"
        reasons.append(
            f"A single movement took {mt.max() / 1000:.1f} s (> {MAX_SINGLE_MOVEMENT_MS / 1000:.0f} s rule); "
            "the run likely contains a pause."
        )
    if len(efficiencies) < len(hits):
        dq.append(
            f"Pointer path available for {len(efficiencies)}/{len(hits)} movements; path efficiency uses only those."
        )

    return MotorScore(status=status, reasons=reasons, metrics=metrics, movement_times_ms=mts, data_quality=dq)
