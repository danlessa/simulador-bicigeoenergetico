# Research note — move-grid connectivity bias in terrain-mode optimal energy

**Date:** 2026-07-11 · **Status:** analysis complete; findings SHIPPED as
options in v57 (2026-07-12) — see §12 for the outcome, including the §11
pre-registration scorecard
**Harness:** `docs/grid-sens.mjs` (self-validating; reproduction §13)
**Cross-ref:** intended as an entry for
`../bicycling-energy-model/research/MODEL_COMPARISON_JOURNAL.md` (the journal
lives in the sibling `bicycling-energy-model` repo, not here); relates to
journal Entries 18–20 as described in §2.

## Abstract

Terrain mode routes on an 8-connected raster, so its "optimal" energies are
upper bounds on the continuum optimum: paths jag between the 8 discrete
headings. We measure that bias on a real DEM against a converged ladder of
move sets — square 4/8/16/32/64/128 (Farey heading subdivisions) and
hexagonal 6/12 — with a flat-terrain control that reproduces each lattice's
theoretical worst case. On the deployed IGC-SP 5 m DTM (v55 smoothing,
UI-default physics) the app's 8-move grid reads **+12.7 % median (+21 %
mean, +47 % p90)** above the near-continuum optimum at route scale, and
**undercounts budget-reachable area by ~19 %**; at 30 m the figures are
+8.1 % median and ~15 %. This is roughly **double** the pure octile-geometry
prediction: the dominant mechanism is not distance inflation but forced
height oscillation around contour lines under the asymmetric climb/descent
cost. A 16-move set recovers ≈ ⅔ of the bias — but only with
profile-integrated long edges; the naive endpoint-Δh generalization flattens
the relief its edges cross and flips to *under*-estimating (−1 % to −8.5 %
median at 30 m), destroying the upper-bound guarantee. Hex lattices are not
competitive. The original 8-over-4 choice is strongly validated.

## 1. Motivation and question

Suspicion (Danilo, 2026-07-11): terrain mode overestimates optimal energy
because of route jaggedness from the 8-cell move grid. Requested: a
sensitivity analysis vs a 16-cell neighborhood on a small DEM; extended to
4/64/128 and hexagonal 6/12 for completeness. The question matters because
(a) the energy field's absolute values feed the 300 kJ-initiative
accessibility KPIs (threshold counting is bias-sensitive), and (b) any fix
touches every bit-parity engine surface, so it needs quantified benefit
before a work order.

## 2. Relation to prior findings (journal Entries 18–20)

Distinct from, and additive in direction with, the known cost-model biases:

- **Entry 19** (resolution over-charge): `v2Edge`'s grade-local ε reads
  conservatively HIGH on fine DTMs (~+9 % median at 5 m vs ∫P·dt on real
  rides). That is a *cost-model* bias measured along fixed street routes.
- **This note** measures a *search-discretization* bias: even under a perfect
  edge cost, the 8-grid's optimal path is jagged, so route-optimal energies
  read high. The two mechanisms are independent and both one-sided positive
  on fine DTMs; they compound (not additively in any precise sense) toward
  conservative terrain-mode energies.
- **Entry 18 / the O(1)-locality requirement** constrains remedies: profile
  integration of long edges (§4) keeps edge costs O(1)-local (fixed ≤ 2·max
  sample count per edge), so a 16-move engine would not violate the
  no-path-history invariant.

## 3. Hypotheses (stated before the runs)

- H1: E8 > continuum optimum, with the flat-geometry octile bound (≤ 8.24 %,
  direction-peaked at 22.5°) as the naive expectation.
- H2: a 16-move set removes most of the gap.
- H3 (methodological): naive endpoint-Δh long moves are confounded — they
  also change terrain sampling, over-crediting the richer neighborhoods.

H1 held but the naive expectation was wrong in an interesting way (terrain
doubles it and erases the direction signature, §6). H2 held (≈ ⅔
recovered). H3 held strongly — at 30 m the naive ladder crosses below the
true optimum (§5.3).

## 4. Method

**Harness.** `docs/grid-sens.mjs`, standalone node. Mirrors (hand-copied,
same rule as the repo's other mirror tests): `v2Edge` ← `energy-worker.js`;
`readCost`'s folded UI-default physics ← the `census/census-density.mjs`
mirror (m 75 kg, Crr 0.008, CdA 0.45, ρ 1.1, k_eff 0.97, P_flat 80 W →
aRoll 6.07e-3, aAero 8.12e-3, β 0.7585 kJ/m); v55 σ = 10 m pre-smoothing ←
the `test-dem-smoothing.mjs` mirror. Dijkstra relax rules mirror the worker
exactly (f32 E storage, f64 heap keys, settled-byte staleness filter).

> **Gravity note (added 2026-07-25, v63).** Every number in this note was
> produced with g = 9.81 m/s². v63 re-baselined the app *and* these harnesses
> to São Paulo's local g = 9.7864 m/s² (IAG-USP absolute gravimetry), so a
> re-run reads ≈0.24% lower in absolute energy (β 0.7585 → 0.7567 kJ/m,
> aRoll 6.07e-3 → 6.05e-3). The conclusions here are all *ratios* between
> lattices computed at the same g, which the change leaves intact; the recorded
> absolute values are kept as the historical record, deliberately not re-run.

**Validation gate.** Every run first executes the REAL `energy-worker.js` in
a sandbox and asserts the harness's own 8-move field is bit-identical
(max|Δ| = 0 kJ, zero finite-mismatches) — observed on all runs. The flat
control (§5.1) additionally reproduces each lattice's closed-form worst case.

**Move sets.** Square lattices by Farey/Stern–Brocot level: 8 → +mediants →
16 → 32 → 64 → 128 headings (levels 0–2 coincide with the coprime
max-norm ≤ R sets; 64/128 are the Farey continuations). Square-4 (von
Neumann) as a degenerate baseline. Hexagonal lattices (node spacing = the
raster's min pixel, heights bilinearly resampled from the same smoothed
raster): hex-6 (60° headings) and hex-12 (+the √3-length 30°-offset moves).
**Square-128 is the reference**; square-64 lands within 0.2–0.9 % of it
everywhere, so the ladder has converged and "vs continuum" below means "vs
sq128".

**The confound and its control (H3).** A long move costed from its
endpoints' Δh alone *skips the relief under it*. With climb at
β ≈ 0.76 kJ/m against ≈ 0.014 kJ/m flat travel, skipping one 1 m bump fakes
more saving than ~50 m of route straightening — a terrain-resampling change
masquerading as a jaggedness fix. All long moves are therefore
**profile-integrated**: bilinear height samples every ~1 cell along the
segment, `v2Edge` summed per sub-segment (2·max(|dr|,|dc|) sub-steps; hex √3
moves in 2 sub-steps). Naive endpoint-Δh variants of square-16/32 are run
separately to size the artifact. Long moves also require their swept cells
passable (supercover sampling), so they cannot tunnel through nodata.

**Conditions.**
1. *5 m:* central-SP crop of the deployed `sampa_centro.tif` (IGC 5 m DTM),
   900×900 px ≈ 4.4×4.8 km, σ = 10 m smoothing per the v55 auto rule,
   4 spread sources.
2. *30 m emulation:* 1500×1500 crop anti-alias-smoothed (σ = 15 m) and 6×
   decimated → 250×250 at ~30 m, no further smoothing (matching how a
   coarse source is used in-app), 6 sources.
3. *Flat control:* heights constant, 700×700, 2 sources — isolates pure
   lattice geometry.

**Statistic.** Overestimate `E_mode/E_sq128 − 1` over all target cells
≥ 800 m from the source (0.3–13 M targets per condition; hex evaluated at
hex nodes mapped to the nearest raster cell). No energy budget (eMax 0), so
no truncation interacts. Reach = area within the median of each source's own
E8 field.

## 5. Results

### 5.1 Overestimate vs the near-continuum optimum (median / mean / p90)

| move set | 5 m DTM (smoothed) | 30 m emulation | flat median | lattice-theory max (observed) |
|---|---|---|---|---|
| square-4 | 31.0 % / 47.6 % / 102 % | 27.8 % / 33.7 % / 61 % | 32.0 % | 41.4 % (41.3 %) ✓ |
| hex-6 | 18.1 % / 29.3 % / 63 % | 14.1 % / 16.8 % / 32 % | 11.3 % | 15.5 % (16.2 %) ✓ |
| **square-8 (app)** | **12.7 % / 21.3 % / 47 %** | **8.1 % / 9.7 % / 18 %** | **5.7 %** | 8.24 % (9.2 %) ✓ |
| hex-12 | 7.9 % / 12.9 % / 28 % | 3.8 % / 4.7 % / 9.8 % | 2.5 % | 3.5 % (4.2 %) ✓ |
| square-16 | 5.8 % / 9.0 % / 19 % | 2.7 % / 3.2 % / 5.9 % | 1.2 % | 2.8 % ✓ |
| square-32 | 2.1 % / 3.1 % / 6.6 % | 0.9 % / 1.0 % / 1.8 % | 0.25 % | 0.7 % ✓ |
| square-64 | 0.6 % / 0.9 % / 2.0 % | 0.14 % / 0.2 % / 0.5 % | 0.05 % | — |

(Flat-control maxima slightly exceed the single-lattice theory values because
the reference sq128 has its own ~0.1–1 % residual; the agreement is the
validation, not a coincidence.)

### 5.2 The direct question: 8 vs 16 (profile-integrated)

| | 5 m | 30 m | flat |
|---|---|---|---|
| E8/E16 − 1 median | **6.9 %** | 3.9 % | 3.8 % |
| E8/E16 − 1 mean / p90 | 10.6 % / 22.6 % | 4.2 % / 6.0 % | 3.9 % / 7.0 % |
| E8/E32 − 1 median | 10.4 % | 5.7 % | 5.1 % |

### 5.3 The naive-edge artifact (H3), isolated

Median vs continuum, naive endpoint-Δh long edges (true profile value in
parentheses):

| | 5 m | 30 m |
|---|---|---|
| square-16 naive | +5.1 % (+5.8 %) | **−1.3 %** (+2.7 %) |
| square-32 naive | −0.2 % (+2.1 %) | **−8.5 %** (+0.9 %) |

At 30 m the naive edges span 60–90 m and flatten whole hillocks: the sign of
the error flips. Where a naive ladder lands near zero (sq32-naive at 5 m) it
is two large errors cancelling, not accuracy.

### 5.4 Budget reach (what the accessibility KPIs feel)

Area reachable within the median of each source's E8 field, relative to
square-8:

| | square-4 | hex-6 | square-8 | hex-12 | square-16 | square-32 | continuum |
|---|---|---|---|---|---|---|---|
| 5 m | −21 % | −7.6 % | 0 | +7.2 % | +10.7 % | +16.1 % | **+19.0 %** |
| 30 m | −23 % | −9.7 % | 0 | +6.0 % | +9.6 % | +13.2 % | **+14.9 %** |

### 5.5 Runtime and the cost–accuracy scaling law (measured)

Per-mode wall time (harness, 900×900 = 810 k cells, one source, this
machine): sq4 0.30 s · sq8 0.47 s · sq16 1.13 s · sq32 2.71 s · sq64 7.22 s
· sq128 18.1 s · hex6 0.57 s · hex12 1.34 s · sq16-naive 0.91 s ·
sq32-naive 1.74 s. Memory unchanged (same per-cell arrays).

Pairing those times with the ladder medians gives the cost–accuracy
exponent k, defined by error ∝ time^(−k) per step:

| step | time × | 5 m err ÷ | k (5 m) | 30 m err ÷ | k (30 m) | flat err ÷ | k (flat) |
|---|---|---|---|---|---|---|---|
| sq8 → sq16 | 2.40 | 2.19 | 0.90 | 3.0 | 1.25 | 4.75 | 1.78 |
| sq16 → sq32 | 2.40 | 2.76 | 1.16 | 3.0 | 1.25 | 4.8 | 1.79 |
| sq32 → sq64 | 2.66 | 3.50 | 1.28 | 6.4 | 1.90 | 5.0 | 1.64 |
| **overall 8 → 64** | **15.4** | **21.2** | **1.12** | 57.9 | 1.49 | 114 | 1.73 |

Three readings. (a) On the rough 5 m DTM, **error × time ≈ constant**
(k ≈ 1.1): each ladder step buys almost exactly its cost's worth — "3× less
error for 3× more time" is the honest summary of the tested range. (b) The
exponent is terrain-dependent and k ≈ 1 is the WORST case: the
contour-oscillation error term decays only ~linearly in the heading gap
(gap halves per level ⇒ error ÷~2) while pure geometry decays quadratically
(÷4; flat column, k ≈ 1.7, near the theoretical ln4/ln2.5 ≈ 1.5 plus
sub-quadratic cost growth). As the terrain term is exhausted, each column's
later steps accelerate toward the flat rate (5 m: ÷2.2 → ÷2.8 → ÷3.5).
(c) The hex points sit strictly off the square Pareto frontier (hex12:
1.34 s for 7.9 % vs sq16's 1.13 s for 5.8 %) — the square ladder is the
efficient family, not just the convenient one.

Because k ≈ 1, the tradeoff curve itself has NO knee on rough terrain — the
stopping rule cannot come from the scaling law and must come from external
error floors (§8.2). Why k → 1 is natural for this paradigm: cost per level
doubles with the edge count (×~2.4 with sub-sampling), while the dominant
terrain error term halves with the heading gap — "more headings" alone can
never beat error·cost ≈ const in the terrain-dominated regime. Prospects
for k < 1 are in §9.

## 6. Mechanism: why terrain doubles the geometric penalty

On flat ground the E8/E16 gap follows octile theory exactly: medians rise
0.8 % → 6.9 % from on-axis to 22.5–30° and fall back — the classic
direction signature. On real terrain that signature vanishes (5.7–7.8 %
medians across ALL headings at 5 m) and the overall gap doubles. The
dominant cost is not extra path length but **height oscillation**: an 8-grid
path following a contour line must zigzag across it, and the asymmetric cost
(climb charged at β, descent refunded at ε·β with ε ≤ 1 − 0.13) taxes every
oscillation cycle. Finer heading sets track contours instead of chopping
across them. Consistently: the bias grows with terrain detail (5 m > 30 m >
flat), and is largest in high-relief subareas (p90 47 % at 5 m).

## 7. Threats to validity

- **Reference ≠ true continuum.** sq128 is a lattice too; but sq64→sq128
  moves < 1 %, so remaining truncation is second-order vs the reported gaps.
- **Between-cell terrain is modeled**, as the bilinear surface (sub-sampled
  every ~1 cell on long edges). Finer sub-stepping would charge long edges
  slightly more, shrinking the reported gaps marginally — the direction of
  this error makes the headline numbers mild upper bounds on the pure
  jaggedness effect.
- **Free-terrain optimum is not physical ground truth.** Real riding is
  street-constrained (graph mode is unaffected by all of this). The study
  measures terrain mode against its own continuum limit — the right target
  for "does the grid bias the field", not for "is the number the rider's
  kJ" (that is per-rider calibration territory, Entry 20).
- **One geography, one cost bundle.** Central São Paulo relief; UI defaults
  (80 W). The mechanism scales with β/(aRoll+aAero) ≈ 53:1, so heavier
  climb-dominance ⇒ larger bias; a strong-rider bundle would shrink it
  somewhat. Not swept here.
- **The 30 m condition is an emulation** (anti-aliased decimation of the
  5 m survey), not a real 30 m product like FABDEM (whose per-pixel noise is
  a separate, documented hazard).
- Sample sizes are millions of target cells but spatially correlated;
  figures are descriptive distributions, not independent draws.

## 8. Implications for the app

1. Terrain-mode optimal energies are **grid-native upper bounds**: ~13 %
   median (5 m) / ~8 % (30 m) above the continuum optimum at route scale.
   The 300 kJ-KPI counting is therefore a **conservative floor**
   (accessible area within a median budget undercounted ~15–19 %). The bias
   direction never flips under the current engine — a safety property worth
   keeping deliberately (a shared-constant correction can center the
   aggregate at the cost of exactly that property — §10).
2. If tightening is wanted, **square-16 with profile-integrated knight
   moves** is the sweet spot: recovers ≈ ⅔ of the bias at ~2.5–3× relax
   cost, stays O(1)-local, keeps the upper-bound property. Square-32 gets
   within 1–2 % at ~3× more again.
3. **The naive 16/32 implementation must never ship** — it silently
   converts a bounded overestimate into an unbounded-sign resampling error
   (§5.3). Any work order must specify profile integration and re-run this
   harness as the acceptance test.
4. Hex lattices are dominated (hex-6 worse than the current grid; hex-12
   between 8 and 16 for a full lattice rewrite). Square-4 would have been
   catastrophic — the original 8-choice is vindicated.
5. Scope of an eventual 16-move work order: `dijkstra()`, `densityField()`,
   the Rust port (+`test-backend.mjs` parity), portal composition, passes
   semantics, `densityPoolSize`/`estimateRunTime` constants, and the A*
   heuristic (a 16-heading octile-style lower bound). Until then, the honest
   framing above costs nothing.

## 9. Beating k = 1 — candidate optimizations

Since "more headings" alone is pinned at error·cost ≈ const on rough
terrain (§5.5), sub-linear cost per unit accuracy requires reusing work,
spending selectively, or changing the discretization class:

1. **Precomputed long-edge tables — tried (2026-07-11): the one candidate
   that WORKS, for density runs** (`docs/grid-longedge.mjs`). Store every
   long move's profile integral in a per-directed-heading table once, then
   relax by table lookup. Structural fact the harness confirms: a single
   Dijkstra integrates each directed edge EXACTLY ONCE (settled-guard ⇒
   one out-edge scan per cell), so for one search precompute cannot win —
   measured: K=1 loses outright (sq16: 1.53 s vs 0.92 s on-demand). The
   win is AMORTIZED across searches sharing the grid — precisely the
   density pool's shape. Measured (900×900, 6 sources): precompute 0.87 s
   (sq16) / 2.89 s (sq32); per-search time drops 0.92 → 0.66 s (sq16,
   −28 %) and 2.34 → 1.20 s (sq32, −49 %) — MORE than the sub-step share,
   because lookup also skips the sweep-passability checks and bilinear
   reads; break-even at ~3 searches; results **bit-identical** to
   on-demand integration (max|Δ| = 0 — same op order), so exactness,
   upper-boundedness and the parity story fully survive. Amortized against
   the sq8 baseline this rewrites the ladder economics for density/KPI
   runs: sq16 at ×1.40 cost for ÷2.19 error → **k ≈ 2.3**; sq32 at ×2.55
   for ÷6.05 → **k ≈ 1.9**. The binding constraint is MEMORY: f64 tables
   are 64 B/cell (sq16) / 192 B/cell (sq32) — 52/156 MB on this crop, but
   ~4.3 GB (sq16 f32) on the 135 M-cell target, so the big DEM would need
   per-slice recompute or overlap with the existing memory budget
   machinery. Single-source runs keep on-demand integration (k ≈ 1 stands
   there).
2. **Slope-adaptive neighborhoods — tried (2026-07-11) and REFUTED on this
   terrain** (`docs/grid-adaptive.mjs`). Design: unit moves everywhere;
   long moves relaxed only when either endpoint's local grade (max |dh|/d
   over the 8 unit neighbors, flag dilated 1 cell) exceeds a threshold. The
   gated edge set nests between sq8 and sq16/32, so results stay valid
   upper bounds — the pointwise nesting E8 ≥ E_ad ≥ E_uniform held with 0
   violations in every run. But the premise ("sloped fraction well under
   half") is FALSE for this deployment: at the grade thresholds that
   preserve accuracy, the steep-cell share is 91–98 % (5 m, σ=10 m
   smoothed) and 96–100 % (30 m) — central São Paulo has essentially no
   flat fraction at ≥ 0.5–1 % grade. Measured Pareto (5 m, 3 sources):
   ad16@1 % = sq16's error at sq16's cost (k 0.99 vs uniform 1.01); at the
   first threshold that prunes meaningfully (4 %, 65 % steep) the error
   grows faster than the time falls (med 4.03 → 5.53 % for −7 % time,
   k 0.69 — WORSE than uniform). Same picture at 30 m. Verdict: the gate
   only pays on landscapes with genuinely large flat fractions — exactly
   where the grid bias is already small — so the option is dominated.
   (This also retracts §9's earlier composition claim of "sq32 accuracy at
   sq16 cost": with (2) dead, (1) alone caps the in-paradigm gain.)
3. **Post-hoc path smoothing (string pulling) — tried (2026-07-11): recovers
   the zigzag, not the route** (`docs/grid-pull.mjs`). Windowed DP over the
   8-grid path's nodes (any pair within 64 nodes joinable by a straight
   segment, profile-integrated costing, masked cells block), iterated over
   the surviving breakpoints so the effective shortcut range grows
   geometrically. On 90 paths (3 sources × 3 rings 1.2/2.0/2.8 km × 16
   headings, 5 m condition): raw path bias vs sq128 med 9.6 % / p90 25.5 %
   → pulled **5.4 % / 16.1 %** — **44 % of the median bias recovered at
   ~60 ms/path**. Iterating adds nothing: the residual is CORRIDOR LOCK-IN
   — the polyline can only visit points of the original path, and the
   route-choice component of the bias (finer headings finding different
   terrain lines) is unrecoverable post hoc. Economics: excellent for the
   displayed route / top-N (60 ms ≪ any field upgrade; result stays an
   upper bound and is its own integrated cost — no viewing≡routing
   conflict); useless for fields; for the K×K accessibility matrix it
   LOSES to a sq16 field per ref row for K ≳ 12 (44 % recovery at
   (K−1)·60 ms vs ~55 % recovery at +0.7 s/row) — so it is a
   route-display tool, not a field fix.
4. **Anisotropic Eikonal — evaluated (2026-07-11): the heading bias
   genuinely vanishes, but a SIGNED interpolation bias replaces it**
   (`docs/grid-eik.mjs`). Implemented a semi-Lagrangian fast-sweeping
   solver: each cell updates from a foot point anywhere on its radius-1
   ring (64 samples, u and h bilinear at the foot ⇒ effectively continuous
   headings); Gauss-Seidel sweeps handle the strong anisotropy
   (β/(aRoll+aAero) ≈ 53) via iteration count instead of causal-ordering
   machinery. Results: on FLAT terrain it nails the analytic answer to
   0.18 % mean / 0.39 % max (vs sq8's 3.9 %) in 2 sweep-groups — heading
   bias eliminated, exactly as theory promises. On real terrain, however,
   it lands BELOW the converged sq128 reference — **−1.3/−1.5 % median at
   5 m; −4 to −12 % at 30 m** (12–17 sweep-groups; 15–22 s at 360 k cells
   vs sq128's 7 s, sq32's ~1 s) — the true continuum is only ~0.2 % below
   sq128, so this is error, and its resolution signature identifies it:
   bilinear foot heights SMOOTH within-cell relief, undercharging climbs —
   the semi-Lagrangian sibling of the naive-long-edge artifact, scaling
   with per-cell relief. Verdict: at the app's resolutions the ladder
   dominates it (sq32: +1.6–2 % guaranteed-sign error at a fraction of the
   cost, vs ±1.4 % signed at 5 m and outright worse at 30 m), and the
   integration blockers are structural — no discrete predecessor tree
   (passes counts), no budget early-exit (sweeps touch the whole grid), no
   bit-parity story (iterative, order-dependent convergence), and the
   upper-bound/floor guarantee is lost in BOTH directions. Scientifically
   validated, practically dominated for this product.

A statistical field deflation is NOT on this list as an accuracy
optimization — §10 measures why (dispersion survives; one-sidedness dies);
it is a reporting-layer option only.

**§9 bottom line after testing all four candidates (2026-07-11):** exactly
one candidate beats k ≈ 1, and only in the density regime: precomputed
long-edge tables (1) give amortized **k ≈ 2.3 (sq16) / 1.9 (sq32)** across
searches sharing the grid, bit-exact, with memory as the binding
constraint — single-source runs stay at k ≈ 1. Slope-adaptivity is dead on
this terrain (2); string pulling is a route-display tool (3); the Eikonal
route trades the heading bias for a signed interpolation bias that is
worse at 30 m and merely sq32-class at 5 m, minus every guarantee the
product relies on (4). The efficient frontier for the app: for
density/KPI runs, sq16 (or sq32) with precomputed long-edge tables —
~×1.4 (×2.6) wall time for ⅔ (5/6) of the bias removed; for single-source
runs, on-demand profile integration at the honest k ≈ 1 deal; string
pulling for the displayed route; §10's threshold-layer correction where a
centered aggregate is preferred over a floor.

## 10. Parametric correction: how far does a shared constant go?

Question (Danilo): can the overestimate be absorbed into the parameters —
e.g. inflate the energy budget, or deflate reported energies by a shared
calibration constant? Measured with `docs/grid-correct.mjs` (sq8 vs sq128
fields, same conditions):

| | 5 m (3 sources) | 30 m (6 sources) |
|---|---|---|
| shared constant c* (mean of per-source median ratios) | 1.115 | 1.090 |
| per-source c spread | 1.074 – 1.184 | 1.053 – 1.150 |
| \|error\| raw, med / p90 / p99 | 9.3 % / 24 % / 48 % | 8.1 % / 18 % / 31 % |
| \|error\| after ÷c*, med / p90 / p99 | **4.1 % / 11 % / 33 %** | **2.6 % / 8 % / 20 %** |
| targets flipped to UNDER-estimates | 63 % | 60 % |
| 2-param fit (+ kJ/m hilliness covariate), R² | 0.16 | 0.20 |
| \|error\| after 2-param, med / p90 / p99 | 4.6 % / 11 % / 25 % | 2.7 % / 7 % / 17 % |
| reach-matching budget inflation c_b (range across sources/budgets) | 1.06 – 1.22 | 1.05 – 1.15 |

Findings:

- **A shared constant removes the center, and only the center**: median
  |error| halves-to-thirds, but the p90 tail stays ~8–11 % and extreme
  corridors 20–33 % — the bias is route-structured (which slopes a pair's
  optimal path crosses), and a scalar cannot see that. The obvious
  covariate (energy per metre = hilliness+detour proxy) explains only
  R² ≈ 0.16–0.20 and buys ~nothing at the median: there is no cheap
  2-parameter fix either.
- **The constant is not universal.** It shifts with resolution (1.115 vs
  1.090), varies ±5 pp across source neighborhoods within ONE city crop,
  and will move with the cost bundle (it scales with climb-dominance) and
  geography. "Shared" must mean *calibrated per DEM + parameter set*, not
  a hard-coded number. A cheap in-app calibration exists: run 2–3 refs at
  sq32-profile in the background (~3 s each at 810 k cells) and take
  c ≈ med(E8/E32)·1.02 — the same machinery as this harness.
- **The correction has a real price: one-sidedness.** Raw grid energies
  are guaranteed upper bounds (KPIs are floors); after ÷c* ~60 % of pairs
  become underestimates with ±4 % (med) / ±10 % (p90) pair-level noise.
  For population-aggregated KPIs the pair noise largely averages out — the
  aggregate becomes approximately centered instead of conservative — but
  any "≥ threshold" claim loses its floor semantics.
- **Where it belongs if adopted**: at the threshold/budget layer (inflate
  eMax and the KPI thresholds E₁/E₂ by c — equivalent to deflating
  energies, but keeps a single energy number everywhere, consistent with
  the "viewing energy ≡ routing energy" product rule; a second corrected
  per-cell energy is explicitly NOT allowed by that rule). Honest labeling:
  "grid-corrected estimate (centered)" vs the default "grid-native floor".

## 11. Pre-registered predictions for a 16-move engine (if built)

To be checked by re-running this harness's acceptance criteria against the
real engine: (a) field-median energy drops 5–8 % on the 5 m DTM, 3–5 % at
30 m; (b) budget-reach area grows 9–11 % (5 m); (c) density-run wall time
grows ≤ 3×; (d) passes corridors sharpen along contour lines (visual);
(e) bit-parity JS↔Rust preserved including the profile sub-sampling order.

## 12. Outcome — shipped in v57 (2026-07-12)

All three actionable findings shipped as user options (feature commit
`1ba06ae`, release `19ec3b1`):

- **Move directions** (`#n-dirs`, 4–128, default 8): `buildMoves()` in
  `energy-worker.js` implements the Farey ladder with profile-integrated
  long moves; density runs amortize per-worker long-edge tables (§9.1's
  winner); passes are stamped over swept cells. nDirs ≠ 8 is browser-only —
  the Rust backend keeps the classic 8-move engine, so the parity
  invariant is untouched (the nDirs = 8 default is bit-identical, suite-
  and backend-parity-verified).
- **String pulling** (`#string-pull`): §9.3's route-display tool, applied
  worker-side to the single path and top-N (round/maximize excluded).
- **Grid correction** (`#kpi-corr`): §10's threshold-layer correction with
  the explicit floor-guarantee warning.

**§11 pre-registration scorecard** (validated against the REAL shipped
worker on the 900×900 5 m crop, 3 sources, 2026-07-12):

| prediction | measured | verdict |
|---|---|---|
| (a) field-median energy drop 5–8 % | 3.9 / 8.7 / 4.6 % per source | **borderline** — the band was drawn from the 4-source pooled median and is too narrow for real per-source terrain spread |
| (b) budget-reach gain 9–11 % | 3.1 / 9.4 / 3.3 % per source | **miscalibrated** — reach gain is strongly source-dependent; one of three in band |
| (c) wall time ≤ 3× | ×2.49 (single-source, on-demand) | **confirmed** |
| (d) corridors sharpen along contours | not formally tested (visual) | open |
| (e) JS↔Rust bit-parity preserved | N/A by design — nDirs ≠ 8 never reaches the backend; the 8-default parity is test-asserted | resolved differently than predicted |

Honest reading: the engine behaves as the harness said it would (the
harness IS bit-validated against it), but the pre-registered BANDS were
overconfident about per-source variance — a lesson for future entries:
pre-register distributions, not point ranges.

## 13. Reproduction

```sh
cd docs
curl -O https://simujaules.pedalhidrografi.co/dem/sampa_centro.tif   # 34 MB
(cd ../census && npm install)                                        # geotiff
node grid-sens.mjs --sources 4 --crop 500,1200,900,900               # 5 m ladder (~3 min)
node grid-sens.mjs --sources 6 --crop 500,1200,1500,1500 --decimate 6  # 30 m (~1 min)
node grid-sens.mjs --sources 2 --crop 700,1300,700,700 --flat        # flat control
node grid-correct.mjs --sources 3 --crop 500,1200,900,900            # §10, 5 m (~2 min)
node grid-correct.mjs --sources 6 --crop 500,1200,1500,1500 --decimate 6  # §10, 30 m
node grid-adaptive.mjs --sources 3 --crop 500,1200,900,900           # §9.2, 5 m (~2 min)
node grid-adaptive.mjs --sources 6 --crop 500,1200,1500,1500 --decimate 6 # §9.2, 30 m
node grid-pull.mjs --sources 3 --crop 500,1200,900,900               # §9.3 string pulling
node grid-eik.mjs --sources 1 --crop 800,1400,400,400 --flatcheck    # §9.4 flat validation
node grid-eik.mjs --sources 2 --crop 700,1300,600,600                # §9.4, 5 m
node grid-eik.mjs --sources 3 --crop 500,1200,1500,1500 --decimate 6 # §9.4, 30 m
node grid-longedge.mjs --sources 8 --crop 500,1200,900,900           # §9.1 long-edge tables
```

Every run self-validates its 8-move engine bit-identical against
`energy-worker.js` before reporting. Nothing here ships (`deploy.sh` stages
an explicit file list; `docs/` never deploys).
