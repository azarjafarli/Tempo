"""Google Health export import (fixture rows are made up for the test, not anyone's data)."""
from app import google_health, services

HRV = ("timestamp,average heart rate variability milliseconds,non rem heart rate beats per minute,entropy,"
       "deep sleep root mean square of successive differences milliseconds,data source\n"
       "2026-10-01T00:00:00Z,40.0,60.0,2.5,42.0,Google Health App\n"
       "2026-10-02T00:00:00Z,35.0,62.0,2.4,38.0,Google Health App\n")
RHR = "timestamp,beats per minute,data source\n2026-10-01T00:00:00Z,64.0,Google Health App\n2026-10-02T00:00:00Z,66.5,Google Health App\n"
READY = ("timestamp,score,type,readiness level,sleep readiness,heart rate variability readiness,resting heart rate readiness,data source\n"
         "2026-10-02,54,MEDIUM,TYPE_UNSPECIFIED,VERY_HIGH,LOW,IGNORED,Google Health App\n")


def local_id(db):
    return db.execute("SELECT id FROM crew_members WHERE code='LOCAL'").fetchone()[0]


def test_import_merges_files_by_header(db):
    res = google_health.import_texts(db, local_id(db), {"a.csv": HRV, "b.csv": RHR, "c.csv": READY, "x.csv": "foo,bar\n1,2\n"})
    assert res["days"] == 2 and res["files_skipped"] == ["x.csv"]
    rows = google_health.daily_rows(db, local_id(db))
    assert rows[1]["hrv_ms"] == 35.0 and rows[1]["resting_hr"] == 66.5 and rows[1]["readiness_score"] == 54
    assert rows[1]["sleep_readiness"] == "Very High" and rows[1]["rhr_readiness"] is None
    assert all(r["provenance"] == "device_data" for r in rows)


def test_reimport_is_idempotent(db):
    google_health.import_texts(db, local_id(db), {"a.csv": HRV})
    google_health.import_texts(db, local_id(db), {"a.csv": HRV, "c.csv": READY})
    assert len(google_health.daily_rows(db, local_id(db))) == 2


def test_local_summary_uses_vendor_readiness_and_no_sleep_score(db):
    google_health.import_texts(db, local_id(db), {"a.csv": HRV, "b.csv": RHR, "c.csv": READY})
    w = services.wearable_summary(db, local_id(db))
    assert w["kind"] == "device_daily" and w["provenance"] == "device_data"
    assert w["latest"]["readiness"]["score"] == 54 and w["latest"]["readiness"]["band"] == "Moderate"
    assert w["latest"]["sleep"]["estimated"] is True
    assert w["latest"]["sleep"]["score"] == services.estimate_sleep_score("Very High", 54) == 89
    assert "estimated" in w["method"]["limits"]


def test_sleep_estimate_rules():
    assert services.estimate_sleep_score("Low", 60) == 60
    assert services.estimate_sleep_score(None, 40) == 63
    assert services.estimate_sleep_score(None, None) is None
    assert services.estimate_sleep_score("Very High", 100) == 96


def test_fictional_crew_unaffected(db):
    google_health.import_texts(db, local_id(db), {"a.csv": HRV})
    vega = db.execute("SELECT id FROM crew_members WHERE code='VEGA'").fetchone()[0]
    assert services.wearable_summary(db, vega)["provenance"] == "synthetic"


def test_api_rejects_unrelated_files(client):
    r = client.post("/api/wearable/import-google-health", json={"files": [{"filename": "x.csv", "content": "a,b\n1,2\n"}]})
    assert r.status_code == 422
    r = client.post("/api/wearable/import-google-health", json={"files": [{"filename": "h.csv", "content": HRV}]})
    assert r.status_code == 200 and r.json()["days"] == 2
