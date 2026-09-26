# Complete assumption register

These are design choices for this implementation, not claims about a real platform. Values match the source and supplied benchmark. The isolated numeric example overrides road weights only to make the arithmetic transparent.

## Geography and routes

1. Exactly 10 horizontal and 10 vertical streets, 100 intersection nodes, 180 undirected edges. No diagonals, boundaries that wrap, or disconnected components.
2. Coordinates are zero-based `(x,y)` with y increasing down the displayed map. Node IDs are `10*y+x`.
3. Every edge is 100 m. The city spans 900 m per side between outer nodes.
4. Roads are bidirectional with equal costs in each direction. Every edge has strictly positive cost. There are no closures, turns, signals, parking, building entrances, or U-turn restrictions.
5. Each road receives a static, seeded condition multiplier uniform on `[1,1.18)`. It does not wear or repair during an episode.
6. Generalized edge cost, in normalized 100 m cost units, is `condition*(1+traffic+weather)`. It is not an ETA in seconds or monetary cost. Multiply by 100 to express equivalent weighted meters if desired.
7. Cost snapshots update every 30 simulated seconds. Rush amplitude is `max(0,sin(2*pi*t/900))`, sampled at the snapshot time, giving a repeating 15-minute demonstration cycle.
8. Central-road traffic is `1.8*rush`, other-road traffic `0.25*rush`. An edge is central when its lower-ID endpoint has x in 3–6 or y in 4–5. This is a simple fixed corridor definition, not observed city traffic.
9. Every 300 s beginning at 180 s, there is a 35% independent chance of one weather event. Duration is an integer 90–180 s, strength uniform `[0.6,1.3)`, center column an integer 0–7. Edges whose midpoint lies within two columns of that center receive the extra multiplier term. Weather effect begins/ends on the sampled cost snapshot, potentially up to 29 s after its scheduled boundary.
10. Weather is generated through last arrival plus 20,000 s. No overlapping weather events arise with this spacing and duration. There is no action-dependent congestion or effect from the three couriers on road conditions.
11. Dijkstra minimizes summed current positive generalized edge costs. Tie handling is deterministic by node scan order. It caches one shortest-path tree per origin per cost snapshot.
12. The active leg remains fixed until its destination. A fresh route is planned on starting each pickup and each delivery leg, including after queued work. There is no mid-leg rerouting. Maps may change color while a courier follows an earlier route.
13. Candidate plans use the current cost snapshot for both legs and for forecasting queued work. Future weather, future rush values, and future orders are not exposed to the policy, although the simulator has pre-generated them for reproducibility.

## Couriers and movement

14. Exactly three identical couriers start at independently uniform random nodes. Starting on the same node is allowed. Starts are the same for every policy on the same scenario.
15. Speed is exactly 10 m/s (36 km/h), constant in time and equal for all couriers, giving 10 s per edge. This is a compressed demonstration parameter, not a calibrated bicycle model.
16. Traffic/weather affect route *cost*, not physical speed. They can increase time indirectly by causing a longer chosen route. Modeling actual traffic delay requires changing this assumption.
17. A courier's operational phases are idle, traveling to pickup, waiting at pickup for prep, and traveling to delivery. Prep waiting is a substate of restaurant service in the user's three-state description; it is not availability.
18. A busy courier can accept any number of queued orders. FIFO is strict. No reassignment, queue reordering, rejection, dispatch delay, or batching. A courier carries one order at a time and completes it before starting the next pickup.
19. Idle couriers stay at their last delivery location. No depot return or proactive repositioning. There are no breaks, shifts, fatigue, heterogeneous vehicles, acceptance decisions, or failed deliveries.
20. Pickup and dropoff service themselves are instantaneous once ready/at the node. Only the prep wait takes time. A courier already at a restaurant can wait/pick up without traversing an edge.
21. Busy utilization includes travel and prep waiting; it excludes idle time. Balance compares cumulative busy fractions since episode start, not order counts, pay, or historical workload from earlier episodes.
22. Exact node/edge-progress and availability estimates are observable. No GPS error, communication delay, uncertain motion, or stale state.

## Orders and time

23. An episode has 40 orders. The first arrives at t=0. Subsequent gaps are `max(1,round(Exponential(mean=55 seconds)))`; this is a discrete approximation to Poisson arrivals with no simultaneous arrivals.
24. Restaurants are uniform across 100 nodes. Customers are uniform across the other 99 nodes. Orders are independent; a restaurant or customer node may recur. No persistent restaurant identity, capacity, catchment, or clustered demand.
25. Prep is an independent uniform integer from 20 through 100 s inclusive, starts at order creation, and is known exactly to both dispatchers. There is no shared kitchen bottleneck.
26. Food readiness persists until pickup. No spoilage, expiry, cancellation, order rejection, or abandonment. Every accepted order must eventually be delivered.
27. The new order is assigned immediately on arrival. Unfinished work remains in courier queues even after arrivals stop. Both policies drain completely before final episode scoring.
28. Simulation uses integer one-second ticks. Arrivals occur after movement/completions at the same timestamp, so a courier just freed at that timestamp is available for the new order. The t=0 order is assigned during initialization.
29. Physical deliveries are never delayed for a cosmetic animation. Food waits only until its actual ready time; the UI may therefore show no prep pause if the courier arrives late.
30. The engine has a 200,000-second guard for a non-draining episode; it throws rather than silently treating unfinished orders as completed or omitting them from a final result.

## Dispatcher, state, and objective

31. Route-only greedy chooses the smallest *additional* weighted pickup-plus-delivery path from the courier's projected free location, ignoring backlog duration and prep in its ranking. It is deliberately the requested naive comparator, not a claim of best classical dispatch. Equal costs choose the smaller courier ID.
32. The stronger diagnostic heuristic chooses minimum predicted creation-to-delivery ETA, including queue and prep; cost order breaks ETA ties. Random assignment is another offline control.
33. The Q policy chooses cost-ranked actions mapped back to courier IDs. No ETA minimization, fallback heuristic, action mask, or manually preferred courier is hidden inside exploitation.
34. State bins are the ETA gap `[0,10]`, `(10,60]`, `(60,infinity)` and free-in `0`, `(0,100]`, `(100,infinity)` for each ranked courier, plus short/long prep at 60 s and rush below/above 0.5. Maximum 2,916 rows / 8,748 action values. Continuous variables and explicit node coordinates are aggregated away.
35. State aggregation and omission of episode horizon, exact queues, absolute geography, and utilization history make this an approximate, partly observable dispatch model. Classical tabular convergence guarantees do not directly apply.
36. Base delay reward is `-0.01` per unfinished order per simulated second. At episode drain its undiscounted delay component equals `-sum(deliveryTime-creationTime)/100` exactly.
37. Each extra planned edge relative to Manhattan distance costs 0.03 reward units, equivalent to 3 order-seconds. Both pickup and delivery legs count. Direct paths can still incur high road cost without a detour penalty. This measures physical extra distance, not extra generalized cost relative to Dijkstra's optimum.
38. Balance reward is `-0.0002*(max utilization-min utilization)` per second, using cumulative utilization at the start of that tick. It is a deliberately minor term; no minimum/maximum utilization guarantee is enforced.
39. Potential shaping uses negative predicted remaining order-seconds divided by 100. It uses current route/queue forecasts; excludes the new unassigned order; and is zero terminally. It changes learning feedback, not exported base reward totals. ETA information enters shaping, but does not select actions.
40. Learning uses `r + 0.92*Phi(next) - Phi(current)` and the usual Q bootstrap, alpha 0.12, gamma 0.92 per arrival. Final transition includes the complete drain with no bootstrap. There is no extra discount within an arrival interval. Discounted learning and undiscounted reporting are intentionally distinguished.
41. All Q values initialize at zero. Unvisited states have three equal zero values. Epsilon starts at 1, decays as `exp(-n/3500)`, and bottoms at 0.05, where n counts learning assignments across episodes. Random action and tied maxima are uniform and seeded.
42. One transition is updated at the next order arrival, or once at terminal drain. Reward includes effects on all pending orders, not just the newest order. There is no experience replay, neural network, planning search, or eligibility trace.
43. Training ends at a chosen episode count, not an automatic convergence test. Performance can fluctuate and is not guaranteed to beat a baseline in every episode.

## Experiments and interface

44. Mulberry32 provides deterministic pseudorandom numbers. Environment randomness and action randomness use separate seeds, so different choices cannot consume or change the shared order/weather stream.
45. The demo scenario is seed 42. Replay resets positions, demand, time, counters, and weather, retaining the Q table. Online mode continues training; frozen mode sets epsilon 0 and never updates Q. Partially replayed episodes retain completed updates but discard their last unfinished transition; only drained episodes increment the completed-episode count.
46. Batch training pauses the demo, trains 200 episodes in a worker, then replays seed 42. Batch scenario seed is `1000 + completedTrainingEpisodes`. The table is session memory; refreshing starts over. Export saves it, and the bundled benchmark-policy button loads the supplied artifact. Arbitrary JSON policy import is not implemented.
47. Training chart points evaluate frozen tables at epsilon 0. Browser batches use six fixed validation seeds 80000–80005. The included CLI benchmark uses ten, 80000–80009. Curves from different validation sets are not merged. These validation runs never learn.
48. Final benchmark uses one training run, 1,000 episodes, seeds 1000–1999, and the final checkpoint. Final fresh tests are 91000–91029, all disjoint from training, validation, and earlier development tests. Repeated training runs and robustness to changed demand settings have not been established.
49. The reported 95% interval is the paired t interval across 30 independent scenario means: mean difference ± 2.045*sampleSD/sqrt(30). It measures uncertainty across evaluation scenarios conditional on one trained policy. Forty orders within a scenario are not treated as independent statistical samples.
50. Top-line live delivery means include completed orders only and show outstanding counts. The comparative advantage/rolling chart use a contiguous prefix completed by both policies, sorted by order ID, with a 20-order rolling window. They are descriptive during a run; final drain removes completion censoring.
51. Every animation compares independent three-courier fleets, not two dispatchers sharing couriers. Once one fleet finishes, its state stops advancing; the other continues until drained. Displayed global clock is the larger fleet time.
52. Speed options are 1×, 5×, 20×, and 60×. They change only playback wall time, not physics, random draws, or training rewards. Long dropped browser frames are capped to 0.25 s wall time so the demo slows rather than jumping uncontrollably. Hidden tabs stop playback advancement.
53. The map interpolates between one-second physics updates and fans out overlapping stationary markers for visibility; these small display offsets do not change simulated position. Delivery badges persist for 25 simulated seconds.
54. The application is a single static page with local browser computation and no customer/courier personal data, backend, account database, or external dispatch integration. Optional Google Fonts affects appearance only. The optional experimental WebMCP playback interface is feature-detected; ordinary controls are always available.
55. The simulator is an educational prototype. The values, rewards, weather, horizon, and capacity are synthetic, not calibrated operating parameters. No claim of real-world improvement or production readiness follows from the synthetic benchmark.
