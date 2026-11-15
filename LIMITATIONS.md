# LIMITATIONS.md — Unvalidated assumptions and known limitations

Tempo is a hackathon research prototype. Read this before drawing any conclusion from it.

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
6. Quick mode (1 min) is far shorter than standard vigilance protocols and is for demonstration.
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

## Self-reported workload
14. Only workload is self-reported (six NASA-TLX ratings). It is unverified, shown for context and not part of
    any flagging rule. Raw TLX is the unweighted mean of the six ratings, not the full weighted procedure.

## Sleep score and readiness
15. Both 0–100 scores imitate the published structure of Fitbit's Sleep Score (time asleep 50, deep and REM 25,
     restoration 25) and Daily Readiness (HRV, resting heart rate and recent sleep vs personal baseline). Fitbit's
     formulas are proprietary, so the point formulas, the equal readiness weights and the Low/Moderate/High cut-offs
     (below 40, 40–69, 70 and above) are this project's own choices.
16. They are consumer-style wellness indicators from device data (simulated for the crew; the local participant's
     readiness is Fitbit's own value and their sleep score is only estimated from it, because the export has no sleep duration). They are not medical
     scores, not an EVA fitness-for-duty determination, and are not used by the flagging rules or the scheduler.
17. Wrist wearables estimate sleep stages from movement and heart rate; stage accuracy is limited.

## Scheduler
18. All restrictions are **reviewer-chosen planning assumptions**, not physiological predictions. The
    software never decides that anyone is unfit.
19. The task model is simplified: two-person EVA crews, 15-minute resolution, a fixed 07:00–19:00 window,
    EVA hours measured as first-start-to-last-end, no consumables, suit, traverse, lighting or comms limits.
20. Objective weights (postponement, reassignment, disruption) are arbitrary design choices; different
    weights give different "optimal" plans.
21. Infeasibility explanations list a minimal set of conflicting *modelled* requirements; real operations
    have many more.

## Data
22. The bundled NASA CSV is a third-party mirror of the data.nasa.gov export (see DATA_PROVENANCE.md);
    replace it with an official download when possible. It ends in 2013 and is used only as context.
23. All crew, mission, assessment, wearable and reviewer-note data for the crew is synthetic, as are the local
    participant's pre-filled sessions and workload ratings (added only when they have no real sessions). The
    interface does not label synthetic data on screen.
