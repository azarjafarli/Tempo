"""SQLite persistence layer.

The schema is normalized: raw trial-level observations are kept separately from
sessions so every derived metric can be recomputed from source measurements.
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BACKEND_DIR / "data" / "eva_recovery.db"


def db_path() -> Path:
    return Path(os.environ.get("EVA_DB_PATH", str(DEFAULT_DB_PATH)))


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS crew_members (
    id              INTEGER PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    role            TEXT NOT NULL,
    qualifications  TEXT NOT NULL DEFAULT '[]',   -- JSON list
    is_fictional    INTEGER NOT NULL DEFAULT 1,
    is_schedulable  INTEGER NOT NULL DEFAULT 1,
    provenance      TEXT NOT NULL                   -- synthetic | local_measurement
);

CREATE TABLE IF NOT EXISTS missions (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    num_days            INTEGER NOT NULL,
    current_day         INTEGER NOT NULL,
    selected_crew_id    INTEGER REFERENCES crew_members(id),
    scenario_profile    TEXT NOT NULL,              -- stable | declining
    random_seed         INTEGER NOT NULL,
    provenance          TEXT NOT NULL,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eva_activities (
    id              INTEGER PRIMARY KEY,
    mission_id      INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    eva_number      INTEGER NOT NULL,
    mission_day     INTEGER NOT NULL,
    start_hour      REAL NOT NULL,
    duration_hours  REAL NOT NULL,
    status          TEXT NOT NULL,                  -- completed | planned
    provenance      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eva_activity_crew (
    eva_activity_id INTEGER NOT NULL REFERENCES eva_activities(id) ON DELETE CASCADE,
    crew_member_id  INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
    PRIMARY KEY (eva_activity_id, crew_member_id)
);

CREATE TABLE IF NOT EXISTS eva_tasks (
    id                      INTEGER PRIMARY KEY,
    mission_id              INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    task_code               TEXT NOT NULL,
    name                    TEXT NOT NULL,
    duration_hours          REAL NOT NULL,
    priority                TEXT NOT NULL,          -- high | medium | low
    required_qualifications TEXT NOT NULL DEFAULT '[]',
    crew_needed             INTEGER NOT NULL DEFAULT 2,
    assigned_crew           TEXT NOT NULL DEFAULT '[]', -- JSON list of crew codes (original plan)
    planned_day             INTEGER,
    planned_start_hour      REAL,
    earliest_day            INTEGER NOT NULL,
    latest_day              INTEGER NOT NULL,
    window_start_hour       REAL NOT NULL,
    window_end_hour         REAL NOT NULL,
    depends_on              TEXT NOT NULL DEFAULT '[]', -- JSON list of task codes
    is_fixed                INTEGER NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'planned', -- planned | completed
    provenance              TEXT NOT NULL,
    UNIQUE (mission_id, task_code)
);

CREATE TABLE IF NOT EXISTS assessment_sessions (
    id                  INTEGER PRIMARY KEY,
    crew_member_id      INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
    assessment_type     TEXT NOT NULL,              -- pvt | motor
    mode                TEXT NOT NULL,              -- demo | standard
    phase               TEXT NOT NULL,              -- baseline | mission
    mission_day         INTEGER,
    mission_time_days   REAL,                       -- position on the mission timeline (day + fraction)
    started_at          TEXT NOT NULL,
    completed_at        TEXT,
    status              TEXT NOT NULL,              -- valid | invalid | incomplete
    status_reasons      TEXT NOT NULL DEFAULT '[]',
    provenance          TEXT NOT NULL,              -- synthetic | local_measurement
    scenario_label      TEXT,
    config              TEXT NOT NULL DEFAULT '{}',
    summary             TEXT NOT NULL DEFAULT '{}',
    client_info         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_sessions_crew_type ON assessment_sessions(crew_member_id, assessment_type);

CREATE TABLE IF NOT EXISTS observations (
    id                  INTEGER PRIMARY KEY,
    session_id          INTEGER NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
    seq                 INTEGER NOT NULL,
    kind                TEXT NOT NULL,   -- pvt: response|false_start|miss ; motor: target|click|path
    t_ms                REAL,            -- time from session start
    value_ms            REAL,            -- reaction / movement time
    x                   REAL,            -- normalized coordinates (0..1)
    y                   REAL,
    target_x            REAL,
    target_y            REAL,
    extra               TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_obs_session ON observations(session_id);

CREATE TABLE IF NOT EXISTS self_reports (
    id                  INTEGER PRIMARY KEY,
    crew_member_id      INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
    mission_day         INTEGER,
    recorded_at         TEXT NOT NULL,
    sleep_hours         REAL,
    fatigue             REAL,            -- 0..10 self-reported
    recovery            REAL,            -- 0..10 self-reported
    tlx_mental          REAL,            -- 0..100
    tlx_physical        REAL,
    tlx_temporal        REAL,
    tlx_performance     REAL,
    tlx_effort          REAL,
    tlx_frustration     REAL,
    raw_tlx             REAL,
    notes               TEXT,
    provenance          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_results (
    id                  INTEGER PRIMARY KEY,
    crew_member_id      INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
    session_id          INTEGER REFERENCES assessment_sessions(id) ON DELETE CASCADE,
    assessment_type     TEXT NOT NULL,
    computed_at         TEXT NOT NULL,
    rule_version        TEXT NOT NULL,
    baseline_status     TEXT NOT NULL,
    category            TEXT NOT NULL,
    details             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_scenarios (
    id                  INTEGER PRIMARY KEY,
    mission_id          INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    kind                TEXT NOT NULL,   -- original | reduced_workload | longer_rest | custom
    params              TEXT NOT NULL,
    solver_status       TEXT NOT NULL,
    result              TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    provenance          TEXT NOT NULL DEFAULT 'hypothetical_scenario'
);

CREATE TABLE IF NOT EXISTS data_imports (
    id                  INTEGER PRIMARY KEY,
    source_key          TEXT NOT NULL,
    source_url          TEXT,
    retrieved_via       TEXT,
    filename            TEXT,
    sha256              TEXT NOT NULL,
    imported_at         TEXT NOT NULL,
    detected_columns    TEXT NOT NULL,
    column_mapping      TEXT NOT NULL,
    rows_total          INTEGER NOT NULL,
    rows_valid          INTEGER NOT NULL,
    rows_rejected       INTEGER NOT NULL,
    rejection_examples  TEXT NOT NULL DEFAULT '[]',
    provenance          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviewer_notes (
    id                  INTEGER PRIMARY KEY,
    crew_member_id      INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
    created_at          TEXT NOT NULL,
    author              TEXT NOT NULL,
    status              TEXT NOT NULL,   -- reviewed_no_action | follow_up | restriction_to_model
    note                TEXT NOT NULL,
    provenance          TEXT NOT NULL DEFAULT 'local_measurement'
);
CREATE INDEX IF NOT EXISTS ix_notes_crew ON reviewer_notes(crew_member_id);

CREATE TABLE IF NOT EXISTS nasa_eva_records (
    id                  INTEGER PRIMARY KEY,
    import_id           INTEGER NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE,
    source_row          INTEGER NOT NULL,
    eva_number          TEXT,
    country             TEXT,
    crew                TEXT,
    vehicle             TEXT,
    date_raw            TEXT,
    date_iso            TEXT,
    year                INTEGER,
    duration_raw        TEXT,
    duration_hours      REAL,
    purpose             TEXT
);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def session(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def drop_all(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        conn.execute(f'DROP TABLE IF EXISTS "{t}"')
    conn.execute("PRAGMA foreign_keys = ON")


def jdump(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"))


def jload(v: str | None, default: Any = None) -> Any:
    if v is None or v == "":
        return default
    return json.loads(v)


def row_to_dict(row: sqlite3.Row, json_fields: tuple[str, ...] = ()) -> dict[str, Any]:
    d = dict(row)
    for f in json_fields:
        if f in d:
            d[f] = jload(d[f], [] if f in ("qualifications", "required_qualifications", "assigned_crew", "depends_on", "status_reasons") else {})
    return d
