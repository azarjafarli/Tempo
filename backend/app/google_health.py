"""Import of a Fitbit / Google Health Takeout export ("Physical Activity_GoogleData" folder).

Only three daily files are used, and only for the local participant:
  * Daily Heart Rate Variability   -> overnight HRV (RMSSD), non-REM heart rate, deep-sleep RMSSD
  * Daily Resting Heart Rate       -> resting heart rate
  * Daily Readiness                -> the vendor's own readiness score (1-100) and its sleep / HRV / RHR ratings
Files are recognised by their header row, not their names. Nothing else in the export is read.
These are real measurements of the person who owns the export; they are labelled "device_data".
"""
from __future__ import annotations

import csv
import io
import sqlite3
from pathlib import Path
from typing import Any

SOURCE = "Fitbit / Google Health export"
PRIVATE_DIR = Path(__file__).resolve().parent.parent / "data" / "private" / "google_health"


def _f(v: str | None) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def _level(v: str | None) -> str | None:
    if not v or v in ("IGNORED", "NOT_AVAILABLE", "NOT AVAILABLE", "TYPE_UNSPECIFIED"):
        return None
    return v.replace("_", " ").title()


def detect(header: list[str]) -> str | None:
    h = [x.strip().lower() for x in header]
    if "average heart rate variability milliseconds" in h:
        return "hrv"
    if "beats per minute" in h and len(h) <= 3:
        return "rhr"
    if "score" in h and "heart rate variability readiness" in h:
        return "readiness"
    return None


def parse(text: str) -> tuple[str | None, list[dict[str, Any]]]:
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        return None, []
    kind = detect(list(rows[0].keys()))
    out = []
    for r in rows:
        r = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        date = r.get("timestamp", "")[:10]
        if len(date) != 10:
            continue
        if kind == "hrv":
            out.append({"date": date, "hrv_ms": _f(r.get("average heart rate variability milliseconds")),
                        "nonrem_hr": _f(r.get("non rem heart rate beats per minute")),
                        "deep_sleep_rmssd_ms": _f(r.get("deep sleep root mean square of successive differences milliseconds"))})
        elif kind == "rhr":
            out.append({"date": date, "resting_hr": _f(r.get("beats per minute"))})
        elif kind == "readiness":
            sc = _f(r.get("score"))
            out.append({"date": date, "readiness_score": int(sc) if sc is not None else None,
                        "readiness_type": (r.get("type") or None),
                        "sleep_readiness": _level(r.get("sleep readiness")),
                        "hrv_readiness": _level(r.get("heart rate variability readiness")),
                        "rhr_readiness": _level(r.get("resting heart rate readiness"))})
    return kind, out


COLS = ("hrv_ms", "deep_sleep_rmssd_ms", "nonrem_hr", "resting_hr", "readiness_score", "readiness_type",
        "sleep_readiness", "hrv_readiness", "rhr_readiness")


def import_texts(conn: sqlite3.Connection, crew_member_id: int, files: dict[str, str]) -> dict[str, Any]:
    """files: {filename: csv text}. Unrecognised files are skipped and reported."""
    merged: dict[str, dict[str, Any]] = {}
    used, skipped = [], []
    for name, text in files.items():
        kind, rows = parse(text)
        if kind is None:
            skipped.append(name)
            continue
        used.append({"file": name, "kind": kind, "rows": len(rows)})
        for r in rows:
            merged.setdefault(r["date"], {}).update({k: v for k, v in r.items() if v is not None})
    for date, vals in merged.items():
        cols = ["crew_member_id", "date", "source", "provenance"] + [c for c in COLS if c in vals]
        args = [crew_member_id, date, SOURCE, "device_data"] + [vals[c] for c in COLS if c in vals]
        upd = ", ".join(f"{c}=excluded.{c}" for c in cols[4:]) or "source=excluded.source"
        conn.execute(f"INSERT INTO device_daily ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) "
                     f"ON CONFLICT(crew_member_id, date) DO UPDATE SET {upd}", args)
    return {"days": len(merged), "files_used": used, "files_skipped": skipped,
            "first_day": min(merged) if merged else None, "last_day": max(merged) if merged else None}


def import_folder(conn: sqlite3.Connection, crew_member_id: int, folder: Path) -> dict[str, Any]:
    files = {}
    for p in sorted(Path(folder).rglob("*.csv")):
        with open(p, encoding="utf-8", errors="replace") as fh:
            head = fh.readline()
        if detect(next(csv.reader([head.lstrip("﻿")]), [])):
            files[p.name] = p.read_text(encoding="utf-8", errors="replace")
    return import_texts(conn, crew_member_id, files)


def daily_rows(conn: sqlite3.Connection, crew_member_id: int) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM device_daily WHERE crew_member_id=? ORDER BY date",
                                          (crew_member_id,)).fetchall()]
