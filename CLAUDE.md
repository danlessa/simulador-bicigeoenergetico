# Simujaules (sampasimu)

Static, build-step-free PWA that computes asymmetric-cost cycling energy
fields over DEMs (Dijkstra variants on an 8-connected grid), plus an
optional native Rust backend. No package.json, no bundler — `index.html`
loads `app.js` directly and libraries come from CDNs with SRI hashes.

> **Name:** the app is **Simujaules** — a deliberate, affective typo of
> *joules* ("simu" + "jaules"), NOT a misspelling of "simujoules". Do not
> "correct" it. The public site lives at `simujaules.pedalhidrografi.co`. Only
> the **branding / hostnames** use this spelling; internal code identifiers and
> the legacy `simujoules.jsonld` vocab filename keep the old spelling so
> exported bundles keep resolving.

## Layout

- `app.js` — all UI: DEM/GeoPackage loading, Leaflet map, compute dispatch,
  rendering, i18n (PT/EN `STRINGS` table + `t()`), bundle export/import.
- `energy-worker.js` — the compute engine (Web Worker): Dijkstra with
  passes count, A* top-N routes, multi-ref density, layered-DP max-cost
  path, IDW network fill. Pure JS on typed arrays.
- `backend/` — optional native compute server (Rust + rayon, see its
  README). OFF by default; the app's compute-source radiogroup (Browser /
  Localhost / Cloud — a top-level compute option, always visible, NOT inside
  the density panel) selects it, and falls back to browser workers on any
  failure. Two endpoints: `POST /density`
  (multi-reference density) and `POST /single` (single-source from/to/round
  energy field + optional passes). Top-N / destination path / maximize stay
  browser-only — the backend produces no routes.
- `sw.js` — service worker (precache + runtime cache). `index.html`,
  `manifest.webmanifest`, `icons/` are the PWA shell.
- `deploy.sh` — stages and rsyncs to `gs://simujaules`, served at
  `simujaules.pedalhidrografi.co` behind Cloudflare (cache invalidation is a
  CF purge, not a Cloud CDN invalidation). Only explicitly listed files ship;
  backend/ and tests never deploy.
- `test-worker-pool.mjs` — run with `node`; self-contained worker
  regression test (invariants + pooled-density ≡ single-run equivalence).
- `backend/test-backend.mjs` — starts the release binary and compares its
  output against `energy-worker.js`.

## Compute architecture

- Regular runs (from/to/round, top-N, maximize): ONE worker per compute.
- Multi-reference density: a POOL of workers sized by the shared
  `densityPoolSize()` helper — `min(K, cores−1, memCap)`, where memCap
  budgets each worker (~38 B/cell, ~55 round) against `navigator.deviceMemory`
  (the spec caps it at 8 GB). A `#max-workers` input overrides this (clamped
  by K) for users on big-RAM machines deviceMemory can't see. Each worker
  gets `densityPartial: true` and returns raw accumulators (density,
  energySum, energyCount) that `app.js` merges and normalises. On a 135 M-cell
  DEM this is 1 worker (two won't fit 16 GB) — the honest ceiling. The
  optional network IDW fill runs AFTER the merge as a separate
  `kind: "interp"` worker message — never per-slice.
- `densityPoolSize()` is shared by the runner AND `estimateRunTime()` — they
  must not drift.
- `estimateRunTime()` is calibrated per-DEM: `startCalibrationProbe()` runs a
  `kind: "probe"` worker at DEM load. The probe does PROBE_REFS spread-ref
  searches CAPPED by settled-cell count (`maxSettled`), NOT by energy budget —
  this bounds the probe to ≤~1.5 s on any DEM (responsiveness target) AND
  anchors at an UNSATURATED point (`Estar` cells at budget `bStar`,
  `perRefProbe` ms). Anchoring unsaturated is load-bearing: the old fixed-budget
  probe saturated small DEMs (E0=N) and under-estimated up to 3.8×. The estimate
  scales from the anchor: `explored = min(N, Estar·(eMax·αprobe/(bStar·α))^EXPLORE_EXP)`,
  `perRef = perRefProbe·(explored/Estar)^RATE_EXP`, then ÷ pool size (browser)
  or the backend slice model. `predictComputeMs()` is the single predictor
  shared by the live estimate AND the online correction (must not drift).
  Probe is generation-guarded (`state.calibrationGen`, bumped per DEM load) and
  skipped while a compute runs.
- The backend estimate must replicate the backend's MEMORY-bounded slice cap
  (`min(refs, cores, mem_budget/per_slice)`, per_slice = 37·N or 55·N round),
  NOT `min(refs, cores)` — on a huge DEM only 1-2 slices fit, so assuming
  cores-many parallelism under-estimates ~3-8×. `/health` reports
  `mem_budget_bytes` for this; `BACKEND_BYTES_PER_CELL{,_ROUND}` mirror
  `backend/src/main.rs`'s `per_slice` (keep in sync). `NATIVE_SPEEDUP` is a
  nominal constant (native vs JS converge toward bandwidth-bound on huge
  frontiers); the per-engine online correction (`corrBrowser`/`corrBackend`,
  EMA of actual/predicted from completed computes, snapshotted in
  `state.lastRun` at run start and applied in `computeDone`) absorbs the
  residual scale/server-dependence — that's what guarantees ±20% in steady
  state. `maxSettled` in `densityField` is probe-only (0 = normal path,
  zero-cost) — don't let it leak into a real run's cost.
- Every run captures `state.computeGen`; `cancelActiveCompute()` bumps it
  and terminates `state.workers`. It must be called before anything that
  changes the grid a result renders against (DEM load, network load/clear).
  Worker callbacks drop messages whose generation doesn't match.

## Invariants — easy to break, hard to notice

- `backend/src/main.rs` is a PORT of `energy-worker.js` `dijkstra()`
  (cost model, f32 energy storage, settled-flag handling, passes
  accumulation, density normalisation). `compute_density` mirrors the JS
  density path; `compute_single` (the `/single` endpoint) mirrors the JS
  worker's from/to/round single-source branch (raw energy, NOT averaged;
  optional passes; round = fwd+bwd sum with the budget mask + endpoint-filtered
  passes). Any change to one must land in the other; `node backend/test-backend.mjs`
  enforces energy bit-parity (`+single` cases cover the single-source path).
  Backend passes may differ from JS only on EXACT f64 cost ties (radix heap
  vs binary heap tie order) — both trees are valid optima.
- BRIDGE PORTAL EDGES (OSM bridges/tunnels, group 1d) are relaxed ALONGSIDE
  the 8-connected grid edges in `dijkstra`, `densityField` and the Rust
  `dijkstra_tree`: a directed shortcut between a bridge's two abutment cells at
  the flat-deck cost (`alpha*deckLenM + beta*dh`, downhill-clamped; `reverse`
  uses the opposite direction's cost). The cells UNDER a deck are never
  touched, so over- and under-bridge routes coexist on the 2.5-D grid. Portal
  costs are derived from the same shared inputs (deck length, endpoint heights
  widened f32→f64, params) in JS (`buildPortalAdj`) and Rust (`build_portals`),
  so they stay bit-parity — `test-backend.mjs` has `+portals` cases. Per-cell
  portal iteration order (JS Map vs Rust HashMap) must match insertion order so
  exact-tie passes agree. App-side, `buildPortals()` packs `state.bridges` into
  portalU/V/lenM, threaded via `baseMsg` (CLONED, never transferred — shared
  across the density pool) and appended to the backend Blob (`nPortals`). A*
  top-N, the max-cost DP path, AND maximize mode do NOT use portals (admissible
  heuristic; and a long deck cost would invert against the single-grid-edge
  `maxEdgeCost` to a clamped-0 free shortcut). The OSM bridge pull is refused on
  a projected DEM (`isGeographic` guard) — lon/lat would map to garbage cells.
- GRAPH MODE bridges are SEPARATE from the raster portals: graph mode is
  portal-blind. Instead, the OSM streets pull captures per-way `{deck, layer}`
  into `state.networkLinesMeta` (parallel to `networkLines`, null for .gpkg),
  threaded into `graphBuild` as `opts.lineMeta`. `graph-engine.js` then (a)
  suppresses a crossing junction when a deck crosses a way at a different
  `layer` (overpass), and (b) flattens deck edges' profiles to a straight line
  between the line's ground-endpoint elevations (arc-length interpolated). So
  `state.bridges` (the 1d pull) must NOT invalidate the cached graph, and
  `state.bridgesToken` is NOT in `computeNetworkGraphToken`.
- The backend bounds concurrent rayon slices by a memory budget
  (auto-detected, or `SIMU_MAX_MEM_GB` / `--max-mem-gb` / `RAYON_NUM_THREADS`)
  so high ref counts on huge DEMs don't OOM — fewer slices just run more refs
  serially (output identical). Its `Scratch.passes` is f32 for DENSITY only
  (parity-safe: it matches the JS `densityField`'s Float32 passes, and exact
  integers widen to the f64 `Acc`); do NOT make `Acc` f32 (breaks the
  `maxD < 1e-15` parity test). `/single` passes are accumulated in f64
  (`subtree_passes_f64`) and shipped as f64 on the wire — the JS single-source
  branch returns Float64Array (counts exceed 2^24 on big DEMs); `/density`'s
  wire format is unchanged.
- The ACCESSIBILITY MATRIX (pairwise ref↔ref energies powering the "3B.
  Acessibilidade" KPIs) is a `/density`-parity surface: `densityField`'s
  optional `refCells` sampling (JS) and `compute_density`'s `want_matrix`
  (Rust) must stay bit-parity — matrix entries are raw per-ref f32 energy
  samples with no cross-slice accumulation, so `test-backend.mjs`'s `+matrix`
  cases assert `maxΔ === 0`. Rows are keyed by the ORIGINAL ref index on both
  engines (a skipped off-grid/off-mask ref keeps an all-Infinity row; Rust
  carries `orig_k` through its compacted ref filter — the `+droppedRef` cases
  pin this). Round entries reuse the exact `accumulate_round` predicate +
  f32 rounding. NEVER pass `refCells` on the probe path (`maxSettled`
  truncation would record non-optimal finite energies) or under maximize
  (both engines must omit the matrix — test-asserted). App-side, the cached
  matrix lives in `state.kpi` (NOT `state.lastResult` — style re-renders must
  not touch it), is invalidated by `kpiInvalidate()` on any ref/grid/network
  change, and KPI threshold edits re-evaluate the cache only — they must
  never trigger a recompute. KPIs are exact only for thresholds ≤ the run's
  `eMax` (0 = ∞); beyond that the matrix is budget-truncated and the UI
  warns "lower bound". `state.refPopM` (census in-extent population, set ONLY
  by `placeCensusRefPoints` after its placement loop) is the M behind
  "K people" thresholds; every ref-set mutation nulls it.
- MOVE DIRECTIONS (`#n-dirs`, 4–128, default 8) generalize both engines'
  neighborhoods via the Farey ladder (`buildMoves`). Invariants: (a) the
  first 8 moves of every set ≥ 8 are the CLASSIC 8 in the CLASSIC order —
  nDirs=8 must stay bit-identical to the historical engine (the Rust-parity
  anchor); (b) since backend 0.2.0 the Rust port serves nDirs ≠ 8 too, in
  BIT-PARITY — this required V8-exact `js_hypot`/`js_round` mirrors in
  main.rs (libm's hypot differs by 1 ulp and breaks passes parity; never
  swap them for the std functions). app.js VERSION-GATES nDirs ≠ 8 dispatch
  on /health version ≥ 0.2.0: an older binary silently IGNORES the `nDirs`
  params field (serde skips unknown keys) and would return a mislabeled
  8-direction field. Rust builds the long-edge tables ONCE per request,
  shared read-only across rayon slices (per-worker in JS); per_slice grows
  37→38 (55→57 round) via parent_long and the shared tables
  ((nDirs−8)·8 B/cell·revs) come off the budget before the slice division —
  `predictComputeMs`'s backend branch mirrors this math;
  (c) long moves are PROFILE-INTEGRATED (`longEdgeCost`: bilinear heights
  every ~1 cell, v2Edge per sub-step, mask-blocked) — NEVER cost a long
  move from its endpoints' Δh alone, that flattens the relief it crosses
  and flips the error sign (measured, research note §5.3); (d)
  `densityField` precomputes per-direction long-edge TABLES when a slice
  has ≥ 3 refs (amortized win; K=1 loses) — tables must stay bit-identical
  to on-demand integration (same op order; test-asserted), and their memory
  (8 B/cell per long move per direction) is budgeted by `densityPoolSize`'s
  nDirs argument (runner + estimator share it — must not drift, same rule
  as always); (e) passes are STAMPED over the swept cells of used long
  edges (`stampLongPasses`, settled-only, flows read pre-stamp) so
  corridors stay continuous — portals never stamp (a deck deliberately
  skips the cells under it); (f) maximize, the calibration probe, A* top-N
  and the layered DP always run the classic 8 (inversion degeneracy /
  anchor stability / admissible-heuristic scope); the estimator scales by
  `DIRS_COST_SINGLE`/`DIRS_COST_DENSITY`.
- STRING PULLING (`#string-pull`) post-hoc shortens the displayed route(s)
  (single path + top-N; round and maximize excluded) by windowed DP over
  the path's own nodes with profile-integrated straight segments. Viewing ≡
  routing holds by construction: the energy shown for a pulled line is that
  polyline's own per-sub-step v2Edge sum, and the drawn line IS the
  polyline (kept nodes joined straight). Mask-blocked segments make it
  self-limiting under a network constraint. It never worsens (only accepted
  when strictly cheaper) and cannot change fields — display layer only.
- The KPI GRID CORRECTION (`#kpi-corr`, default 1.00 = off) inflates the
  two accessibility thresholds by c before counting (≡ deflating the
  8-grid's overestimated energies, research note §10). It lives at the
  KPI/threshold layer ONLY — never add a corrected per-cell energy number
  (viewing ≡ routing forbids it). c > 1 surfaces the "centered estimate —
  floor guarantee lost" warning; the measured c* is ~1.09–1.12 on the SP
  DTM and is DEM/parameter-specific, and the correction is pointless when
  the run used ≥ 16 move directions.
- Multi-reference density does NOT go through `dijkstra()`: it uses the
  dedicated `densityField()` engine (one reused scratch set, targeted
  reset/accumulate over only the explored cells, and an exact monotone
  RADIX heap matching the backend's). It is the perf-critical path on
  huge DEMs — keep its cost model identical to `dijkstra()`. Its radix
  heap shares the backend's exact-except-on-f64-ties behaviour, so density
  passes match the backend (not the binary-heap single-point modes) on
  ties. The from/to single-point modes still use `dijkstra()` (binary
  heap); only density was switched. `densityField`'s `density` and `passes`
  are Float32 (memory), but `energySum` stays Float64 (energy is a large
  summed value — f32 there diverges ~1e-3 between pooled/single and breaks
  the energy tolerance); the `app.js` pool merge accumulators stay Float64.
- In the worker, `E` is Float32Array but heap priorities are f64: the
  `settled` byte array (not `g > E[idx]`) filters stale heap entries, and
  settled neighbours are never relaxed. Both guards exist because of the
  f32/f64 precision mismatch — removing either corrupts passes counts.
- `sw.js`: bump `VERSION` (with a changelog line) on every deploy that
  changes app behaviour; keep `PRECACHE_URLS` in sync with what
  `index.html`/`deploy.sh` actually reference — `cache.addAll` is atomic,
  one 404 blocks the SW install for every user.
- The changelog lives in THREE places that must move together with every
  release: `CHANGELOG.md`, the collapsed `<details id="changelog">` in the
  help modal (`index.html`), and the `sw.js` version-history comment.
  Update all three whenever you ship user-visible changes — don't let
  them drift.
- Every version bump (a new `VERSION` + the changelog trio) ships as its own
  git commit — always commit when pushing a new version. Author the release
  commit as Claude (the assistant) and credit the user as a contributor, e.g.
  `git commit --author="Claude <noreply@anthropic.com>"` with a trailer
  `Co-Authored-By: Danilo Lessa Bernardineli <danilo.lessa@gmail.com>`.
- CDN `<script>` tags in `index.html` carry SRI `integrity` +
  `crossorigin="anonymous"`. The crossorigin attribute is ALSO what makes
  responses non-opaque so `sw.js` can runtime-cache them for offline use —
  pin new lib versions with a fresh sha384 hash, don't drop the attributes.
- User-derived strings (error messages, bundle metadata) must go through
  `escapeHtml()` before any `status.innerHTML` interpolation.
- UI text goes through the `STRINGS` table / `data-i18n`; never hardcode
  display text in JS (it clobbers the PT translation).
- **Viewing energy ≡ routing energy, by construction** (product requirement,
  `docs/energy-journal-2026-07-06-workorder.md`): never add a second
  "estimated energy" number for a routed path/cell — whatever is shown IS the
  per-edge sum the search optimized. `v2Edge`'s trailing `max(0, e)` descent
  clamp is provably unreachable (journal Entry 18: 1.78 M-combo sweep, global
  min pre-clamp +4.1e-4 kJ; confirmed on real data, min pre-clamp descent
  edge +4.6 J across 1 402 rides) — there is nothing to reconcile between
  "viewed" and "routed" energy, so don't build a reconciliation mechanism.
- **Edge costs stay O(1)-local** (product requirement): no path-history-
  dependent term may ever enter `dijkstra()`/`densityField()`/`graph-engine.js`
  `stepCost`/`backend/src/main.rs` — this is why the descent clamp above
  can't just be removed via a global reweighting; any such change must
  re-run `verify_v2edge_clamp.mjs`-style proof against the new formula.
- **v2 model is tuned for ~30 m DEM sampling**, not 5 m. On the deployed
  IGC-SP 5 m DTM, `v2Edge`'s grade-local ε collapses on steep local grades and
  reads conservatively HIGH vs ∫P·dt (journal Entry 19: measured ~+9% median
  bias on real São Paulo rides at 5 m vs ~+6% at 30 m). Since v55 the
  mitigation SHIPS as app-side preprocessing (journal Entry 20's validated
  config): `smoothHeightsInPlace()` — sequential per-axis mask-normalized
  Gaussian, in place at DEM load — driven by the `#dem-smooth` knob ("auto"
  = σ 10 m when min pixel ≤ 10 m; skips coarse sources AND already-smoothed
  re-imports via the exported dem.tif's `ImageDescription` tag). It runs
  BEFORE heights ship to the engines, so JS/graph/Rust bit-parity is
  untouched — never move smoothing INTO an engine (path-history state,
  forbidden above). `test-dem-smoothing.mjs` holds the byte-identical mirror
  and reference tests (hand-kept-in-sync); Entry 20's σ is only valid for THIS
  transform — don't swap in a plain blur or change σ/the auto rule without
  re-running the journal validation. Accuracy itself is carried by per-rider
  calibration (CdA/Crr/k_s fitted on the rider's own rides — Entry 20:
  validated med|Δ%| 3.7/2.7/4.9 with bias < ±1% on three independent riders,
  meeting the ±5%/±2% product goal); smoothing alone does NOT rescue
  uncalibrated fine-DEM accuracy.
- **GRAVITY IS LOCAL, and it is hand-copied.** `G_SP = 9.7864`
  m/s² (São Paulo, IAG-USP absolute gravimetry) — NOT the textbook 9.81, which
  is ≈0.24% high here. Re-baselined in v63 to re-sync with
  `bicycling-energy-model` (its journal Entry 27), which moved first; while the
  two disagreed, the sibling applet's `v2Edge` readout differed from this app's
  by exactly the gravity ratio. The constant lives in `app.js`'s `readCost`
  chain (the origin, with the long note) and is hand-copied into
  `census/census-density.mjs`, `test-energy-v2.mjs` and every
  `docs/grid-*.mjs` harness — the `readCost` mirror chain. **Grep `9.7864`
  and change every hit together**; a mirror at a different gravity silently
  computes different physics than the app (the sibling repo hit exactly that,
  running two gravities inside one computation). `backend/src/main.rs` needs NO
  copy and never will: it receives the derived `{aRoll, aAero, beta, abRatio,
  …}` bundle over the wire, so **JS↔Rust bit-parity is gravity-blind** — which
  also means `test-backend.mjs` (synthetic bundle, `aRoll: 1, beta: 30`) does
  NOT exercise this constant. What pins it is `test-energy-v2.mjs`'s
  `beta ≈ m·g/keff` assertion, written in terms of `G` so it tracks
  automatically. Dated research notes keep the numbers they were published
  with (see the gravity note in `docs/grid-connectivity-sensitivity-2026-07-11.md`).
- **FABDEM is unsuitable for energy computations on flat/urban terrain**:
  its per-pixel noise inflates h₊ by +57% median (up to +135% on flat
  corpora) vs the validated local IGC survey, and `v2Edge` amplifies it
  (journal Entry 19). Do not substitute FABDEM for energy work without
  accounting for this wherever the app's FABDEM loader is documented/used.

## Testing & verification

```sh
node test-worker-pool.mjs                  # worker regression suite
node test-energy-v2.mjs                    # v2 closed form + refEnergyKJ/epsGeom mirrors
node test-dem-smoothing.mjs                # DEM pre-smoothing transform (mirrors app.js)
node test-graph-engine.mjs                 # vector-network graph engine
node test-water-raster.mjs                 # OSM water-mask rasterisation (areas/sea/rivers)
node census/test-census-sampler.mjs        # in-browser census sampler helpers (mirrors app.js)
node census/test-census-density.mjs        # census density harness end-to-end (needs npm install in census/)
cd backend && cargo build --release && node test-backend.mjs
```

`census/test-census-sampler.mjs` holds PURE MIRRORS of `app.js`'s census-sampling
helpers (`pointInPolygon`, `ringArea`/`polyArea`, `clipRingToBbox`/`clippedPolyArea`,
`sobolScalar1D`) — same hand-kept-in-sync rule as below. It checks population
weighting, in-polygon placement, and the clip-area ratio. The cloud `.fgb`
(`census/build_fgb.py` → GCS) is built/uploaded out-of-band, never shipped.

`test-water-raster.mjs` holds PURE MIRRORS of `app.js`'s OSM water-mask helpers
(`fillRingsEvenOdd`, `rasterPolylineSupercover`, `assembleRings`,
`fillSeaFromCoastlines`) — `app.js` is a browser module and can't be imported in
node, so the copies must be kept in sync (like `backend/main.rs` mirrors
`energy-worker.js`). The SEA fill is the load-bearing case: OSM gives only
`natural=coastline` lines (land-left/water-right), filled by a horizontal+vertical
orientation SWEEP (sea/land set per span, never flood-filled — coastline gaps
would otherwise leak the sea into all land).

`docs/grid-*.mjs` are ANALYSIS harnesses, not tests (they need the
`sampa_centro.tif` download + `census/node_modules`): they reproduce
`docs/grid-connectivity-sensitivity-2026-07-11.md` — the research note
behind the v57 move-directions/string-pulling/grid-correction options —
and each self-validates its 8-move engine bit-identical against
`energy-worker.js` before reporting, so they double as an independent
cross-check when touching the engines.

There is no CI; run them before committing engine changes. Style knob
changes (colormap, ranges, gamma, blend) re-render cached arrays and must
never trigger a recompute.
