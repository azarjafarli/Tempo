"""Deterministic synthetic demo mission.

Everything created here is SYNTHETIC: fictional crew (call signs VEGA, ORION,
LYRA), a fictional five-day lunar surface mission, simulated trial-level
assessment data and simulated self-reports. Every random draw comes from
numpy Generators seeded from BASE_SEED plus fixed integer identifiers, so the
same profile always produces byte-identical data.
"""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from .analysis.motor import ARENA_ASPECT, START_POINT, layout
from .db import jdump
from .store import create_motor_session, create_pvt_session, insert_self_report

BASE_SEED = 20260514
PROFILES = ("declining", "stable")
MISSION_ANCHOR = datetime(2031, 4, 7, tzinfo=timezone.utc)  # fictional mission day 0
NUM_DAYS = 5
CURRENT_DAY = 3
LOCAL_CODE = "LOCAL"

CREW = [
    {"code": "VEGA", "display_name": "Crew Member A (call sign VEGA)", "role": "Commander",
     "qualifications": ["EVA", "geology", "drilling", "rover"],
     "pvt_median": 262.0, "pvt_sigma": 0.13, "motor_a": 170.0, "motor_b": 105.0},
    {"code": "ORION", "display_name": "Crew Member B (call sign ORION)", "role": "Flight engineer",
     "qualifications": ["EVA", "rover", "engineering", "comms"],
     "pvt_median": 281.0, "pvt_sigma": 0.12, "motor_a": 185.0, "motor_b": 112.0},
    {"code": "LYRA", "display_name": "Crew Member C (call sign LYRA)", "role": "Mission specialist",
     "qualifications": ["EVA", "geology", "engineering", "drilling"],
     "pvt_median": 249.0, "pvt_sigma": 0.12, "motor_a": 160.0, "motor_b": 100.0},
]

# mission timeline positions (days) of assessment sessions
BASELINE_TIMES = [-10.4, -9.4, -8.4, -7.4, -6.4]
MISSION_TIMES = {"VEGA": [1.75, 2.25, 2.75, 3.25], "ORION": [1.75, 2.25, 2.75, 3.25], "LYRA": [1.25, 2.25, 2.75, 3.25]}
# Seed index of each session. Sessions added later get indices from 20 upward so earlier sessions keep identical data.
ORIGINAL_MISSION_TIMES = {"VEGA": [1.75, 2.25, 2.75, 3.25], "ORION": [1.75, 2.25, 3.25], "LYRA": [2.75, 3.25]}


def _seed_index(code: str, phase: str, position: int, tp: float) -> int:
    if phase == "baseline":
        return position
    orig = ORIGINAL_MISSION_TIMES[code]
    if tp in orig:
        return len(BASELINE_TIMES) + orig.index(tp)
    extra = [t for t in MISSION_TIMES[code] if t not in orig]
    return 20 + extra.index(tp)

# per-session modifiers for VEGA's mission sessions (index aligned with MISSION_TIMES["VEGA"])
VEGA_PROFILE = {
    "declining": {"rt": [1.04, 1.09, 1.16, 1.30], "lapse": [0.02, 0.03, 0.07, 0.12],
                  "mt": [1.03, 1.08, 1.14, 1.26], "err": [1.0, 1.1, 1.25, 1.6], "eff_drop": [0.0, 0.01, 0.03, 0.07]},
    "stable": {"rt": [1.01, 0.99, 1.02, 1.00], "lapse": [0.01, 0.01, 0.01, 0.01],
               "mt": [1.01, 0.99, 1.02, 1.00], "err": [1.0, 1.0, 1.05, 1.0], "eff_drop": [0.0, 0.0, 0.01, 0.0]},
}
STABLE_MOD = {"rt": 1.0, "lapse": 0.01, "mt": 1.0, "err": 1.0, "eff_drop": 0.0}

TASKS: list[dict[str, Any]] = [
    # completed (days 1-2)
    dict(task_code="T01", name="Habitat egress & suit checkout", duration_hours=1.0, priority="high", required_qualifications=[],
         assigned_crew=["VEGA", "ORION"], planned_day=1, planned_start_hour=8.0, depends_on=[], status="completed"),
    dict(task_code="T02", name="Seismometer deployment", duration_hours=2.5, priority="high", required_qualifications=["engineering"],
         assigned_crew=["VEGA", "ORION"], planned_day=1, planned_start_hour=9.0, depends_on=["T01"], status="completed"),
    dict(task_code="T03", name="Geology traverse, Station 1", duration_hours=3.0, priority="medium", required_qualifications=["geology"],
         assigned_crew=["VEGA", "ORION"], planned_day=1, planned_start_hour=11.5, depends_on=[], status="completed"),
    dict(task_code="T04", name="Rover checkout drive", duration_hours=1.5, priority="high", required_qualifications=["rover"],
         assigned_crew=["VEGA", "LYRA"], planned_day=2, planned_start_hour=8.5, depends_on=[], status="completed"),
    dict(task_code="T05", name="Station 2 sampling", duration_hours=3.0, priority="high", required_qualifications=["geology"],
         assigned_crew=["VEGA", "LYRA"], planned_day=2, planned_start_hour=10.0, depends_on=["T04"], status="completed"),
    dict(task_code="T06", name="Drill site survey", duration_hours=2.5, priority="medium", required_qualifications=["drilling"],
         assigned_crew=["VEGA", "LYRA"], planned_day=2, planned_start_hour=13.0, depends_on=[], status="completed"),
    # planned (days 3-5)
    dict(task_code="T07", name="Rover traverse to Station 4", duration_hours=1.5, priority="high", required_qualifications=["rover"],
         assigned_crew=["VEGA", "ORION"], planned_day=3, planned_start_hour=8.0, depends_on=[], earliest_day=3, latest_day=4),
    dict(task_code="T08", name="Core sample drilling", duration_hours=2.5, priority="high", required_qualifications=["drilling"],
         assigned_crew=["VEGA", "ORION"], planned_day=3, planned_start_hour=9.5, depends_on=["T07"], earliest_day=3, latest_day=4),
    dict(task_code="T09", name="Core documentation & bagging", duration_hours=1.0, priority="medium", required_qualifications=["geology"],
         assigned_crew=["VEGA", "ORION"], planned_day=3, planned_start_hour=12.0, depends_on=["T08"], earliest_day=3, latest_day=5),
    dict(task_code="T10", name="Seismometer leveling check", duration_hours=1.0, priority="low", required_qualifications=["engineering"],
         assigned_crew=["VEGA", "ORION"], planned_day=3, planned_start_hour=13.0, depends_on=[], earliest_day=3, latest_day=5),
    dict(task_code="T11", name="Comms relay mast install", duration_hours=2.5, priority="high", required_qualifications=["engineering", "comms"],
         assigned_crew=["ORION", "LYRA"], planned_day=4, planned_start_hour=9.0, depends_on=[], earliest_day=4, latest_day=4, is_fixed=1),
    dict(task_code="T12", name="Rover maintenance", duration_hours=1.5, priority="medium", required_qualifications=["rover"],
         assigned_crew=["ORION", "LYRA"], planned_day=4, planned_start_hour=11.5, depends_on=[], earliest_day=3, latest_day=5),
    dict(task_code="T13", name="Regolith sieve experiment", duration_hours=2.0, priority="low", required_qualifications=["geology"],
         assigned_crew=["ORION", "LYRA"], planned_day=4, planned_start_hour=13.0, depends_on=[], earliest_day=3, latest_day=5),
    dict(task_code="T14", name="Sample container packing", duration_hours=2.0, priority="high", required_qualifications=["geology"],
         assigned_crew=["VEGA", "LYRA"], planned_day=5, planned_start_hour=8.0, depends_on=["T09"], earliest_day=4, latest_day=5),
    dict(task_code="T15", name="Station 4 photo survey", duration_hours=1.5, priority="medium", required_qualifications=[],
         assigned_crew=["VEGA", "LYRA"], planned_day=5, planned_start_hour=10.0, depends_on=[], earliest_day=3, latest_day=5),
    dict(task_code="T16", name="Extended geology traverse", duration_hours=3.0, priority="low", required_qualifications=["geology", "rover"],
         assigned_crew=["VEGA", "LYRA"], planned_day=5, planned_start_hour=11.5, depends_on=[], earliest_day=4, latest_day=5),
]

EVAS = [
    # (eva_number, day, start_hour, duration_hours, status, crew)
    (1, 1, 8.0, 6.5, "completed", ["VEGA", "ORION"]),
    (2, 2, 8.5, 7.0, "completed", ["VEGA", "LYRA"]),
    (3, 3, 8.0, 6.0, "planned", ["VEGA", "ORION"]),
    (4, 4, 9.0, 6.0, "planned", ["ORION", "LYRA"]),
    (5, 5, 8.0, 6.5, "planned", ["VEGA", "LYRA"]),
]


def _rng(*ids: int) -> np.random.Generator:
    return np.random.default_rng([BASE_SEED, *ids])


def ts(day_pos: float) -> str:
    return (MISSION_ANCHOR + timedelta(days=day_pos)).isoformat(timespec="seconds")


def gen_pvt_trials(rng: np.random.Generator, median: float, sigma: float, lapse_p: float,
                   fs_p: float = 0.03, miss_p: float = 0.004, duration_ms: float = 180_000,
                   isi: tuple[float, float] = (2000, 7000)) -> list[dict[str, Any]]:
    trials: list[dict[str, Any]] = []
    t = 0.0
    while True:
        gap = float(rng.uniform(*isi))
        if rng.random() < fs_p:
            trials.append({"kind": "false_start", "t_ms": round(t + gap * float(rng.uniform(0.2, 0.9)), 1)})
        onset = t + gap
        if onset > duration_ms:
            break
        u = rng.random()
        if u < miss_p:
            trials.append({"kind": "miss", "t_ms": round(onset, 1)})
            t = onset + 3000
            continue
        if u < miss_p + lapse_p:
            rt = float(rng.uniform(500, 1100))
        else:
            rt = max(140.0, float(rng.lognormal(math.log(median), sigma)))
        trials.append({"kind": "response", "t_ms": round(onset, 1), "rt_ms": round(rt, 1)})
        t = onset + rt
    return trials


def gen_motor(rng: np.random.Generator, variant: int, a: float, b: float, mt_f: float, err_f: float,
              eff_drop: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lay = layout(variant)
    clicks: list[dict[str, Any]] = []
    path: list[dict[str, Any]] = []
    t = 0.0
    px, py = START_POINT
    for tg, idb in zip(lay["targets"], lay["index_of_difficulty_bits"]):
        mt = (a + b * idb) * mt_f * float(rng.lognormal(0, 0.12))
        # endpoint
        sd = 0.0085 * err_f
        miss_first = False
        for _ in range(20):
            ex, ey = rng.normal(0, sd), rng.normal(0, sd)
            if math.hypot(ex, ey) <= tg["r"] * 0.95:
                break
            miss_first = True
        hx, hy = tg["x"] + ex, tg["y"] + ey / ARENA_ASPECT
        # curved path in width-units space
        dxw, dyw = hx - px, (hy - py) * ARENA_ASPECT
        d = math.hypot(dxw, dyw) or 1e-6
        eff = max(0.6, 0.93 - eff_drop + float(rng.normal(0, 0.015)))
        amp = d * (2 / math.pi) * math.sqrt(max(1 / eff - 1, 0)) * (1 if rng.random() < 0.5 else -1)
        nx, ny = -dyw / d, dxw / d
        steps = max(4, int(mt / 30))
        for k in range(1, steps):
            f = k / steps
            s = (1 - math.cos(math.pi * f)) / 2  # ease-in-out progress
            off = amp * math.sin(math.pi * s)
            xw = px + dxw * s + nx * off
            yw = py * ARENA_ASPECT + dyw * s + ny * off
            path.append({"t_ms": round(t + mt * f, 1), "x": round(xw, 5), "y": round(yw / ARENA_ASPECT, 5)})
        t_hit = t + mt
        if miss_first:
            mx = tg["x"] + (tg["r"] * 1.6) * (1 if rng.random() < 0.5 else -1)
            clicks.append({"t_ms": round(t_hit - 180, 1), "x": round(mx, 5), "y": round(tg["y"], 5)})
        clicks.append({"t_ms": round(t_hit, 1), "x": round(hx, 5), "y": round(hy, 5)})
        t = t_hit
        px, py = hx, hy
    return clicks, path


# Synthetic wearable nights (morning of each day). Individual baselines, then mission effects.
WEARABLE_BASE = {
    "VEGA": {"asleep": 428, "deep": 84, "rem": 102, "slp_hr": 51, "rhr": 58, "hrv": 63, "restless": 8},
    "ORION": {"asleep": 412, "deep": 80, "rem": 96, "slp_hr": 54, "rhr": 61, "hrv": 54, "restless": 9},
    "LYRA": {"asleep": 440, "deep": 90, "rem": 108, "slp_hr": 49, "rhr": 56, "hrv": 71, "restless": 7},
}
WEARABLE_DAYS = list(range(-13, CURRENT_DAY + 1))
# VEGA mission-morning deltas by mission day (declining profile)
VEGA_WEAR_DECLINE = {1: dict(asleep=-35, hrv=-6, rhr=2, slp_hr=3, restless=3, stage=0.95),
                     2: dict(asleep=-75, hrv=-13, rhr=4, slp_hr=6, restless=6, stage=0.88),
                     3: dict(asleep=-95, hrv=-17, rhr=5, slp_hr=8, restless=8, stage=0.82)}


def gen_wearable_night(rng: np.random.Generator, base: dict[str, float], delta: dict[str, float]) -> dict[str, float]:
    asleep = max(180.0, base["asleep"] + delta.get("asleep", 0) + rng.normal(0, 18))
    stage = delta.get("stage", 1.0)
    deep = max(20.0, base["deep"] * asleep / base["asleep"] * stage + rng.normal(0, 7))
    rem = max(20.0, base["rem"] * asleep / base["asleep"] * stage + rng.normal(0, 9))
    rhr = base["rhr"] + delta.get("rhr", 0) + rng.normal(0, 1.2)
    return {
        "asleep_min": round(asleep), "awake_min": round(max(10.0, 45 + rng.normal(0, 10) + delta.get("restless", 0) * 2)),
        "deep_min": round(deep), "rem_min": round(rem), "light_min": round(max(0.0, asleep - deep - rem)),
        "sleeping_hr": round(base["slp_hr"] + delta.get("slp_hr", 0) + rng.normal(0, 1.0), 1),
        "resting_hr": round(rhr, 1),
        "hrv_ms": round(max(15.0, base["hrv"] + delta.get("hrv", 0) + rng.normal(0, 3.5)), 1),
        "restless_pct": round(max(1.0, base["restless"] + delta.get("restless", 0) + rng.normal(0, 1.5)), 1),
    }


def seed_wearable(conn: sqlite3.Connection, profile: str, crew_ids: dict[str, int] | None = None) -> int:
    """Insert deterministic synthetic wearable nights for the fictional crew (idempotent per crew/day)."""
    p_idx = PROFILES.index(profile)
    if crew_ids is None:
        crew_ids = {r[0]: r[1] for r in conn.execute("SELECT code, id FROM crew_members WHERE provenance='synthetic'")}
    n_rows = 0
    for ci, c in enumerate(CREW):
        if c["code"] not in crew_ids:
            continue
        for d in WEARABLE_DAYS:
            rng = _rng(p_idx, ci, 700 + d + 20)
            delta: dict[str, float] = {}
            if d >= 1:
                delta = {"asleep": -15, "hrv": -2, "rhr": 1}  # mild mission effect for everyone
                if c["code"] == "VEGA" and profile == "declining":
                    delta = VEGA_WEAR_DECLINE[d]
            n = gen_wearable_night(rng, WEARABLE_BASE[c["code"]], delta)
            conn.execute(
                "INSERT OR IGNORE INTO wearable_nights (crew_member_id, mission_day, sleep_start, asleep_min, awake_min, deep_min, rem_min, "
                "light_min, sleeping_hr, resting_hr, hrv_ms, restless_pct, device, provenance) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'synthetic')",
                (crew_ids[c["code"]], d, ts(d - 1 + 0.93), n["asleep_min"], n["awake_min"], n["deep_min"], n["rem_min"],
                 n["light_min"], n["sleeping_hr"], n["resting_hr"], n["hrv_ms"], n["restless_pct"],
                 "a simulated wrist wearable"))
            n_rows += 1

    return n_rows


def _clear_synthetic(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM missions")
    conn.execute("DELETE FROM crew_members WHERE code != ?", (LOCAL_CODE,))


def ensure_local_participant(conn: sqlite3.Connection) -> int:
    r = conn.execute("SELECT id FROM crew_members WHERE code=?", (LOCAL_CODE,)).fetchone()
    if r:
        return int(r[0])
    cur = conn.execute(
        "INSERT INTO crew_members (code, display_name, role, qualifications, is_fictional, is_schedulable, provenance) "
        "VALUES (?,?,?,?,?,?,?)",
        (LOCAL_CODE, "Local participant (you)", "Person using this computer · real measurements", "[]", 0, 0,
         "local_measurement"))
    return int(cur.lastrowid)


def load_demo(conn: sqlite3.Connection, profile: str = "declining") -> dict[str, Any]:
    if profile not in PROFILES:
        raise ValueError(f"profile must be one of {PROFILES}")
    p_idx = PROFILES.index(profile)
    _clear_synthetic(conn)
    ensure_local_participant(conn)

    crew_ids: dict[str, int] = {}
    for c in CREW:
        cur = conn.execute(
            "INSERT INTO crew_members (code, display_name, role, qualifications, is_fictional, is_schedulable, provenance) "
            "VALUES (?,?,?,?,1,1,'synthetic')", (c["code"], c["display_name"], c["role"], jdump(c["qualifications"])))
        crew_ids[c["code"]] = int(cur.lastrowid)

    label = f"Demo scenario · {profile}-performance history (synthetic)"
    cur = conn.execute(
        "INSERT INTO missions (name, num_days, current_day, selected_crew_id, scenario_profile, random_seed, provenance, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        ("LX-5 Lunar Surface Mission", NUM_DAYS, CURRENT_DAY, crew_ids["VEGA"], profile, BASE_SEED,
         "synthetic", ts(CURRENT_DAY + 0.3)))
    mission_id = int(cur.lastrowid)

    for num, day, start, dur, status, crew in EVAS:
        cur = conn.execute(
            "INSERT INTO eva_activities (mission_id, eva_number, mission_day, start_hour, duration_hours, status, provenance) "
            "VALUES (?,?,?,?,?,?,'synthetic')", (mission_id, num, day, start, dur, status))
        for c in crew:
            conn.execute("INSERT INTO eva_activity_crew VALUES (?,?)", (cur.lastrowid, crew_ids[c]))

    for t in TASKS:
        conn.execute(
            "INSERT INTO eva_tasks (mission_id, task_code, name, duration_hours, priority, required_qualifications, crew_needed, "
            "assigned_crew, planned_day, planned_start_hour, earliest_day, latest_day, window_start_hour, window_end_hour, "
            "depends_on, is_fixed, status, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synthetic')",
            (mission_id, t["task_code"], t["name"], t["duration_hours"], t["priority"], jdump(t["required_qualifications"]), 2,
             jdump(t["assigned_crew"]), t["planned_day"], t["planned_start_hour"], t.get("earliest_day", t["planned_day"]),
             t.get("latest_day", t["planned_day"]), 7.0, 19.0, jdump(t["depends_on"]), t.get("is_fixed", 0),
             t.get("status", "planned")))

    n_sessions = 0
    for ci, c in enumerate(CREW):
        cid = crew_ids[c["code"]]
        times = [(tp, "baseline", None) for tp in BASELINE_TIMES]
        for k, tp in enumerate(MISSION_TIMES[c["code"]]):
            times.append((tp, "mission", k))
        for pos, (tp, phase, k) in enumerate(times):
            si = _seed_index(c["code"], phase, pos, tp)
            if c["code"] == "VEGA" and k is not None:
                prof = VEGA_PROFILE[profile]
                mod = {key: prof[key][k] for key in prof}
            else:
                mod = STABLE_MOD
            day = int(math.floor(tp)) if tp >= 0 else None
            rng = _rng(p_idx, ci, si, 1)
            trials = gen_pvt_trials(rng, c["pvt_median"] * mod["rt"], c["pvt_sigma"], mod["lapse"])
            create_pvt_session(conn, crew_member_id=cid, mode="standard", phase=phase, mission_day=day,
                               mission_time_days=tp, started_at=ts(tp), completed_at=ts(tp + 0.0021), trials=trials,
                               interrupted=False, interruption_reason=None, completed=True, provenance="synthetic",
                               scenario_label=label)
            rng = _rng(p_idx, ci, si, 2)
            clicks, path = gen_motor(rng, si % 4, c["motor_a"], c["motor_b"], mod["mt"], mod["err"], mod["eff_drop"])
            create_motor_session(conn, crew_member_id=cid, mode="standard", phase=phase, mission_day=day,
                                 mission_time_days=round(tp + 0.01, 3), started_at=ts(tp + 0.01), completed_at=ts(tp + 0.012),
                                 variant=si % 4, clicks=clicks, path=path, interrupted=False, interruption_reason=None,
                                 completed=True, provenance="synthetic", scenario_label=label)
            n_sessions += 2

    # One deliberately interrupted synthetic session to demonstrate invalid-measurement handling.
    rng = _rng(p_idx, 0, 99, 1)
    partial = gen_pvt_trials(rng, 270, 0.13, 0.02, duration_ms=41_000)
    create_pvt_session(conn, crew_member_id=crew_ids["VEGA"], mode="standard", phase="mission", mission_day=2,
                       mission_time_days=2.8, started_at=ts(2.8), completed_at=None, trials=partial, interrupted=True,
                       interruption_reason="browser tab lost focus after 41 s", completed=False, provenance="synthetic",
                       scenario_label=label + " · simulated interruption")
    n_sessions += 1

    seed_wearable(conn, profile, crew_ids)

    # Self-reported workload (NASA-TLX dimensions) only; sleep and recovery come from the wearable data above
    sr_days = [-8, -6, 1, 2, 3]
    for ci, c in enumerate(CREW):
        rng = _rng(p_idx, ci, 500)
        for j, d in enumerate(sr_days):
            decline = profile == "declining" and c["code"] == "VEGA" and d > 0
            step = (d if decline else 0)
            insert_self_report(
                conn, crew_member_id=crew_ids[c["code"]], mission_day=d if d > 0 else None,
                recorded_at=ts(d + 0.27),
                tlx_mental=float(np.clip(round(35 + 8 * step + rng.normal(0, 4)), 0, 100)),
                tlx_physical=float(np.clip(round(45 + 10 * step + rng.normal(0, 4)), 0, 100)),
                tlx_temporal=float(np.clip(round(30 + 6 * step + rng.normal(0, 4)), 0, 100)),
                tlx_performance=float(np.clip(round(25 + 7 * step + rng.normal(0, 4)), 0, 100)),
                tlx_effort=float(np.clip(round(45 + 9 * step + rng.normal(0, 4)), 0, 100)),
                tlx_frustration=float(np.clip(round(20 + 6 * step + rng.normal(0, 4)), 0, 100)),
                notes="Synthetic workload rating", provenance="synthetic")

    from .demo_fill import clear_local_synthetic, fill_gaps
    clear_local_synthetic(conn)
    filled = fill_gaps(conn, profile)
    return {"mission_id": mission_id, "profile": profile, "sessions_created": n_sessions, "seed": BASE_SEED, "filled": filled,
            "fingerprint": synthetic_fingerprint(conn)}


def synthetic_fingerprint(conn: sqlite3.Connection) -> str:
    """SHA-256 over all synthetic session observations, for determinism checks."""
    h = hashlib.sha256()
    rows = conn.execute(
        "SELECT s.assessment_type, s.mission_time_days, s.summary, o.kind, o.t_ms, o.value_ms, o.x, o.y "
        "FROM assessment_sessions s JOIN observations o ON o.session_id = s.id "
        "WHERE s.provenance='synthetic' ORDER BY s.mission_time_days, s.assessment_type, o.seq").fetchall()
    for r in rows:
        h.update(json.dumps(list(r)).encode())
    return h.hexdigest()
