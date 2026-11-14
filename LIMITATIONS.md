# LIMITATIONS.md — Unvalidated assumptions and known limitations

EVA RECOVERY is a hackathon research prototype. Read this before drawing any conclusion from it.

## Clinical and scientific scope
1. **Not a medical device and not a fitness-for-duty system.** It does not diagnose fatigue, illness,
   injury or any other condition, and it produces no readiness score.
2. **No validation.** No outcome data were used. No accuracy, sensitivity or specificity is claimed.
3. The categories ("Functional change worth reviewing", etc.) describe statistical distance from a
   person's own earlier results, nothing more. A flag can come from distraction, a different keyboard, a
   different room, practice effects or chance.

## Vigilant-attention task
4. Inspired by the NASA PVT; **not** the validated NASA PVT instrument, its hardware or its norms.
5. Browser timing: onset is captured in a `requestAnimationFrame` callback, so displayed-onset error is
   about one display frame (≈ 8–17 ms). Keyboard and OS latency vary by hardware and are not corrected.
   Compare results only within the same device setup.
6. Demo mode (1 min) is far shorter than standard vigilance protocols and is for demonstration.
7. The 100 ms premature and 500 ms lapse cut-offs are literature conventions used here as exploratory rules.

## Precision motor task
8. Mouse, trackpad and touch produce systematically different values; baselines should be built with
   the same input device. Pointer sampling is throttled to ~60 Hz.
9. Mirror variants keep difficulty identical in geometry, but left/right hand and screen-edge effects are
   not controlled.

## Baseline engine
10. Thresholds (robust z ≥ 3, per-metric minimum changes, spread floors, 3/5 session minimums) were chosen
    by the team for plausibility. They are not clinical cutoffs.
11. Multiple metrics are evaluated per session without multiple-comparison correction; more metrics
    means more chance flags.
12. Learning/practice effects across early sessions are not modelled.
13. Trends from 4–6 sessions have wide intervals and are descriptive only.

## Self-reported context
14. Sleep, fatigue, recovery and workload are self-reported and unverified. They are shown for context and
    are not part of any flagging rule. Raw TLX is the unweighted mean of the six NASA-TLX ratings, not the
    full weighted procedure.

## Scheduler
15. All restrictions are **reviewer-chosen planning assumptions**, not physiological predictions. The
    software never decides that anyone is unfit.
16. The task model is simplified: two-person EVA crews, 15-minute resolution, a fixed 07:00–19:00 window,
    EVA hours measured as first-start-to-last-end, no consumables, suit, traverse, lighting or comms limits.
17. Objective weights (postponement, reassignment, disruption) are arbitrary design choices; different
    weights give different "optimal" plans.
18. Infeasibility explanations list a minimal set of conflicting *modelled* requirements; real operations
    have many more.

## Data
19. The bundled NASA CSV is a third-party mirror of the data.nasa.gov export (see DATA_PROVENANCE.md);
    replace it with an official download when possible. It ends in 2013 and is used only as context.
20. All crew, mission and assessment histories in the demo are synthetic.
