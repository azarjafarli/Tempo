"""Import workflow for NASA's "Extra-vehicular Activity (EVA) - US and Russia" CSV.

The importer inspects the header of the supplied file instead of assuming a
schema: it normalizes header names, maps recognized columns, reports
unrecognized ones, and rejects rows it cannot parse (with reasons). Nothing is
ever fabricated: if a file cannot be mapped, the import fails with an error.

Historical EVA durations are used only for reference visualization and
duration context in the planner. They are NOT used as labels for recovery,
fatigue or injury prediction.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from .db import jdump, jload
from .store import now_iso

DATASET_URL = "https://data.nasa.gov/dataset/extra-vehicular-activity-eva-us-and-russia"
BUNDLED_FILE = Path(__file__).resolve().parent.parent / "data" / "nasa" / "eva_us_russia_mirror.csv"
BUNDLED_RETRIEVED_VIA = (
    "Copy of the data.nasa.gov CSV export, mirrored in the public GitHub repository "
    "nsgrantham/spacewalks (file 'Extra-vehicular_Activity__EVA__-_US_and_Russia.csv'). "
    "data.nasa.gov could not be reached from the build environment. Replace it with an official "
    "download via the manual import if you can reach data.nasa.gov."
)

FIELD_ALIASES: dict[str, list[str]] = {
    "eva_number": ["eva", "evano", "evanumber", "id", "evaid"],
    "country": ["country", "nation"],
    "crew": ["crew", "crewmembers", "astronauts"],
    "vehicle": ["vehicle", "spacecraft", "mission"],
    "date": ["date", "evadate", "startdate"],
    "duration": ["duration", "evaduration", "durationhhmm", "length"],
    "purpose": ["purpose", "description", "notes"],
}
REQUIRED = ("duration",)
MAX_BYTES = 5_000_000

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], start=1)}


def norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", h.strip().lower())


def map_columns(headers: list[str]) -> tuple[dict[str, int], list[str]]:
    mapping: dict[str, int] = {}
    unrecognized = []
    for i, h in enumerate(headers):
        n = norm_header(h)
        hit = next((f for f, al in FIELD_ALIASES.items() if n in al and f not in mapping), None)
        if hit:
            mapping[hit] = i
        else:
            unrecognized.append(h.strip())
    return mapping, unrecognized


def parse_duration(s: str) -> float | None:
    s = (s or "").strip()
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    sec = int(m.group(3) or 0)
    if mi >= 60 or sec >= 60:
        return None
    return h + mi / 60 + sec / 3600


def parse_date(s: str) -> tuple[str | None, int | None]:
    s = (s or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            d = datetime.strptime(s, fmt)
            return d.date().isoformat(), d.year
        except ValueError:
            pass
    m = re.match(r"([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*-\s*\d{1,2})?,?\s+(\d{4})", s)
    if m and m.group(1).lower() in MONTHS:
        try:
            d = datetime(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
            return d.date().isoformat(), d.year
        except ValueError:
            pass
    y = re.search(r"(19|20)\d{2}", s)
    return None, (int(y.group(0)) if y else None)


class ImportError_(ValueError):
    pass


def import_csv_text(
    conn: sqlite3.Connection, text: str, *, filename: str, source_key: str = "nasa_eva_dataset",
    source_url: str = DATASET_URL, retrieved_via: str = "Manual upload by user",
) -> dict[str, Any]:
    raw = text.encode("utf-8", errors="replace")
    if len(raw) > MAX_BYTES:
        raise ImportError_(f"File is larger than {MAX_BYTES // 1_000_000} MB.")
    text = text.lstrip("﻿")
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        raise ImportError_("The file is empty.")
    mapping, unrecognized = map_columns(headers)
    missing = [f for f in REQUIRED if f not in mapping]
    if missing:
        raise ImportError_(
            f"Could not find required column(s) {missing}. Detected columns: {[h.strip() for h in headers]}. "
            "This does not look like the NASA EVA CSV; nothing was imported."
        )
    sha = hashlib.sha256(raw).hexdigest()
    conn.execute("DELETE FROM data_imports WHERE source_key=?", (source_key,))
    cur = conn.execute(
        "INSERT INTO data_imports (source_key, source_url, retrieved_via, filename, sha256, imported_at, detected_columns, "
        "column_mapping, rows_total, rows_valid, rows_rejected, rejection_examples, provenance) "
        "VALUES (?,?,?,?,?,?,?,?,0,0,0,'[]','nasa_public_data')",
        (source_key, source_url, retrieved_via, filename, sha, now_iso(), jdump([h.strip() for h in headers]),
         jdump({k: headers[v].strip() for k, v in mapping.items()})))
    import_id = int(cur.lastrowid)

    def get(row: list[str], f: str) -> str | None:
        i = mapping.get(f)
        return row[i].strip() if i is not None and i < len(row) else None

    total = valid = 0
    rejected: list[dict[str, Any]] = []
    rows = []
    for line_no, row in enumerate(reader, start=2):
        if not any(c.strip() for c in row):
            continue
        total += 1
        dur_raw = get(row, "duration") or ""
        dur = parse_duration(dur_raw)
        reason = None
        if dur is None:
            reason = f"unparseable duration {dur_raw!r}"
        elif dur <= 0:
            reason = "zero duration (EVA cancelled or not recorded)"
        if reason:
            if len(rejected) < 25:
                rejected.append({"line": line_no, "reason": reason, "eva_number": get(row, "eva_number")})
            else:
                rejected.append({"line": line_no, "reason": reason})
            continue
        date_iso, year = parse_date(get(row, "date") or "")
        crew = re.sub(r"\s{2,}", "; ", get(row, "crew") or "").strip("; ")
        rows.append((import_id, line_no, get(row, "eva_number"), get(row, "country"), crew, get(row, "vehicle"),
                     get(row, "date"), date_iso, year, dur_raw, round(dur, 4), get(row, "purpose")))
        valid += 1
    conn.executemany(
        "INSERT INTO nasa_eva_records (import_id, source_row, eva_number, country, crew, vehicle, date_raw, date_iso, year, "
        "duration_raw, duration_hours, purpose) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.execute("UPDATE data_imports SET rows_total=?, rows_valid=?, rows_rejected=?, rejection_examples=? WHERE id=?",
                 (total, valid, len(rejected), jdump(rejected[:25]), import_id))
    return import_status(conn)


def import_bundled(conn: sqlite3.Connection) -> dict[str, Any]:
    if not BUNDLED_FILE.exists():
        raise ImportError_("Bundled NASA CSV not found. Use the manual import instead.")
    text = BUNDLED_FILE.read_text(encoding="utf-8", errors="replace")
    return import_csv_text(conn, text, filename=BUNDLED_FILE.name, retrieved_via=BUNDLED_RETRIEVED_VIA)


def import_status(conn: sqlite3.Connection) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM data_imports WHERE source_key='nasa_eva_dataset' ORDER BY id DESC LIMIT 1").fetchone()
    if not r:
        return {"imported": False, "bundled_file_available": BUNDLED_FILE.exists(), "dataset_url": DATASET_URL}
    d = dict(r)
    for k in ("detected_columns", "column_mapping", "rejection_examples"):
        d[k] = jload(d[k], [])
    return {"imported": True, "bundled_file_available": BUNDLED_FILE.exists(), "dataset_url": DATASET_URL, "import": d}


def summary(conn: sqlite3.Connection) -> dict[str, Any]:
    st = import_status(conn)
    if not st["imported"]:
        return {**st, "records": 0}
    iid = st["import"]["id"]
    rows = conn.execute("SELECT country, year, duration_hours, vehicle, eva_number, date_raw FROM nasa_eva_records "
                        "WHERE import_id=?", (iid,)).fetchall()
    durs = np.array([r["duration_hours"] for r in rows], dtype=float)
    bins = list(range(0, 10)) + [24]
    hist, _ = np.histogram(durs, bins=bins)
    histogram = [{"bin": f"{bins[i]}–{bins[i + 1]} h" if bins[i + 1] != 24 else "9+ h", "count": int(c)}
                 for i, c in enumerate(hist)]
    by_country: dict[str, int] = {}
    for r in rows:
        by_country[r["country"] or "unknown"] = by_country.get(r["country"] or "unknown", 0) + 1
    decades: dict[int, list[float]] = {}
    for r in rows:
        if r["year"]:
            decades.setdefault(r["year"] // 10 * 10, []).append(r["duration_hours"])
    by_decade = [{"decade": f"{d}s", "n": len(v), "median_hours": round(float(np.median(v)), 2)}
                 for d, v in sorted(decades.items())]
    q1, med, q3 = np.percentile(durs, [25, 50, 75])
    return {
        **st, "records": int(durs.size),
        "duration_hours": {"median": round(float(med), 2), "q1": round(float(q1), 2), "q3": round(float(q3), 2),
                           "max": round(float(durs.max()), 2), "min": round(float(durs.min()), 2)},
        "histogram": histogram, "by_country": by_country, "by_decade": by_decade,
        "usage_note": "Reference context only. Historical EVA durations are not used as labels for recovery, "
                      "fatigue or injury, and are not linked to any individual's health.",
    }


def records(conn: sqlite3.Connection, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    st = import_status(conn)
    if not st["imported"]:
        return []
    rows = conn.execute("SELECT * FROM nasa_eva_records WHERE import_id=? ORDER BY id LIMIT ? OFFSET ?",
                        (st["import"]["id"], limit, offset)).fetchall()
    return [dict(r) for r in rows]
