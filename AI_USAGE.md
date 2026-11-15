# AI_USAGE.md — Disclosure of AI assistance

## Tools
* **Claude (Anthropic), model Claude Opus 5.5, used through Claude's agentic coding environment
  (Claude Code tooling)** generated essentially all of the code, tests, seed data design and documentation
  in this repository from the team's written project brief.

## What the AI produced
* Backend: FastAPI application, SQLite schema, scoring code, baseline engine, OR-Tools CP-SAT scheduler,
  NASA CSV importer, Fitbit / Google Health importer, sleep-score and readiness approximations, synthetic data
  generator and demo filler, reviewer roster and notes, CLI, pytest suite.
* Frontend: React/TypeScript UI (later redesigned on request), the reaction-time and motor tasks, workload
  check-in, mission control roster, wearable cards, charts, Vitest suite.
* Naming: the project name "Tempo" was suggested by the AI and chosen by the team.
* Documentation: README.md, RESEARCH.md, DATA_PROVENANCE.md, LIMITATIONS.md, this file.
* Visual design: original UI styling and an abstract SVG app icon. No AI image generation was used and no
  NASA logos, flags, patches or protected branding were reproduced.

## How AI output was checked
* Automated tests (72 pytest, 18 Vitest) were written and run; all pass at delivery.
* The app was run end to end in a headless browser: every screen, a reaction-time run with simulated key presses,
  a motor run, reviewer notes, reduced-workload, longer-rest and infeasible optimizations.
* The Google Health importer was checked against the team member's own export files; those files are never
  committed (git-ignored `backend/data/private/`).
* Statistical rules and limitations are documented so humans can review them.

## What the AI did not do / could not verify
* It could not open data.nasa.gov, ntrs.nasa.gov, humanresearchroadmap.nasa.gov, techport.nasa.gov or
  nasa.gov from its build environment. Descriptions of those references follow the project brief and are
  marked as not verified in RESEARCH.md. The NASA CSV came from a GitHub mirror (see DATA_PROVENANCE.md).
* No source citations, validation results or accuracy figures were invented.
* All synthetic data is labelled as synthetic in the database. At the team's request the interface no longer
  labels it on screen; DATA_PROVENANCE.md documents what is simulated.

## Team responsibility
The team should review the code, confirm every source before citing it, and present the project as an
AI-assisted prototype in line with NASA Space Apps rules on AI use.
