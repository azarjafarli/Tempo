# DATA_PROVENANCE.md — Real versus simulated inputs

Every record in the database carries exactly one provenance category. The UI badges real measurements, NASA data,
references and hypothetical scenarios; synthetic records are not labelled on screen.

| Category (`provenance`) | Label in UI | What it contains | Where it comes from |
|---|---|---|---|
| `nasa_public_data` | NASA public data | 368 parsed EVA records (of 375 rows) | The NASA "Extra-vehicular Activity (EVA) – US and Russia" CSV |
| `local_measurement` | Real · local | Reaction-time trials, pointer samples/clicks and workload ratings recorded in your browser | Whoever performs the assessments on this computer |
| `synthetic` | Synthetic | Fictional crew (VEGA, ORION, LYRA), the LX-5 mission, EVA tasks, assessment trials, wearable nights, workload ratings | `backend/app/seed.py`, fixed seeds |
| `published_reference` | Reference | Links and one-line descriptions of NASA pages | `backend/app/provenance.py` |
| `hypothetical_scenario` | Hypothetical | Optimizer outputs under reviewer-chosen assumptions | `backend/app/scheduler.py` |

## NASA EVA CSV

* **Official dataset page:** https://data.nasa.gov/dataset/extra-vehicular-activity-eva-us-and-russia
* **How the bundled copy was obtained:** `data.nasa.gov` was not reachable from the build environment. The
  file `backend/data/nasa/eva_us_russia_mirror.csv` was downloaded from the public GitHub repository
  `nsgrantham/spacewalks`, which redistributes the data.nasa.gov export under its original file name
  (`Extra-vehicular_Activity__EVA__-_US_and_Russia.csv`). It is not modified.
  SHA-256: `00230a611fe003a85f373ed22cbbdea1482625b20f5ccb58a6b93d1ce956bc3e`.
* **Recommendation:** download the CSV from the official page and import it with *Research & Data
  Sources → Import a CSV manually*, or `python -m app.cli import-nasa path\to\file.csv`. The importer
  records the file name, SHA-256, detected columns and how it retrieved the file.
* **Inspected columns (actual header):** `EVA #`, `Country`, `Crew    ` (trailing spaces), `Vehicle`,
  `Date`, `Duration`, `Purpose ` (trailing space). The importer normalizes headers instead of assuming them.
* **Rows:** 375 (236 USA, 139 Russia). 7 rejected: zero (`0:00`, e.g. a cancelled EVA) or missing durations.
  Mixed date formats (`06/03/1965`, `March 16-17, 1966`) are parsed where possible; unparsed dates are kept
  as raw text.
* **Use:** reference visualization and planner context only. **Never** used as labels for recovery,
  fatigue or injury. No rows are ever fabricated; an unrecognized file is rejected with an error.

## Synthetic demo data

* Fictional crew with call signs; no real astronaut names or records.
* Each fictional crew member has 5 baseline and 4 mission sessions per assessment (enough for mission trends).
* Two reproducible histories for VEGA: **declining-performance** and **stable-performance** (sidebar →
  Load Demo Mission). ORION and LYRA are always stable.
* Each session stores raw synthetic trials (reaction times, clicks, pointer paths) so the same scoring
  code runs on synthetic and real data. One synthetic session is deliberately **interrupted** to show
  invalid-measurement handling.
* All random draws use `numpy.random.default_rng([20260514, profile, crew, session, stream])`. A SHA-256
  fingerprint over all synthetic observations is checked for determinism in the tests.
* The interface does not label synthetic data on screen; the `provenance` column is kept on every record, and
  this document is the reference for what is simulated.

## Filled demo areas (synthetic)

`app/demo_fill.py` fills areas that would otherwise be empty, all stored as synthetic: one reviewer note per
fictional crew member (from a fictional flight surgeon), three saved planner scenarios, and, for the local
participant only when they have no real sessions of their own, 5 baseline + 4 recent reaction-time and motor
sessions and 4 workload ratings. Fake sessions are never mixed with real ones, and the user's imported wearable
data is never invented or changed.

## What is self-reported

Only perceived workload: the six NASA-TLX ratings (Raw TLX). Sleep, recovery and other health signals are
never self-reported; they come from (currently synthetic) wearable data.

## Synthetic wearable data (sleep score and readiness)

* One simulated night per crew member for each morning from pre-mission day −13 to mission day 3: time asleep,
  deep/REM/light minutes, sleeping and resting heart rate, overnight HRV and restlessness. Stored in
  `wearable_nights` with provenance `synthetic` and device "a simulated wrist wearable". Fixed seeds as above.
* VEGA's declining history includes shorter, more restless sleep, lower HRV and higher resting heart rate on
  mission days; the other crew members have only a mild mission effect.
* The sleep score (0–100) and readiness (0–100) are computed from these nights by `app/analysis/wearable.py`.
  The structure follows Fitbit's public description; the formulas are this project's approximations.
* A real Fitbit/Google Health export importer is planned; imported nights would carry a separate, real-device label.

## Your own wearable data (local participant only)

* Category `device_data`. Imported from the user's own Fitbit / Google Health Takeout export: Daily Heart Rate
  Variability (overnight RMSSD, non-REM heart rate), Daily Resting Heart Rate and Daily Readiness (the vendor's own
  score and its sleep / HRV / resting-heart-rate ratings). Files are recognised by header; nothing else is read.
* The export has no sleep duration or stages. The local participant's sleep score is therefore *estimated*
  (derived, not measured): Fitbit's sleep-readiness rating (Very low 48 … Very high 90) shifted by 0.15 × (readiness − 60),
  or 45 + 0.45 × readiness when no sleep rating exists. It is labelled "estimated" in the app. The readiness shown is
  Fitbit's own value, not this project's approximation.
* The files live in `backend/data/private/google_health/`, which is git-ignored, and are imported on startup or via
  *Research and data → Your wearable data* or `python -m app.cli import-google-health <folder>`.

## Real local measurements

* Saved exactly as recorded (raw events); the backend re-scores them but never alters or rescales them.
* If you record under a fictional persona, the result is still labelled *real local measurement*, and the
  analysis warns that the comparison against a synthetic baseline is a workflow demonstration only.
* *Local participant (you)* keeps real-only data and survives demo reloads (`reset-db.ps1` clears it).
