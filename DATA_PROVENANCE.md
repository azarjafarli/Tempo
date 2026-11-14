# DATA_PROVENANCE.md — Real versus simulated inputs

Every record in the database carries exactly one provenance category, and the UI shows a badge for it.

| Category (`provenance`) | Label in UI | What it contains | Where it comes from |
|---|---|---|---|
| `nasa_public_data` | NASA public data | 368 parsed EVA records (of 375 rows) | The NASA "Extra-vehicular Activity (EVA) – US and Russia" CSV |
| `local_measurement` | Real · local | Reaction-time trials, pointer samples/clicks and check-ins recorded in your browser | Whoever performs the assessments on this computer |
| `synthetic` | Synthetic | Fictional crew (VEGA, ORION, LYRA), the LX-5 mission, EVA tasks, assessment trials, self-reports | `backend/app/seed.py`, fixed seeds |
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
* Two reproducible histories for VEGA: **declining-performance** and **stable-performance** (sidebar →
  Load Demo Mission). ORION and LYRA are always stable.
* Each session stores raw synthetic trials (reaction times, clicks, pointer paths) so the same scoring
  code runs on synthetic and real data. One synthetic session is deliberately **interrupted** to show
  invalid-measurement handling.
* All random draws use `numpy.random.default_rng([20260514, profile, crew, session, stream])`. A SHA-256
  fingerprint over all synthetic observations is checked for determinism in the tests.
* The UI shows an amber **DEMO SCENARIO** indicator whenever synthetic data is displayed.

## Real local measurements

* Saved exactly as recorded (raw events); the backend re-scores them but never alters or rescales them.
* If you record under a fictional persona, the result is still labelled *real local measurement*, and the
  analysis warns that the comparison against a synthetic baseline is a workflow demonstration only.
* *Local participant (you)* keeps real-only data and survives demo reloads (`reset-db.ps1` clears it).
