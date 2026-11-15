# RESEARCH.md — Sources and what each one actually supports

This file lists the sources named in the project brief and states, conservatively, what each is used
for in EVA RECOVERY. We do not reproduce data from the published references, and we do not claim that any
of them validates this software.

**Verification status (honest disclosure).** The build environment used to write this prototype could not
open `data.nasa.gov`, `ntrs.nasa.gov`, `humanresearchroadmap.nasa.gov`, `techport.nasa.gov` or `nasa.gov`
directly. Statements below that are marked *not verified in-build* rely only on how the project brief
describes the source. Please open each link and confirm before citing it in a submission.

| # | Source | Link | Provenance | How the app uses it | Status |
|---|---|---|---|---|---|
| 1 | Extra-vehicular Activity (EVA) – US and Russia (NASA open data) | https://data.nasa.gov/dataset/extra-vehicular-activity-eva-us-and-russia | NASA public data | Imported as data. Historical EVA dates and durations feed a reference histogram, decade medians and the "historical context" line in the planner. | Column names and content verified from the CSV itself (see DATA_PROVENANCE.md). |
| 2 | NASA Hi-Tempo EVA research (NTRS citation 20260000071) | https://ntrs.nasa.gov/citations/20260000071 | Published reference | Motivation only: NASA is studying the health and performance effects of frequent, high-tempo planetary EVAs. | Not verified in-build. |
| 3 | NASA Human Research Roadmap, EVA gap (gap.aspx?i=827, "EVA-302" per the brief) | https://humanresearchroadmap.nasa.gov/gaps/gap.aspx?i=827 | Published reference | Motivation only: individual recovery between EVAs is an open research gap. The app does not claim to close it. | Not verified in-build. |
| 4 | NASA TechPort project 23201 (Psychomotor Vigilance Test research) | https://techport.nasa.gov/projects/23201 | Published reference | Design inspiration for the vigilant-attention task: reaction time to visual stimuli presented after random delays. Our task is **not** the validated NASA PVT instrument. | Not verified in-build. |
| 5 | NASA Task Load Index (TLX) | https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/ | Published reference | The six workload dimensions in the check-in (mental, physical, temporal demand, performance, effort, frustration). We compute the unweighted **Raw TLX** mean, not the weighted NASA-TLX procedure. | Six dimensions are standard NASA-TLX content; page not opened in-build. |

## Related NASA work: what already exists, and what this project adds

NASA already measures astronaut cognition and alertness against each person's own baseline. EVA Recovery
builds on that idea; it does not claim to invent it, and its tasks are not validated like NASA's.

| Tool | What it is (from public sources) | Link |
|---|---|---|
| WinSCAT | Five-test cognitive battery; a medical requirement for U.S. long-duration astronauts since NASA/Mir and used on every ISS expedition, compared with each astronaut's own ground baseline. | https://ntrs.nasa.gov/citations/20100036584 |
| Reaction Self Test | 3-minute PVT-B reaction-time test (with sleep, stress and workload ratings) used on the ISS since 2009 to show astronauts when fatigue degrades their performance. | https://ntrs.nasa.gov/citations/20090029851 , https://spinoff.nasa.gov/Spinoff2013/hm_1.html |
| Cognition | Ten brief validated tests developed for NASA (University of Pennsylvania); part of NASA's Behavioral Health and Performance Standard Measures on ISS. | https://www.med.upenn.edu/uep/cognition.html |

**What EVA Recovery adds (as far as we could find in public sources):**
1. **Closing the loop to the EVA schedule.** The public tools report results to astronauts and flight
   surgeons. EVA Recovery carries a flagged change through a documented reviewer decision into a constraint-based
   re-plan of the next spacewalks: reassignments, postponements, rest intervals, or a minimal explanation of why
   no plan works.
2. **A focus on high-tempo planetary EVAs.** ISS tools were built for six-month stays with occasional EVAs.
   EVA Recovery targets several demanding surface EVAs in a few days, adds a precision motor task (relevant to
   suited hand work) and tracks rest between EVAs.
3. **One reviewer workflow:** test, flag with visible evidence, doctor's review note, schedule what-if.

NASA may have internal Artemis tools that are not public; we only claim we did not find this combination in
public sources.

## Related context found during development (via search results)

These were surfaced by web search while building; they are listed for further reading, not used as data.

* **Considerations for Health and Performance during Surface Extravehicular Activities** (NTRS 20240005165,
  presentation slides, 2024). Its slides contrast ISS EVA tempo (about 8 EVA hours roughly every two
  months) with exploration EVA tempo (about 24 EVA hours per week). https://ntrs.nasa.gov/citations/20240005165
* **Investigating Risks Due to Artemis EVA Tempo Via Probabilistic Risk Assessment** (NTRS 20250000639).
  Describes how the number and frequency of EVAs can affect medical risk, resource use and mission success.
  https://ntrs.nasa.gov/citations/20250000639
* **Operational Assessment of Apollo Lunar Surface Extravehicular Activity** (NTRS 20170007261). Quantifies
  operational variability of Apollo 14–17 surface EVA timelines. https://ntrs.nasa.gov/search.jsp?R=20170007261

## Methods used in the software (standard statistics, not NASA sources)

* Median and median absolute deviation (MAD) with the 1.4826 consistency constant for robust scale.
* Theil–Sen slope estimator (SciPy `theilslopes`) for descriptive trends.
* Fitts-style index of difficulty (Shannon formulation, log2(D/W + 1)) only to show that mirror variants of
  the motor layout have identical difficulty.
* Constraint programming with Google OR-Tools CP-SAT; minimal infeasible requirement sets via assumption
  literals and a deletion filter.
* PVT-literature conventions used as exploratory scoring rules: responses < 100 ms counted as premature;
  RT ≥ 500 ms counted as lapses.

## What no source supports

* No source validates our thresholds, our reaction-time implementation, or the idea that these measures
  indicate recovery status. All flags are exploratory.
* Historical EVA durations are never used as labels for recovery, fatigue or injury.
