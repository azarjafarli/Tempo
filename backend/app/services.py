"""Database-backed analysis and overview services."""
from __future__ import annotations

import sqlite3
from typing import Any

import numpy as np

from .analysis.baseline import (
    CATEGORY_INVALID, CATEGORY_LABELS, CATEGORY_REVIEW, METRIC_RULES, evaluate_session, rules_documentation,
    theil_sen_trend,
)
from .store import get_crew_member, get_mission, list_self_reports, list_sessions, pvt_rts


def _pick_evaluated(sessions: list[dict[str, Any]], session_id: int | None) -> dict[str, Any] | None:
    if session_id is not None:
        return next((s for s in sessions if s["id"] == session_id), None)
    mission = [s for s in sessions if s["phase"] == "mission"]
    if mission:
        return mission[-1]
    return sessions[-1] if sessions else None


def _persistence(sessions: list[dict[str, Any]], evaluated: dict[str, Any], baseline: list[dict[str, Any]],
                 atype: str) -> dict[str, int]:
    """For each metric, how many consecutive valid mission sessions (ending at the evaluated one) were flagged."""
    mission_valid = [s for s in sessions if s["phase"] == "mission" and s["status"] == "valid"]
    idx = next((i for i, s in enumerate(mission_valid) if s["id"] == evaluated["id"]), None)
    out: dict[str, int] = {}
    if idx is None:
        return out
    for r in METRIC_RULES[atype]:
        n = 0
        for s in reversed(mission_valid[: idx + 1]):
            ev = evaluate_session(s, baseline, atype)
            m = next((m for m in ev["metrics"] if m["metric"] == r.key), None)
            if m and m["flagged"]:
                n += 1
            else:
                break
        out[r.key] = n
    return out


def _hist(values: list[float], edges: list[float]) -> list[float]:
    if not values:
        return [0.0] * (len(edges) - 1)
    c, _ = np.histogram(np.clip(values, edges[0], edges[-1] - 1e-6), bins=edges)
    return [round(float(x) / len(values), 4) for x in c]


def analyze(conn: sqlite3.Connection, crew_id: int, atype: str, session_id: int | None = None) -> dict[str, Any]:
    if atype not in METRIC_RULES:
        raise ValueError("assessment type must be 'pvt' or 'motor'")
    crew = get_crew_member(conn, crew_id)
    if crew is None:
        raise LookupError("crew member not found")
    sessions = list_sessions(conn, crew_id, atype)
    baseline = [s for s in sessions if s["phase"] == "baseline"]
    evaluated = _pick_evaluated(sessions, session_id)
    if session_id is not None and evaluated is None:
        raise LookupError("session not found for this crew member and assessment type")

    history = []
    for s in sessions:
        if s["phase"] == "baseline":
            cat = "baseline" if s["status"] == "valid" else CATEGORY_INVALID
        else:
            cat = evaluate_session(s, baseline, atype)["category"]
        history.append({
            "id": s["id"], "phase": s["phase"], "mission_day": s["mission_day"],
            "mission_time_days": s["mission_time_days"], "started_at": s["started_at"], "status": s["status"],
            "status_reasons": s["status_reasons"], "provenance": s["provenance"], "mode": s["mode"],
            "category": cat, "metrics": {r.key: s["summary"].get(r.key) for r in METRIC_RULES[atype]},
        })

    result: dict[str, Any] = {
        "crew": crew, "assessment_type": atype, "rules": rules_documentation(), "history": history,
        "evaluated_session": None, "evaluation": None, "trends": {}, "distribution": None, "warnings": [],
        "self_reports": list_self_reports(conn, crew_id),
        "disclaimer": "Exploratory comparison with this person's own earlier results. This does not diagnose "
                      "fatigue, illness or injury and is not a fitness-for-duty determination.",
    }
    if evaluated is None:
        result["evaluation"] = {"category": "insufficient_data", "category_label": CATEGORY_LABELS["insufficient_data"],
                                "metrics": [], "baseline_n": 0, "explanation": ["No sessions recorded yet."]}
        return result

    ev = evaluate_session(evaluated, baseline, atype)
    ev["persistence"] = _persistence(sessions, evaluated, baseline, atype) if evaluated["status"] == "valid" else {}
    result["evaluated_session"] = {k: evaluated[k] for k in (
        "id", "phase", "mission_day", "mission_time_days", "started_at", "status", "status_reasons", "provenance",
        "mode", "summary", "scenario_label")}
    result["evaluation"] = ev

    base_prov = {s["provenance"] for s in baseline if s["status"] == "valid"}
    if evaluated["provenance"] == "local_measurement" and "synthetic" in base_prov:
        result["warnings"].append(
            "Mixed provenance: a real local measurement is being compared with a SYNTHETIC baseline. "
            "This only demonstrates the software workflow; the comparison has no meaning for the person tested.")
    if evaluated["provenance"] == "synthetic":
        result["warnings"].append("Evaluated session is synthetic demo data.")

    mission_valid = [s for s in sessions if s["phase"] == "mission" and s["status"] == "valid"]
    for r in METRIC_RULES[atype]:
        result["trends"][r.key] = theil_sen_trend(
            [s["mission_time_days"] for s in mission_valid], [s["summary"].get(r.key) for s in mission_valid])

    if atype == "pvt":
        edges = [100 + 25 * i for i in range(0, 29)]  # 100..800 ms
        base_rts: list[float] = []
        for s in baseline:
            if s["status"] == "valid":
                base_rts.extend(pvt_rts(conn, s["id"]))
        eval_rts = pvt_rts(conn, evaluated["id"])
        result["distribution"] = {
            "kind": "reaction_time_histogram", "unit": "ms", "bin_edges": edges,
            "baseline_pooled": _hist(base_rts, edges), "evaluated": _hist(eval_rts, edges),
            "baseline_n_responses": len(base_rts), "evaluated_n_responses": len(eval_rts),
            "evaluated_raw_rts": [round(x, 1) for x in eval_rts],
        }
    else:
        per_target: list[list[float]] = []
        for s in baseline:
            if s["status"] == "valid":
                mts = s["summary"].get("movement_times_ms") or []
                for i, v in enumerate(mts):
                    while len(per_target) <= i:
                        per_target.append([])
                    per_target[i].append(v)
        ev_mts = evaluated["summary"].get("movement_times_ms") or []
        result["distribution"] = {
            "kind": "movement_time_per_target", "unit": "ms",
            "targets": [{"target": i + 1,
                         "baseline_median": round(float(np.median(v)), 1) if v else None,
                         "evaluated": ev_mts[i] if i < len(ev_mts) else None}
                        for i, v in enumerate(per_target or [[]] * len(ev_mts))],
        }
    return result


def overview(conn: sqlite3.Connection, crew_id: int | None = None) -> dict[str, Any]:
    mission = get_mission(conn)
    if mission is None:
        return {"mission": None}
    cid = crew_id or mission["selected_crew_id"]
    crew = get_crew_member(conn, cid)
    if crew is None:
        raise LookupError("crew member not found")
    evas = []
    for r in conn.execute("SELECT * FROM eva_activities WHERE mission_id=? ORDER BY eva_number", (mission["id"],)):
        members = [x[0] for x in conn.execute(
            "SELECT c.code FROM eva_activity_crew ec JOIN crew_members c ON c.id = ec.crew_member_id "
            "WHERE ec.eva_activity_id=? ORDER BY c.id", (r["id"],))]
        evas.append({**dict(r), "crew": members})
    mine = [e for e in evas if crew["code"] in e["crew"]]
    completed = [e for e in mine if e["status"] == "completed"]
    planned = [e for e in mine if e["status"] == "planned"]

    assessments = {}
    next_steps: list[str] = []
    quality: list[dict[str, Any]] = []
    for atype, label in (("pvt", "Vigilant attention"), ("motor", "Precision motor control")):
        a = analyze(conn, cid, atype)
        ev = a["evaluation"]
        sessions = a["history"]
        n_invalid = sum(1 for s in sessions if s["status"] != "valid")
        n_base = sum(1 for s in sessions if s["phase"] == "baseline" and s["status"] == "valid")
        key_metric = "median_rt_ms" if atype == "pvt" else "median_movement_time_ms"
        assessments[atype] = {
            "label": label, "evaluated_session": a["evaluated_session"], "category": ev["category"],
            "category_label": ev["category_label"], "baseline_n": n_base,
            "baseline_status": ev.get("baseline_status", "insufficient"),
            "key_metric": key_metric,
            "key_metric_result": next((m for m in ev["metrics"] if m["metric"] == key_metric), None),
            "flagged_metrics": [m["label"] for m in ev["metrics"] if m["flagged"]],
            "series": [{"t": s["mission_time_days"], "value": s["metrics"].get(key_metric), "phase": s["phase"],
                        "status": s["status"], "category": s["category"]} for s in sessions],
            "trend": a["trends"].get(key_metric),
            "warnings": a["warnings"],
        }
        quality.append({"assessment": label, "sessions": len(sessions), "invalid_or_incomplete": n_invalid,
                        "valid_baseline_sessions": n_base, "baseline_status": ev.get("baseline_status", "insufficient"),
                        "latest_status": a["evaluated_session"]["status"] if a["evaluated_session"] else None})
        if ev["category"] == CATEGORY_REVIEW:
            next_steps.append(f"{label}: review the flagged observations in Recovery Analysis with a qualified reviewer.")
            next_steps.append(f"{label}: repeat the assessment to check whether the change persists.")
        elif ev["category"] == CATEGORY_INVALID:
            next_steps.append(f"{label}: the latest run was invalid or incomplete and is not interpreted; repeat it.")
        elif ev["category"] == "insufficient_data":
            next_steps.append(f"{label}: complete more baseline sessions ({n_base} of 3 minimum).")
    if any(a["category"] == CATEGORY_REVIEW for a in assessments.values()) and crew["is_schedulable"]:
        next_steps.append("If a reviewer decides to explore it, model a hypothetical workload restriction in the "
                          "EVA Mission Planner. The software does not make that decision.")
    reports = list_self_reports(conn, cid)
    latest_report = reports[-1] if reports else None
    if not latest_report or latest_report.get("mission_day") != mission["current_day"]:
        next_steps.append("Complete today's self-reported check-in (sleep, fatigue, recovery, Raw TLX).")
    if not next_steps:
        next_steps.append("No action suggested by the exploratory rules. Continue routine assessments.")

    return {
        "mission": mission, "crew": crew, "all_evas": evas,
        "last_eva": completed[-1] if completed else None, "next_eva": planned[0] if planned else None,
        "eva_count": {"completed": len(completed), "planned": len(planned)},
        "assessments": assessments, "data_quality": quality, "latest_self_report": latest_report,
        "next_steps": next_steps,
    }
