from app.analysis.baseline import (
    CATEGORY_INSUFFICIENT, CATEGORY_INVALID, CATEGORY_REVIEW, CATEGORY_WITHIN, METRIC_RULES, compare_metric,
    evaluate_session,
)

RT = next(r for r in METRIC_RULES["pvt"] if r.key == "median_rt_ms")
EFF = next(r for r in METRIC_RULES["motor"] if r.key == "path_efficiency")


def sess(i, rt, status="valid", lapses=0):
    return {"id": i, "status": status, "summary": {"median_rt_ms": rt, "rt_iqr_ms": 40, "lapses": lapses, "false_starts": 0}}


def test_missing_baseline_is_insufficient():
    ev = evaluate_session(sess(99, 300), [], "pvt")
    assert ev["category"] == CATEGORY_INSUFFICIENT
    assert ev["baseline_n"] == 0


def test_two_baseline_sessions_insufficient():
    r = compare_metric(320, [260, 262], RT)
    assert r["category"] == CATEGORY_INSUFFICIENT
    assert r["robust_z"] is None


def test_provisional_and_established_status():
    assert compare_metric(270, [260, 262, 264], RT)["baseline"]["status"] == "provisional"
    assert compare_metric(270, [260, 262, 264, 258, 266], RT)["baseline"]["status"] == "established"


def test_zero_variance_baseline_uses_floor():
    r = compare_metric(265, [260, 260, 260, 260, 260], RT)
    assert r["baseline"]["zero_variance"] is True
    assert r["baseline"]["scale"] == 10.0  # floor_abs for median RT
    assert r["category"] == CATEGORY_WITHIN  # +5 ms is not flagged despite MAD = 0
    assert any("zero spread" in o for o in r["observations"])


def test_flag_requires_both_z_and_absolute_change():
    big = compare_metric(340, [260, 262, 264, 258, 266], RT)
    assert big["category"] == CATEGORY_REVIEW and big["flagged"]
    # large absolute change (+70 ms) but inside this person's wide baseline spread -> not flagged
    wide = compare_metric(330, [200, 260, 320, 230, 290], RT)
    assert wide["difference"] >= RT.min_change
    assert wide["robust_z"] < 3
    assert wide["category"] == CATEGORY_WITHIN


def test_favourable_change_not_flagged():
    r = compare_metric(200, [260, 262, 264, 258, 266], RT)
    assert r["category"] == CATEGORY_WITHIN
    r2 = compare_metric(0.99, [0.90, 0.91, 0.90, 0.92, 0.91], EFF)
    assert r2["category"] == CATEGORY_WITHIN


def test_lower_is_worse_metric_flags_decrease():
    r = compare_metric(0.80, [0.93, 0.94, 0.93, 0.95, 0.94], EFF)
    assert r["category"] == CATEGORY_REVIEW


def test_outlier_in_baseline_is_robust():
    with_outlier = compare_metric(275, [260, 262, 264, 258, 900], RT)
    assert with_outlier["baseline"]["median"] == 262
    assert with_outlier["baseline"]["outliers"] == [900.0]
    assert with_outlier["category"] == CATEGORY_WITHIN


def test_invalid_evaluated_session_not_interpreted():
    base = [sess(i, 260 + i) for i in range(5)]
    ev = evaluate_session({**sess(99, 400), "status": "invalid", "status_reasons": ["interrupted"]}, base, "pvt")
    assert ev["category"] == CATEGORY_INVALID
    assert ev["metrics"] == []


def test_invalid_baseline_sessions_excluded():
    base = [sess(i, 260) for i in range(3)] + [sess(10, 999, status="invalid")]
    ev = evaluate_session(sess(99, 262), base, "pvt")
    assert ev["baseline_n"] == 3
    assert ev["baseline_excluded_session_ids"] == [10]


def test_missing_measurement():
    r = compare_metric(None, [260, 262, 264], RT)
    assert r["category"] == CATEGORY_INSUFFICIENT
    assert "missing" in r["observations"][0]


def test_flag_explanation_lists_observations():
    base = [sess(i, 260 + i, lapses=0) for i in range(5)]
    ev = evaluate_session(sess(99, 350, lapses=6), base, "pvt")
    assert ev["category"] == CATEGORY_REVIEW
    assert any("Median reaction time" in e for e in ev["explanation"])
    assert any("exploratory threshold" in e for e in ev["explanation"])
