# AI_USAGE.md — Disclosure of AI assistance

## Tools
* **Claude (Anthropic), model Claude Opus 5.5, used through Claude's agentic coding environment
  (Claude Code tooling)** generated essentially all of the code, tests, seed data design and documentation
  in this repository from the team's written project brief.

## What the AI produced
* Backend: FastAPI application, SQLite schema, scoring code, baseline engine, OR-Tools CP-SAT scheduler,
  NASA CSV importer, synthetic data generator, CLI, pytest suite.
* Frontend: React/TypeScript UI, the reaction-time and motor tasks, check-in form, charts, Vitest suite.
* Documentation: README.md, RESEARCH.md, DATA_PROVENANCE.md, LIMITATIONS.md, this file.
* Visual design: original UI styling and an abstract SVG app icon. No AI image generation was used and no
  NASA logos, flags, patches or protected branding were reproduced.

## How AI output was checked
* Automated tests (72 pytest, 18 Vitest) were written and run; all pass at delivery.
* The app was run end to end in a headless browser: overview, a real reaction-time run with simulated key
  presses, a motor run, reduced-workload and longer-rest optimizations, and the data pages.
* Statistical rules and limitations are documented so humans can review them.

## What the AI did not do / could not verify
* It could not open data.nasa.gov, ntrs.nasa.gov, humanresearchroadmap.nasa.gov, techport.nasa.gov or
  nasa.gov from its build environment. Descriptions of those references follow the project brief and are
  marked as not verified in RESEARCH.md. The NASA CSV came from a GitHub mirror (see DATA_PROVENANCE.md).
* No source citations, validation results or accuracy figures were invented.
* All synthetic data is labelled as synthetic in the database and the UI.

## Team responsibility
The team should review the code, confirm every source before citing it, and present the project as an
AI-assisted prototype in line with NASA Space Apps rules on AI use.
