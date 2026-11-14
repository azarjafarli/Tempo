"""Repository functions shared by the API and the seed scripts."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from .analysis.motor import layout, score_motor
from .analysis.pvt import MODE_CONFIG, score_pvt
from .db import jdump, jload, row_to_dict
from .provenance import require_valid

SESSION_JSON = ("status_reasons", "config", "summary", "client_info")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def raw_tlx(values: list[float | None]) -> float | None:
    vals = [float(v) for v in values if v is not None]
    if len(vals) != 6:
        return None
    return round(sum(vals) / 6.0, 1)


# ----------------------------------------------------------------- crew / mission
def get_crew(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM crew_members ORDER BY id").fetchall()
    out = []
    for r in rows:
        d = row_to_dict(r, ("qualifications",))
        d["is_fictional"] = bool(d["is_fictional"])
        d["is_schedulable"] = bool(d["is_schedulable"])
        out.append(d)
    return out


def get_crew_member(conn: sqlite3.Connection, crew_id: int) -> dict[str, Any] | None:
    for c in get_crew(conn):
        if c["id"] == crew_id:
            return c
    return None


def get_mission(conn: sqlite3.Connection) -> dict[str, Any] | None:
    r = conn.execute("SELECT * FROM missions ORDER BY id DESC LIMIT 1").fetchone()
    return dict(r) if r else None


def get_tasks(conn: sqlite3.Connection, mission_id: int) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM eva_tasks WHERE mission_id=? ORDER BY task_code", (mission_id,)).fetchall()
    out = []
    for r in rows:
        d = row_to_dict(r, ("required_qualifications", "assigned_crew", "depends_on"))
        d["is_fixed"] = bool(d["is_fixed"])
        out.append(d)
    return out


# ----------------------------------------------------------------- sessions
def _insert_session(conn: sqlite3.Connection, **f: Any) -> int:
    cols = ", ".join(f)
    q = ", ".join("?" for _ in f)
    cur = conn.execute(f"INSERT INTO assessment_sessions ({cols}) VALUES ({q})", tuple(f.values()))
    return int(cur.lastrowid)


def create_pvt_session(
    conn: sqlite3.Connection, *, crew_member_id: int, mode: str, phase: str, mission_day: int | None,
    mission_time_days: float | None, started_at: str, completed_at: str | None, trials: list[dict[str, Any]],
    interrupted: bool, interruption_reason: str | None, completed: bool, provenance: str,
    scenario_label: str | None = None, client_info: dict[str, Any] | None = None,
) -> int:
    require_valid(provenance)
    sc = score_pvt(trials, mode=mode, interrupted=interrupted, completed=completed, interruption_reason=interruption_reason)
    sid = _insert_session(
        conn, crew_member_id=crew_member_id, assessment_type="pvt", mode=mode, phase=phase,
        mission_day=mission_day, mission_time_days=mission_time_days, started_at=started_at,
        completed_at=completed_at, status=sc.status, status_reasons=jdump(sc.reasons), provenance=provenance,
        scenario_label=scenario_label, config=jdump({**MODE_CONFIG[mode], "mode": mode,
                                                    "interrupted": interrupted, "interruption_reason": interruption_reason}),
        summary=jdump(sc.metrics), client_info=jdump(client_info or {}),
    )
    rows = []
    for i, t in enumerate(trials):
        rows.append((sid, i, t["kind"], t.get("t_ms"), t.get("rt_ms"), None, None, None, None, jdump({})))
    conn.executemany(
        "INSERT INTO observations (session_id, seq, kind, t_ms, value_ms, x, y, target_x, target_y, extra) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    return sid


def create_motor_session(
    conn: sqlite3.Connection, *, crew_member_id: int, mode: str, phase: str, mission_day: int | None,
    mission_time_days: float | None, started_at: str, completed_at: str | None, variant: int,
    clicks: list[dict[str, Any]], path: list[dict[str, Any]], interrupted: bool, interruption_reason: str | None,
    completed: bool, provenance: str, scenario_label: str | None = None, client_info: dict[str, Any] | None = None,
) -> int:
    require_valid(provenance)
    sc = score_motor(variant, clicks, path, interrupted=interrupted, completed=completed,
                     interruption_reason=interruption_reason)
    lay = layout(variant)
    sid = _insert_session(
        conn, crew_member_id=crew_member_id, assessment_type="motor", mode=mode, phase=phase,
        mission_day=mission_day, mission_time_days=mission_time_days, started_at=started_at,
        completed_at=completed_at, status=sc.status, status_reasons=jdump(sc.reasons + sc.data_quality),
        provenance=provenance, scenario_label=scenario_label,
        config=jdump({"variant": lay["variant"], "aspect": lay["aspect"], "target_radius": lay["target_radius"],
                      "interrupted": interrupted, "interruption_reason": interruption_reason}),
        summary=jdump({**sc.metrics, "movement_times_ms": [round(m, 1) for m in sc.movement_times_ms]}),
        client_info=jdump(client_info or {}),
    )
    rows = []
    seq = 0
    for c in clicks:
        rows.append((sid, seq, "click", c["t_ms"], None, c["x"], c["y"], None, None, jdump({})))
        seq += 1
    for p in path:
        rows.append((sid, seq, "path", p["t_ms"], None, p["x"], p["y"], None, None, jdump({})))
        seq += 1
    conn.executemany(
        "INSERT INTO observations (session_id, seq, kind, t_ms, value_ms, x, y, target_x, target_y, extra) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    return sid


def session_dict(r: sqlite3.Row) -> dict[str, Any]:
    return row_to_dict(r, SESSION_JSON)


def list_sessions(conn: sqlite3.Connection, crew_member_id: int | None = None,
                  assessment_type: str | None = None) -> list[dict[str, Any]]:
    q = "SELECT * FROM assessment_sessions WHERE 1=1"
    args: list[Any] = []
    if crew_member_id is not None:
        q += " AND crew_member_id=?"
        args.append(crew_member_id)
    if assessment_type is not None:
        q += " AND assessment_type=?"
        args.append(assessment_type)
    q += " ORDER BY COALESCE(mission_time_days, 1e9), started_at, id"
    return [session_dict(r) for r in conn.execute(q, args).fetchall()]


def get_session(conn: sqlite3.Connection, session_id: int, with_observations: bool = True) -> dict[str, Any] | None:
    r = conn.execute("SELECT * FROM assessment_sessions WHERE id=?", (session_id,)).fetchone()
    if not r:
        return None
    d = session_dict(r)
    if with_observations:
        obs = conn.execute("SELECT * FROM observations WHERE session_id=? ORDER BY seq", (session_id,)).fetchall()
        d["observations"] = [{**dict(o), "extra": jload(o["extra"], {})} for o in obs]
    return d


def pvt_rts(conn: sqlite3.Connection, session_id: int) -> list[float]:
    rows = conn.execute(
        "SELECT value_ms FROM observations WHERE session_id=? AND kind='response' AND value_ms >= 100 ORDER BY seq",
        (session_id,)).fetchall()
    return [float(r[0]) for r in rows]


def insert_self_report(conn: sqlite3.Connection, **f: Any) -> int:
    f["raw_tlx"] = raw_tlx([f.get(k) for k in ("tlx_mental", "tlx_physical", "tlx_temporal",
                                                "tlx_performance", "tlx_effort", "tlx_frustration")])
    require_valid(f["provenance"])
    cols = ", ".join(f)
    cur = conn.execute(f"INSERT INTO self_reports ({cols}) VALUES ({', '.join('?' for _ in f)})", tuple(f.values()))
    return int(cur.lastrowid)


def list_self_reports(conn: sqlite3.Connection, crew_member_id: int) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM self_reports WHERE crew_member_id=? ORDER BY recorded_at, id",
                        (crew_member_id,)).fetchall()
    return [dict(r) for r in rows]
