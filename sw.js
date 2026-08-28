// Service worker for the Simujoules PWA.
//
// Caching strategy:
//   PRECACHE — same-origin app shell, installed atomically. Bumping the
//              VERSION constant invalidates this on next activate.
//   RUNTIME  — opportunistic cache for same-origin/CORS runtime fetches:
//              CDN libs (Leaflet, GeoTIFF, JSZip, proj4, sql.js), fonts,
//              small data files. Populated on first network success;
//              cache-first thereafter with a quiet background revalidation
//              so updates land on the second load.
//
// What we *don't* cache (deliberately):
//   - Basemap/overlay tile images — tile layers load without crossorigin, so
//     their responses are opaque and refused by the non-2xx guard in handle().
//   - Large data files: DEM rasters (.tif/.tiff) and GeoPackages (.gpkg) are
//     exempted from the fetch handler entirely (network/HTTP cache only), and
//     anything over MAX_RUNTIME_BYTES is skipped as a belt-and-braces cap.
//     The user picks a fresh DEM, the worker sees a bare-metal fetch, no
//     storage hit.
//   - Anything that isn't a GET. POST/PUT/DELETE are passed through.
//
// To force an update during dev, bump VERSION and reload — `activate` purges
// every cache that doesn't match. deploy.sh sets no-cache on this file so
// browsers actually fetch the new version instead of staling out.

// Bump on every deploy that ships meaningful behavioural changes to the
// app shell — the activate handler purges any cache whose name doesn't
// match these two, so an old cached app.js / index.html / wasm /
// geotiff CDN URL is replaced on the user's next visit instead of
// lingering until manual reload.
//   v1 → v2: GeoTIFF library upgrade (3.0.5), bundle outputs as .tif,
//            mobile drawer, sidebar tightening.
//   v2 → v3: PT/EN i18n toggle, FABDEM viewport loader,
//            astar mask-relaxation fix.
//   v3 → v4: Locate-me button, hamburger to bottom-left on mobile,
//            DEM relief (cmocean.phase + slope multiply) layer.
//   v4 → v5: Relief OOM fix on huge DEMs — reservoir-sampled
//            percentiles, stride-downsampled canvas, drop slope array
//            after render. Locate button uses panTo (no zoom change).
//   v5 → v6: Same OOM fix in renderFieldToDataURL (energy/passes),
//            drawer-toggle z-index fix so close-via-hamburger works,
//            skip relief render on non-geographic DEMs, harden
//            localStorage access for iOS private-browsing.
//   v6 → v7: Wasm support removed entirely — energy-worker-wasm.js and
//            wasm/pkg/* dropped from precache.
//   v7 → v8: Reverse-optimisation toggle (maximize energy) in the
//            Parameters group; worker now accepts a maximize flag and
//            inverts edge costs against a precomputed MAX_EDGE_COST.
//   v8 → v9: Length-constrained max-cost path via layered DP (L > 0
//            input under the Maximize toggle).
//   v9 → v10: Surface DP failures (unreachable, memory cap) to the UI
//             via a "warning" message instead of silently console.warn.
//   v10 → v11: Fix layered-DP backtrack sign error (was reading the
//              direction array but subtracting the offset, sending the
//              walk the wrong way → spurious "backtrack_fail"). Fix
//              ReferenceError on autoMax/passesMax in renderResult.
//   v11 → v12: Density worker pool + Dijkstra heap optimisations;
//              manifest link fixed (index.html pointed at a manifest.json
//              that never existed); CDN libs get SRI + crossorigin (which
//              also makes them runtime-cacheable here — no-cors responses
//              were opaque and never cached, so offline mode lacked the
//              libraries); maskable icons precached; synchronous
//              res.clone() before the body can be consumed. QMC
//              (Sobol/Halton) sampling option for "Place random" refs.
//              Round-trip budget mode: eMax can cap each leg (old
//              behaviour, default) or the round-trip total. Round-mode
//              passes are filtered: only displayed (feasible/in-budget)
//              destinations count as trajectory endpoints. "Energy color"
//              passes blend (hue from energy field, alpha from passes).
//              Optional vector-network rendering (black lines, adjustable
//              ground width + opacity; deterministic layer stacking via
//              dedicated panes, user-reorderable in a modal) and
//              constrain-to-network toggle. Basemap selector (OSM, Carto
//              minimal, solid colours). Rendered-image export (PNG +
//              world files). Changelog in the help modal +
//              CHANGELOG.md (see CLAUDE.md: keep all three in sync).
//              Fix bundle-before-DEM order: pending bundle re-applied on
//              matching DEM load instead of being wiped. Density+network
//              Compute no longer aborts silently (null-src re-snap bug);
//              random refs snap to the network. OSM (Overpass) network
//              pull; constrained-vs-unconstrained compare + difference
//              fields (energy diff interpolated; passes overlaid red/
//              green additively with per-channel min/max/gamma/filter,
//              also in density mode); interp
//              prefilter + pooled banding (bit-identical, ~4x clustered,
//              xcores everywhere); backend liveness ticker, hard-fail
//              after response; budget- and engine-aware compute-time
//              estimate (per-DEM calibration probe at load);
//              density engine rewritten (reused scratch +
//              targeted reset + radix heap) — in-browser density now within
//              ~20% of the native backend on huge DEMs;
//              density workers leaner (f32) + deviceMemory-budgeted pool +
//              opt-in max-workers override; backend caps rayon slices to a
//              memory budget (SIMU_MAX_MEM_GB) so it no longer OOMs at scale;
//              zero-copy parse, interp progress. Network snap is
//              grid-wide (radius input = quiet zone, no rejection dead
//              end); .gpkg geom column from metadata; 0-cell networks
//              rejected with a clear error. SEO/LLM metadata
//              (description, canonical, OG, JSON-LD, llms.txt, sitemap).
//   v12 → v13: "Follow the vectors" network-graph mode (new graph-engine.js,
//              now precached): routes on the real polyline graph (planarised,
//              both junction modes) instead of the rasterised mask — passes
//              trace the vectors, rendered as a colored-vector overlay. All
//              compute modes; JS-only (Rust backend untouched). Bumped so the
//              new worker (graphBuild/graphRun) + graph-engine.js actually
//              install — a v12 cache would serve the pre-graph worker.
//   v13 → v14: Compute-time estimate accuracy fix. The v12 estimate could be
//              ~3× low (backend density on a huge DEM): it assumed all cores
//              parallelise, ignoring the server's memory-bounded slice cap
//              (1-2 slices fit, not cores-many), and used a too-low native
//              speedup. The calibration probe is now cell-capped (≤~1.5 s on
//              any DEM, anchored unsaturated — fixes a separate up-to-3.8×
//              error on small DEMs), the backend estimate replicates the slice
//              cap (/health now reports mem_budget_bytes), and an online
//              correction learns actual/predicted per engine. Bumped so the
//              new probe protocol (maxSettled) + estimate worker install.
//   v14 → v15: Bundle reload restores ALL saved layers, not just the energy/
//              passes rasters. The top-N routes and the maximize path were
//              exported to the zip (routes.geojson / path.geojson) but the
//              loader never read them back — reload redrew the fields and told
//              you to recompute the lines. Now the GeoJSON is parsed and its
//              coords are converted back to cell indices (exact inverse of the
//              export mapping, gated on a strict DEM-dimension match), so the
//              routes/path render and recolor identically to a fresh compute,
//              with no recompute. Bumped so the updated app.js installs.
//   v15 → v16: Time estimate now correct for network/graph runs. Graph mode
//              ("follow the vectors") was estimated with the raster model
//              (~1000× too high — a graph Dijkstra is ∝ edges, not 135 M
//              cells); it now uses a graph-size model. The IDW interpolation
//              fill is a separate, often-dominant phase (scales with N and the
//              max ray distance — previously ignored). Compute and interp are
//              corrected independently (a slow interp no longer inflates the
//              compute estimate), and toggling interp / graph / constrain now
//              moves the number. Bumped so the updated app.js installs.
//   v16 → v17: UI/accessibility pass. The "Load DEM" and "vector network"
//              groups light up (accent border + bar) once their data is
//              loaded. Parameter/visualization choices now persist across
//              reloads (localStorage). The clear-points / place-random /
//              clear-refs buttons are clustered together (clear-points on
//              top); only the src/dst picker fades in density mode now, not
//              the whole group. Sidebar hint paragraphs were removed and
//              their content migrated into the Help modal (which now also
//              documents maximize, OSM pull, the native backend, worker
//              sizing, QMC sampling, etc.). Accessibility: #status is an
//              aria-live region, field labels are programmatically
//              associated with their inputs, opacity sliders got aria-labels,
//              a global :focus-visible ring was added, and the example DEM
//              loaders are now <button>s instead of <a href="#">. Bumped so
//              the updated app.js / index.html install.
//   v17 → v18: Optional impassable mask (group 1c). Upload a binary GeoTIFF
//              (1=impassable, e.g. water); it's resampled onto the DEM grid by
//              area-coverage majority (≥50% ⇒ blocked) and blocks routing. The
//              vector network can carve passable "bridge" corridors across it,
//              with a smooth elevation offset (linear ramp from each shore to a
//              +/- peak at the bridge centre, clamped −5…+15 m). Composed
//              app-side in buildComputeGrid() — energy-worker.js and the Rust
//              backend are unchanged (bit-parity preserved). Bundles gain
//              impassable.tif. Bumped so the updated app.js / index.html install.
//   v18 → v19: Optional OSM bridges & tunnels (group 1d). A dedicated pull
//              queries Overpass for way[bridge] (+ tunnel=yes) over the DEM
//              extent and models each as a level deck between its two ground
//              abutments. In the raster compute each deck is a PORTAL EDGE
//              between its end cells at the flat-deck cost, relaxed alongside
//              the grid edges — the cells UNDER the deck keep ground elevation,
//              so the route over a bridge and the route under it both stay
//              correct (true multi-level on a 2.5-D grid). Engine change:
//              dijkstra/densityField (energy-worker.js) + dijkstra_tree
//              (backend/src/main.rs) gain portal relaxation; portal costs
//              match bit-for-bit (test-backend.mjs +portals cases). Graph mode
//              ("follow the vectors") also goes multi-level: the OSM streets
//              pull captures bridge/tunnel/layer tags, and graph-engine.js
//              suppresses different-layer crossing junctions + flattens deck
//              edges. Bundles gain bridges.geojson. Bumped so the updated
//              worker/backend/app install.
//   v19 → v20: Bridge follow-ups. (1) Deck passes/density: a portal jumps
//              abutment→abutment, so deck cells showed no passes even when the
//              bridge carried heavy traffic — now painted with the crossing
//              flow (min of the two abutments' passes). (2) Groups 1c/1d
//              (impassable mask, bridges) light up when their data is loaded.
//              (3) New 1d source: extract bridges/tunnels from the already-
//              loaded vector network (gpkg tags / OSM other_tags) — offline, no
//              Overpass. (4) 1c/1d each get an "apply to compute" toggle to
//              enable/disable their effect without clearing the data. Bumped so
//              the updated app.js installs.
//   v20 → v21: Fix: "Load FABDEM for current viewport" threw "TypeError: t is
//              not a function". The tile-mosaic loop's variable (const t =
//              opened[i]) shadowed the i18n t() function, and the v19/v20 status
//              i18n migration added a t("status.fabdem_mosaic") call inside that
//              loop — so it invoked the tile object. Renamed the loop var to
//              `tile` (both tile loops). App-only patch; engine/backend unchanged.
//   v21 → v22: New 1c source — "Pull water from OSM". Queries Overpass over the
//              DEM extent and rasterises an impassable mask onto the DEM grid:
//              water AREAS (natural=water / waterway=riverbank / landuse=reservoir,
//              ways + multipolygon relations) via even-odd fill; the open SEA
//              (natural=coastline, land-left/water-right) via a horizontal+vertical
//              orientation sweep (gap-tolerant, no flood-leak); and NON-tunnelled
//              waterway=river LINES via supercover (with a "Rivers (lines)
//              impassable" toggle). Streams + tunnelled waterways stay passable.
//              Reuses the uploaded-mask pipeline (Invert, corridors, overlay,
//              bundle). App-only; engine/backend unchanged. New test:
//              test-water-raster.mjs. Bumped so the updated app.js installs.
//   v22 → v23: OSM `ele` on bridge/tunnel decks. The 1d "Pull bridges & tunnels
//              from OSM" pull now also fetches node `ele` tags and uses the
//              mapped deck elevation for the raster PORTAL endpoint heights
//              (per-abutment, with way-`ele` / nearest-node fallback). Unmapped
//              ends fall back to the bare-earth DEM (NaN sentinel), so a pull
//              without ele is byte-identical to v22. Threaded through the worker
//              pool + native backend Blob (now 32 B/portal) and persisted in the
//              bundle (bridges.geojson). energy-worker.js + backend/src/main.rs
//              kept bit-parity (test-backend.mjs +ele cases). Graph mode stays
//              DEM-based for now.
//   v23 → v24: UX fix — "Compute on network graph (follow the vectors)" wins the
//              run dispatch over the raster "Constrain to network" / "Compare
//              with unconstrained" toggles, so with graph mode on (it's persisted,
//              so it can be on silently from a prior session) the compare never
//              ran and its "Displayed scenario" dropdown never appeared. Graph
//              mode now greys out + disables those two toggles (with a tooltip)
//              while it's on, on toggle AND on load. App-only; no engine change.
//   v24 → v25: Graph mode now RUNS the comparison instead of disabling it.
//              "Constrain to network" is forced on + locked (graph mode is
//              inherently network-constrained) while "Compare with unconstrained"
//              stays togglable: graph mode runs a full-DEM unconstrained RASTER
//              scenario alongside the graph compute and exposes the difference via
//              the "Displayed scenario" picker (graph / unconstrained / difference).
//              Native backend single-source: "Use native backend" moved out of the
//              density panel (always visible) and now also accelerates from/to/round
//              ENERGY-FIELD runs via a new POST /single endpoint (top-N/path/maximize
//              stay browser-only; auto-fallback unchanged). energy-worker.js +
//              backend/src/main.rs kept bit-parity (test-backend.mjs +single cases).
//   v25 → v26: Cloud compute source. The "Use native backend (Rust)" checkbox
//              became a three-way Compute-source selector: Browser (in-page
//              workers, default), Localhost (native Rust backend), and Cloud — a
//              local orchestrator (127.0.0.1:8079) that boots a pre-baked VM on
//              demand, waits for health, proxies /density & /single, then stops
//              the VM after each run (and on tab hide). Adds a transfer-size
//              estimate. Cloud is only offered when the applet is served locally.
//              On orchestrator/boot failure the run falls back to the browser
//              pool. No new served files; compute path / bit-parity unchanged.
//   v26 → v27: Cloud "keep VM warm between runs" toggle. When ticked, a run no
//              longer stops the VM at the end — it stays up to reuse on the next
//              run (only the first run pays the boot), and the orchestrator lease
//              + in-VM idle-watchdog stop it after ~15 min idle. Tab-hide no
//              longer stops the VM in keep-warm mode (only a real unload does).
//   v27 → v28: Network IDW interpolation pool is now budgeted against
//              deviceMemory (like densityPoolSize) + the #max-workers override,
//              instead of a fixed 1.5 GB that collapsed huge DEMs to a single
//              interp worker. Perf only; output unchanged.
//   v28 → v29: Difference (network-cost) passes view recoloured from red/green
//              to an ORANGE (network) + AZURE-BLUE (terrain) additive-complement
//              pair: overlap sums to white (max brightness), and the blue–yellow
//              axis stays discriminable under red–green colour-blindness. The two
//              passes control groups gain colour-chip labels (Network / Terrain).
//   v29 → v30: Bundle export/import now round-trips the "Comparar com cenário sem
//              rede" (compare) scenario: downloadBundle writes the unconstrained
//              energy/passes + the saved difference field (energy_unconstrained.tif,
//              energy_difference.tif, passes_unconstrained.tif), metadata records
//              the #vec-compare flag + e-max-mode, and load restores the toggle and
//              rebuilds energyAlt/passesAlt so the scenario picker + difference view
//              come back. (Graph-mode compare restore is still a follow-up.)
//   v31 → v32: New "IBGE 2022 census (population density)" reference-sampling
//              strategy. Instead of spreading references uniformly, it samples
//              them where people live: a live port of census/sample_census.py
//              that fetches the census setores inside the DEM bbox from a cloud
//              FlatGeobuf (HTTP Range — only the bbox slice transfers, not the
//              ~450 MB national file), weights each setor by pop·(area in the
//              DEM / full area), picks setores by a 1-D Sobol inverse-CDF and
//              drops points inside them with a 2-D Sobol rejection draw. Adds
//              the flatgeobuf CDN lib (runtime-cached, like geotiff/jszip).
//              Brazil-only, online-only (like Overpass/FABDEM); JS-only.
//   v32 → v35: Two changes, numbered v35 to dodge a clash with the in-flight
//              feature/ui-overhaul branch's v33.
//              (a) App moved to its own domain — served from the root of
//              https://simujaules.pedalhidrografi.co/ (dedicated gs://simujaules
//              bucket) instead of telhas.pedalhidrografi.co/simujoules/; brand
//              spelled "Simujaules" (affective typo of joules); absolute URLs
//              repoint to the new root; the RDF @vocab IRI stays on telhas
//              (stable identifier, resolved via redirect); rmsampa-v2/FABDEM
//              tiles stay on telhas.
//              (b) Cloud compute now works REMOTELY: a public, password-gated
//              Cloud Run orchestrator creates/starts/stops/deletes the VM; the
//              browser sends the big compute payloads DIRECT to the VM over
//              HTTPS (Caddy, TLS via DNS-01); new "Cloud password" field; the
//              same token gates control + data planes; ephemeral IP with dynamic
//              DNS; the VM is deleted after 30 days idle (cost → 0).
//              No engine changes.
//   v35 → v36: Big UI overhaul (the former feature/ui-overhaul "v33", renumbered
//              to land after the domain/cloud v35). Sidebar restructured into
//              nested collapsible groups (0 Import/Export · 1 Inputs [1A-1D] ·
//              2 Compute [2A-2C] · 3 Results [3A-3D]) with per-group status
//              colours, auto-expand, and a draggable 1-4-column resizer; layer
//              visibility/opacity/order + basemap (+ Esri satellite) moved to a
//              non-blocking on-map "Controle de camadas" panel with unified
//              per-layer rows; compute progress/log floats in a dismissable
//              bottom pill. Full config persistence + export/import/reset
//              (Group 0) and bundles now embed the whole UI state. On-map drawing
//              (Leaflet-Geoman): barrier/passable-corridor polygons (1C) + portal
//              lines (1D) feed the compute. Plus: density tweaks follow the
//              displayed channel, passes auto-max p90-above-min, scientific-
//              notation density bounds, desktop sidebar collapse, locate
//              marker+accuracy circle, credit in the help modal. Adds the
//              leaflet-geoman CDN lib (runtime-cached). JS/UI only; engine +
//              worker + backend untouched (bit-parity preserved).
//   v36 → v37: UI refinements on top of v36. Sidebar groups reordered/renamed
//              (1B-1D, 2A-2C) with "maximizar energia" + "origem das referências"
//              removed; multi-column sidebar fills each column top-to-bottom
//              before the next and scrolls VERTICALLY only (no horizontal spill).
//              1B network params + 2A parameters are now 2-col label|input tables
//              (cost coefficients in J/m, budget in kJ). Results styling (energy
//              field / density / legend) moved INTO the "Controle de camadas"
//              panel; its × removed (toggle/Esc close it). Collapse/expand group
//              highlight (grey/white, under the status colours); 1C/1D go green on
//              drawn geometry alone. App title is now the brand "Simujaules" + a
//              tagline. Fixes: collapsing the sidebar no longer blanks the map;
//              the rmsampa-v2 overlay no longer 404s tiles past z16. JS/UI only;
//              engine + worker + backend untouched (bit-parity preserved).
//   v37 → v38: UI/UX review pass. Units: budget stays kJ, α/β back to kJ/m
//              (reverting v37's J/m); downhill recovery input is now a 0–100 %
//              mapped to the engine's 0–1 fraction (one-time persistence
//              migration). Visual: the collapse/expand group cue is a quiet grey
//              bar (was a loud near-white border that out-shouted the status
//              colours); "Baixar bundle" is secondary so "Calcular" is the lone
//              primary. A11y: bilingual accessible names on icon buttons / file
//              pickers / layer rows, accent-color on native controls, ≥24px
//              touch targets, reduced-motion, layer panel as role=region.
//              Interaction: draw "armed" state + Esc-cancel, auto-dismissing
//              success pill, disabled-Calcular reason, density auto-opens the
//              refs group. i18n/copy leaks fixed + shorter select options +
//              mobile button fixes + cloud example datasets ("Viário RMSampa"
//              network in 1B, "Águas RMSampa" water mask in 1C, full RMSampa
//              extent). JS/UI only;
//              engine untouched (bit-parity).
//   v38 → v39: Density display + new I/O + map fixes. Graph-mode passes: network
//              vectors keep a true orange / azure hue (intensity is now opacity,
//              not a darkening multiply that muddied mid-values into yellow-brown);
//              "filtro média N" rasterises + mean-smooths the network channel
//              (precise vectors when empty); the difference view composites
//              network + terrain into one orange/azure raster; the 3C.a passes and
//              3B energy inputs show the resolved auto numbers (were static
//              p10/p90/auto). Sidebar columns balance evenly once content overflows
//              (was column-1-heavy). Map: rmsampa-v2 hydrography is crisp on HiDPI
//              and no longer vanishes past z17 (detectRetina + DPR-aware native-zoom
//              cap). Group 0 gains export/import of the four inputs in matching
//              formats — DEM + mask as GeoTIFF, network + bridges as GeoPackage (new
//              in-browser .gpkg writer). The layer-control panel is resizable to
//              2 columns. JS/UI only; engine + worker + backend untouched
//              (bit-parity preserved).
//   v39 → v40: Passes are ALWAYS shown as a normalized density now, not raw
//              counts — single-run subtree-size counts are scaled by 1/(H·W)² into
//              the same units the multi-reference density already uses (so a 3C
//              channel reads ~1e-10 instead of "12"). Display-only + colour-
//              invariant (a constant scale, so the percentile-normalized pattern
//              is unchanged); already-normalized density fields are left untouched;
//              the GeoTIFF export stays counts. JS/UI only; engine untouched.
//   v40 → v41: Mobile layout fix. The locate / hamburger / layer-control buttons
//              now mirror the desktop top-right stack (8 / 56 / 104), and the
//              layer-control modal opens BELOW them — previously the buttons sat
//              in the bottom corners and the tall modal covered them, so you
//              couldn't tap the layer button to close its own modal. The modal
//              also scrolls VERTICALLY when space is tight (its 2-column flow
//              moved into a height:auto child) instead of spilling sideways into
//              extra columns. JS/UI only; engine untouched.
//   v41 → v42: Removed the on-map Leaflet attribution strip (attributionControl
//              off); the same credits (Leaflet, Leaflet-Geoman, OpenStreetMap,
//              CARTO, Esri, the pedalhidrografi.co hydrography overlay) now live
//              in an "Atribuições / Attributions" section of the help modal.
//              JS/UI only; engine untouched.
//   v42 → v43: New "Geometria de referência" layer — its layer-control row has an
//              ↑ upload button (instead of opacity) that loads a GPX track, drawn
//              as a magenta overlay; hover/click shows its metrics (distance, total
//              energy via the app's α·dist+β·dh model with current params, total
//              ascent + descent; elevation from GPX <ele> or sampled from the DEM).
//              Also: energy now displays as a plain decimal (e.g. "3357 kJ"), never
//              scientific. JS/UI only; engine untouched.
//   v43 → v44: v2 energy model. The cost is now physics-parameterised (mass, Crr,
//              CdA, ρ, drivetrain efficiency, power on the flat, climb threshold)
//              of the α/β/η knobs: per edge it splits rolling vs aero and charges
//              aero only OFF climbs, with a per-grade descent recovery
//              ε=clamp(min(1,(α/β)/s)−0.13). JS worker, graph engine AND the Rust
//              backend move together (bit-parity); reference-geometry energy uses
//              the closed form with a 2 m elevation deadband. See
//              bicycling-energy-model/notas.md (v2).
//   v44 → v45: Bridge/tunnel deck passes now read as a continuous line. The deck
//              is a 1-cell line over water (mask=0, unreached), so its stamped
//              flow was faint and dropped by the passes-overlay downsample on big
//              DEMs → a gap along the bridge. The stamp is now dilated by the
//              render stride so it always lands on a sampled cell. Render-only.
//   v45 → v46: Two MTPI (multi-scale topographic position index) basemaps in the
//              basemap dropdown — Pindorama 90 m (COP90, South America, native z10)
//              and Bacia do Paraná 30 m (native z12). XYZ tiles from
//              telhas.pedalhidrografi.co; maxNativeZoom over-scales past native.
//   v46 → v47: Revert the v46 MTPI basemaps — they belong in amora, not Simujaules.
//   v47 → v48: Source→destination ROUTE comparison. With "Comparar com cenário
//              sem rede" on, the "Cenário exibido" picker now switches the best
//              ROUTE too, not just the field: terrain (unconstrained) route in
//              blue, network (constrained) route in orange, both in the difference
//              view — matching the density difference colours. Single best per
//              scenario. Works in raster network-mask mode AND graph mode; the
//              unconstrained partner now also traces a path to the destination.
//              Hovering/tapping either route shows BOTH routes' energy + length
//              (and the Δ) — bound as a hover tooltip and a click/tap popup.
//   v48 → v49: Full-repo review fix batch (docs/review-2026-07-01.md): admissible
//              A* top-N heuristic + correct "até"-mode route direction; maximize
//              no longer silently empties under an energy budget; graph-mode
//              half-cell terrain/rasterisation/snap fix, T-junctions, chained
//              deck flattening, metre-capped snap tolerance; native-backend
//              maximize+network parity and exact large-DEM /single passes;
//              crafted-.gpkg XSS hardening, bundle-import compute cancellation,
//              calibration-probe error recovery; deploy no longer deletes the
//              cloud VM startup script; SW precache bypasses the HTTP cache (no
//              more stale/mixed-version installs) and stops caching big DEM/GPKG
//              files; i18n + v1→v2 cost-model doc fixes; census pipeline fixed.
//   v49 → v50: New app icon — a yellow ascent arrow crossing a blue topographic
//              contour field, replacing the old bicycle glyph. Regenerated every
//              size (favicon.ico, icon-192/512, apple-touch-icon, maskable
//              192/512) from the design source; icon.svg/icon-maskable.svg now
//              wrap the raster (a hand-authored vector no longer matched the
//              art). Same file names/paths — no manifest changes. Also placed
//              beside the "Simujaules" title in the panel header (was
//              text-only), via a new .brand wrapper in the header markup.
//   v50 → v51: Second full-repo review fix batch (docs/review-2026-07-02-round2-
//              workorder.md): top-N/DP correctness (true energy reporting,
//              "até"-mode DP direction + soft-seed, repulsion clamp), graph
//              spatial-hash rewrite + T-junction merge fix, bundle geotransform
//              check + zip-bomb cap, DEM-load / OSM-loader identity guards,
//              worker-pool teardown, export georeferencing fixes, cloud VM
//              lease (X-Simu-Client) + boot-order + XFF hardening, CSP +
//              focus-trap, remaining i18n gaps, doc corrections. An
//              adversarial re-review of the batch's own diff caught two more
//              races: the water-mask rebuild's staleness check and a DEM
//              load's generation guard could each be fooled by unrelated
//              concurrent activity — both now check the right thing.
//   v51 → v52: From an audit against bicycling-energy-model (the energy law's
//              spec repo): graph-mode maximize now respects mode "to" (was
//              always scoring forward from srcNode, unlike topN and the raster
//              maxCostPathOfLength); round-mode path energy now reports the
//              round-trip total (fwd+bwd) instead of silently recomputing the
//              outbound leg alone. Two new regression tests confirm both bite
//              on unfixed code. Stale abRatio comment corrected. Removed the
//              legacy QGIS plugins (qgis/) this app was originally ported from
//              — long superseded by energy-worker.js's v2 engine and carrying
//              no served files.
//   v52 → v53: Icon cache-bust fix. v50's icon redesign kept every filename
//              identical, colliding with the 30-day Cache-Control deploy.sh
//              sets on icons/ — browsers/Cloudflare that had already cached
//              the old bytes wouldn't see the new icon for up to 30 days
//              regardless of redeploying. Every shipped icon file (icon.svg,
//              icon-192/512, maskable 192/512, apple-touch-icon) renamed with
//              a "-v2" suffix — a new URL bypasses every existing cache
//              outright. favicon.ico can't be renamed (browsers fetch it at a
//              fixed well-known path); its cache lifetime is cut from 30 days
//              to 1, so this doesn't recur for it specifically.
//   v53 → v54: Energy-model journal alignment (bicycling-energy-model journal
//              Entries 18/19). Reference-geometry (imported/drawn track)
//              energy readout only — routed-path/field energy is untouched.
//              refEnergyKJ's descent-recovery ε now ports the champion
//              harness's epsGeom estimator exactly: drop-weighted over 30 m-
//              resampled cells, replacing a lumped mean-descent-grade
//              approximation its own comment had claimed but never
//              implemented. Also clarified (comments only, no behaviour
//              change): the v2 engine's trailing descent-cost clamp is
//              provably dead code — a 1.78 M-combo sweep plus 1 402 real
//              rides never triggered it — kept only for JS/Rust bit-parity.
//              New disclosures: the v2 model is tuned for ~30 m DEM sampling,
//              so on the deployed 5 m IGC-SP DTM energies read conservatively
//              high on hilly terrain (help modal, PT/EN); and FABDEM is not
//              recommended for energy work on flat/urban terrain, since its
//              per-pixel noise inflates measured ascent. App-only (help
//              modal + JS comments + CLAUDE.md); engine/worker/backend
//              bit-parity unchanged.
//   v54 → v55: DEM pre-smoothing + validated accuracy goal (journal Entry 20).
//              Fine DTMs (pixel ≤ 10 m) get a static mask-normalized Gaussian
//              pre-smoothing (σ = 10 m) once at DEM load — the Entry-19
//              resolution-over-charge mitigation in its validated config. New
//              "Suavização do MDT" select in 1A (auto/off/10/20/30 m; auto
//              skips coarse sources and already-smoothed re-imports, flagged
//              via an ImageDescription tag on exported dem.tif). Heights are
//              smoothed app-side before shipping to the engines — JS/graph/
//              Rust bit-parity untouched. With σ=10 + per-rider calibrated
//              params, held-out error validated at med|Δ%| 3.7/2.7/4.9 with
//              bias < ±1% (three riders) — meets the ±5%/±2% goal. New
//              test-dem-smoothing.mjs locks the transform.
//   v55 → v56: Accessibility KPIs ("300 kJ city" initiative). Density runs now
//              also sample each reference's energy field at every OTHER ref's
//              cell — a pairwise K×K matrix at zero extra Dijkstra cost —
//              powering a new "3B. Acessibilidade" results block: % of the
//              population that can access ≥ K people within E₁ kJ (default
//              1M / 200 kJ) and ≥ J% of the population within E₂ kJ (default
//              80% / 600 kJ). Census sampling now records the in-extent
//              population total M (each ref proxies M/K people); other
//              sampling strategies take a hand-entered M (KPI 2 needs none).
//              Threshold edits re-evaluate the cached matrix live (never a
//              recompute); ref markers recolor red→yellow→green by attained
//              access; per-ref + matrix CSV exports. Rust backend gains
//              want_matrix on /density (f32×K² appended, "matrix":K in the
//              meta; bit-parity with the JS worker, enforced by new +matrix
//              cases incl. a dropped-ref index regression). Warns when a
//              threshold exceeds the run's energy budget (lower bound).
//   v56 → v57: Move directions + string pulling + KPI grid correction (the
//              grid-connectivity research note shipped as options). New
//              "Direções de movimento" select (4/8/16/32/64/128, default 8 =
//              the classic engine, bit-identical): richer Farey heading
//              ladders with profile-integrated long moves cut the route-
//              jaggedness energy overestimate (~⅔ less at 16 directions);
//              density runs amortize precomputed long-edge tables per
//              worker; passes are stamped over swept cells so corridors
//              stay continuous. nDirs ≠ 8 computes in-browser (the native
//              backend keeps the 8-move engine). New "string pulling"
//              checkbox post-hoc shortens the displayed route(s) (single +
//              top-N; round/maximize excluded) — the shown energy is the
//              pulled polyline's own integrated sum. New KPI "correção de
//              grade ×c" input inflates the accessibility thresholds
//              (centered estimate vs conservative floor, with a warning).
//              All three persist in bundles.
//   v57 → v58: Crop + downsample the loaded DEM (1A). "Recortar à janela
//              atual" crops to the visible map window (geographic DEMs only;
//              no-overlap / whole-DEM / too-small views get clear statuses);
//              "Reduzir resolução" (2/3/4/6×) does mask-aware N×N block
//              averaging — gdalwarp -r average's transform, so 6× on a 5 m
//              IGC raster ≈ the 30 m regime where the model is most accurate
//              (journal Entries 19/21); works on projected DEMs too. Both are
//              in-memory export→reimport through the standard load path
//              (mask/CRS/invalidation/smoothing-tag guard all inherited) and
//              drop the source URL from bundle metadata.
//   v58 → v59: Cloud compute fixed end-to-end + machine selector. CSP
//              allowlists the orchestrator's real *.run.app host (cloud mode
//              was CSP-blocked from the deployed site); default orchestrator
//              URL points at the live service; scheme-less URLs get https://
//              assumed. "Máquina da nuvem" select (8/32/128 vCPUs, R$/h
//              reference prices; spot billing is typically 60–90% below):
//              applied on VM create/restart with a matching max-mem-gb, and
//              the time estimate models the SELECTED size (sub-linear
//              bandwidth-contention curve). Cloud runs say "Calculando na
//              nuvem…"; fallbacks to browser workers state their reason.
//   v59 → v60: Cloud machine-switch ergonomics. /cloud/start timeout 15→45 s
//              (the synchronous resize inside it takes ~11 s and could blow
//              15); the mid-boot restart carries the selected machineType;
//              a status hint flags a running keep-warm VM whose size differs
//              from the dropdown (the selection only applies on next boot);
//              new "Desligar VM agora" button forces that next boot without
//              the untick-keep-warm dance.
//   v60 → v61: "Falhar em vez de cair pro navegador" checkbox (cloud panel,
//              persisted): a cloud failure aborts the run with the error
//              instead of silently recomputing on the browser pool — the
//              silent fallback masked every cloud problem and burned laptop
//              CPU on runs meant for the big VM.
//   v61 → v62: Directions ≠ 8 now run on the native/cloud backend (Rust
//              0.2.0): full bit-parity port of the Farey move sets +
//              profile-integrated long edges + swept-cell passes stamping
//              (incl. V8-exact hypot/round — libm drifts 1 ulp), with the
//              long-edge cost tables shared once per request across all
//              slices. App version-gates dispatch on /health ≥ 0.2.0 (an
//              older binary silently ignores nDirs); estimate models the
//              nDirs memory terms.
//   v62 → v63: Gravity re-baselined to São Paulo's LOCAL value, g = 9.7864
//              m/s² (IAG-USP absolute gravimetry), replacing the textbook
//              9.81 — which is ≈0.24% high here. β falls 0.7585 → 0.7567
//              kJ/m, so every energy field / budget / route cost drops
//              ≈0.24% on climb-dominated terrain (≈0.2% mixed). Re-syncs the
//              app with bicycling-energy-model (journal Entry 27), which
//              moved first; the two had disagreed by exactly this ratio.
//              Constants only — no model, engine or parity change (the Rust
//              backend receives the derived cost bundle over the wire, so
//              JS↔Rust bit-parity is untouched: 97 cases, max|Δ| = 0).
//   v63 → v64: Routing defaults follow bicycling-energy-model Entry 74 /
//              paper 3 §3.2(d): DEM smoothing "auto" now applies σ = 30 m to
//              EVERY source (was σ = 10 m on fine DTMs only — coarse sources
//              like FABDEM are now treated too; the already-smoothed tag
//              guard stays), and move directions default 8 → 16 (the local
//              survey's med|Δ%| optimum, 0.20 pp from FABDEM's n = 32
//              optimum; gains beyond 32 are marginal at ≥ 2× runtime).
//              Config defaults only — no engine change; nDirs = 8 remains
//              the classic parity anchor and the "fast" choice.
//   v64 → v65: New 1B button "Puxar viário do FGB (América do Sul · nuvem)":
//              the same highway=* network as the Overpass pull, served from
//              amora's South-America road FlatGeobuf on gs://telhas — the
//              packed Hilbert R-tree means only the view's bytes travel
//              (HTTP Range), no Overpass dependency, and bridge/tunnel/layer
//              come as columns (normalized identically to the OSM pull).
//              Reuses the flatgeobuf 3.36.0 lib the census sampling already
//              ships. ALSO a re-precache release: v64 deployed without a
//              Cloudflare purge, the edge served the v63 app.js for up to
//              4 h (cache:"reload" bypasses the browser cache, not the
//              edge), and clients that installed v64 in that window
//              precached the old app.js. deploy.sh now sources .env so the
//              purge runs on every deploy.
//   v65 → v66: The FGB family now feeds groups 1C and 1D too: "Puxar água do
//              FGB" pulls the water mask from the project's water FlatGeobufs
//              (areas + rivers; same classes as the OSM pull, filling the
//              same osmWaterGeom cache so #imp-rivers re-applies — but NO
//              coastline layer and no tunnel filter on rivers, both stated
//              in the button tooltip), and "Puxar do FGB" in 1D pulls road
//              bridge/tunnel decks from the viário FGB (same abutment
//              semantics, eleA/eleB null → DEM fallback; highway-only).
//              Shared fgbStream helper; no engine change.
//   v66 → v67: New passes blend "soma de dados (A+B numa paleta)": in the
//              raster difference view the two scenarios' passes fields are
//              summed CELL BY CELL and painted through the single-field
//              pipeline with normal compositing — an honest, basemap-
//              independent scale. The old "soma" was renamed "soma de
//              cores (plus-lighter)": it adds rendered COLORS against the
//              whole backdrop (basemap included) scaled by opacity, which
//              is not a data sum. Graph mode (vector channel) composites
//              normal under sum-data. Pure re-render, no recompute.
//   v67 → v68: UI tightening, no engine change. The "Calcular contagem de
//              passagens" checkbox is gone — passes are now ALWAYS computed
//              (identical to it being permanently checked; old bundles with
//              wantPasses:false gain passes on replay). 1B renames:
//              "Interpolar campo de energia" (was "entre células fora da
//              rede") and "Usar grafo viário ao invés de rasterizado" (was
//              "Calcular sobre o grafo da rede"). The six 1B numeric params
//              now sit in a 2×3 stacked grid, and 2A's Mode→budget fields
//              in a two-column grid (readouts α_r/α_a/β unchanged below).
//   v68 → v69: FABDEM tiles now come from fabdem.pedalhidrografi.co
//              (Cloudflare R2, tiles at the root — the old telhas
//              /fabdem/ path is retired; telhas still serves rmsampa
//              tiles + the viário FGBs). CSP connect-src gains the new
//              host. Same Bristol names, same COGs — no behaviour change.
//   v69 → v70: Address-search button (🔍) parked under the Leaflet zoom
//              control — Photon (komoot) typeahead, ported from amora but
//              reduced on purpose: picking a result ONLY flies the map to
//              the place (no pin, no state). CSP connect-src gains
//              photon.komoot.io; this SW exempts that host from the
//              runtime cache (cache-first would freeze query results).
//   v70 → v71: FGB pull window caps aligned with FABDEM's: one shared cap
//              DERIVED from the FABDEM loader's constants (50 MB ÷ 4 B/cell
//              × (1″)² ≈ 1.01°² — any window FABDEM accepts, the viário/
//              água/pontes FGB pulls accept too). Was 0.25°² for viário/
//              bridges and a hand-set 1.0°² for water.
//   v71 → v72: FABDEM viewport cap raised ~1°² (50 MB) → 10°²
//              (FABDEM_MAX_DEG2; ≈ 494 MiB of Float32, ~129.6 M cells —
//              at the app's honest RAM ceiling). The FGB pull caps derive
//              from it, so viário/água/pontes windows rise to 10°² too.
//   v72 → v73: FGB pulls ~25× faster. The three FGBs are now fetched
//              DIRECTLY from GCS (storage.googleapis.com) instead of the
//              telhas.pedalhidrografi.co proxy: Cloudflare can't cache
//              objects over 512 MB (the viário FGB is 4.5 GB) and throttles
//              big uncacheable ranges — measured: the same 20 MB range took
//              92 s via telhas vs 0.6 s direct (~150×); a 0.2°×0.2° SP
//              viário pull dropped 57 s → 2.3 s. Water areas+rivers now
//              download in parallel (independent files), and this SW stops
//              intercepting .fgb (each Range paid a cache lookup + 206
//              clone for nothing). Sub-window parallelism was measured and
//              REJECTED (2.5× slower — the reader already fetches feature
//              batches concurrently; the bottleneck was the serving path).
//   v73 → v74: Max-density segment (3C.c). New worker kind "maxseg": finds
//              a continuous SIMPLE path of ~L km maximising Σ density·metre
//              over the last passes/density field, on an automatically
//              block-mean-coarsened grid (≤ 4 M cells). Orienteering is
//              NP-hard, so the search is an honest heuristic — multi-start
//              two-ended self-avoiding greedy with rollout lookahead; an
//              exact layered DP over WALKS was tried first and dropped
//              (measured: it shuttled 5× over the hottest 4 km stretch of
//              a 20 km target). Steps are scored with a multiplicative turn
//              penalty (((1+cosΔθ)/2)^0.5, seed-kink coupled) — without it
//              the raw objective rewards snaking across wide corridors
//              (measured sinuosity 1.41 → 1.04); the penalty steers the
//              search only, the reported sum stays the drawn line's own raw
//              integral. Fuchsia line with dark casing + fitBounds on
//              result; geographic DEMs only (like all routes). Display/
//              analysis only — engines, backend parity, bundles untouched.
//              test-maxseg.mjs pins quality against exact enumeration of
//              the same penalized objective + shuttle/zigzag regressions.
const VERSION  = "v74";
const PRECACHE = `simu-precache-${VERSION}`;
const RUNTIME  = `simu-runtime-${VERSION}`;

// Belt-and-braces cap on RUNTIME entries: the .tif/.gpkg exemption above the
// fetch handler already keeps the known big files out, but any other huge
// response would both bloat the cache AND get fully re-downloaded in the
// background on every reuse (stale-while-revalidate). Responses whose
// Content-Length parses above this are served but never cached. When
// Content-Length is ABSENT — common on chunked/Content-Encoding responses
// through a CDN — we can't trust "no header" to mean "small": putIfWithinCap
// below counts the decoded bytes off the stream instead, so a big body still
// can't slip past the cap uncapped.
const MAX_RUNTIME_BYTES = 30 * 1024 * 1024;

// Cache `res` into RUNTIME if it fits the size cap; a no-op otherwise. `res`
// must already be a clone the caller owns (see the "res.clone() must happen
// synchronously" note on handle(), below) — this function may consume its
// body.
//   - Content-Length present: today's fast path (size check, then put).
//   - Content-Length absent, no body: nothing to count — put directly.
//   - Content-Length absent, has a body: read it via the stream reader,
//     counting bytes; cancel and skip caching once the count exceeds the
//     cap, otherwise rebuild a Response from the counted chunks. The rebuilt
//     Response's body is the DECODED bytes (the reader already inflated
//     them), so content-encoding/content-length/transfer-encoding are
//     stripped from its headers — keeping them would corrupt a later
//     cache.match() read (a decoder trying to re-inflate already-decoded
//     bytes, or a length header that no longer matches the body).
async function putIfWithinCap(req, res) {
  const len = parseInt(res.headers.get("content-length") || "", 10);
  if (Number.isFinite(len)) {
    if (len > MAX_RUNTIME_BYTES) return;
    const cache = await caches.open(RUNTIME);
    return cache.put(req, res);
  }

  if (!res.body) {
    const cache = await caches.open(RUNTIME);
    return cache.put(req, res);
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RUNTIME_BYTES) {
      reader.cancel();
      return; // over cap — do not cache (memory bounded to ~cap + one chunk)
    }
    chunks.push(value);
  }

  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const rebuilt = new Response(new Blob(chunks), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
  const cache = await caches.open(RUNTIME);
  return cache.put(req, rebuilt);
}

// Paths are relative to the SW's scope (the deploy root). Keep this list
// in sync with what index.html actually loads — anything missing from here
// will work online but break the offline launch.
// Precache only files we *know* will resolve — cache.addAll is atomic, so
// a single 404 in this list aborts the whole install. Bare-directory URLs
// (./) are intentionally absent: GCS / CDN configs sometimes redirect them
// and an opaque-redirect response would fail the install. The navigate
// handler below maps "./"-style requests onto cached "./index.html" anyway.
const PRECACHE_URLS = [
  "./index.html",
  "./app.js",
  "./energy-worker.js",
  "./graph-engine.js",
  "./manifest.webmanifest",
  "./icons/icon-v2.svg",
  "./icons/icon-192-v2.png",
  "./icons/icon-512-v2.png",
  "./icons/icon-maskable-192-v2.png",
  "./icons/icon-maskable-512-v2.png",
  "./icons/apple-touch-icon-v2.png",
  "./vocab/simujoules.jsonld",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      // cache: "reload" — the precache must bypass the browser HTTP cache
      // (deploy.sh serves app.js/workers with max-age=3600), or a VERSION
      // bump can install a stale, mixed-version shell. Still atomic.
      .then((cache) => cache.addAll(
        PRECACHE_URLS.map((u) => new Request(u, { cache: "reload" })),
      ))
      // skipWaiting: don't sit in the "waiting" state behind the previous
      // SW. Combined with clients.claim() below, the new code takes effect
      // on the very next page load instead of after every tab is closed.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== PRECACHE && k !== RUNTIME)
            .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // pass through

  const url = new URL(req.url);

  // Skip big data files entirely — DEM rasters, GeoPackage networks
  // (the "Viário RMSampa" example alone is ~145 MB) and FlatGeobufs (v73:
  // the viário/água/pontes + census pulls issue THOUSANDS of Range requests
  // against multi-GB .fgb files — each was paying a cache lookup + a 206
  // body clone here, and Cache.put refuses 206s anyway) go straight to the
  // network/HTTP cache. Returning without calling respondWith() lets the
  // browser handle the request normally.
  if (/\.(tiff?|gpkg|fgb)$/i.test(url.pathname)) return;

  // Skip the Photon geocoder (the 🔍 address search) — handle()'s cache-first
  // would freeze each query's results forever and bloat RUNTIME with one
  // entry per keystroke. Straight to the network; offline search is useless
  // anyway.
  if (url.hostname === "photon.komoot.io") return;

  // For top-level navigation requests, try the network first so deploys
  // propagate quickly; fall back to the cached shell for offline launch
  // AND for 5xx edge errors (a CDN hiccup shouldn't take the app down
  // when we have a perfectly good shell cached).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => (res && res.status < 500)
          ? res
          : caches.match("./index.html").then((c) => c || res))
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(handle(event));
});

// Cache-first with stale-while-revalidate. Returns the cached copy
// immediately if there is one, and refreshes the cache in the background
// from the network. On cache miss, fetch from network and stash a copy.
//
// NOTE on scope: the background refresh writes to RUNTIME, and caches.match()
// returns a PRECACHE hit first. So stale-while-revalidate is effective for
// RUNTIME entries (cross-origin CDN libs + tiles) but INERT for the precached
// same-origin shell (app.js, workers, index.html) — by design. The shell is
// versioned: it updates atomically when VERSION bumps (install re-runs
// addAll, activate purges the old cache), never piecemeal here. That
// atomicity is what keeps app.js and energy-worker.js on the same version;
// revalidating individual precached files into PRECACHE would break it.
//
// Two subtleties:
//   - res.clone() must happen synchronously, BEFORE the response is
//     handed to the page. Cloning inside caches.open(...).then(...) races
//     the page consuming the body — clone() then throws "body already
//     used" and the cache write intermittently fails.
//   - cache writes go through event.waitUntil so the SW isn't terminated
//     mid-put after the response has been returned.
async function handle(event) {
  const req = event.request;
  const cached = await caches.match(req);
  if (cached) {
    // Background refresh, ignored failures — offline browsing is fine.
    event.waitUntil(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          return putIfWithinCap(req, copy);
        }
      }).catch(() => {}),
    );
    return cached;
  }

  try {
    const res = await fetch(req);
    if (res && res.ok && res.status < 400) {
      // Cache only successful responses. opaque (cross-origin no-cors) and
      // 4xx/5xx are skipped to avoid poisoning the cache; over-cap bodies
      // are skipped inside putIfWithinCap.
      const copy = res.clone();
      event.waitUntil(putIfWithinCap(req, copy));
    }
    return res;
  } catch (err) {
    // Network is unreachable. One more cache lookup in case another tab
    // has populated it in the meantime.
    const fallback = await caches.match(req);
    if (fallback) return fallback;
    throw err;
  }
}
