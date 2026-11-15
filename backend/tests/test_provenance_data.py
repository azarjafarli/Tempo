import pytest

from app import nasa_import
from app.db import connect, init_schema
from app.provenance import PROVENANCE_CATEGORIES, REFERENCES, require_valid
from app.seed import ensure_local_participant, gen_pvt_trials, _rng, load_demo, synthetic_fingerprint


def test_provenance_registry():
    assert set(PROVENANCE_CATEGORIES) == {"nasa_public_data", "local_measurement", "device_data", "synthetic",
                                          "published_reference", "hypothetical_scenario"}
    for r in REFERENCES:
        assert r["provenance"] in PROVENANCE_CATEGORIES
        assert r["url"].startswith("https://")
    with pytest.raises(ValueError):
        require_valid("made_up")


def test_all_seeded_records_are_labelled_synthetic(db):
    for table in ("assessment_sessions", "self_reports", "eva_tasks", "eva_activities", "missions"):
        vals = {r[0] for r in db.execute(f"SELECT DISTINCT provenance FROM {table}")}
        assert vals == {"synthetic"}, table
    fict = db.execute("SELECT code, is_fictional, provenance FROM crew_members").fetchall()
    for code, is_fictional, prov in fict:
        if code == "LOCAL":
            assert prov == "local_measurement" and is_fictional == 0
        else:
            assert prov == "synthetic" and is_fictional == 1


def test_synthetic_data_is_deterministic(tmp_path):
    prints = []
    for i in range(2):
        conn = connect(tmp_path / f"d{i}.db")
        init_schema(conn)
        ensure_local_participant(conn)
        prints.append(load_demo(conn, "declining")["fingerprint"])
        conn.close()
    assert prints[0] == prints[1]
    assert gen_pvt_trials(_rng(1, 2, 3), 260, 0.1, 0.01) == gen_pvt_trials(_rng(1, 2, 3), 260, 0.1, 0.01)


def test_profiles_differ_and_reload_is_idempotent(db):
    a = synthetic_fingerprint(db)
    load_demo(db, "stable")
    b = synthetic_fingerprint(db)
    load_demo(db, "declining")
    assert a != b
    assert synthetic_fingerprint(db) == a


def test_reload_preserves_local_participant_data(db):
    from app.store import create_pvt_session
    lid = db.execute("SELECT id FROM crew_members WHERE code='LOCAL'").fetchone()[0]
    create_pvt_session(db, crew_member_id=lid, mode="demo", phase="baseline", mission_day=None, mission_time_days=0,
                       started_at="2026-11-14T10:00:00+00:00", completed_at=None,
                       trials=[{"kind": "response", "t_ms": i * 1000, "rt_ms": 300} for i in range(10)],
                       interrupted=False, interruption_reason=None, completed=True, provenance="local_measurement")
    load_demo(db, "stable")
    n = db.execute("SELECT COUNT(*) FROM assessment_sessions WHERE crew_member_id=?", (lid,)).fetchone()[0]
    assert n == 1


def test_nasa_import_inspects_columns(db):
    csv_text = "EVA #,Country,Crew    ,Vehicle,Date,Duration,Purpose \n" \
               "1,USA,Ed White,Gemini IV,06/03/1965,0:36,First U.S. EVA\n" \
               "2,USA,David Scott,Gemini VIII,\"March 16-17, 1966\",0:00,cancelled\n" \
               "3,Russia,A B,Voskhod 2,\"March 18, 1965\",0:12,first\n" \
               "4,USA,X,Y,01/01/1970,bad,unparseable\n"
    st = nasa_import.import_csv_text(db, csv_text, filename="t.csv")
    imp = st["import"]
    assert imp["column_mapping"]["duration"] == "Duration"
    assert imp["column_mapping"]["crew"] == "Crew"
    assert imp["rows_valid"] == 2 and imp["rows_rejected"] == 2
    assert imp["provenance"] == "nasa_public_data"
    rows = nasa_import.records(db)
    assert rows[0]["duration_hours"] == pytest.approx(0.6)
    assert rows[1]["date_iso"] == "1965-03-18"


def test_nasa_import_rejects_unrecognized_file(db):
    with pytest.raises(nasa_import.ImportError_):
        nasa_import.import_csv_text(db, "a,b,c\n1,2,3\n", filename="x.csv")
    assert not nasa_import.import_status(db)["imported"]


def test_bundled_nasa_file_imports(db):
    st = nasa_import.import_bundled(db)
    assert st["import"]["rows_valid"] > 300
    s = nasa_import.summary(db)
    assert s["records"] == st["import"]["rows_valid"]
    assert "not used as labels" in s["usage_note"]


def test_health_data_is_not_self_reported(db):
    """Sleep, fatigue and recovery come from the wearable; self-reports hold only workload ratings."""
    n = db.execute("SELECT COUNT(*) FROM self_reports WHERE sleep_hours IS NOT NULL OR fatigue IS NOT NULL "
                   "OR recovery IS NOT NULL").fetchone()[0]
    assert n == 0
    assert db.execute("SELECT COUNT(*) FROM self_reports WHERE raw_tlx IS NOT NULL").fetchone()[0] > 0
