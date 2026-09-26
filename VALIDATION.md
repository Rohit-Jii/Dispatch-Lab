# Validation record

The final implementation was checked on this workstation with Node 24 and headless Microsoft Edge.

- Engine tests: graph connectivity and bidirectionality, weighted shortest path, dynamic roads, the 70-second numeric trace, prep readiness, FIFO draining under a burst of 60 orders, exact order-second accounting, mid-edge availability, Q bootstrap/terminal updates, epsilon bounds, reproducible frozen runs, matched-order censoring, and potential-shaping telescoping.
- Browser checks: play/pause, speed, next-arrival stepping, both fleet views, a real 200-episode worker training run, loading the supplied policy, completing both 40-order fleets, matching all 40 IDs, JSON download, guide modal/keyboard close, mobile width, and doubled base text size. No browser JavaScript errors occurred.
- Visually inspected the desktop and mobile output. Local screenshots are in the ignored `qa/` folder, not required for the app.
- Experimental WebMCP is optional and feature-detected. Native WebMCP validation was unavailable in the installed browser; it is not a dependency of any requested UI feature.
- The final CLI benchmark uses the same simulation engine and exports all raw per-scenario summaries, not a hand-authored performance curve. See `dist/benchmark-results.json`.

The tests cover a synthetic model. They do not establish production suitability or superiority to the queue-aware ETA heuristic. One demo scenario (seed 42) can lose to greedy even when the final policy improves across the fresh test set.
