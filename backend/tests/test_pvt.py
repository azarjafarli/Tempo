from app.analysis.pvt import score_pvt


def responses(rts):
    return [{"kind": "response", "t_ms": 1000.0 * i, "rt_ms": rt} for i, rt in enumerate(rts)]


def test_median_variability_and_lapses():
    rts = [250, 260, 270, 280, 290, 300, 310, 320, 600, 700]
    s = score_pvt(responses(rts), mode="demo")
    assert s.status == "valid"
    assert s.metrics["median_rt_ms"] == 295.0
    assert s.metrics["lapses"] == 2
    assert s.metrics["n_valid_responses"] == 10
    assert s.metrics["rt_iqr_ms"] > 0
    assert s.metrics["fastest10_mean_ms"] == 250.0
    assert s.metrics["slowest10_mean_ms"] == 700.0


def test_anticipations_counted_as_false_starts_not_rts():
    trials = responses([300] * 10) + [{"kind": "response", "t_ms": 1, "rt_ms": 60}, {"kind": "false_start", "t_ms": 2}]
    s = score_pvt(trials, mode="demo")
    assert s.metrics["false_starts"] == 2
    assert s.metrics["anticipations"] == 1
    assert 60 not in s.valid_rts_ms
    assert s.metrics["median_rt_ms"] == 300.0


def test_interrupted_session_is_invalid_even_with_good_data():
    s = score_pvt(responses([300] * 20), mode="demo", interrupted=True, interruption_reason="tab lost focus")
    assert s.status == "invalid"
    assert any("interrupted" in r.lower() for r in s.reasons)


def test_too_few_responses_invalid():
    s = score_pvt(responses([300] * 3), mode="demo")
    assert s.status == "invalid"
    assert any("valid responses" in r for r in s.reasons)


def test_incomplete_flag():
    s = score_pvt(responses([300] * 12), mode="demo", completed=False)
    assert s.status == "incomplete"


def test_excessive_false_starts_invalid():
    trials = responses([300] * 10) + [{"kind": "false_start", "t_ms": i} for i in range(6)]
    s = score_pvt(trials, mode="demo")
    assert s.status == "invalid"
    assert any("Premature" in r for r in s.reasons)


def test_excessive_misses_invalid():
    trials = responses([300] * 10) + [{"kind": "miss", "t_ms": i} for i in range(8)]
    s = score_pvt(trials, mode="demo")
    assert s.status == "invalid"
    assert s.metrics["misses"] == 8


def test_empty_session():
    s = score_pvt([], mode="demo")
    assert s.status == "invalid"
    assert s.metrics["median_rt_ms"] is None


def test_malformed_rt_ignored():
    trials = responses([300] * 10) + [{"kind": "response", "t_ms": 5, "rt_ms": None}]
    s = score_pvt(trials, mode="demo")
    assert s.metrics["n_valid_responses"] == 10
