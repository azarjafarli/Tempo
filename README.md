# Tempo

**Keeping lunar EVA tempo safe.** A NASA Space Apps 2026 prototype that checks how each astronaut is performing
between spacewalks, compares them only with their own normal, and shows mission control how to re-plan the next
EVAs if someone needs a lighter load.

> Research and decision-support prototype. It is not a clinically validated fitness-for-duty system and does not
> diagnose fatigue, illness or injury. A human reviewer makes every decision. Not affiliated with or endorsed by NASA.

## Why Tempo

NASA already tracks astronauts' reaction time and cognition against their own baseline on the ISS (WinSCAT, the
Reaction Self Test, the Cognition battery). Lunar missions will add several demanding surface spacewalks within a
few days, and in the public tools we found, those results do not feed into EVA planning. Tempo closes that loop:

**Test → flag with evidence → doctor's review → instant re-plan of the next spacewalks.**

See [RESEARCH.md](RESEARCH.md#related-nasa-work-what-already-exists-and-what-this-project-adds) for the related
NASA work and what Tempo adds.

## What's in the app

| Screen | What it shows |
|---|---|
| **Mission overview** | A plain-language status line for the selected person, the five-day EVA strip, sleep score and readiness (0–100), the latest reaction-time and motor results against their baseline, workload rating and next steps. |
| **Mission control** | The flight surgeon's roster: every crew member's results vs their own baseline, last night's sleep and readiness, workload, EVA load and rest before the next EVA. Flagged crew first. Reviewer decisions and notes. |
| **Performance lab** | Three tasks: a reaction-time test (inspired by NASA's PVT, not the validated instrument), a 12-target precision-motor test, and a NASA-TLX workload check-in, the only self-reported input. |
| **Recovery analysis** | Robust baseline comparison per metric, "Why was this flagged?", distributions, mission trends, sleep/readiness/workload context and a full session log. |
| **EVA mission planner** | A five-day lunar EVA plan optimized with Google OR-Tools under reviewer-chosen restrictions (reduced hours, unavailable days, longer rest). Original vs optimized side by side, explained changes, or a minimal list of conflicting requirements when no plan exists. |
| **Research and data** | NASA's related tools and what Tempo adds, the imported NASA EVA dataset (1965–2013 US and Russian EVAs) and every source with what it supports. |

The crew picker in the header ("Viewing VEGA" / "Performing as You") applies to the three per-person screens.

## Quick start (Windows)

**Prerequisites:** Python 3.11–3.13 (python.org, tick *Add python.exe to PATH*) and Node.js 18+ LTS. No accounts,
paid APIs, sensors or extra devices are needed, and after the first build the app runs fully offline.

Double-click **`run-eva.cmd`**. The first run installs everything (3–5 minutes); later runs start in seconds and
rebuild the interface automatically after an update. The app opens at <http://127.0.0.1:8000>. Keep that
window open while presenting; closing it stops the app.

| Script | Purpose |
|---|---|
| `run-eva.cmd` | One-click launcher: setup when needed, rebuild after updates, start |
| `setup.ps1` / `start.ps1` | The same steps separately (`powershell -ExecutionPolicy Bypass -File .\setup.ps1`) |
| `dev.ps1` | Development mode: FastAPI with auto-reload on 8000 + Vite on 5173 |
| `test.ps1` | All backend (pytest) and frontend (Vitest) tests |
| `reset-db.ps1 [-Profile declining\|stable]` | Drop and recreate the database |

In the app, **Reset mission** (sidebar) restores the starting scenario. Choose *Declining* or *Stable* crew history first.

<details><summary>Manual commands</summary>

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.cli reset
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

cd ..\frontend
npm install
npm test
npm run build
```

CLI: `python -m app.cli reset|seed [--profile declining|stable]`, `python -m app.cli import-nasa [file.csv]`,
`python -m app.cli import-google-health <folder>`.
</details>

## Your own wearable data (optional)

Put the three daily CSVs from a Fitbit / Google Health Takeout export (*Physical Activity* folder: Daily Heart Rate
Variability, Daily Resting Heart Rate, Daily Readiness) in `backend\data\private\google_health\`. They are imported
for the *Local participant* on startup. That folder is git-ignored, so personal health data is never pushed. The
export has no sleep duration, so the local sleep score is labelled *estimated* (see DATA_PROVENANCE.md).

## 3-minute demo script

| Time | Screen | Action |
|---|---|---|
| 0:00 | Mission overview | The pitch, then the headline: *VEGA: Two functional changes worth reviewing before EVA 3.* |
| 0:20 | Performance lab | Optional: a judge takes the 1-minute reaction test (*Quick* mode, press Space). |
| 1:00 | Mission control | Test → Flag → Review → Re-plan strip, VEGA first, his sleep/readiness and the doctor's note. |
| 1:30 | EVA planner | Opens on "VEGA limited to 3 h/day": original vs optimized and one explanation. Then *Reduced workload → ORION → D4 → Run* shows **infeasible** with the two conflicting requirements. |
| 2:20 | Mission overview, *Viewing: You* | Real Fitbit HRV, resting heart rate and readiness. |
| 2:50 | | Close: built on NASA's EVA data and research gaps; a human always decides. |

**Before presenting:** run `run-eva.cmd` once at home (the rebuild needs internet), click **Reset mission**, and open
each screen in its own tab.

## Data at a glance

| Data | Source |
|---|---|
| Crew (VEGA, ORION, LYRA), mission, assessment histories, crew wearable nights, reviewer notes | Simulated from fixed random seeds |
| Historical EVAs (368 records) | NASA open data, *Extra-vehicular Activity (EVA) – US and Russia* |
| Tests you take in the browser | Real measurements |
| Local participant's HRV, resting HR, readiness | Your own Fitbit / Google Health export, if provided |
| Planner results | Hypothetical scenarios under reviewer-chosen assumptions |

The interface does not label simulated data on screen; every database record keeps its provenance. Full details:
[DATA_PROVENANCE.md](DATA_PROVENANCE.md).

## Architecture

```
tempo/
├── run-eva.cmd, setup.ps1, start.ps1, dev.ps1, test.ps1, reset-db.ps1
├── backend/                  Python 3.11+, FastAPI, SQLite, NumPy/SciPy, OR-Tools
│   ├── app/
│   │   ├── main.py           REST API (Pydantic validation); also serves frontend/dist
│   │   ├── db.py             Normalized SQLite schema
│   │   ├── store.py          Sessions, observations, self-reports
│   │   ├── services.py       Analysis, overview, mission control, wearable summaries
│   │   ├── analysis/         pvt.py, motor.py, baseline.py (robust median/MAD), wearable.py (sleep/readiness)
│   │   ├── scheduler.py      CP-SAT model, plan checks, change explanations, minimal conflict sets
│   │   ├── seed.py           Deterministic simulated mission
│   │   ├── demo_fill.py      Fills empty demo areas (notes, saved scenarios, local sessions)
│   │   ├── nasa_import.py    Header-inspecting NASA EVA CSV importer
│   │   ├── google_health.py  Fitbit / Google Health daily CSV importer (local participant)
│   │   └── cli.py            reset / seed / import-nasa / import-google-health
│   ├── data/nasa/            Bundled copy of the NASA EVA CSV
│   ├── data/private/         Your own wearable files (git-ignored)
│   └── tests/                pytest
└── frontend/                 React 18, TypeScript, Vite, Tailwind, Recharts, Lucide
    └── src/screens, assessments, components, lib (+ Vitest tests)
```

The SQLite database lives at `backend/data/eva_recovery.db`. The file name predates the rename and is kept so
existing data survives.

### Main API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/overview?crew_id=`, `/api/mission` | Overview and mission/crew |
| GET | `/api/mission-control` | Reviewer roster |
| GET/POST | `/api/review-notes` | Reviewer decisions and notes |
| POST | `/api/assessments/pvt`, `/api/assessments/motor` | Save a browser test (re-scored server-side) |
| GET | `/api/assessments?crew_id=&type=`, `/api/assessments/{id}` | Sessions with raw observations |
| POST/GET | `/api/self-reports` | NASA-TLX workload ratings |
| GET | `/api/analysis/{crew_id}?type=&session_id=`, `/api/analysis/rules` | Baseline comparison and documented rules |
| GET | `/api/wearable/{crew_id}` | Sleep score and readiness with components |
| POST | `/api/wearable/import-google-health` | Import your own Google Health daily CSVs |
| GET/PUT | `/api/schedule/tasks`, `/api/schedule/tasks/{code}` | EVA tasks |
| POST/GET | `/api/schedule/optimize`, `/api/schedule/scenarios[/{id}]` | Run and reopen scenarios |
| GET/POST | `/api/nasa/eva/*` | NASA dataset status, summary, records, import |
| POST | `/api/demo/load` | Reset mission (`declining` / `stable`) |

Interactive docs: <http://127.0.0.1:8000/docs>.

## How it works

**Reaction time:** 1-minute (quick) or 3-minute runs with random 2–7 s delays; stimulus drawn in
`requestAnimationFrame`, timed with `performance.now()`. Held keys and repeats are ignored; early presses are counted.
Switching tabs invalidates the run. Scores: median, IQR, lapses (≥ 500 ms), premature responses, misses.

**Precision motor:** 12 targets in a fixed order with four mirror variants of identical difficulty; normalized
coordinates make results independent of window size. Scores: movement time, consistency, endpoint error, path
efficiency, misses.

**Baseline engine (exploratory rules):** each person against their own valid baseline sessions (3–4 = provisional,
5+ = established). Robust z from median and 1.4826 × MAD with spread floors. A metric is flagged only if robust
z ≥ 3 in the adverse direction **and** the change exceeds a per-metric minimum. Invalid runs are kept but never
interpreted. Theil–Sen slopes describe trends over ≥ 4 mission sessions.

**Sleep score and readiness (0–100):** modelled on Fitbit's published structure (sleep: time asleep 50 + deep/REM 25
+ restoration 25; readiness: HRV, resting heart rate and recent sleep vs personal baseline). Formulas are documented
approximations. Wellness indicators only, never used for flags or scheduling.

**Scheduler:** OR-Tools CP-SAT with two-person EVA crews, qualifications, day/time windows, dependencies, fixed tasks,
locked completed tasks, max EVA hours per day and a minimum rest interval. The objective minimizes weighted
postponements, reassignments and disruption. Infeasible requests return a minimal set of conflicting requirements.

## Tests

`test.ps1` runs **72 backend tests** (scoring, invalid runs, baselines incl. zero variance and outliers, scheduler
constraints and infeasibility, provenance, determinism, NASA and Google Health imports, wearable scores, API
validation) and **18 frontend tests** (scoring, keypress gating, normalized coordinates, labels).

## Documentation

[RESEARCH.md](RESEARCH.md) · [DATA_PROVENANCE.md](DATA_PROVENANCE.md) · [LIMITATIONS.md](LIMITATIONS.md) ·
[AI_USAGE.md](AI_USAGE.md)

No NASA logos, flags or mission patches are used; the Tempo glyph is original.
