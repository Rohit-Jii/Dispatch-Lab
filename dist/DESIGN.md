# Dispatch Lab: a 30-minute design walkthrough

## 0–3 minutes — Define the decision

We need to dispatch a new food order immediately while retaining capacity for later orders. An order contains a restaurant node, a distinct customer node, and a known preparation duration. Three identical couriers move on a 10×10, bidirectional street grid. Each courier executes its assigned orders sequentially.

Separate the jobs: **Dijkstra selects roads; Q-learning selects a courier.** Shortest-path search is already exact for the current positive edge weights. Asking RL to learn street navigation would make the learning problem harder without helping the dispatch question.

For each arrival, project each courier through its existing queue. Calculate the additional weighted route from its eventual free location to the restaurant and then to the customer. Estimate when this order would finish, including the courier's backlog and any food-prep wait. All three candidate plans use only currently observed costs, never future weather or future orders.

The new assignment changes a courier's future position and availability. That makes this a sequential decision problem, not merely three independent shortest-path problems. Nevertheless, sequential structure alone does not prove RL will beat a good heuristic.

## 3–8 minutes — Work one order all the way through

Use zero-based `(x,y)` coordinates; node ID is `10*y+x`. Each edge is 100 m. Speed is 10 m/s, so an edge takes 10 seconds. For this isolated example only, all relevant edge costs are one unit.

An order arrives at time 0: restaurant `(4,4)`, customer `(7,4)`, prep 40 s. The restaurant-to-customer route is three segments. A is busy and will be free in 90 seconds at `(3,4)`; B is idle at `(4,1)`; C is idle at `(9,4)`.

| Courier | Free in | Pickup travel | Delivery travel | Additional route cost | Delivery time |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 90 s | 10 s | 30 s | 4 | 130 s |
| B | 0 s | 30 s | 30 s | 6 | 70 s |
| C | 0 s | 50 s | 30 s | 8 | 80 s |

Compute `ETA = max(now + freeIn + pickupTravel, created + prep) + deliveryTravel - created`.

The greedy baseline chooses A because its *additional route cost* is smallest. Suppose the learner chooses B. Its pickup path is `(4,1) → (4,2) → (4,3) → (4,4)`, taking 30 seconds. B waits 10 seconds, not the full 40: food prep started at order creation. At second 40 B picks up the food. It travels `(4,4) → (5,4) → (6,4) → (7,4)` and delivers at second 70. A customer/restaurant pair is distinct, but a courier may already be at the restaurant, in which case the pickup leg has zero length.

The simulator accrues one unfinished-order second each second. This order therefore contributes 70 order-seconds, or **−0.70** at a 100-second reward scale. Its route has no extra edges relative to Manhattan distance, so detour penalty is zero. Fleet balance and penalties for A's pre-existing work are separate; −0.70 is not the whole fleet's reward.

Candidates are sorted by additional route cost: A, B, C. Relative ETA gaps are 60, 0, and 10 seconds. The three `(ETA-gap bin, availability bin)` pairs are `(1,1)`, `(0,0)`, `(0,0)`. Short prep and light traffic give table key `11-00-00:0:0`. Selecting B means action 1 in this canonical ordering; it does not mean courier B is always action 1.

For an illustrative subsequent arrival, let the previous Q value be −2.00, observed base interval reward −0.50, previous potential −1.20, next potential −1.80, and highest next-state Q −1.50. The shaped reward is `−0.50 + 0.92*(−1.80) − (−1.20) = −0.956`. The target is `−0.956 + 0.92*(−1.50) = −2.336`. With alpha 0.12, Q becomes `−2 + 0.12*(−2.336 + 2) = −2.04032`. These values illustrate arithmetic, not a fabricated trained row.

## 8–12 minutes — State and actions

The full environment observes every courier's node, progress along its current edge, route, phase, FIFO queue, ready times, busy-time counters, the new order, and all current edge costs. Raw positions alone already permit one million three-courier combinations; queues and dynamic edge weights make the raw state vastly larger. A small physical map does not imply a small tabular state space.

We deliberately use an approximate state. For each cost-ranked courier, encode:

- Its predicted delivery-time gap to the fastest candidate: **0–10 s**, **over 10–60 s**, or **over 60 s**.
- Time until free: **idle**, **over 0–100 s**, or **over 100 s**.

Also encode prep **at most 60 s / over 60 s**, and current rush level **below 0.5 / at least 0.5**. Positions, endpoints, queues, prep, and costs enter through the route and ETA calculations. Cost ranking retains which candidate has cheaper travel. Availability is a workload proxy; actual busy-time balance is used in the reward, not directly stored in the table.

This is at most `9^3 × 2 × 2 = 2,916` rows, each with three Q values. A sparse JavaScript `Map` stores visited rows. Identical couriers are interchangeable, so canonical cost ranking avoids relearning the same situation merely because courier labels swap.

Action 0, 1, or 2 selects one of the cost-ranked candidates, then maps back to a physical courier. All actions are valid because busy couriers accept queued orders. There is no rejection, reassignment, or deliberate dispatch delay action.

Aggregation hides absolute geography, exact backlogs, weather details, episode progress, and some history. The table is not an exact Markov representation. It cannot recognize that a particular neighborhood is likely to need a courier in 30 seconds unless that information is represented. The default demand is spatially uniform, so this demo mainly learns queue and capacity tradeoffs. It does not demonstrate hotspot anticipation.

## 12–17 minutes — Reward and learning

Decision epochs are arrivals; the interval to the next arrival varies. Let `N(t)` be unfinished accepted orders, `U_i(t)` each courier's busy-time fraction, and `E` extra route edges planned in the interval. Base reward is:

```
r = -sum_seconds N(t)/100
    -0.03 * E
    -0.0002 * sum_seconds (max_i U_i(t) - min_i U_i(t))
```

The first term includes queue waiting, travel, and prep waiting. Over a completely drained episode, `sum N(t)` equals the sum of all `deliveryTime - creationTime`. This is the user's definition of cold food; it is not a physical food-temperature model. Real food quality may instead depend heavily on time since cooking finished.

An extra edge is a planned route's edge count minus its Manhattan minimum, separately for each pickup and delivery leg. A longer path around expensive roads still incurs this penalty, even if it is cheapest in generalized cost. Thus generalized route cost and delivery time are intentionally different objectives. RL cannot override Dijkstra's route choice. Busy fractions include prep waiting. The balance term is deliberately small and does not force equal work at the expense of delivery time.

Assigning fleet reward to one action can be noisy: most unfinished orders came from earlier actions. Initial experiments without shaping did not improve reliably even after 4,000 episodes. We add earlier feedback via a potential:

```
Phi(observation) = - estimated remaining order-seconds / 100
shapedReward = r + gamma*Phi(nextObservation) - Phi(observation)
Q[s,a] += alpha * (shapedReward + gamma*max Q[next] - Q[s,a])
```

Estimate each already-assigned order's remaining delivery time under the current road snapshot. Sum across all queued orders. The arriving, not-yet-assigned order is excluded. Terminal potential and continuation Q are zero, after the last order is delivered. This gives credit sooner without changing the recorded base reward. The standard potential construction preserves the discounted objective in a fully observed MDP; our aggregated table still has approximation error. See [Ng, Harada & Russell (1999)](https://people.eecs.berkeley.edu/~russell/papers/icml99-shaping.pdf).

Use alpha **0.12**, gamma **0.92 per arrival**, and `epsilon = max(0.05, exp(-trainingDecisions/3500))`. Epsilon starts at 1; the first assignment is purely random. It is approximately 0.319 after 4,000 training decisions, 0.102 after 8,000, and reaches the 0.05 floor near 10,485. Exploration is uniform over all three actions. Exploitation selects the largest Q with seeded random tie-breaking. A table starts at zero; no heuristic supplies the chosen action.

Gamma is per dispatch decision rather than per simulated second. This deliberately simple convention discounts future decision intervals equally even when their durations differ. It prioritizes nearer-term outcomes; it is not identical to minimizing undiscounted episode delivery time. The UI and benchmark report actual, undiscounted delivery metrics. A more careful continuous-time model could use duration-dependent discounting. Constant alpha and nonzero exploration support adaptation but do not provide an exact convergence guarantee. The basic tabular update follows [Sutton & Barto, section 6.5](https://www.incompleteideas.net/book/bookdraft2018mar21.pdf).

## 17–22 minutes — Run the UI

Start at epsilon 1. Play at 20× and point out route dashes for pickup, solid delivery routes, changing road colors, square restaurants, hollow customer markers, and completed-delivery checkmarks. Each tick is one simulation second; interpolation animates movement smoothly. A courier waiting for prep remains in the restaurant/pickup phase, shown with a distinct waiting label.

Pause at an arrival. The decision table shows all three candidates' cost, free-in estimate, predicted delivery time, and Q at assignment. These estimates do not silently change after the decision. Toggle the displayed fleet to inspect greedy on the same exogenous scenario.

Train 200 episodes in a Web Worker, keeping the interface responsive. The live episode pauses and then replays seed 42 with the updated table. Alternatively load the included 1,000-episode policy for a prepared talk; this explicitly switches to frozen evaluation, epsilon 0. A separate learning curve evaluates snapshots on fixed validation scenarios. It is not a chart of increasingly easy training orders.

The top means use each policy's completed orders and show outstanding counts. They can have survivor bias mid-episode. The advantage and live chart instead use a **contiguous prefix of order IDs delivered by both policies**, including a slow earlier order before any later one. Each point is a rolling mean over up to 20 matched IDs; both policies use the same window. Every episode stops arrivals at 40 orders and drains all queues before its final mean.

## 22–26 minutes — Interpret the evidence

The final benchmark trains 1,000 episodes (40,000 assignments), evaluates checkpoints every 100 episodes on seeds 80000–80009, and then evaluates the final table on 30 fresh scenarios, seeds 91000–91029. Training seeds are 1000–1999. We keep the final checkpoint, not the best-looking validation checkpoint. The final table has 921 visited states. All evaluation freezes Q and uses epsilon 0. Each policy sees identical starts, orders, static road conditions, and timed weather, using an independent policy RNG.

| Policy | Mean delivery time, final test |
| --- | ---: |
| Random assignment | 301.65 s |
| Cheapest additional route (requested greedy) | 219.13 s |
| Learned table | 202.84 s |
| Queue-aware minimum predicted ETA | **170.76 s** |

The learned policy improves on route-only greedy by **16.29 seconds / 7.43%**, winning 23 of 30 scenarios. An approximate paired 95% t confidence interval for the improvement is **4.84–27.74 s**, calculated across scenario means, not correlated individual orders. This interval covers variation in test demand for a single trained model; it does not measure variation across multiple training seeds.

Validation improves from 293.50 s untrained to 212.38 s after 1,000 episodes, but fluctuates: 194.18 s at 200 episodes, 219.35 s at 300, and 193.08 s at 800. Do not claim monotonic improvement. The raw records and final table are included.

The initial unshaped experiments used test seeds 90000–90029 and performed poorly (299.27 s after 600 episodes; 328.33 s after 4,000, versus greedy 243.30 s). After changing the credit assignment, final testing moved to the fresh 91000 range. These initial outcomes motivated an engineering change, not selection of a flattering final checkpoint.

**Does RL earn its place?** It demonstrates learning to improve over the specified route-only greedy policy. It has not earned production preference over the simple queue-aware ETA dispatcher. Keep that heuristic as the deployment candidate until repeated training runs, richer demand patterns, and robust held-out tests establish a useful advantage. Do not manufacture an improvement claim merely because RL was requested.

## 26–30 minutes — What the real platform adds

The assumption register is a separate deliverable. The most consequential future additions are:

- Spatial and time-dependent demand, restaurant clusters, and demand forecasts in state. Uniform demand cannot teach named-neighborhood reservation.
- Stochastic prep readiness, kitchen capacity, pickup handoff delays, and uncertainty-aware ETA estimates.
- Actual traffic-dependent travel speed, one-way roads, turn restrictions, closures, parking, buildings, and walking to doors. Replanning mid-trip needs careful treatment of the current edge.
- Batched orders, carrying capacity, pickup-before-dropoff constraints, deadlines, cancellation, acceptance, reassignment, and the option to delay or reject an assignment.
- Courier breaks, shifts, differing vehicles, availability, compensation, fatigue, and fairness measured across comparable working opportunities.
- Customer lateness percentiles and service-level violations, food age after readiness, wasted food, mileage, energy, and platform cost—not just mean time.
- Demand exceeding capacity, queue limits, fallback rules, stale observations, missing GPS, and dispatch latency.
- Logged-policy bias and counterfactual evaluation, multiple training seeds, temporal/geographic holdouts, distribution shift, shadow operation, and a controlled comparison against the strongest simple heuristic.

Close with the decision boundary: routing solves the current graph; dispatch allocates future capacity. This simulator makes that distinction observable, and makes its performance claim falsifiable.
