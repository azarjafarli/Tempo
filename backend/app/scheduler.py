"""EVA schedule optimization with Google OR-Tools CP-SAT.

The optimizer explores *hypothetical* planning scenarios. Restrictions on a
crew member (reduced EVA hours, unavailable days) are inputs chosen by a human
medical or operational reviewer. The optimizer never decides that anyone is
unfit; it only reports how the plan could be rearranged under the assumptions
it was given.

Time model: days 1..num_days; within a day, 15-minute slots from 00:00.
EVA hours for a crew member on a day = span from their first task start to
their last task end (suit time), which must not exceed the daily maximum.
Rest interval = time between a crew member's last task end on day d and first
task start on day d+1 (both days with EVA work).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

SLOTS_PER_HOUR = 4
SLOTS_PER_DAY = 24 * SLOTS_PER_HOUR
EVA_QUAL = "EVA"

PRIORITY_WEIGHT = {"high": 1000, "medium": 300, "low": 100}
REASSIGN_WEIGHT = 40       # per original crew member removed from a task
DAY_SHIFT_WEIGHT = 30      # per day a task moves
TIME_SHIFT_WEIGHT = 1      # per 15 minutes a start time moves

DEFAULT_PARAMS = {
    "max_eva_hours": 7.5,
    "min_rest_hours": 12.0,
    "crew_restrictions": {},
    "time_limit_s": 10.0,
}


def h2s(hours: float) -> int:
    return int(round(hours * SLOTS_PER_HOUR))


def s2h(slots: int) -> float:
    return slots / SLOTS_PER_HOUR


def fmt_hhmm(hours: float) -> str:
    total = int(round(hours * 60))
    return f"{total // 60:02d}:{total % 60:02d}"


@dataclass
class Scenario:
    num_days: int
    current_day: int
    max_eva_hours: float
    min_rest_hours: float
    crew_restrictions: dict[str, dict[str, Any]] = field(default_factory=dict)
    time_limit_s: float = 10.0

    @classmethod
    def from_params(cls, num_days: int, current_day: int, params: dict[str, Any]) -> "Scenario":
        p = {**DEFAULT_PARAMS, **(params or {})}
        if not (1 <= float(p["max_eva_hours"]) <= 12):
            raise ValueError("max_eva_hours must be between 1 and 12")
        if not (0 <= float(p["min_rest_hours"]) <= 24):
            raise ValueError("min_rest_hours must be between 0 and 24")
        return cls(
            num_days=num_days,
            current_day=current_day,
            max_eva_hours=float(p["max_eva_hours"]),
            min_rest_hours=float(p["min_rest_hours"]),
            crew_restrictions=p.get("crew_restrictions") or {},
            time_limit_s=float(p.get("time_limit_s", 10.0)),
        )

    def max_hours(self, crew: str, day: int) -> float:
        """Maximum EVA hours for crew on day. Past days are not restricted."""
        if day < self.current_day:
            return 24.0
        r = self.crew_restrictions.get(crew) or {}
        if day in (r.get("unavailable_days") or []):
            return 0.0
        lim = r.get("max_eva_hours")
        return min(self.max_eva_hours, float(lim)) if lim is not None else self.max_eva_hours

    def available(self, crew: str, day: int) -> bool:
        return self.max_hours(crew, day) > 0


def _qualified(task: dict[str, Any], crew: dict[str, Any]) -> bool:
    return EVA_QUAL in crew["qualifications"]


def _covers(task: dict[str, Any], crew_codes: list[str], crew_by_code: dict[str, dict[str, Any]]) -> list[str]:
    """Return required qualifications not covered by at least one of crew_codes."""
    missing = []
    for q in task["required_qualifications"]:
        if not any(q in crew_by_code[c]["qualifications"] for c in crew_codes if c in crew_by_code):
            missing.append(q)
    return missing


# --------------------------------------------------------------------------- #
# Plan evaluation (used for the original plan and to verify solver output)
# --------------------------------------------------------------------------- #
def evaluate_plan(
    placements: list[dict[str, Any]], crew: list[dict[str, Any]], sc: Scenario
) -> dict[str, Any]:
    """Check a concrete plan against scenario constraints.

    placements: [{code, name, day, start_hour, duration_hours, crew:[codes], required_qualifications,
                  depends_on, crew_needed, scheduled, status}]
    """
    crew_by_code = {c["code"]: c for c in crew}
    conflicts: list[dict[str, Any]] = []
    sched = [p for p in placements if p.get("scheduled", True) and p.get("day") is not None]
    by_code = {p["code"]: p for p in sched}

    # per crew-day blocks
    blocks: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for p in sched:
        for c in p["crew"]:
            blocks.setdefault((c, p["day"]), []).append(p)

    for p in sched:
        if len(p["crew"]) != p.get("crew_needed", 2):
            conflicts.append({"type": "crew_count", "tasks": [p["code"]], "crew": None, "day": p["day"],
                              "message": f"{p['code']} needs {p.get('crew_needed', 2)} crew but has {len(p['crew'])}."})
        for c in p["crew"]:
            if c not in crew_by_code or EVA_QUAL not in crew_by_code[c]["qualifications"]:
                conflicts.append({"type": "qualification", "tasks": [p["code"]], "crew": c, "day": p["day"],
                                  "message": f"{c} is not EVA-qualified for {p['code']}."})
        missing = _covers(p, p["crew"], crew_by_code)
        if missing:
            conflicts.append({"type": "qualification", "tasks": [p["code"]], "crew": None, "day": p["day"],
                              "message": f"{p['code']} requires {', '.join(missing)} but no assigned crew holds it."})
        for dep in p.get("depends_on", []):
            d = by_code.get(dep)
            if d is None:
                conflicts.append({"type": "dependency", "tasks": [p["code"], dep], "crew": None, "day": p["day"],
                                  "message": f"{p['code']} depends on {dep}, which is not scheduled."})
            elif d["day"] * 24 + d["start_hour"] + d["duration_hours"] > p["day"] * 24 + p["start_hour"] + 1e-9:
                conflicts.append({"type": "dependency", "tasks": [p["code"], dep], "crew": None, "day": p["day"],
                                  "message": f"{p['code']} starts before its prerequisite {dep} has finished."})

    spans: dict[tuple[str, int], tuple[float, float]] = {}
    for (c, d), ps in blocks.items():
        ps = sorted(ps, key=lambda q: q["start_hour"])
        first = ps[0]["start_hour"]
        last = max(q["start_hour"] + q["duration_hours"] for q in ps)
        spans[(c, d)] = (first, last)
        for a, b in zip(ps, ps[1:]):
            if a["start_hour"] + a["duration_hours"] > b["start_hour"] + 1e-9:
                conflicts.append({"type": "overlap", "tasks": [a["code"], b["code"]], "crew": c, "day": d,
                                  "message": f"{c} is assigned to overlapping tasks {a['code']} and {b['code']} on day {d}."})
        cap = sc.max_hours(c, d)
        if cap <= 0:
            conflicts.append({"type": "availability", "tasks": [q["code"] for q in ps], "crew": c, "day": d,
                              "message": f"{c} is marked unavailable for EVA on day {d} in this scenario."})
        elif last - first > cap + 1e-9:
            conflicts.append({"type": "max_hours", "tasks": [q["code"] for q in ps], "crew": c, "day": d,
                              "message": f"{c}'s EVA on day {d} spans {last - first:.2f} h "
                                         f"({fmt_hhmm(first)}–{fmt_hhmm(last)}), above the {cap:g} h limit."})

    rests: list[dict[str, Any]] = []
    for c in crew_by_code:
        days = sorted(d for (cc, d) in spans if cc == c)
        for d1, d2 in zip(days, days[1:]):
            gap = (d2 - d1) * 24 - spans[(c, d1)][1] + spans[(c, d2)][0]
            rests.append({"crew": c, "from_day": d1, "to_day": d2, "rest_hours": round(gap, 2)})
            if d2 >= sc.current_day and gap + 1e-9 < sc.min_rest_hours:
                conflicts.append({
                    "type": "rest", "crew": c, "day": d2,
                    "tasks": [q["code"] for q in blocks[(c, d2)]],
                    "message": f"{c} has {gap:.2f} h between EVAs on day {d1} and day {d2}, "
                               f"below the {sc.min_rest_hours:g} h minimum rest interval.",
                })
    eva_spans = [
        {"crew": c, "day": d, "start_hour": f, "end_hour": l, "hours": round(l - f, 2), "limit_hours": sc.max_hours(c, d)}
        for (c, d), (f, l) in sorted(spans.items(), key=lambda kv: (kv[0][1], kv[0][0]))
    ]
    return {"conflicts": conflicts, "eva_spans": eva_spans, "rest_intervals": rests}


# --------------------------------------------------------------------------- #
# Optimization
# --------------------------------------------------------------------------- #
def _original_placements(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for t in tasks:
        out.append({
            "code": t["task_code"], "name": t["name"], "day": t["planned_day"],
            "start_hour": t["planned_start_hour"], "duration_hours": t["duration_hours"],
            "crew": list(t["assigned_crew"]), "required_qualifications": t["required_qualifications"],
            "depends_on": t["depends_on"], "crew_needed": t["crew_needed"], "priority": t["priority"],
            "scheduled": t["planned_day"] is not None, "status": t["status"], "is_fixed": bool(t["is_fixed"]),
        })
    return out


def precheck(tasks: list[dict[str, Any]], crew: list[dict[str, Any]], sc: Scenario) -> list[str]:
    """Human-readable diagnostics for fixed/required tasks that cannot be satisfied."""
    msgs = []
    crew_by_code = {c["code"]: c for c in crew}
    for t in tasks:
        if not t["is_fixed"] or t["status"] == "completed":
            continue
        d = t["planned_day"]
        avail = [c["code"] for c in crew if EVA_QUAL in c["qualifications"] and sc.max_hours(c["code"], d) >= t["duration_hours"]]
        if len(avail) < t["crew_needed"]:
            msgs.append(
                f"Fixed task {t['task_code']} on day {d} needs {t['crew_needed']} EVA crew with at least "
                f"{t['duration_hours']:g} h of EVA allowance, but only {len(avail)} qualify under this scenario "
                f"({', '.join(avail) or 'none'})."
            )
        for q in t["required_qualifications"]:
            holders = [c for c in avail if q in crew_by_code[c]["qualifications"]]
            if not holders:
                msgs.append(f"Fixed task {t['task_code']} requires '{q}', but no available crew member on day {d} holds it.")
    return msgs


def optimize(
    tasks: list[dict[str, Any]], crew: list[dict[str, Any]], sc: Scenario
) -> dict[str, Any]:
    model = cp_model.CpModel()
    crew_codes = [c["code"] for c in crew]
    crew_by_code = {c["code"]: c for c in crew}
    days = list(range(1, sc.num_days + 1))

    S: dict[str, cp_model.IntVar] = {}
    Z: dict[tuple[str, int], cp_model.IntVar] = {}
    X: dict[tuple[str, str], cp_model.IntVar] = {}
    Y: dict[tuple[str, str, int], cp_model.IntVar] = {}
    ST: dict[str, cp_model.IntVar] = {}
    DAY: dict[str, cp_model.LinearExpr] = {}
    dur: dict[str, int] = {}

    # assumption literals for infeasibility explanations
    groups: dict[str, cp_model.IntVar] = {}
    group_text: dict[str, str] = {}

    def group(key: str, text: str) -> cp_model.IntVar:
        if key not in groups:
            groups[key] = model.NewBoolVar(f"grp_{key}")
            group_text[key] = text
        return groups[key]

    for t in tasks:
        code = t["task_code"]
        dur[code] = max(1, h2s(t["duration_hours"]))
        completed = t["status"] == "completed"
        s = model.NewBoolVar(f"s_{code}")
        S[code] = s
        if completed:
            allowed_days = [t["planned_day"]]
        else:
            lo = max(t["earliest_day"], sc.current_day)
            allowed_days = [d for d in days if lo <= d <= t["latest_day"]]
        for d in days:
            Z[(code, d)] = model.NewBoolVar(f"z_{code}_{d}")
            if d not in allowed_days:
                model.Add(Z[(code, d)] == 0)
        model.Add(sum(Z[(code, d)] for d in days) == s)
        DAY[code] = sum(d * Z[(code, d)] for d in days)

        ws, we = h2s(t["window_start_hour"]), h2s(t["window_end_hour"])
        if completed:
            ws = we = None
            st = model.NewConstant(h2s(t["planned_start_hour"]))
        else:
            hi = we - dur[code]
            if hi < ws:
                hi = ws  # window too short; task can only be postponed
                model.Add(s == 0)
            st = model.NewIntVar(ws, hi, f"st_{code}")
        ST[code] = st

        for c in crew_codes:
            x = model.NewBoolVar(f"x_{code}_{c}")
            X[(code, c)] = x
            if EVA_QUAL not in crew_by_code[c]["qualifications"]:
                model.Add(x == 0)
            for d in days:
                y = model.NewBoolVar(f"y_{code}_{c}_{d}")
                Y[(code, c, d)] = y
                model.AddImplication(y, x)
                model.AddImplication(y, Z[(code, d)])
                model.AddBoolOr([x.Not(), Z[(code, d)].Not(), y])
        model.Add(sum(X[(code, c)] for c in crew_codes) == t["crew_needed"] * s)
        for q in t["required_qualifications"]:
            holders = [X[(code, c)] for c in crew_codes if q in crew_by_code[c]["qualifications"]]
            if holders:
                model.Add(sum(holders) >= s)
            else:
                model.Add(s == 0)

        if completed:
            model.Add(s == 1)
            model.Add(Z[(code, t["planned_day"])] == 1)
            for c in crew_codes:
                model.Add(X[(code, c)] == (1 if c in t["assigned_crew"] else 0))
        elif t["is_fixed"]:
            g = group(f"fixed:{code}", f"Fixed task {code} ({t['name']}) must occur on day {t['planned_day']} at "
                                       f"{fmt_hhmm(t['planned_start_hour'])}")
            model.Add(s == 1).OnlyEnforceIf(g)
            if t["planned_day"] in days:
                model.Add(Z[(code, t["planned_day"])] == 1).OnlyEnforceIf(g)
            model.Add(st == h2s(t["planned_start_hour"])).OnlyEnforceIf(g)

    # dependencies
    task_by_code = {t["task_code"]: t for t in tasks}
    for t in tasks:
        for dep in t["depends_on"]:
            if dep not in task_by_code:
                model.Add(S[t["task_code"]] == 0)
                continue
            a, b = dep, t["task_code"]
            model.AddImplication(S[b], S[a])
            model.Add(DAY[a] * SLOTS_PER_DAY + ST[a] + dur[a] <= DAY[b] * SLOTS_PER_DAY + ST[b]).OnlyEnforceIf(S[b])

    # per crew-day structure
    rest_slots = h2s(sc.min_rest_hours)
    g_rest = group("min_rest", f"Minimum rest interval of {sc.min_rest_hours:g} h between EVA days")
    active: dict[tuple[str, int], cp_model.IntVar] = {}
    first: dict[tuple[str, int], cp_model.IntVar] = {}
    last: dict[tuple[str, int], cp_model.IntVar] = {}
    for c in crew_codes:
        r = sc.crew_restrictions.get(c) or {}
        for d in days:
            ys = [Y[(t["task_code"], c, d)] for t in tasks]
            a = model.NewBoolVar(f"act_{c}_{d}")
            model.AddMaxEquality(a, ys)
            active[(c, d)] = a
            f = model.NewIntVar(0, SLOTS_PER_DAY, f"first_{c}_{d}")
            l = model.NewIntVar(0, SLOTS_PER_DAY, f"last_{c}_{d}")
            first[(c, d)], last[(c, d)] = f, l
            intervals = []
            for t in tasks:
                code = t["task_code"]
                y = Y[(code, c, d)]
                model.Add(f <= ST[code]).OnlyEnforceIf(y)
                model.Add(l >= ST[code] + dur[code]).OnlyEnforceIf(y)
                intervals.append(model.NewOptionalFixedSizeIntervalVar(ST[code], dur[code], y, f"iv_{code}_{c}_{d}"))
            model.AddNoOverlap(intervals)
            if d >= sc.current_day:
                cap = sc.max_hours(c, d)
                if d in (r.get("unavailable_days") or []):
                    g = group(f"availability:{c}", f"{c} unavailable for EVA on day(s) {sorted(r['unavailable_days'])} (reviewer assumption)")
                    for y in ys:
                        model.Add(y == 0).OnlyEnforceIf(g)
                else:
                    if r.get("max_eva_hours") is not None and float(r["max_eva_hours"]) < sc.max_eva_hours:
                        g = group(f"max_hours:{c}", f"{c} limited to {cap:g} EVA hours per day (reviewer assumption)")
                    else:
                        g = group("max_hours:all", f"Maximum {sc.max_eva_hours:g} planned EVA hours per crew member per day")
                    model.Add(l - f <= h2s(cap)).OnlyEnforceIf([a, g])
        for d in days[:-1]:
            if d + 1 < sc.current_day:
                continue  # both days in the past
            model.Add(SLOTS_PER_DAY - last[(c, d)] + first[(c, d + 1)] >= rest_slots).OnlyEnforceIf(
                [active[(c, d)], active[(c, d + 1)], g_rest]
            )

    # objective
    terms = []
    post_terms, reassign_terms, shift_terms = [], [], []
    for t in tasks:
        if t["status"] == "completed":
            continue
        code = t["task_code"]
        w = PRIORITY_WEIGHT.get(t["priority"], 100)
        post_terms.append(w * (1 - S[code]))
        for c in t["assigned_crew"]:
            if c in crew_codes:
                reassign_terms.append(REASSIGN_WEIGHT * (S[code] - X[(code, c)]))
        if t["planned_day"] is not None:
            dd = model.NewIntVar(-sc.num_days, sc.num_days, f"dd_{code}")
            model.Add(dd == DAY[code] - t["planned_day"] * S[code])
            add = model.NewIntVar(0, sc.num_days, f"add_{code}")
            model.AddAbsEquality(add, dd)
            shift_terms.append(DAY_SHIFT_WEIGHT * add)
            orig = h2s(t["planned_start_hour"])
            model.Add(ST[code] == orig).OnlyEnforceIf(S[code].Not())  # neutral when postponed
            dt = model.NewIntVar(-SLOTS_PER_DAY, SLOTS_PER_DAY, f"dt_{code}")
            model.Add(dt == ST[code] - orig)
            adt = model.NewIntVar(0, SLOTS_PER_DAY, f"adt_{code}")
            model.AddAbsEquality(adt, dt)
            shift_terms.append(TIME_SHIFT_WEIGHT * adt)
    terms = post_terms + reassign_terms + shift_terms
    model.Minimize(sum(terms))

    group_keys = list(groups)
    model.AddAssumptions([groups[k] for k in group_keys])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = sc.time_limit_s
    solver.parameters.num_workers = 8
    solver.parameters.random_seed = 7
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    result: dict[str, Any] = {"solver_status": status_name, "feasible": status in (cp_model.OPTIMAL, cp_model.FEASIBLE)}
    if not result["feasible"]:
        core: list[str] = []
        if status == cp_model.INFEASIBLE:
            diag = cp_model.CpSolver()
            diag.parameters.num_workers = 1
            diag.parameters.max_time_in_seconds = sc.time_limit_s
            diag.Solve(model)
            idx = diag.SufficientAssumptionsForInfeasibility()
            lit_to_key = {groups[k].Index(): k for k in group_keys}
            core_keys = [lit_to_key[i] for i in idx if i in lit_to_key]
            core_keys = _minimize_core(model, groups, core_keys, sc.time_limit_s)
            core = [group_text[k] for k in core_keys]
        result["infeasibility"] = {
            "conflicting_requirements": core,
            "diagnostics": precheck(tasks, crew, sc),
            "explanation": (
                "No schedule satisfies all hard requirements simultaneously. The requirements listed together "
                "cannot all hold; relaxing at least one of them (for example, unfixing a task or changing a "
                "reviewer assumption) is necessary." if core else
                "The solver did not find a feasible schedule within the time limit."
            ),
        }
        result["schedule"] = []
        return result

    placements = []
    for t in tasks:
        code = t["task_code"]
        sched = bool(solver.Value(S[code]))
        day = next((d for d in days if solver.Value(Z[(code, d)])), None) if sched else None
        start = s2h(solver.Value(ST[code])) if sched else None
        placements.append({
            "code": code, "name": t["name"], "scheduled": sched, "day": day, "start_hour": start,
            "end_hour": (start + t["duration_hours"]) if sched else None, "duration_hours": t["duration_hours"],
            "crew": [c for c in crew_codes if solver.Value(X[(code, c)])] if sched else [],
            "priority": t["priority"], "status": t["status"], "is_fixed": bool(t["is_fixed"]),
            "required_qualifications": t["required_qualifications"], "depends_on": t["depends_on"],
            "crew_needed": t["crew_needed"],
        })
    result["schedule"] = placements
    result["objective"] = {
        "total": solver.ObjectiveValue(),
        "postponement_cost": sum(solver.Value(e) for e in post_terms) if post_terms else 0,
        "reassignment_cost": sum(solver.Value(e) for e in reassign_terms) if reassign_terms else 0,
        "disruption_cost": sum(solver.Value(e) for e in shift_terms) if shift_terms else 0,
        "weights": {"postpone": PRIORITY_WEIGHT, "reassign_per_crew": REASSIGN_WEIGHT,
                    "per_day_moved": DAY_SHIFT_WEIGHT, "per_15min_moved": TIME_SHIFT_WEIGHT},
        "proven_optimal": status == cp_model.OPTIMAL,
    }
    return result


def _minimize_core(model: cp_model.CpModel, groups: dict[str, Any], core: list[str], time_limit: float) -> list[str]:
    """Deletion filter: drop requirements from the conflict set while the rest stays infeasible.

    Produces a minimal (irreducible) set of conflicting requirements, which is easier to explain.
    """
    keep = list(core)
    for k in list(core):
        trial = [x for x in keep if x != k]
        m = model.Clone()
        m.ClearAssumptions()
        m.AddAssumptions([groups[x] for x in trial])
        for other, lit in groups.items():
            if other not in trial:
                m.Add(lit == 0)  # relax every requirement outside the trial set
        s = cp_model.CpSolver()
        s.parameters.max_time_in_seconds = min(2.0, time_limit)
        s.parameters.num_workers = 8
        if s.Solve(m) == cp_model.INFEASIBLE:
            keep = trial
    return keep


def _explain_changes(
    original: list[dict[str, Any]], optimized: list[dict[str, Any]], orig_eval: dict[str, Any],
    crew: list[dict[str, Any]], sc: Scenario,
) -> list[dict[str, Any]]:
    crew_by_code = {c["code"]: c for c in crew}
    opt_by = {p["code"]: p for p in optimized}
    conflicts_by_task: dict[str, list[dict[str, Any]]] = {}
    for cf in orig_eval["conflicts"]:
        for code in cf["tasks"]:
            conflicts_by_task.setdefault(code, []).append(cf)

    changes = []
    for o in original:
        if o["status"] == "completed":
            continue
        n = opt_by.get(o["code"])
        if n is None:
            continue
        kinds = []
        if o["scheduled"] and not n["scheduled"]:
            kinds.append("postponed")
        else:
            if set(o["crew"]) != set(n["crew"]):
                kinds.append("reassigned")
            if o["day"] != n["day"]:
                kinds.append("moved_day")
            elif o["start_hour"] is not None and n["start_hour"] is not None and abs(o["start_hour"] - n["start_hour"]) > 1e-9:
                kinds.append("retimed")
        if not kinds:
            continue
        reasons = []
        direct = conflicts_by_task.get(o["code"], [])
        if direct:
            reasons.append("The original placement violates this scenario's constraints:")
            reasons.extend(f"• {cf['message']}" for cf in direct)
        else:
            reasons.append(
                "The original placement of this task does not itself violate a constraint; it changed so that other "
                "conflicting tasks could be accommodated at lower total cost."
            )
        if "postponed" in kinds:
            reasons.append(
                f"Postponing this {o['priority']}-priority task costs {PRIORITY_WEIGHT[o['priority']]} objective points. "
                "The solver found no placement within the planning horizon that satisfies all constraints at lower total cost."
            )
            qualified = [c["code"] for c in crew if EVA_QUAL in c["qualifications"]]
            reasons.append(f"EVA-qualified crew considered: {', '.join(qualified)}.")
        if "reassigned" in kinds:
            removed = sorted(set(o["crew"]) - set(n["crew"]))
            added = sorted(set(n["crew"]) - set(o["crew"]))
            for a in added:
                held = [q for q in o["required_qualifications"] if q in crew_by_code[a]["qualifications"]]
                reasons.append(
                    f"{a} replaces {', '.join(removed)}; {a} is EVA-qualified"
                    + (f" and holds {', '.join(held)}" if held else "")
                    + f" and has remaining EVA allowance on day {n['day']} ({sc.max_hours(a, n['day']):g} h limit)."
                )
        if "moved_day" in kinds:
            reasons.append(f"Moved from day {o['day']} to day {n['day']} (cost {DAY_SHIFT_WEIGHT} per day moved).")
        if "retimed" in kinds:
            reasons.append(f"Start moved from {fmt_hhmm(o['start_hour'])} to {fmt_hhmm(n['start_hour'])}.")
        changes.append({"task": o["code"], "name": o["name"], "kinds": kinds,
                        "original": {"day": o["day"], "start_hour": o["start_hour"], "crew": o["crew"]},
                        "optimized": {"day": n["day"], "start_hour": n["start_hour"], "crew": n["crew"]},
                        "explanation": reasons})
    return changes


def run_scenario(
    tasks: list[dict[str, Any]], crew: list[dict[str, Any]], num_days: int, current_day: int, params: dict[str, Any]
) -> dict[str, Any]:
    sc = Scenario.from_params(num_days, current_day, params)
    schedulable = [c for c in crew if c.get("is_schedulable", True)]
    original = _original_placements(tasks)
    orig_eval = evaluate_plan(original, schedulable, sc)
    res = optimize(tasks, schedulable, sc)
    out: dict[str, Any] = {
        "scenario": {
            "num_days": sc.num_days, "current_day": sc.current_day, "max_eva_hours": sc.max_eva_hours,
            "min_rest_hours": sc.min_rest_hours, "crew_restrictions": sc.crew_restrictions,
        },
        "assumption_notice": "All restrictions are reviewer-chosen planning assumptions, not physiological "
                             "predictions. The optimizer does not assess anyone's fitness.",
        "original": {"schedule": original, **orig_eval},
        **{k: v for k, v in res.items() if k != "schedule"},
    }
    if res["feasible"]:
        opt_eval = evaluate_plan(res["schedule"], schedulable, sc)
        out["optimized"] = {"schedule": res["schedule"], **opt_eval}
        out["changes"] = _explain_changes(original, res["schedule"], orig_eval, schedulable, sc)
        out["postponed"] = [p["code"] for p in res["schedule"] if not p["scheduled"]]
    else:
        out["optimized"] = None
        out["changes"] = []
        out["postponed"] = []
    return out
