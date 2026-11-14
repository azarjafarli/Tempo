import copy

import pytest

from app import scheduler, store


@pytest.fixture()
def plan(db):
    m = store.get_mission(db)
    return store.get_tasks(db, m["id"]), store.get_crew(db), m


def run(plan, **params):
    tasks, crew, m = plan
    return scheduler.run_scenario(tasks, crew, m["num_days"], m["current_day"], params)


def check_hard_constraints(res, max_by_crew, rest):
    sched = [p for p in res["optimized"]["schedule"] if p["scheduled"]]
    assert res["optimized"]["conflicts"] == []
    for span in res["optimized"]["eva_spans"]:
        if span["day"] >= res["scenario"]["current_day"]:
            assert span["hours"] <= max_by_crew.get(span["crew"], 7.5) + 1e-9
    for r in res["optimized"]["rest_intervals"]:
        if r["to_day"] >= res["scenario"]["current_day"]:
            assert r["rest_hours"] >= rest - 1e-9
    for p in sched:
        assert 7.0 <= p["start_hour"] and p["end_hour"] <= 19.0 or p["status"] == "completed"


def test_original_plan_is_feasible_and_unchanged(plan):
    res = run(plan)
    assert res["feasible"]
    assert res["original"]["conflicts"] == []
    assert res["changes"] == []
    assert res["objective"]["total"] == 0


def test_reduced_workload_respects_limit_and_qualifications(plan):
    res = run(plan, crew_restrictions={"VEGA": {"max_eva_hours": 3}})
    assert res["feasible"]
    assert any(c["type"] == "max_hours" and c["crew"] == "VEGA" for c in res["original"]["conflicts"])
    check_hard_constraints(res, {"VEGA": 3}, 12)
    crew = {c["code"]: c for c in plan[1]}
    for p in res["optimized"]["schedule"]:
        if p["scheduled"]:
            for q in p["required_qualifications"]:
                assert any(q in crew[c]["qualifications"] for c in p["crew"])
    assert any("reassigned" in ch["kinds"] for ch in res["changes"])
    assert all(ch["explanation"] for ch in res["changes"])


def test_longer_rest_interval(plan):
    res = run(plan, min_rest_hours=18)
    assert res["feasible"]
    assert any(c["type"] == "rest" for c in res["original"]["conflicts"])
    check_hard_constraints(res, {}, 18)


def test_completed_tasks_never_change(plan):
    res = run(plan, crew_restrictions={"VEGA": {"max_eva_hours": 2}}, min_rest_hours=20)
    orig = {p["code"]: p for p in res["original"]["schedule"]}
    for p in res["optimized"]["schedule"]:
        if p["status"] == "completed":
            o = orig[p["code"]]
            assert (p["day"], p["start_hour"], sorted(p["crew"])) == (o["day"], o["start_hour"], sorted(o["crew"]))


def test_dependencies_respected(plan):
    res = run(plan, crew_restrictions={"VEGA": {"unavailable_days": [3]}, "ORION": {"max_eva_hours": 4}})
    assert res["feasible"]
    by = {p["code"]: p for p in res["optimized"]["schedule"]}
    for p in by.values():
        if not p["scheduled"]:
            continue
        for d in p["depends_on"]:
            q = by[d]
            assert q["scheduled"]
            assert q["day"] * 24 + q["end_hour"] <= p["day"] * 24 + p["start_hour"] + 1e-9


def test_fixed_task_stays_fixed(plan):
    res = run(plan, crew_restrictions={"ORION": {"max_eva_hours": 3}})
    t11 = next(p for p in res["optimized"]["schedule"] if p["code"] == "T11")
    assert t11["scheduled"] and t11["day"] == 4 and t11["start_hour"] == 9.0


def test_infeasible_schedule_is_explained(plan):
    # ORION is the only crew member holding 'comms', required by fixed task T11 on day 4.
    res = run(plan, crew_restrictions={"ORION": {"unavailable_days": [4]}})
    assert not res["feasible"]
    assert res["solver_status"] == "INFEASIBLE"
    req = res["infeasibility"]["conflicting_requirements"]
    assert any("T11" in r for r in req)
    assert any("ORION" in r for r in req)
    assert len(req) == 2  # minimal conflict set
    assert any("comms" in d for d in res["infeasibility"]["diagnostics"])


def test_capacity_shortfall_postpones_with_explanations(plan):
    res = run(plan, max_eva_hours=3.0)
    assert res["feasible"]
    assert res["postponed"]
    check_hard_constraints(res, {c["code"]: 3.0 for c in plan[1]}, 12)
    explained = {ch["task"] for ch in res["changes"] if "postponed" in ch["kinds"]}
    assert explained == set(res["postponed"])
    w = scheduler.PRIORITY_WEIGHT
    pri = {p["code"]: p["priority"] for p in res["optimized"]["schedule"]}
    assert res["objective"]["postponement_cost"] == sum(w[pri[c]] for c in res["postponed"])


def test_invalid_params_rejected(plan):
    with pytest.raises(ValueError):
        run(plan, min_rest_hours=30)
