# EVA RECOVERY — Mission Readiness Lab

A software-only research and decision-support prototype for **NASA Space Apps 2026**.

An astronaut completes short computerized assessments between planetary EVAs, compares each result with
their **own personal baseline**, and a reviewer explores how hypothetical workload adjustments would
change a five-day lunar EVA schedule.

### Why this project

NASA already tracks astronauts' reaction time and cognition against their own baseline on the ISS (WinSCAT,
the Reaction Self Test, the Cognition battery). Lunar missions will add several demanding spacewalks within a
few days, and in the public tools we found, those results do not yet feed into EVA planning. EVA Recovery
closes that loop: **test → flag with evidence → doctor's review → instant re-plan of the next spacewalks.**
See [RESEARCH.md](RESEARCH.md#related-nasa-work-what-already-exists-and-what-this-project-adds).

> **This is not a clinically validated fitness-for-duty system.** It does not diagnose fatigue, illness or
> injury. Flags are exploratory statistical prompts for human review. The scheduler never decides that
> anyone is unfit; a human reviewer chooses every restriction it explores. See [LIMITATIONS.md](LIMITATIONS.md).

---

## 1. Quick start (Windows PowerShell)

**Prerequisites:** Python **3.11–3.13** (python.org installer, tick *Add python.exe to PATH*) and
Node.js **18+ LTS** (nodejs.org). No accounts, paid APIs, sensors or external devices are needed.

```powershell
cd C:\Users\<you>\OneDrive\Documents\nasa\eva-recovery
powershell -ExecutionPolicy Bypass -File .\setup.ps1   # venv, Python deps, DB reset + seed, npm install, frontend build
powershell -ExecutionPolicy Bypass -File .\start.ps1   # opens http://127.0.0.1:8000
```

| Script | What it does |
|---|---|
| `setup.ps1` | Creates `backend\.venv`, installs requirements, resets/seeds the database, installs and builds the frontend |
| `start.ps1` | Runs one server (FastAPI) that serves both the API and the built UI on port 8000 |
| `dev.ps1` | Development mode: FastAPI with auto-reload on 8000 + Vite dev server on 5173 (proxying `/api`) |
| `test.ps1` | Runs all backend (pytest) and frontend (Vitest) tests |
| `reset-db.ps1 [-Profile declining\|stable]` | Drops and recreates the database, reseeds the demo mission and re-imports the NASA CSV |

<details><summary>Manual commands (if you prefer not to use the scripts)</summary>

```powershell
cd backend
py -3.12 -m venv .venv            # or: python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.cli reset            # database reset + seed
.\.venv\Scripts\python.exe -m pytest                   # backend tests
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

cd ..\frontend
npm install
npm test                          # Vitest
npm run build                     # production build served by FastAPI
npm run dev                       # or: dev server on http://localhost:5173
```

Other CLI commands: `python -m app.cli seed --profile stable` (reload only the synthetic mission, keeping
local-participant data) and `python -m app.cli import-nasa [path\to\file.csv]`.
</details>

Interactive API docs are at <http://127.0.0.1:8000/docs> while the server runs.

---

## 2. Demo script for judges (about 6 minutes, no code edits)

1. **Open the seeded mission.** The app starts with the *declining-performance* demo. The amber
   **DEMO SCENARIO** pill in the header is visible whenever synthetic data is on screen.
   To reload, pick a history in the sidebar (*Declining* or *Stable*) and click **Load Demo Mission**.
2. **Mission Overview** — fictional crew member VEGA, mission day 3/5, last EVA (7 h 00 min, day 2), next EVA,
   the five-day EVA timeline, latest assessments vs baseline, data-quality table, latest self-reported workload rating
   and next steps. A **Sleep and readiness** card shows last night's sleep score and this morning's readiness
   (0–100 each, with their components) from synthetic wearable data, modelled on how Fitbit describes its
   scores. They are wellness indicators only and never feed the flags or the scheduler.
3. **Mission control** — the crew roster a flight surgeon would use: each crew member's latest results vs
   their own baseline (with sparklines), flagged metrics, wearable sleep and readiness, self-reported workload, EVA workload and rest before
   the next EVA. Flagged crew are listed first. Select a row for details, record a reviewer decision and note,
   or jump to the planner with that crew member preselected. There is no combined health score.
4. **Review previous assessments** — click *Open Recovery Analysis*. The latest synthetic vigilance session is
   *Functional change worth reviewing*. Expand **Why was this flagged?** to see the exact observations
   (value, baseline median, MAD, difference, robust z, rule thresholds). Note the interrupted session in the session log (Day 2 · 19:12): a
   simulated **interrupted** run that is stored but never interpreted.
5. **Complete a real assessment** — *Performance Lab → A · Vigilant attention*, mode *Demo (1 min)*,
   click **Start**, press **Space** whenever the amber target appears. Try switching tabs once to see the run
   invalidated. Your result is saved as a *real local measurement* and immediately compared with the baseline.
   (Comparing your real result with VEGA's synthetic baseline is labelled as a workflow demonstration only;
   select **Local participant (you)** to build a genuine personal baseline.)
6. Optionally run **B · Precision motor** (12 targets) and **C · Workload check-in** (the six NASA-TLX
   ratings → *Raw TLX*). Workload is the only self-reported input; sleep and recovery come from the wearable.
7. **EVA Mission Planner** — choose **2 · Reduced workload**, restricted astronaut *VEGA*, *3 h/day*, add a
   reviewer note, click **Run optimization**. Compare the original and optimized schedules side by side:
   red outlines mark original conflicts, dashed blocks were changed, each change has a written explanation,
   plus postponed tasks, rest intervals and the solver status.
8. Choose **3 · Longer rest interval** (18 h) and run again: tasks are retimed to honor the rest window.
9. **Infeasibility demo:** *Reduced workload* → restricted astronaut **ORION**, mark **D4** unavailable → run.
   ORION is the only crew member qualified for the fixed comms-mast task on day 4, so the solver reports
   **INFEASIBLE** and lists the minimal conflicting requirements.
10. **Research & Data Sources** — NASA EVA CSV import (detected columns, mapping, rejected rows, SHA-256),
   duration charts, source list with what each supports, provenance categories and limitations.

---

## 3. Architecture

```
eva-recovery/
├── backend/                     Python 3.11+, FastAPI, SQLite, NumPy/SciPy, OR-Tools
│   ├── app/
│   │   ├── main.py              Typed REST API (Pydantic validation), serves frontend/dist
│   │   ├── db.py                Normalized SQLite schema
│   │   ├── store.py             Repository functions (sessions, observations, self-reports)
│   │   ├── services.py          Analysis + overview orchestration
│   │   ├── analysis/pvt.py      Reaction-time scoring and validity rules
│   │   ├── analysis/motor.py    Target layout (4 equivalent mirror variants) and motor scoring
│   │   ├── analysis/baseline.py Robust median/MAD baseline engine, categories, Theil–Sen trends
│   │   ├── scheduler.py         CP-SAT model, plan evaluation, change explanations, infeasibility cores
│   │   ├── seed.py              Deterministic synthetic mission (fixed seeds)
│   │   ├── nasa_import.py       Schema-inspecting importer for the NASA EVA CSV
│   │   ├── provenance.py        Provenance categories + reference registry
│   │   └── cli.py               reset / seed / import-nasa
│   ├── data/nasa/               Bundled copy of the NASA EVA CSV (see DATA_PROVENANCE.md)
│   └── tests/                   pytest suite
└── frontend/                    React 18 + TypeScript + Vite + Tailwind + Recharts + Lucide
    └── src/
        ├── screens/             MissionOverview, MissionControl, PerformanceLab, RecoveryAnalysis, MissionPlanner, Research
        ├── assessments/         PvtTask, MotorTask, CheckIn
        ├── components/          UI kit, evaluation tables, "Why was this flagged?"
        └── lib/                 API client, PVT/motor client logic (+ Vitest tests), formatting
```

### Database (SQLite, `backend/data/eva_recovery.db`)

`crew_members`, `missions`, `eva_activities` (+ `eva_activity_crew`), `eva_tasks`, `assessment_sessions`,
`observations` (every individual trial, click and pointer sample), `self_reports`, `reviewer_notes`, `analysis_results`
(derived-analysis audit log with rule version), `schedule_scenarios`, `data_imports`, `nasa_eva_records`.
Every row carries a provenance category.

### Main API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/mission`, `/api/overview?crew_id=` | Mission, crew, overview metrics |
| GET | `/api/wearable/{crew_id}` | Wearable nights with sleep score and readiness (0–100) and their components |
| GET | `/api/mission-control` | Reviewer roster: every crew member's results, sleep and readiness, workload ratings, EVA load, notes |
| GET/POST | `/api/review-notes` | Reviewer decisions and notes (human-entered) |
| POST | `/api/demo/load` | Reload the synthetic mission (`declining`/`stable`) |
| GET | `/api/assessments?crew_id=&type=`, `/api/assessments/{id}` | Sessions with raw observations |
| POST | `/api/assessments/pvt`, `/api/assessments/motor` | Save a real browser assessment (re-scored server-side) |
| GET | `/api/assessments/motor/next-variant?crew_id=` | Next equivalent-difficulty target layout |
| POST/GET | `/api/self-reports` | Self-reported workload ratings, six NASA-TLX dimensions (Raw TLX computed server-side) |
| GET | `/api/analysis/{crew_id}?type=&session_id=` | Baseline comparison, distributions, trends |
| GET | `/api/analysis/rules` | The documented exploratory rules |
| GET/PUT | `/api/schedule/tasks`, `/api/schedule/tasks/{code}` | EVA tasks (validated edits) |
| POST | `/api/schedule/optimize` | Run a scenario (CP-SAT) |
| GET | `/api/schedule/scenarios[/{id}]` | Saved scenarios |
| GET/POST | `/api/nasa/eva/status`, `/summary`, `/records`, `/import`, `/import-bundled` | NASA CSV workflow |
| GET | `/api/provenance` | Provenance categories and references |

---

## 4. Technical notes

### Vigilant attention (reaction time)
* Inspired by NASA's Psychomotor Vigilance Test; **not the validated NASA PVT instrument**.
* Demo mode: 60 s, random 2–5 s delays. Assessment mode: 180 s, 2–7 s delays. 3 s without response = miss.
* Stimulus is shown inside a `requestAnimationFrame` callback; onset and key presses are timed with
  `performance.now()`. Auto-repeat (`event.repeat`) and held keys are ignored; only the first press per
  stimulus counts; a press with no stimulus is a premature response and restarts the delay.
* Tab hidden / window blur / Esc → the run is invalidated and can only be saved as *invalid*.
* Scores: median RT, mean RT, IQR, MAD, fastest/slowest 10 %, lapses (≥ 500 ms), premature responses
  (presses before the stimulus or RT < 100 ms), misses. Raw trials are stored and re-scored by the backend.
* Validity rules: interrupted → invalid; too few valid responses (8 demo / 20 assessment) → invalid;
  > 25 % premature → invalid; > 34 % misses → invalid.

### Precision motor control
* 12 targets in a fixed sequence; four mirror variants rotate between sessions. Mirroring preserves all
  distances and target sizes, so every movement's index of difficulty is identical (tested).
* Coordinates are normalized to an arena of fixed aspect ratio (16:10); distances are computed in
  arena-width units, so resizing the window does not change measurements (tested).
* Metrics: completion time, median/mean movement time, movement-time CV (consistency), endpoint error,
  path efficiency (straight / travelled), misses, hit rate.

### Personal baseline engine (exploratory rules, version `exploratory-v1`)
* Baseline = the same person's **valid** sessions marked *baseline*. < 3 → *Insufficient data*;
  3–4 → *provisional*; ≥ 5 → *established*.
* Centre = median; spread = 1.4826 × MAD with a documented absolute and relative floor, which handles
  zero-variance baselines and prevents false precision.
* **Functional change worth reviewing** only if adverse robust z ≥ 3 **and** the adverse absolute change
  exceeds a per-metric minimum (e.g. 30 ms for median RT). Otherwise *Within observed baseline variation*.
  Invalid sessions → *Invalid or incomplete measurement*, never interpreted.
* Theil–Sen slopes with 90 % intervals describe trends across ≥ 4 valid mission sessions.
* No confidence percentages, no medical claims.

### Scheduler (Google OR-Tools CP-SAT)
* Decision variables: whether each task is scheduled, its day, start time (15-min resolution) and crew.
* Constraints: crew availability, EVA qualification + task qualifications (at least one assigned member
  holds each), two-person EVA crews, permitted day and time windows, task dependencies, fixed required
  tasks, completed tasks locked, no overlap per crew member, **maximum EVA hours per day** (first start →
  last end), **minimum rest interval** between consecutive EVA days (user-configurable).
* Objective: minimize weighted postponements (high 1000 / medium 300 / low 100) + reassignment
  (40 per original crew member removed) + disruption (30 per day moved, 1 per 15 min shifted).
* Infeasibility: hard requirements are guarded by assumption literals; the solver's infeasible
  assumption set is reduced with a deletion filter to a **minimal** set of conflicting requirements.
* Every change is explained by listing the constraints the original placement violates and the cost
  trade-off the solver made.

---

## 5. Tests

```powershell
powershell -ExecutionPolicy Bypass -File .\test.ps1
```

* **Backend (pytest, 64 tests):** reaction-time scoring, anticipation/false starts, interrupted/incomplete
  handling, motor scoring and resize invariance, equivalent-difficulty variants, baseline comparison,
  missing/insufficient baselines, zero-variance floor, robustness to outliers, invalid-session refusal,
  schedule constraints (limits, rest, qualifications, dependencies, fixed and completed tasks),
  infeasible schedules with minimal explanation, data provenance labelling, synthetic-data determinism,
  NASA CSV import/rejection, the mission-control roster and reviewer notes, sleep-score and readiness calculations, and API validation and persistence.
* **Frontend (Vitest, 18 tests):** client-side reaction-time scoring, keypress gating (auto-repeat, double
  presses, false starts), ISI bounds, normalized coordinates, hit testing, motor preview, provenance and
  category labels.

---

## 6. Documentation

* [RESEARCH.md](RESEARCH.md) — NASA sources and what each one supports
* [DATA_PROVENANCE.md](DATA_PROVENANCE.md) — real versus simulated inputs
* [LIMITATIONS.md](LIMITATIONS.md) — unvalidated assumptions
* [AI_USAGE.md](AI_USAGE.md) — disclosure of AI assistance

No NASA logos, flags, mission patches or other protected branding are used. The app icon is an original
abstract orbit glyph. This project is not affiliated with or endorsed by NASA.
