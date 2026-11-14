from app.analysis.wearable import Night, readiness, score_nights, sleep_score
from app import services


def night(**kw):
    base = dict(asleep_min=480, deep_min=100, rem_min=116, sleeping_hr=48, resting_hr=58, hrv_ms=60, restless_pct=0)
    base.update(kw)
    return Night(**base)


def test_sleep_score_structure_and_max():
    s = sleep_score(night())
    assert s["score"] == 100 and s["band"] == "Excellent"
    assert [c["max"] for c in s["components"]] == [50, 25, 25]
    assert sum(c["points"] for c in s["components"]) == 100


def test_sleep_score_penalises_short_and_restless_sleep():
    good = sleep_score(night(asleep_min=450))["score"]
    short = sleep_score(night(asleep_min=300, deep_min=60, rem_min=70))["score"]
    restless = sleep_score(night(asleep_min=450, sleeping_hr=57, restless_pct=18))["score"]
    assert short < good and restless < good
    assert sleep_score(night(asleep_min=240, deep_min=30, rem_min=30, sleeping_hr=58, restless_pct=20))["band"] == "Poor"


def _nights(n_base, hrv_today, rhr_today):
    rows = [dict(mission_day=d, asleep_min=450, deep_min=95, rem_min=110, sleeping_hr=50, resting_hr=58 + (d % 2),
                 hrv_ms=60 + (d % 3), restless_pct=6, provenance="synthetic") for d in range(-n_base + 1, 1)]
    rows.append(dict(mission_day=1, asleep_min=450, deep_min=95, rem_min=110, sleeping_hr=50, resting_hr=rhr_today,
                     hrv_ms=hrv_today, restless_pct=6, provenance="synthetic"))
    return score_nights(rows)


def test_readiness_needs_baseline():
    out = _nights(3, 60, 58)
    assert out[-1]["readiness"]["score"] is None and out[-1]["readiness"]["band"] == "Calibrating"


def test_readiness_drops_with_lower_hrv_and_higher_rhr():
    normal = _nights(8, 61, 58)[-1]["readiness"]
    strained = _nights(8, 42, 66)[-1]["readiness"]
    assert normal["score"] > strained["score"]
    assert strained["band"] in ("Low", "Moderate")
    assert {c["key"] for c in normal["components"]} == {"hrv", "rhr", "sleep"}
    assert 0 <= strained["score"] <= 100


def test_zero_variance_baseline_is_floored():
    rows = [dict(mission_day=d, asleep_min=450, deep_min=95, rem_min=110, sleeping_hr=50, resting_hr=58, hrv_ms=60,
                 restless_pct=6, provenance="synthetic") for d in range(-7, 1)]
    r = readiness(dict(hrv_ms=61, resting_hr=58), [85, 85, 85], rows, [85] * 8)
    assert 60 <= r["score"] <= 80  # +1 ms HRV against a flat baseline is not extreme


def test_demo_wearable_data_labelled_and_deterministic(db):
    vega = db.execute("SELECT id FROM crew_members WHERE code='VEGA'").fetchone()[0]
    a = services.wearable_summary(db, vega)
    assert a["provenance"] == "synthetic" and len(a["series"]) == 17
    assert a["series"][-1]["readiness"] < a["series"][-5]["readiness"]  # declining profile
    assert "not used by the flagging rules" in a["method"]["limits"]
    from app.seed import load_demo
    load_demo(db, "declining")
    b = services.wearable_summary(db, db.execute("SELECT id FROM crew_members WHERE code='VEGA'").fetchone()[0])
    assert [s["sleep_score"] for s in a["series"]] == [s["sleep_score"] for s in b["series"]]


def test_existing_database_gets_wearable_data_on_startup(db):
    from app.main import bootstrap
    db.execute("DELETE FROM wearable_nights")
    db.commit()
    bootstrap(db)
    assert db.execute("SELECT COUNT(*) FROM wearable_nights").fetchone()[0] == 3 * 17
