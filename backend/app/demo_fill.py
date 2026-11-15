"""Fill otherwise-empty demo areas with deterministic synthetic data.

* Reviewer notes for each fictional crew member (written by a fictional flight surgeon).
* Three saved planner scenarios (original plan, reduced workload, longer rest).
* For the local participant: baseline and recent reaction-time / motor sessions and workload ratings, but only when
  that person has no real sessions or ratings of their own. Real data is never altered or mixed with fake baseline
  sessions, and the person's imported wearable data is untouched.

Everything created here is stored with provenance "synthetic" (scenarios: "hypothetical_scenario").
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from . import scheduler, store
from .db import jdump
from .seed import BASE_SEED, LOCAL_CODE, _rng, gen_motor, gen_pvt_trials, ts

LOCAL_ANCHOR = datetime(2026, 11, 3, 8, 30, tzinfo=timezone.utc)
# (days after anchor, phase, reaction-time factor, movement-time factor)
LOCAL_SESSIONS = [(0, "baseline", 1.0, 1.0), (1, "baseline", 1.0, 1.0), (2, "baseline", 1.0, 1.0),
                  (3, "baseline", 1.0, 1.0), (4, "baseline", 1.0, 1.0),
                  (7, "mission", 1.0, 1.0), (8, "mission", 1.01, 1.0), (10, "mission", 1.04, 1.03),
                  (11, "mission", 1.07, 1.05)]
LOCAL_WORKLOAD_DAYS = [2, 6, 9, 11]


def _local_id(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT id FROM crew_members WHERE code=?", (LOCAL_CODE,)).fetchone()[0])


def clear_local_synthetic(conn: sqlite3.Connection) -> None:
    lid = _local_id(conn)
    conn.execute("DELETE FROM assessment_sessions WHERE crew_member_id=? AND provenance='synthetic'", (lid,))
    conn.execute("DELETE FROM self_reports WHERE crew_member_id=? AND provenance='synthetic'", (lid,))


def fill_local(conn: sqlite3.Connection) -> int:
    lid = _local_id(conn)
    n = 0
    if not conn.execute("SELECT 1 FROM assessment_sessions WHERE crew_member_id=? LIMIT 1", (lid,)).fetchone():
        for i, (d, phase, rt_f, mt_f) in enumerate(LOCAL_SESSIONS):
            start = LOCAL_ANCHOR + timedelta(days=d)
            rng = _rng(9, 9, i, 1)
            trials = gen_pvt_trials(rng, 286.0 * rt_f, 0.13, 0.015 if rt_f < 1.05 else 0.03, duration_ms=60_000, isi=(2000, 5000))
            store.create_pvt_session(
                conn, crew_member_id=lid, mode="demo", phase=phase, mission_day=None, mission_time_days=float(d),
                started_at=start.isoformat(timespec="seconds"), completed_at=(start + timedelta(minutes=1)).isoformat(timespec="seconds"),
                trials=trials, interrupted=False, interruption_reason=None, completed=True, provenance="synthetic")
            rng = _rng(9, 9, i, 2)
            clicks, path = gen_motor(rng, i % 4, 178.0, 108.0, mt_f, 1.0, 0.0)
            store.create_motor_session(
                conn, crew_member_id=lid, mode="standard", phase=phase, mission_day=None, mission_time_days=d + 0.01,
                started_at=(start + timedelta(minutes=3)).isoformat(timespec="seconds"),
                completed_at=(start + timedelta(minutes=4)).isoformat(timespec="seconds"), variant=i % 4,
                clicks=clicks, path=path, interrupted=False, interruption_reason=None, completed=True, provenance="synthetic")
            n += 2
    if not conn.execute("SELECT 1 FROM self_reports WHERE crew_member_id=? LIMIT 1", (lid,)).fetchone():
        for j, d in enumerate(LOCAL_WORKLOAD_DAYS):
            rng = _rng(9, 9, 100 + j)
            v = lambda base: float(max(0, min(100, round(base + 4 * j + rng.normal(0, 5)))))  # noqa: E731
            store.insert_self_report(
                conn, crew_member_id=lid, mission_day=None,
                recorded_at=(LOCAL_ANCHOR + timedelta(days=d, hours=10)).isoformat(timespec="seconds"),
                tlx_mental=v(45), tlx_physical=v(25), tlx_temporal=v(40), tlx_performance=v(30), tlx_effort=v(45),
                tlx_frustration=v(25), notes="Synthetic workload rating", provenance="synthetic")
            n += 1
    return n


def fill_reviewer_notes(conn: sqlite3.Connection, profile: str) -> int:
    if conn.execute("SELECT 1 FROM reviewer_notes LIMIT 1").fetchone():
        return 0
    ids = {r[0]: r[1] for r in conn.execute("SELECT code, id FROM crew_members WHERE provenance='synthetic'")}
    author = "Dr. M. Okafor (flight surgeon)"
    notes = [
        ("LYRA", 3.20, "reviewed_no_action",
         "Premature-response flag on a single session; reaction time, motor results and readiness are all in her normal "
         "range. Most likely chance. Recheck at the next session, no change to EVA 4."),
        ("ORION", 3.21, "reviewed_no_action", "All results within his own baseline. Cleared for EVA 3 as planned."),
    ]
    if profile == "declining":
        notes.append(("VEGA", 3.22, "follow_up",
                      "Vigilance and fine-motor slowing since EVA 2, three sessions in a row, with short sleep and low "
                      "readiness on the wearable. Discussed with VEGA. Repeat both tests before EVA 3 and look at a lighter "
                      "EVA 3 workload with the ops lead."))
    else:
        notes.append(("VEGA", 3.22, "reviewed_no_action", "Results within his own baseline. No action before EVA 3."))
    for code, t, status, text in notes:
        if code in ids:
            conn.execute("INSERT INTO reviewer_notes (crew_member_id, created_at, author, status, note, provenance) "
                         "VALUES (?,?,?,?,?, 'synthetic')", (ids[code], ts(t), author, status, text))
    return len(notes)


def fill_scenarios(conn: sqlite3.Connection) -> int:
    m = store.get_mission(conn)
    if m is None or conn.execute("SELECT 1 FROM schedule_scenarios WHERE mission_id=? LIMIT 1", (m["id"],)).fetchone():
        return 0
    tasks, crew = store.get_tasks(conn, m["id"]), store.get_crew(conn)
    runs: list[tuple[str, str, dict[str, Any], str | None, float]] = [
        ("Original plan", "original", {"max_eva_hours": 7.5, "min_rest_hours": 12.0, "crew_restrictions": {}}, None, 3.23),
        ("VEGA limited to 3 h/day", "reduced_workload",
         {"max_eva_hours": 7.5, "min_rest_hours": 12.0, "crew_restrictions": {"VEGA": {"max_eva_hours": 3.0, "unavailable_days": []}}},
         "Flight surgeon review after flagged vigilance change; exploring a lighter EVA 3.", 3.24),
        ("Minimum rest 18 h", "longer_rest", {"max_eva_hours": 7.5, "min_rest_hours": 18.0, "crew_restrictions": {}},
         "Ops lead: what does a longer rest rule cost the plan?", 3.25),
    ]
    for name, kind, params, note, t in runs:
        res = scheduler.run_scenario(tasks, crew, m["num_days"], m["current_day"], params)
        res["reviewer_note"] = note
        conn.execute(
            "INSERT INTO schedule_scenarios (mission_id, name, kind, params, solver_status, result, created_at) VALUES (?,?,?,?,?,?,?)",
            (m["id"], name, kind, jdump({**params, "reviewer_note": note}), res["solver_status"], jdump(res), ts(t)))
    return len(runs)


def fill_gaps(conn: sqlite3.Connection, profile: str) -> dict[str, int]:
    return {"local": fill_local(conn), "notes": fill_reviewer_notes(conn, profile), "scenarios": fill_scenarios(conn)}


__all__ = ["fill_gaps", "clear_local_synthetic", "BASE_SEED"]
