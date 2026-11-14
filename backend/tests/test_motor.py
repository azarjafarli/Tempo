import itertools
import math

from app.analysis.motor import ARENA_ASPECT, dist, layout, score_motor


def perfect_run(variant, mt=500.0):
    lay = layout(variant)
    clicks, path, t = [], [], 0.0
    px, py = lay["start"]["x"], lay["start"]["y"]
    for tg in lay["targets"]:
        for k in range(1, 10):
            f = k / 10
            path.append({"t_ms": t + mt * f, "x": px + (tg["x"] - px) * f, "y": py + (tg["y"] - py) * f})
        t += mt
        clicks.append({"t_ms": t, "x": tg["x"], "y": tg["y"]})
        px, py = tg["x"], tg["y"]
    return clicks, path


def test_variants_have_equivalent_difficulty():
    ids = [layout(v)["index_of_difficulty_bits"] for v in range(4)]
    for a, b in itertools.combinations(ids, 2):
        assert a == b


def test_perfect_run_scores():
    clicks, path = perfect_run(0)
    s = score_motor(0, clicks, path)
    assert s.status == "valid"
    assert s.metrics["targets_hit"] == 12
    assert s.metrics["misses"] == 0
    assert s.metrics["median_movement_time_ms"] == 500.0
    assert s.metrics["path_efficiency"] > 0.99
    assert s.metrics["mean_endpoint_error_pct"] == 0.0


def test_normalized_coordinates_are_resize_invariant():
    """Same physical movement captured at two window sizes yields identical metrics after normalization."""
    clicks, path = perfect_run(1)
    results = []
    for w in (800, 1600):
        h = w * ARENA_ASPECT
        px_clicks = [{"t_ms": c["t_ms"], "x": c["x"] * w, "y": c["y"] * h} for c in clicks]
        px_path = [{"t_ms": p["t_ms"], "x": p["x"] * w, "y": p["y"] * h} for p in path]
        n_clicks = [{"t_ms": c["t_ms"], "x": c["x"] / w, "y": c["y"] / h} for c in px_clicks]
        n_path = [{"t_ms": p["t_ms"], "x": p["x"] / w, "y": p["y"] / h} for p in px_path]
        results.append(score_motor(1, n_clicks, n_path).metrics)
    for k in ("median_movement_time_ms", "path_efficiency", "mean_endpoint_error_pct"):
        assert math.isclose(results[0][k], results[1][k], rel_tol=1e-9)


def test_misses_counted_and_incomplete():
    clicks, path = perfect_run(0)
    clicks = [{"t_ms": 10, "x": 0.99, "y": 0.99}] + clicks[:5]
    s = score_motor(0, clicks, path)
    assert s.metrics["misses"] == 1
    assert s.status == "incomplete"


def test_interrupted_motor_invalid():
    clicks, path = perfect_run(2)
    s = score_motor(2, clicks, path, interrupted=True)
    assert s.status == "invalid"


def test_long_pause_invalid():
    clicks, path = perfect_run(0, mt=9000)
    s = score_motor(0, clicks, path)
    assert s.status == "invalid"


def test_distance_uses_aspect():
    assert math.isclose(dist(0, 0, 0, 1), ARENA_ASPECT)
