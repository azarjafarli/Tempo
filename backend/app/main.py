"""EVA RECOVERY — Mission Readiness Lab: FastAPI application."""
from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import nasa_import, scheduler, services, store
from .analysis.baseline import rules_documentation
from .analysis.motor import layout
from .analysis.pvt import MODE_CONFIG
from .db import connect, init_schema, jdump, jload
from .provenance import PROVENANCE_CATEGORIES, REFERENCES
from .seed import LOCAL_CODE, PROFILES, ensure_local_participant, load_demo

@asynccontextmanager
async def lifespan(_app: FastAPI):
    conn = connect()
    try:
        bootstrap(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="EVA RECOVERY — Mission Readiness Lab API", version="1.0.0", lifespan=lifespan,
              description="Research and decision-support prototype. Not a clinically validated fitness-for-duty system.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


def get_conn():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def bootstrap(conn: sqlite3.Connection) -> None:
    init_schema(conn)
    ensure_local_participant(conn)
    if store.get_mission(conn) is None:
        load_demo(conn, "declining")
    if not nasa_import.import_status(conn)["imported"] and nasa_import.BUNDLED_FILE.exists():
        nasa_import.import_bundled(conn)
    conn.commit()


# ------------------------------------------------------------------ models
class PvtTrialIn(BaseModel):
    kind: Literal["response", "false_start", "miss"]
    t_ms: float = Field(ge=0, le=3_600_000)
    rt_ms: Optional[float] = Field(default=None, ge=0, le=60_000)


class PointIn(BaseModel):
    t_ms: float = Field(ge=0, le=3_600_000)
    x: float = Field(ge=-0.5, le=1.5)
    y: float = Field(ge=-0.5, le=1.5)


class SessionBase(BaseModel):
    crew_member_id: int
    mode: Literal["demo", "standard"] = "demo"
    phase: Literal["baseline", "mission"] = "mission"
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    interrupted: bool = False
    interruption_reason: Optional[str] = Field(default=None, max_length=200)
    completed: bool = True
    client_info: dict[str, Any] = Field(default_factory=dict)

    @field_validator("started_at", "completed_at")
    @classmethod
    def _iso(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as e:
            raise ValueError("must be an ISO-8601 timestamp") from e
        return v


class PvtSessionIn(SessionBase):
    trials: list[PvtTrialIn] = Field(max_length=3000)


class MotorSessionIn(SessionBase):
    variant: int = Field(ge=0, le=3)
    clicks: list[PointIn] = Field(max_length=1000)
    path: list[PointIn] = Field(max_length=30000)


class SelfReportIn(BaseModel):
    crew_member_id: int
    sleep_hours: Optional[float] = Field(default=None, ge=0, le=24)
    fatigue: Optional[float] = Field(default=None, ge=0, le=10)
    recovery: Optional[float] = Field(default=None, ge=0, le=10)
    tlx_mental: Optional[float] = Field(default=None, ge=0, le=100)
    tlx_physical: Optional[float] = Field(default=None, ge=0, le=100)
    tlx_temporal: Optional[float] = Field(default=None, ge=0, le=100)
    tlx_performance: Optional[float] = Field(default=None, ge=0, le=100)
    tlx_effort: Optional[float] = Field(default=None, ge=0, le=100)
    tlx_frustration: Optional[float] = Field(default=None, ge=0, le=100)
    notes: Optional[str] = Field(default=None, max_length=500)


class DemoLoadIn(BaseModel):
    profile: Literal["declining", "stable"] = "declining"


class TaskUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    duration_hours: Optional[float] = Field(default=None, gt=0, le=8)
    priority: Optional[Literal["high", "medium", "low"]] = None
    required_qualifications: Optional[list[str]] = None
    assigned_crew: Optional[list[str]] = None
    planned_day: Optional[int] = Field(default=None, ge=1, le=5)
    planned_start_hour: Optional[float] = Field(default=None, ge=0, le=23.75)
    earliest_day: Optional[int] = Field(default=None, ge=1, le=5)
    latest_day: Optional[int] = Field(default=None, ge=1, le=5)
    window_start_hour: Optional[float] = Field(default=None, ge=0, le=24)
    window_end_hour: Optional[float] = Field(default=None, ge=0, le=24)
    depends_on: Optional[list[str]] = None
    is_fixed: Optional[bool] = None


class CrewRestriction(BaseModel):
    max_eva_hours: Optional[float] = Field(default=None, ge=0, le=12)
    unavailable_days: list[int] = Field(default_factory=list)


class OptimizeIn(BaseModel):
    name: str = Field(default="Scenario", max_length=80)
    kind: Literal["original", "reduced_workload", "longer_rest", "custom"] = "custom"
    max_eva_hours: float = Field(default=7.5, ge=1, le=12)
    min_rest_hours: float = Field(default=12.0, ge=0, le=24)
    crew_restrictions: dict[str, CrewRestriction] = Field(default_factory=dict)
    reviewer_note: Optional[str] = Field(default=None, max_length=300)


class ReviewerNoteIn(BaseModel):
    crew_member_id: int
    author: str = Field(min_length=1, max_length=80)
    status: Literal["reviewed_no_action", "follow_up", "restriction_to_model"]
    note: str = Field(min_length=1, max_length=1000)


class CsvImportIn(BaseModel):
    filename: str = Field(max_length=200)
    content: str = Field(max_length=6_000_000)


# ------------------------------------------------------------------ helpers
def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_crew(conn: sqlite3.Connection, crew_id: int) -> dict[str, Any]:
    c = store.get_crew_member(conn, crew_id)
    if c is None:
        raise HTTPException(404, "Crew member not found")
    return c


def _timeline(conn: sqlite3.Connection, crew: dict[str, Any]) -> tuple[Optional[int], Optional[float]]:
    """Mission timeline position for a new real measurement."""
    if crew["code"] == LOCAL_CODE:
        first = conn.execute("SELECT MIN(started_at) FROM assessment_sessions WHERE crew_member_id=?",
                             (crew["id"],)).fetchone()[0]
        if not first:
            return None, 0.0
        dt = datetime.now(timezone.utc) - datetime.fromisoformat(first.replace("Z", "+00:00"))
        return None, round(dt.total_seconds() / 86400, 4)
    m = store.get_mission(conn)
    if not m:
        return None, None
    n = conn.execute("SELECT COUNT(*) FROM assessment_sessions WHERE crew_member_id=? AND provenance='local_measurement'",
                     (crew["id"],)).fetchone()[0]
    return m["current_day"], round(m["current_day"] + 0.3 + 0.01 * (n + 1), 3)


# ------------------------------------------------------------------ routes
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "time": _now()}


@app.get("/api/provenance")
def provenance() -> dict[str, Any]:
    return {"categories": PROVENANCE_CATEGORIES, "references": REFERENCES}


@app.post("/api/demo/load")
def demo_load(body: DemoLoadIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    res = load_demo(conn, body.profile)
    if not nasa_import.import_status(conn)["imported"] and nasa_import.BUNDLED_FILE.exists():
        nasa_import.import_bundled(conn)
    return res


@app.get("/api/mission")
def mission(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    m = store.get_mission(conn)
    return {"mission": m, "crew": store.get_crew(conn), "profiles": list(PROFILES)}


@app.get("/api/overview")
def overview(crew_id: Optional[int] = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    try:
        return services.overview(conn, crew_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


@app.get("/api/assessments/config")
def assessment_config() -> dict[str, Any]:
    return {"pvt_modes": MODE_CONFIG, "motor_layouts": [layout(v) for v in range(4)],
            "notice": "The vigilant-attention task is inspired by NASA's Psychomotor Vigilance Test but is not the "
                      "validated NASA PVT instrument."}


@app.get("/api/assessments/motor/next-variant")
def next_variant(crew_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_crew(conn, crew_id)
    n = conn.execute("SELECT COUNT(*) FROM assessment_sessions WHERE crew_member_id=? AND assessment_type='motor'",
                     (crew_id,)).fetchone()[0]
    return layout(n % 4)


@app.get("/api/assessments")
def list_assessments(crew_id: Optional[int] = None, type: Optional[Literal["pvt", "motor"]] = None,
                     conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return store.list_sessions(conn, crew_id, type)


@app.get("/api/assessments/{session_id}")
def get_assessment(session_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    s = store.get_session(conn, session_id)
    if s is None:
        raise HTTPException(404, "Assessment session not found")
    return s


@app.post("/api/assessments/pvt", status_code=201)
def save_pvt(body: PvtSessionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    crew = _require_crew(conn, body.crew_member_id)
    day, tpos = _timeline(conn, crew)
    sid = store.create_pvt_session(
        conn, crew_member_id=crew["id"], mode=body.mode, phase=body.phase, mission_day=day, mission_time_days=tpos,
        started_at=body.started_at or _now(), completed_at=body.completed_at, trials=[t.model_dump() for t in body.trials],
        interrupted=body.interrupted, interruption_reason=body.interruption_reason, completed=body.completed,
        provenance="local_measurement", scenario_label=None, client_info=body.client_info)
    conn.commit()
    return {"session": store.get_session(conn, sid, with_observations=False),
            "analysis": services.analyze(conn, crew["id"], "pvt", sid)}


@app.post("/api/assessments/motor", status_code=201)
def save_motor(body: MotorSessionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    crew = _require_crew(conn, body.crew_member_id)
    day, tpos = _timeline(conn, crew)
    sid = store.create_motor_session(
        conn, crew_member_id=crew["id"], mode=body.mode, phase=body.phase, mission_day=day, mission_time_days=tpos,
        started_at=body.started_at or _now(), completed_at=body.completed_at, variant=body.variant,
        clicks=[c.model_dump() for c in body.clicks], path=[p.model_dump() for p in body.path],
        interrupted=body.interrupted, interruption_reason=body.interruption_reason, completed=body.completed,
        provenance="local_measurement", client_info=body.client_info)
    conn.commit()
    return {"session": store.get_session(conn, sid, with_observations=False),
            "analysis": services.analyze(conn, crew["id"], "motor", sid)}


@app.post("/api/self-reports", status_code=201)
def save_self_report(body: SelfReportIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    crew = _require_crew(conn, body.crew_member_id)
    m = store.get_mission(conn)
    rid = store.insert_self_report(
        conn, **body.model_dump(), mission_day=(m["current_day"] if m and crew["code"] != LOCAL_CODE else None),
        recorded_at=_now(), provenance="local_measurement")
    return {"id": rid, "reports": store.list_self_reports(conn, crew["id"])}


@app.get("/api/self-reports")
def get_self_reports(crew_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    _require_crew(conn, crew_id)
    return store.list_self_reports(conn, crew_id)


@app.get("/api/analysis/rules")
def analysis_rules() -> dict[str, Any]:
    return rules_documentation()


@app.get("/api/analysis/{crew_id}")
def analysis(crew_id: int, type: Literal["pvt", "motor"] = "pvt", session_id: Optional[int] = None,
             conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    try:
        res = services.analyze(conn, crew_id, type, session_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    ev = res["evaluation"]
    if res["evaluated_session"]:
        conn.execute(
            "INSERT INTO analysis_results (crew_member_id, session_id, assessment_type, computed_at, rule_version, "
            "baseline_status, category, details) VALUES (?,?,?,?,?,?,?,?)",
            (crew_id, res["evaluated_session"]["id"], type, _now(), res["rules"]["version"],
             ev.get("baseline_status", "insufficient"), ev["category"],
             jdump({"metrics": [{k: m[k] for k in ("metric", "value", "difference", "robust_z", "category")}
                                for m in ev["metrics"]]})))
    return res


# ---- mission control (reviewer roster)
@app.get("/api/mission-control")
def mission_control(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return services.mission_control(conn)


@app.get("/api/review-notes")
def review_notes(crew_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    _require_crew(conn, crew_id)
    return services.list_reviewer_notes(conn, crew_id)


@app.post("/api/review-notes", status_code=201)
def add_review_note(body: ReviewerNoteIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_crew(conn, body.crew_member_id)
    conn.execute("INSERT INTO reviewer_notes (crew_member_id, created_at, author, status, note) VALUES (?,?,?,?,?)",
                 (body.crew_member_id, _now(), body.author.strip(), body.status, body.note.strip()))
    return {"notes": services.list_reviewer_notes(conn, body.crew_member_id)}


# ---- planner
def _mission_or_404(conn: sqlite3.Connection) -> dict[str, Any]:
    m = store.get_mission(conn)
    if not m:
        raise HTTPException(404, "No mission loaded. Use Load Demo Mission.")
    return m


@app.get("/api/schedule/tasks")
def schedule_tasks(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    m = _mission_or_404(conn)
    crew = [c for c in store.get_crew(conn) if c["is_schedulable"]]
    return {"mission": m, "crew": crew, "tasks": store.get_tasks(conn, m["id"]),
            "defaults": scheduler.DEFAULT_PARAMS, "historical_reference": _historical_reference(conn)}


def _historical_reference(conn: sqlite3.Connection) -> Optional[dict[str, Any]]:
    s = nasa_import.summary(conn)
    if not s.get("imported"):
        return None
    return {"records": s["records"], "duration_hours": s["duration_hours"], "provenance": "nasa_public_data",
            "note": "Historical US/Russian EVA durations (NASA public data) shown for context only."}


@app.put("/api/schedule/tasks/{task_code}")
def update_task(task_code: str, body: TaskUpdateIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    m = _mission_or_404(conn)
    row = conn.execute("SELECT * FROM eva_tasks WHERE mission_id=? AND task_code=?", (m["id"], task_code)).fetchone()
    if not row:
        raise HTTPException(404, "Task not found")
    if row["status"] == "completed":
        raise HTTPException(409, "Completed tasks are historical and cannot be edited.")
    upd = body.model_dump(exclude_none=True)
    crew_codes = {c["code"] for c in store.get_crew(conn) if c["is_schedulable"]}
    task_codes = {r[0] for r in conn.execute("SELECT task_code FROM eva_tasks WHERE mission_id=?", (m["id"],))}
    if "assigned_crew" in upd:
        if not set(upd["assigned_crew"]) <= crew_codes:
            raise HTTPException(422, f"Unknown crew code(s): {sorted(set(upd['assigned_crew']) - crew_codes)}")
        if len(upd["assigned_crew"]) != row["crew_needed"]:
            raise HTTPException(422, f"Task needs exactly {row['crew_needed']} crew members.")
    if "depends_on" in upd:
        bad = set(upd["depends_on"]) - task_codes
        if bad or task_code in upd["depends_on"]:
            raise HTTPException(422, "Dependencies must reference other existing tasks.")
    merged = {**dict(row), **upd}
    if merged["earliest_day"] > merged["latest_day"]:
        raise HTTPException(422, "earliest_day must be <= latest_day")
    if merged["window_end_hour"] - merged["window_start_hour"] < merged["duration_hours"]:
        raise HTTPException(422, "Time window is shorter than the task duration.")
    if merged["planned_day"] is not None and not (merged["earliest_day"] <= merged["planned_day"] <= merged["latest_day"]):
        raise HTTPException(422, "Planned day must lie inside the permitted day window.")
    for k in ("required_qualifications", "assigned_crew", "depends_on"):
        if k in upd:
            upd[k] = jdump(upd[k])
    if "is_fixed" in upd:
        upd["is_fixed"] = int(upd["is_fixed"])
    if upd:
        sets = ", ".join(f"{k}=?" for k in upd)
        conn.execute(f"UPDATE eva_tasks SET {sets} WHERE id=?", (*upd.values(), row["id"]))
    return next(t for t in store.get_tasks(conn, m["id"]) if t["task_code"] == task_code)


@app.post("/api/schedule/optimize")
def optimize(body: OptimizeIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    m = _mission_or_404(conn)
    crew = store.get_crew(conn)
    codes = {c["code"] for c in crew if c["is_schedulable"]}
    bad = set(body.crew_restrictions) - codes
    if bad:
        raise HTTPException(422, f"Unknown crew code(s) in restrictions: {sorted(bad)}")
    for r in body.crew_restrictions.values():
        if any(d < 1 or d > m["num_days"] for d in r.unavailable_days):
            raise HTTPException(422, "unavailable_days must be within the mission days")
    params = {"max_eva_hours": body.max_eva_hours, "min_rest_hours": body.min_rest_hours,
              "crew_restrictions": {k: v.model_dump() for k, v in body.crew_restrictions.items()}}
    try:
        res = scheduler.run_scenario(store.get_tasks(conn, m["id"]), crew, m["num_days"], m["current_day"], params)
    except ValueError as e:
        raise HTTPException(422, str(e))
    res["reviewer_note"] = body.reviewer_note
    cur = conn.execute(
        "INSERT INTO schedule_scenarios (mission_id, name, kind, params, solver_status, result, created_at) "
        "VALUES (?,?,?,?,?,?,?)", (m["id"], body.name, body.kind, jdump({**params, "reviewer_note": body.reviewer_note}),
                                   res["solver_status"], jdump(res), _now()))
    res["scenario_id"] = cur.lastrowid
    res["name"], res["kind"] = body.name, body.kind
    return res


@app.get("/api/schedule/scenarios")
def scenarios(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    m = _mission_or_404(conn)
    rows = conn.execute("SELECT id, name, kind, params, solver_status, created_at FROM schedule_scenarios "
                        "WHERE mission_id=? ORDER BY id DESC LIMIT 30", (m["id"],)).fetchall()
    return [{**dict(r), "params": jload(r["params"], {})} for r in rows]


@app.get("/api/schedule/scenarios/{scenario_id}")
def scenario(scenario_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM schedule_scenarios WHERE id=?", (scenario_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Scenario not found")
    return {**jload(r["result"], {}), "scenario_id": r["id"], "name": r["name"], "kind": r["kind"]}


# ---- NASA data
@app.get("/api/nasa/eva/status")
def nasa_status(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return nasa_import.import_status(conn)


@app.get("/api/nasa/eva/summary")
def nasa_summary(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return nasa_import.summary(conn)


@app.get("/api/nasa/eva/records")
def nasa_records(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                 conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return nasa_import.records(conn, limit, offset)


@app.post("/api/nasa/eva/import")
def nasa_import_upload(body: CsvImportIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    try:
        return nasa_import.import_csv_text(conn, body.content, filename=body.filename)
    except nasa_import.ImportError_ as e:
        raise HTTPException(422, str(e))


@app.post("/api/nasa/eva/import-bundled")
def nasa_import_bundled(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    try:
        return nasa_import.import_bundled(conn)
    except nasa_import.ImportError_ as e:
        raise HTTPException(422, str(e))


# ------------------------------------------------------------------ static frontend (production build)
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
