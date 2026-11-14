def pvt_payload(crew_id, rts, **kw):
    trials = [{"kind": "response", "t_ms": 3000.0 * i, "rt_ms": rt} for i, rt in enumerate(rts)]
    return {"crew_member_id": crew_id, "mode": "demo", "phase": "mission", "trials": trials, **kw}


def crew_id(client, code):
    return next(c["id"] for c in client.get("/api/mission").json()["crew"] if c["code"] == code)


def test_health_and_overview(client):
    assert client.get("/api/health").json()["status"] == "ok"
    ov = client.get("/api/overview").json()
    assert ov["mission"]["current_day"] == 3
    assert ov["crew"]["code"] == "VEGA"
    assert ov["eva_count"]["completed"] + ov["eva_count"]["planned"] == 4
    assert ov["assessments"]["pvt"]["category"] == "change_worth_reviewing"


def test_save_pvt_is_stored_as_local_measurement_and_reopened(client):
    cid = crew_id(client, "LOCAL")
    r = client.post("/api/assessments/pvt", json=pvt_payload(cid, [280 + i for i in range(12)]))
    assert r.status_code == 201
    sess = r.json()["session"]
    assert sess["provenance"] == "local_measurement"
    assert sess["status"] == "valid"
    again = client.get(f"/api/assessments/{sess['id']}").json()
    assert len(again["observations"]) == 12
    assert r.json()["analysis"]["evaluation"]["category"] == "insufficient_data"


def test_live_result_on_demo_persona_warns_mixed_provenance(client):
    cid = crew_id(client, "VEGA")
    r = client.post("/api/assessments/pvt", json=pvt_payload(cid, [300] * 12))
    assert any("Mixed provenance" in w for w in r.json()["analysis"]["warnings"])


def test_interrupted_run_is_not_interpreted(client):
    cid = crew_id(client, "VEGA")
    r = client.post("/api/assessments/pvt", json=pvt_payload(cid, [300] * 12, interrupted=True,
                                                              interruption_reason="tab hidden", completed=False))
    ev = r.json()["analysis"]["evaluation"]
    assert ev["category"] == "invalid_measurement"
    assert ev["metrics"] == []


def test_validation_errors(client):
    assert client.post("/api/assessments/pvt", json={"crew_member_id": 1, "trials": [{"kind": "bogus", "t_ms": 1}]}).status_code == 422
    assert client.post("/api/assessments/pvt", json=pvt_payload(99999, [300] * 10)).status_code == 404
    assert client.post("/api/self-reports", json={"crew_member_id": 1, "fatigue": 11}).status_code == 422
    assert client.post("/api/schedule/optimize", json={"min_rest_hours": 40}).status_code == 422
    assert client.post("/api/schedule/optimize", json={"crew_restrictions": {"NOPE": {}}}).status_code == 422


def test_self_report_raw_tlx(client):
    cid = crew_id(client, "LOCAL")
    body = {"crew_member_id": cid, "sleep_hours": 7, "fatigue": 3, "recovery": 7,
            **{f"tlx_{k}": v for k, v in zip(["mental", "physical", "temporal", "performance", "effort", "frustration"],
                                              [60, 30, 40, 20, 50, 10])}}
    r = client.post("/api/self-reports", json=body).json()
    assert r["reports"][-1]["raw_tlx"] == 35.0
    assert r["reports"][-1]["provenance"] == "local_measurement"


def test_optimize_and_compare(client):
    r = client.post("/api/schedule/optimize", json={"kind": "reduced_workload", "name": "VEGA 3h",
                                                    "crew_restrictions": {"VEGA": {"max_eva_hours": 3}}})
    assert r.status_code == 200
    body = r.json()
    assert body["feasible"] and body["original"]["schedule"] and body["optimized"]["schedule"]
    assert "not physiological predictions" in body["assumption_notice"]
    saved = client.get(f"/api/schedule/scenarios/{body['scenario_id']}").json()
    assert saved["solver_status"] == body["solver_status"]


def test_task_edit_validation(client):
    assert client.put("/api/schedule/tasks/T01", json={"priority": "low"}).status_code == 409
    assert client.put("/api/schedule/tasks/T07", json={"assigned_crew": ["VEGA"]}).status_code == 422
    r = client.put("/api/schedule/tasks/T10", json={"priority": "medium", "duration_hours": 1.5})
    assert r.status_code == 200 and r.json()["priority"] == "medium"


def test_demo_load_and_nasa_endpoints(client):
    assert client.post("/api/demo/load", json={"profile": "stable"}).json()["profile"] == "stable"
    ov = client.get("/api/overview").json()
    assert ov["mission"]["scenario_profile"] == "stable"
    s = client.get("/api/nasa/eva/summary").json()
    assert s["imported"] and s["records"] > 300
    bad = client.post("/api/nasa/eva/import", json={"filename": "x.csv", "content": "a,b\n1,2\n"})
    assert bad.status_code == 422
