"""Command-line utilities.

    python -m app.cli reset [--profile declining|stable]   # drop and recreate the database, seed demo + NASA CSV
    python -m app.cli seed  [--profile declining|stable]   # reload the synthetic demo mission (keeps local participant data)
    python -m app.cli import-nasa [path/to/file.csv]       # import the NASA EVA CSV (bundled copy if no path)
    python -m app.cli import-google-health <folder>         # your own Fitbit/Google Health daily CSVs (local participant)
"""
from __future__ import annotations

import argparse
from pathlib import Path

from . import nasa_import
from .db import connect, db_path, drop_all, init_schema
from .seed import ensure_local_participant, load_demo


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("reset", "seed"):
        p = sub.add_parser(name)
        p.add_argument("--profile", choices=["declining", "stable"], default="declining")
    p = sub.add_parser("import-google-health", help="import your own Fitbit / Google Health daily CSVs for the local participant")
    p.add_argument("folder")
    p = sub.add_parser("import-nasa")
    p.add_argument("path", nargs="?")
    args = ap.parse_args()

    conn = connect()
    try:
        if args.cmd == "reset":
            drop_all(conn)
            init_schema(conn)
            ensure_local_participant(conn)
            res = load_demo(conn, args.profile)
            st = nasa_import.import_bundled(conn) if nasa_import.BUNDLED_FILE.exists() else None
            conn.commit()
            print(f"Database reset at {db_path()}")
            print(f"Demo mission seeded: profile={res['profile']} sessions={res['sessions_created']} seed={res['seed']}")
            print(f"Synthetic fingerprint: {res['fingerprint'][:16]}...")
            if st:
                imp = st["import"]
                print(f"NASA EVA CSV imported: {imp['rows_valid']} valid rows, {imp['rows_rejected']} rejected")
        elif args.cmd == "seed":
            init_schema(conn)
            res = load_demo(conn, args.profile)
            conn.commit()
            print(f"Demo mission reloaded: profile={res['profile']} sessions={res['sessions_created']}")
        elif args.cmd == "import-google-health":
            from . import google_health
            init_schema(conn)
            lid = ensure_local_participant(conn)
            res = google_health.import_folder(conn, lid, Path(args.folder))
            conn.commit()
            print(f"Imported {res['days']} days ({res['first_day']} to {res['last_day']}) from {[u['file'] for u in res['files_used']]}")
        elif args.cmd == "import-nasa":
            init_schema(conn)
            if args.path:
                text = Path(args.path).read_text(encoding="utf-8", errors="replace")
                st = nasa_import.import_csv_text(conn, text, filename=Path(args.path).name,
                                                 retrieved_via="Command-line import of a local file")
            else:
                st = nasa_import.import_bundled(conn)
            conn.commit()
            imp = st["import"]
            print(f"Imported {imp['rows_valid']} valid rows ({imp['rows_rejected']} rejected). Columns: {imp['detected_columns']}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
