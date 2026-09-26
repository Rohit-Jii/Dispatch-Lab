# Dispatch Lab

A readable, dependency-free courier simulation and browser UI. Dijkstra handles routing; tabular Q-learning chooses a courier. The simulator, browser, training worker, and offline benchmark use the same engine.

## Run locally

Requires Node.js 20 or newer. No package installation or build is needed.

```powershell
cd 'C:\Users\Rohit\Desktop\Reinforcement Learning\courier-lab'
node server.mjs
```

Open http://127.0.0.1:4173. Serve the files over HTTP; opening `index.html` directly will block ES modules and the training worker in some browsers. The UI uses system fonts if the optional Google Fonts request is unavailable. All simulation and learning run locally in the browser.

## Present it

1. Open **Design & assumptions** for the explanation, then close it.
2. Start from the default untrained policy: **Play**, 20× or 60×. Explain the map, the assignment table, and prep waiting. **Next order** pauses and advances to the next arrival; after all arrivals it drains both fleets.
3. **Train 200 episodes** runs in a worker and replays the same demo scenario. Inspect the **Learning curve**; it uses frozen evaluation with epsilon zero. Repeat if desired.
4. For a prepared presentation, **Load benchmark policy** loads the included 1,000-episode table and the measured learning curve. It switches to **Evaluate · epsilon 0**.
5. Select **Live deliveries** and play. Toggle **Learned / Greedy** to inspect both fleets. Use **Replay** to reset the same demand stream while keeping learning. **Reset learning** discards the table.
6. **Export results** saves actual order records, policy, summaries, and chart history as JSON. Browser refresh starts fresh; there is no implicit persistent training state.

## Read the design

- [DESIGN.md](dist/DESIGN.md): a 30-minute talk outline, numeric example, formulation, measured results, limitations, and future work.
- [ASSUMPTIONS.md](dist/ASSUMPTIONS.md): the full model and experiment assumptions.
- The same material is available in the UI guide.

## Code map

| File | Responsibility |
| --- | --- |
| `dist/simulation.js` | Seeded orders/weather, 180-edge graph, Dijkstra, FIFO courier movement, Q-table, reward, paired evaluation |
| `dist/ui.js` | SVG map/chart, playback, decision desk, worker orchestration, export |
| `dist/training-worker.js` | Training batches and frozen validation, off the UI thread |
| `dist/index.html`, `dist/style.css` | Page layout and styling |
| `benchmark.mjs` | Reproducible training and 30-scenario final test |
| `tests/simulation.test.mjs` | Routing, queue, timing, reward, Q update, reproducibility checks |
| `dist/benchmark-results.json` | Actual benchmark records, including every test seed |
| `dist/trained-policy.json` | Final Q table, action visit counts, and training counters |
| `server.mjs` | Local static server on port 4173 |

Constants and state bins are clearly marked in `simulation.js`. Keep fixed 10×10 geometry and 10-second edges consistent if extending it; these dimensions are deliberately simple, not a general graph library. Training is real Q-learning, with no hard-coded choice of the minimum ETA. Unseen states use equal Q values and random tie-breaking.

## Verify and reproduce

```powershell
node --test tests/simulation.test.mjs
node benchmark.mjs 1000
```

The benchmark overwrites the two generated JSON artifacts. With the included settings, the final policy was trained on seeds 1000–1999, validated on 80000–80009, and tested on fresh seeds 91000–91029. Every episode contains 40 orders and drains completely. Evaluation neither changes Q nor explores.

Final test: learned **202.84 s**, route-only greedy **219.13 s**, queue-aware ETA **170.76 s**, random **301.65 s**. Learned improves on the requested greedy by **7.43%**, but does **not** beat ETA. The paired mean improvement is 16.29 s, with an approximate 95% t interval of 4.84–27.74 s across 30 scenario means. This is one training run, not a confidence interval over independent training runs.

`qa-browser.mjs` is a development-only Playwright smoke check using this workstation's bundled runtime and Edge; it is not a runtime dependency. Its paths must be adjusted on other computers. The normal app and engine tests need only Node and a browser.
