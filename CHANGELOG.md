# Changelog

Versions track the service-worker `VERSION` in `sw.js` (bumped on every
deploy that changes app behaviour). Keep this file, the collapsed Changelog
section in the help modal (`index.html`), and the `sw.js` version-history
comment in sync — update all three with every release.

Backfill note: v1–v11 entries were reconstructed from the `sw.js` version
history and git log on 2026-06-12; v4–v10 shipped between 2026-05-08 and
2026-05-13 without individually recorded dates.

## v69 — 2026-08-24

**FABDEM mudou de casa.** Os tiles FABDEM agora vêm de
`fabdem.pedalhidrografi.co` (Cloudflare R2, na raiz — sem o segmento
`/fabdem/` do host antigo `telhas`). Mesmos nomes de Bristol, mesmos COGs,
mesmo carregador por HTTP Range — **sem mudança de comportamento**. O
`telhas` segue servindo os tiles rmsampa e os FGBs do viário.

## v68 — 2026-08-23

**2A e 1B mais enxutos.** O checkbox **"Calcular contagem de passagens"** foi
removido — a contagem agora é **sempre** calculada (comportamento idêntico a
deixá-lo permanentemente marcado; bundles antigos com `wantPasses: false`
passam a exibir passes ao recarregar). Dois renomes em 1B: "Interpolar entre
células fora da rede" → **"Interpolar campo de energia"**, e "Calcular sobre
o grafo da rede (seguir os vetores)" → **"Usar grafo viário ao invés de
rasterizado"**. Os seis parâmetros numéricos da rede (larguras, snap,
junções, distância máx, suavizações) viraram uma grade 2×3, e os campos do
2A (Modo → "Orçamento aplica-se a") foram compactados em duas colunas
(rótulo sobre o campo); os coeficientes derivados α_r/α_a/β seguem abaixo.
Só UI — motores intocados.

## v67 — 2026-08-09

**"Soma" que soma de verdade.** Novo modo de mistura das passagens — **"soma
de dados (A+B numa paleta)"**: na vista de diferença (com rede × sem rede),
os dois campos de passagens são somados **célula a célula** e a soma é
pintada pelo pipeline de campo único (percentis/γ/janela do canal A) em
composição normal — escala honesta e independente do basemap. O modo antigo
foi renomeado **"soma de cores (plus-lighter)"** para dizer o que ele
realmente faz: soma as CORES já pintadas contra tudo que está por baixo
(basemap incluso), escalada pela opacidade — por isso satura pro branco
sobre mapa claro e não se comporta como soma de dados. No modo grafo (um
canal é vetorial) a soma de dados não é computável — o modo compõe normal.
Puro re-render (regra dos botões de estilo: nunca dispara recompute).

## v66 — 2026-08-09

**A família FGB agora alimenta a água (1C) e as pontes (1D) também.** Dois
botões novos, irmãos do pull de viário do v65 — tudo servido por HTTP Range
dos FlatGeobufs do projeto no `gs://telhas`, sem Overpass:

- **1C · "Puxar água do FGB (América do Sul · nuvem)"** — as mesmas classes
  d'água do pull do OSM (áreas `natural=water` / `landuse=reservoir` /
  `waterway=riverbank` + linhas `waterway=river`), preenchendo o MESMO cache
  (`osmWaterGeom`) e a mesma rasterização — o toggle "rios intransponíveis"
  segue re-aplicando sem re-consultar. Duas lacunas documentadas (tooltip do
  botão): **sem litoral** (o mar não é preenchido — em DEM costeiro use o
  pull do OSM) e sem filtro de rios em túnel (o FGB não traz a tag).
- **1D · "Puxar do FGB (América do Sul · nuvem)"** — pontes/túneis de VIAS
  do FGB do viário (o `osmium` preserva o recorte das ways nos apoios, então
  a semântica de tabuleiro é a mesma do Overpass; `bridge`/`tunnel`/`layer`
  em colunas). Sem `ele` mapeado (os apoios caem no DEM, o fallback já
  documentado) e sem estruturas ferroviárias (o FGB é highway-only). Mesmo
  checkbox de túneis, mesma cauda `installBridgesFromWays`.

Helper `fgbStream` compartilhado pelos três pulls; nenhuma mudança de engine.

## v65 — 2026-08-08

**Viário do FGB, sem Overpass.** Novo botão em 1B — **"Puxar viário do FGB
(América do Sul · nuvem)"** — que carrega a mesma malha `highway=*` do botão
Overpass, mas servida do FlatGeobuf da América do Sul (gerado pelo
`build-viario.py` do amora, hospedado no `gs://telhas`): o índice Hilbert
R-tree do FGB permite baixar **só os bytes da janela** via HTTP Range — sem
depender do servidor do OSM (e dos timeouts dele), e com `bridge`/`tunnel`/
`layer` já em colunas, normalizadas exatamente como no pull do Overpass (as
duas fontes são intercambiáveis rio abaixo: raster, grafo, pontes 1D via
"Extract from loaded network"). Janela limitada a ~0,25°² (aproxime o zoom);
reusa o flatgeobuf 3.36.0 que a amostragem censitária já carrega.

**E uma re-emissão:** o deploy do v64 saiu **sem o purge da Cloudflare** e a
edge serviu o `app.js` do v63 por até 4 h — clientes que instalaram o SW v64
nessa janela precachearam o app antigo (`cache: "reload"` fura o cache do
navegador, não a edge). O v65 força o re-precache; `deploy.sh` agora carrega o
`.env` (CF_API_TOKEN/CF_ZONE_ID) sozinho, então o purge roda em todo deploy.

## v64 — 2026-08-08

**Routing defaults follow the recommended practice** (`bicycling-energy-model`
journal Entry 74 / paper 3 §3.2(d)). Two config defaults move — no engine
change, no parity implications:

- **DEM smoothing "auto" is now σ = 30 m on every source** (was σ = 10 m on
  fine DTMs only). Coarse sources — FABDEM included — are now treated too: the
  Entry-74 ε-policy contest showed the deployed grade-local ε wins every cell
  on σ30-treated chains on both DTMs, while on raw chains the ordering inverts
  (terrain noise manufactures steep micro-descents a grade-local policy
  refuses to credit). The already-smoothed `ImageDescription` tag guard stays,
  so re-imported exports are not double-smoothed; an explicit σ choice still
  overrides.
- **Move directions default 8 → 16** — the med|Δ%| optimum on the local
  survey, 0.20 pp from FABDEM's n = 32 optimum. 8 remains the "fast" choice
  and the Rust-parity anchor; gains beyond n = 32 are marginal (≤ 0.6 pp)
  against ≥ 2× runtime per rung (and old bundles reload with the nDirs they
  saved).

Bridge/tunnel portals were already on by default and the grade-local descent ε
is unchanged — with σ30 this completes the recommended bundle: **grade-local ε
on a σ30-treated map, 16 directions, portals on**.

## v63 — 2026-07-25

**São Paulo's gravity, not the textbook's.** The model's `g` moves from 9.81 to
**9.7864 m/s²** — the **local** value from IAG-USP absolute gravimetry. 9.81 is
≈0.24% high here, and every DEM this app ships plus every ride the model was
calibrated against sits in the São Paulo metropolitan region, so the local value
is the physical one. Direct consequence: `β = m·g/k_eff` falls 0.7585 →
**0.7567 kJ/m** (visible in the Parameters panel's derived-coefficient readout),
and with it **every energy drops ≈0.24%** on climb-dominated terrain (≈0.2%
mixed — `a_roll` falls 0.24%, but `v_f` rises a hair, so `a_aero` rises 0.10%).
Optimal routes barely move: the whole cost bundle rescales by very nearly a
common factor. An old bundle reloaded recomputes at the new `g`, so it reads
≈0.2% below the raster it stored.

This **re-syncs the app with `bicycling-energy-model`** (that repo's journal
Entry 27), which moved first: while the two disagreed, the sibling applet's
`v2Edge` readout differed from what this app deploys by exactly that ratio.

**Constants only** — no model, engine or wire-format change. `g` is hand-copied
across the `readCost` mirror chain (`app.js` is the origin;
`census/census-density.mjs`, `test-energy-v2.mjs` and every `docs/grid-*.mjs`
harness — `grep 9.7864`), and the Rust backend carries **no copy**: it receives
the already-derived cost bundle over the wire, so JS↔Rust bit-parity is
unaffected (97 cases, max|Δ| = 0, revalidated). Dated research notes keep the
numbers they were published with; the grid-connectivity note gained a gravity
note saying so.

## v62 — 2026-07-12

**Directions ≠ 8 on the cloud/native backend.** The Rust backend (0.2.0)
now serves the full v57 move-direction feature — Farey move sets (4–128),
profile-integrated long edges, swept-cell passes stamping — in **bit-parity**
with the JS worker (the port required V8-exact `Math.hypot`/`Math.round`
mirrors: libm differs by 1 ulp, enough to flip passes on tied costs; 21 new
parity cases in `backend/test-backend.mjs`, all exact-zero delta). Unlike the
JS workers' per-worker tables, Rust builds the long-edge cost tables once per
request and shares them read-only across all rayon slices. The app
version-gates nDirs ≠ 8 dispatch on `/health` version ≥ 0.2.0 — an older
binary silently ignores the field — and reports a clear reason (respecting
"Falhar em vez de cair pro navegador") when the deployed binary is too old.
The time estimate models the nDirs memory terms (38/57 B per cell per slice +
shared tables).

## v61 — 2026-07-12

**Opt out of the silent browser fallback.** New "Falhar em vez de cair pro
navegador" checkbox in the cloud panel (persisted per device): when ticked, a
cloud failure — VM boot, auth, or a failed `/density`/`/single` dispatch —
aborts the run with the error in the status line instead of silently
recomputing on the in-browser worker pool. The fallback is friendly for
casual runs but masks cloud problems and quietly burns laptop CPU on
computes sized for a 128-vCPU VM.

## v60 — 2026-07-12

**Cloud machine-switch ergonomics.** The `/cloud/start` timeout goes 15 → 45 s
(the orchestrator resizes the stopped VM *inside* that call — ~11 s measured,
easily past 15 for bigger shapes — and a client-side abort caused a bogus
"orchestrator unreachable" fallback); the mid-boot restart now carries the
selected `machineType`; a status hint flags a running keep-warm VM whose size
differs from the dropdown (the selection only applies on the next boot); and a
new **"Desligar VM agora"** button in the cloud panel forces that next boot —
switching sizes becomes stop → select → compute, no keep-warm toggling.

## v59 — 2026-07-12

**Cloud compute actually works — and you pick the machine.** The CSP now
allowlists the orchestrator's real `*.run.app` host (cloud mode had been
silently CSP-blocked from the deployed site since it shipped), the default
orchestrator URL points at the live service, and a pasted URL without a
scheme gets `https://` assumed instead of resolving against the page. New
**"Máquina da nuvem"** selector (8/32/128 vCPUs, with per-hour reference
prices; the VM runs as spot, typically 60–90% cheaper): the orchestrator
validates the choice and applies it when creating/restarting the VM, along
with a matching backend memory budget; the time estimate models the selected
size (and its bandwidth-contention curve is now sub-linear — 128 vCPUs no
longer estimate a nonsensical 1.4× over 8). Cloud runs now say
**"Calculando na nuvem…"** (not "backend nativo"), and any fallback to
browser workers states its reason in the status line. Orchestrator-side
(no app deploy needed): DNS stop-placeholder moved to `127.0.0.1` so a
stale-DNS browser fails fast instead of hanging 8 s per poll; CORS allowlists
localhost origins on both planes (local development against the real cloud is
a supported flow); the VM startup script `restart`s its services on reboot
(an already-running Caddy used to keep serving the previous boot's config);
and the VM is pinned to Ice Lake (the cached backend binary is
`target-cpu=native` — a smaller machine on an older CPU SIGILLed mid-compute).

## v58 — 2026-07-11

**Crop DEM to the current view.** New "Recortar DEM à janela atual" button in
1A: crops the loaded DEM to the visible map window — zoom into a
neighbourhood of a huge raster (e.g. the 135 M-cell Sampa Sítio Urbano) and
carve out just that extent for faster computes and less memory. Implemented
as an in-memory export→reimport of the cropped window through the standard
DEM load path, so everything a real load does is inherited: compute
cancellation, mask rebuild (GDAL_NODATA round-trip), CRS GeoKeys, network/
graph/probe invalidation, and the smoothing-tag guard (a crop of an
already-smoothed DEM is NOT re-smoothed — the cumulative σ tag travels with
it; a crop of an unsmoothed DEM follows the current 1A smoothing setting,
like any load). Geographic (lon/lat) DEMs only — same guard as the OSM
pulls. Clear status messages for no-overlap / whole-DEM / too-small (< 2×2
cells) views. Alongside it, **"Reduzir resolução"** (factor 2/3/4/6×)
downsamples the loaded DEM by mask-aware N×N block averaging — the same
transform as `gdalwarp -r average`, so 6× on a 5 m IGC raster lands at
~30 m, the regime where the v2 model is most accurate (journal Entries
19/21). Same export→reimport path, and it works on projected DEMs too (no
viewport involved). Both derivations drop the source URL from bundle
metadata (they are local derivations, like a file-picker load).

## v57 — 2026-07-11

**Move directions, string pulling, KPI grid correction** — the
grid-connectivity research note
(`docs/grid-connectivity-sensitivity-2026-07-11.md`) shipped as options.
New **"Direções de movimento"** select (4/8/16/32/64/128; default 8 = the
classic engine, bit-identical): richer Farey heading ladders with
profile-integrated long moves cut the route-jaggedness optimal-energy
overestimate (measured ≈⅔ less at 16 directions on the SP DTM) at
proportional compute cost. Density runs amortize precomputed long-edge cost
tables per worker (bit-identical to on-demand integration; memory budgeted
by the pool sizer), and passes are stamped over the cells long moves sweep,
so corridors stay continuous. Non-8 values compute in-browser — the native
backend keeps serving the classic 8-move engine (same pattern as
top-N/maximize). New **"string pulling"** checkbox post-hoc shortens the
displayed route and top-N alternatives (windowed DP over the path's own
nodes, profile-integrated straight segments; round/maximize excluded;
recovers ~44 % of the median route-energy overestimate at ~tens of ms) —
the energy shown for a pulled line is that polyline's own integrated sum,
so viewing ≡ routing holds. New KPI **"correção de grade ×c"** input
inflates the two accessibility thresholds (≡ deflating the grid's
overestimated energies; measured c* ≈ 1.09–1.12 at 8 directions) with an
explicit "centered estimate — floor guarantee lost" warning; unnecessary at
≥ 16 directions. All three options persist in bundles; the time estimate
scales with the chosen direction count. New worker-suite sections pin the
nesting (E16 ≤ E8 ≤ E4), a flat-grid analytic heading check, pooled ≡
single at 16 directions (tables ≡ on-demand), maximize forcing 8, and the
string-pulling contract.

## v56 — 2026-07-11

**Accessibility KPIs — "300 kJ city" initiative.** Density runs now also
sample each reference's energy field at every other reference's cell,
producing a pairwise K×K ref↔ref energy matrix at zero extra Dijkstra cost
(the per-ref field already existed transiently inside `densityField`). A new
**"3B. Acessibilidade"** results block evaluates the initiative's two KPIs
live from the cached matrix: the share of the population that can access at
least K people within E₁ kJ (defaults: 1 000 000 people / 200 kJ), and the
share that can access at least J% of the population within E₂ kJ (defaults:
80% / 600 kJ). Census sampling ("IBGE 2022") now records the in-extent
population total M — each reference proxies M/K people, so "% of references"
reads as "% of population"; other sampling strategies take a hand-entered M
(KPI 2 needs none). Threshold edits re-evaluate instantly without a
recompute (style-knob rule); reference markers recolor red→yellow→green by
attained access with per-ref tooltips; per-reference and full-matrix CSV
exports. The Rust backend gains `want_matrix` on `/density` (f32×K² appended
after the energy field, announced by `"matrix":K` in the response meta) in
bit-parity with the JS worker — enforced by new `+matrix` cases in
`backend/test-backend.mjs`, including a dropped-ref index regression (both
engines key matrix rows by the ORIGINAL ref index; an older backend binary
degrades to "KPI unavailable", never a wrong matrix). The block warns when a
threshold exceeds the run's energy budget — the matrix is truncated there,
so the KPIs become lower bounds. New matrix section in
`test-worker-pool.mjs` (brute-force vs single-source, pooled ≡ single,
budget bounds, maximize suppression).


## v55 — 2026-07-07

**DEM pre-smoothing + validated accuracy goal** (`bicycling-energy-model`
journal Entry 20). Fine DTMs (pixel ≤ 10 m, e.g. the IGC-SP 5 m rasters) now
get a static, mask-normalized Gaussian pre-smoothing (σ = 10 m) applied once
at DEM load — the Entry-19 "resolution over-charge" mitigation, in its
journal-validated configuration. New "Suavização do MDT" control in 1A
(auto / off / 10 / 20 / 30 m; auto skips coarse sources like FABDEM and
already-smoothed re-imports, which exported `dem.tif` files now flag via an
`ImageDescription` tag). Heights are smoothed app-side before shipping to the
engines, so JS worker / graph / Rust bit-parity is untouched; changing the
knob takes effect on the next DEM load. With this σ plus per-rider calibrated
parameters (CdA, Crr, k_s fitted on each rider's own ride history — procedure
in the journal), held-out prediction error validated at med |Δ%| 3.7 / 2.7 /
4.9 with bias < ±1% across three independent riders — meeting the ±5% / ±2%
product goal. Honest note: the calibration is the bigger lever; the smoothing
is the validated default that also softens the uncalibrated fine-DEM bias.
New `test-dem-smoothing.mjs` locks the transform (byte-identical mirror of
the app.js copy).

## v54 — 2026-07-07

**Energy-model journal alignment** (`bicycling-energy-model` journal Entries
18/19; `docs/energy-journal-2026-07-06-workorder.md`). Reference-geometry
(imported/drawn track) energy readout only — routed-path/field energy is
untouched. `refEnergyKJ`'s descent-recovery ε now ports the champion
harness's `epsGeom` estimator exactly: drop-weighted over 30 m-resampled
cells, replacing a lumped mean-descent-grade approximation its own comment
had claimed but never implemented. Also clarified (code comments +
`CLAUDE.md`, no behaviour change): the v2 engine's trailing descent-cost
clamp is provably dead code — a 1.78 M-combo parameter sweep plus 1 402 real
rides never once triggered it — and is kept only for JS/Rust bit-parity. New
disclosures: the v2 model is tuned for ~30 m DEM sampling, so on the deployed
5 m IGC-SP DTM energies read conservatively high on hilly terrain (help
modal, PT/EN); and FABDEM is not recommended for energy work on flat/urban
terrain, since its per-pixel noise inflates measured ascent.

## v53 — 2026-07-03

**Icon cache-bust fix.** v50's icon redesign kept every filename identical to
minimize the diff — but `deploy.sh` sets a 30-day `Cache-Control` on `icons/`,
and its own comment already warned about exactly this: a browser or
Cloudflare edge that had cached the old icon bytes under that header wouldn't
see the new one for up to 30 days, no matter how many times the site got
redeployed. Every shipped icon file (`icon.svg`, `icon-192`/`512`, the
maskable `192`/`512` variants, `apple-touch-icon`) is renamed with a `-v2`
suffix — a new URL bypasses every existing cache outright, old or new.
`favicon.ico` is the one exception (browsers fetch it at a fixed well-known
path, so it can't be renamed); its cache lifetime is cut from 30 days to 1 so
this specific failure mode doesn't recur for it. Next icon redesign: bump
every filename to `-v3` (see the comment above the icon `gcloud storage
objects update` call in `deploy.sh`).

## v52 — 2026-07-03

**Cross-repo energy-model audit fixes.** An adversarial audit against
`bicycling-energy-model` (the energy law's spec repo) confirmed `v2Edge` is
correctly implemented everywhere it's called — zero computational bugs in the
core cost function — but surfaced two engine-vs-engine inconsistencies:
graph-mode **maximize** now respects mode `"to"` (it previously always scored
the walk forward from `srcNode`, unlike top-N and the raster
`maxCostPathOfLength`, which already handle this); **round-mode path energy**
now reports the round-trip total (forward + backward) instead of silently
recomputing just the outbound leg. Two new regression tests
(`test-graph-engine.mjs`) confirm both bite on the unfixed code. Also fixed a
stale code comment (`abRatio` was documented as smoothed; it's deliberately
not) and removed the legacy QGIS plugins (`qgis/`) this app was originally
ported from — long superseded by `energy-worker.js`'s v2 engine and never
part of the deployed file set.

## v51 — 2026-07-03

**Second full-repo review fix batch** (`docs/review-2026-07-02-round2-workorder.md`),
covering rendering/export, bundle round-trip, data loaders, cloud-ops, i18n
completeness, the DP/interp worker paths, memory at scale, and a fresh-eyes
pass on v49 itself:

- **Correctness.** Top-N alternative routes now report their true (un-penalised)
  energy instead of the A\*'s internal penalised search cost; the length-constrained
  DP now respects **"até"** mode's travel direction and soft-masks the start cell
  like every other search mode; per-cell top-N repulsion can no longer go
  negative. The graph-mode spatial hash is now a packed-integer CSR structure
  (was string-keyed) — faster and bounded, with a safe fallback for
  out-of-bounds geometry. Graph T-junctions merge correctly regardless of which
  side of a snap-tolerance boundary the touching vertex falls on. Bundle
  binary-replay now checks the DEM's full geotransform, not just its
  dimensions — a same-size DEM at a different location can no longer silently
  render a bundle's rasters/routes at the wrong place. A rapid double-click
  across two DEM-loading buttons can no longer let the slower load's parse
  silently overwrite a faster, more-recent one.
- **Cloud.** The in-VM cost backstops (idle watchdog, uptime cap) now install
  *before* any network-dependent boot step, so a transient failure can't leave
  a VM running with zero safety net. The orchestrator now tracks a short-lived
  per-tab lease (`X-Simu-Client`) so a second browser's "stop after run" can't
  kill a VM mid-compute for someone else, and reads the X-Forwarded-For chain's
  *last* (Cloud-Run-appended, unforgeable) entry instead of the first
  (client-spoofable) one for its firewall rule.
- **Robustness.** DEM/OSM/vector loaders gained DEM-identity guards (a DEM swap
  mid-load can no longer install a stale-sized layer), Overpass timeout/partial
  responses are now detected and rejected instead of silently installing
  incomplete data, multi-band GeoTIFFs and GDAL_NODATA comparisons are read
  correctly, and worker pools/interp workers are properly torn down instead of
  accumulating. Exported GeoTIFFs and PNG world files are now correctly
  georeferenced (including the stride-downsampled huge-DEM case and
  FABDEM-derived CRS tags), and a crafted zip bundle can no longer OOM the tab
  before its size is checked.
- **Security & i18n.** Added a Content-Security-Policy meta tag; the help
  dialog now traps focus while open. Filled in the last hardcoded-English UI
  strings (DEM metadata, colormap group labels, OSM/DP status and warning
  messages) and rewrote the help modal's stale sections (compute-source radio,
  graph mode, compare view, dormant "maximizar" wording removed).
- **Docs.** README/CLAUDE.md/orchestrator+vm READMEs corrected to match shipped
  behaviour (compute-source radio, deploy bucket, lease semantics, the
  `--dry-run` token requirement); the "Viário RMSampa" example network gained
  a provenance doc and its OSM/ODbL attribution.

See the work order for the full 78-finding list and disposition; one item
(a linear-taper fix for the climb-threshold cost discontinuity) is deliberately
deferred to its own release, and the OSM `ele`-tag pull-through for graph-mode
decks is deferred pending a live-tested Overpass query change.

An adversarial re-review of this batch's own diff (hunting specifically for
damage from the lane agents' unintended concurrent editing of `app.js`) found
none, but caught two genuine new races the batch introduced: the OSM
water-mask rebuild's staleness check reused a generation counter that also
bumps on unrelated bridge/impassable toggles (now checks DEM identity
instead, like every sibling loader), and a DEM load's generation guard only
covered its fetch stage — a slow parse could still silently finish after and
overwrite a faster, more recent load (now re-checked right before the DEM is
installed).

## v50 — 2026-07-02

**New app icon.** Replaced the old bicycle glyph with a yellow ascent arrow
crossing a blue topographic contour field — closer to what the app actually
computes (climbing effort over terrain relief). Regenerated every size
(`favicon.ico`, `icon-192.png`/`icon-512.png`, `apple-touch-icon.png`, and the
maskable `192`/`512` variants, safe-zone-padded the same way the previous
design was) from the new design source (`simujaules-v2.png`, kept at the repo
root). `icon.svg`/`icon-maskable.svg` now wrap that raster in an SVG shell
instead of hand-authored vector paths — the contour texture isn't practical
to hand-vectorise. Same file names/paths throughout, so `manifest.webmanifest`
and `deploy.sh` needed no changes. The same icon now also sits beside the
**"Simujaules"** title in the panel header (`icons/icon-192.png`, 28×28,
decorative/`alt=""`) — previously the header had text only.

## v49 — 2026-07-02

**Correctness fixes from a full-repo review** (`docs/review-2026-07-01.md`), spanning
the browser engine, the graph engine, the Rust backend, and app.js:

- **Top-N routes.** The A\* heuristic overcharged gentle descents under the v2 model
  (up to 3.3×), so route #1 could cost more than the energy field's own optimum —
  replaced with a heuristic derived from the model's true per-metre cost floors
  (admissible **and** consistent; proof is in the code comment). Routes in **"até"**
  mode now score the real travel direction (destination → reference), matching the
  field and best path, instead of always scoring reference → destination.
- **Maximizar energia** (dormant since v36 — no UI toggle, but the engine and native
  backend still implement it) ignored the kJ energy budget while inverting costs,
  silently pruning the whole field on any realistic budget. The budget is now forced
  to 0 under maximize on every path (browser, native backend, graph), with the `#e-max`
  input greyed out (and re-enabled) the moment the toggle exists again.
- **Graph mode ("seguir os vetores")** sampled terrain **half a cell off** the raster
  engine's grid convention — every node height, edge profile and deck ground-endpoint
  was displaced and low-pass filtered. Fixed at the source (`sampleHeight`); also
  fixed the matching half-cell shift in energy/passes rasterisation and in
  source/destination/reference node snapping. A street ending on another street's
  interior (a **T-junction**) now correctly joins the network in *cruzamentos* mode
  instead of silently splitting into disconnected components. A bridge/tunnel mapped
  as several consecutive OSM ways now flattens as **one continuous deck** instead of
  dipping to the valley floor at each joint. Node snap tolerance is now capped at
  **15 m** on coarse DEMs (was a flat 0.5 cells → 45 m on COP90 90 m).
- **Native backend.** "Maximizar" density runs under a network constraint now derive
  their height range from the full DEM, matching the browser engine (previously
  diverged wholesale whenever the network excluded the DEM's height extremes).
  `/single` passes counts are now exact on very large DEMs (shipped as 64-bit floats,
  matching the browser engine above 2²⁴ counts); `/single` now rejects
  `maximize` with a clear error instead of silently returning a degenerate field.

**Hardening.** A crafted `.gpkg` file with a non-numeric `srs_id` could inject HTML
on load — the value is now coerced at the source. Importing a bundle mid-compute now
cancels the running job before swapping the grid underneath it. The compute-time
estimate no longer sticks on "estimating…" forever if the calibration probe fails —
it retries on the next run.

**PWA & deploy.** Every site deploy was silently deleting the cloud orchestrator's
VM startup script (`vm/` was missing from the deploy exclude list) — fixed; the
service worker now fetches the precached app shell past the browser's HTTP cache, so
a version bump can no longer install a stale or mixed-version app; and large data
files (GeoTIFF DEMs, `.gpkg` networks — e.g. the 145 MB *Viário RMSampa* example) are
no longer pulled into the offline cache or silently re-downloaded in the background.

**i18n.** The OSM bridge/tunnel pull's status messages are now translated (PT/EN),
and round-trip runs with top-N routes note that alternative-route energies cover the
outbound leg only.

**Docs & offline tooling.** The README, in-app help modal, `llms.txt` and JSON-LD
metadata described the **retired v1 α/β/η cost model** — rewritten to the v2 physics
model that's actually shipped (mass/Crr/CdA/ρ/k\_eff/climb-threshold). Density docs
now correctly say passes are **summed** (not averaged) across reference points. The
offline census-density pipeline (`census/census-density.mjs`), broken since v44's
physics-model change, sends the v2 cost bundle again; its README now points at the
live `gs://simujaules` bucket instead of the retired `telhas` one.

## v48 — 2026-06-29

**Source→destination route comparison.** With *"Comparar com cenário sem
rede"* on, the *"Cenário exibido"* picker now switches the best **route** too,
not just the energy/passes field:

- **`sem restrição`** → the unconstrained best **terrain route**, in **blue**.
- **`restrito à rede`** → the network-constrained best **route**, in **orange**.
- **`diferença`** → **both** routes together (terrain blue + network orange).

The colours match the density difference view exactly (`TERR_BLUE` /
`NET_ORANGE`, additive complements). One best route per scenario — top-N
collapses to the optimum here.

**Hover / tap a route to compare.** Pointing at *either* line shows BOTH
routes' energy + length at once (network in orange, terrain in blue) plus the
Δ (the energy cost of staying on the network), with the line you're on
emphasised. Bound as a hover tooltip *and* a click/tap popup, so it works on
desktop and touch.

Implementation: the compare run's unconstrained partner — previously fired
energy/passes-only (`goalR/goalC = -1`) — now keeps the destination so it also
traces the terrain route (`pathAlt`). Works in both raster network-mask mode
(`startComparePair`) and graph "seguir os vetores" mode
(`computeUnconstrainedEnergy`). The route renderers (`rerenderCachedResult`,
`renderGraphOverlay`) honour the scenario picker, and in raster mode the
terrain route round-trips through bundles (`path_alt.geojson`; graph-mode
compare routes don't round-trip — graph results never do). Render/dispatch
only — no change to the energy engine or the Rust backend.

## v47 — 2026-06-29

Reverted the MTPI basemaps added in v46 — they were meant for amora, not
Simujaules.

## v46 — 2026-06-29

Two **MTPI** (multi-scale topographic position index) basemaps in the basemap
dropdown — **Pindorama 90 m** (COP90, South-America-wide, native zoom 10) and
**Bacia do Paraná 30 m** (native zoom 12) — served as XYZ tiles from
`telhas.pedalhidrografi.co`. `maxNativeZoom` over-scales past native instead of
404ing.

## v45 — 2026-06-29

Bridge/tunnel **deck passes** read as a continuous line again. A bridge deck is a
1-cell-wide line over water (`mask=0`, unreached by the compute), so its stamped
density was faint and got dropped by the passes-overlay downsample on large DEMs
— a **gap along the bridge** in the density layer. The deck stamp is now dilated
by the render stride so it always lands on a sampled cell. Render-only; the
engine/routing is unchanged.

## v44 — 2026-06-29

The **v2 energy model**. The cost is now **physics-parameterised** — *mass, Crr
(rolling), CdA (drag), ρ (air density), drivetrain efficiency, power on the flat*
and a *climb threshold* replace the old α/β/η knobs. Per edge the model splits rolling
from aero and charges **aero only off the climbs**, with a **per-grade descent
recovery** ε = clamp(min(1, (α/β)/s) − 0.13). The JS worker, the graph engine and
the **Rust backend** all move together and stay bit-parity (`test-backend.mjs`);
a new `test-energy-v2.mjs` locks the closed form to the canonical model. The
*Geometria de referência* energy now uses the v2 closed form with a **2 m
elevation deadband**. Reference: `bicycling-energy-model/notas.md` (v2).

Defaults are São Paulo-context (ρ=1.1, Crr=0.008, mass 75 kg, ~80 W flat power).
The Parameters panel shows the derived per-edge coefficients **α_r** (rolling),
**α_a** (flat aero) and **β** (climb) in kJ/m, plus a **k_smooth** knob (1 = no
smoothing, as a per-edge engine needs; ≈0.74 is the FABDEM closed-form value) and
an adjustable **elevation deadband** for the reference-geometry energy (default
2 m; 0 = off). The UI font is now **IBM Plex Mono**.

## v43 — 2026-06-26

A reference-geometry GPX layer + plain-decimal energy. **JS/UI only — engine
untouched.**

- **New "Geometria de referência" layer.** Its row in the layer-control panel
  carries an **↑ upload button** (in place of the opacity slider) that loads a
  **GPX track**, drawn as a magenta overlay on its own reorderable pane (with a
  visibility checkbox). **Hover or click** the track for its metrics: **distance,
  total energy, total ascent, total descent**. Energy uses the app's asymmetric
  `α·dist + β·dh` model with the *current* parameters (recomputed on each open).
  Elevation comes from the GPX `<ele>` if present, else sampled from the loaded
  DEM; without either, only distance is shown.
- **Energy is now shown as a plain decimal** (e.g. `3357 kJ`) instead of
  scientific notation (`3.3e+3 kJ`), in the legend, the energy min/max
  placeholders and the reference-geometry metrics. Passes/density keep scientific
  notation (they span ~1e-9…1e-3).

## v42 — 2026-06-26

Moved the map attribution into the help modal. **JS/UI only — engine untouched.**

- Removed the on-map Leaflet attribution strip (`attributionControl: false`). The
  same credits — Leaflet, Leaflet-Geoman, © OpenStreetMap contributors, © CARTO,
  © Esri (Maxar, Earthstar Geographics), and the `pedalhidrografi.co` buried-
  hydrography overlay — now live in an **"Atribuições / Attributions"** section of
  the help modal, with links.

## v41 — 2026-06-26

Mobile layout fix for the on-map buttons + the layer-control panel. **JS/UI
only — engine untouched.**

- On phones the **locate / hamburger / layer-control buttons** now mirror the
  desktop top-right stack (8 / 56 / 104) instead of being scattered to the bottom
  corners. The **layer-control modal opens below them**, so it no longer covers
  the buttons — previously the tall modal extended down over the bottom-corner
  buttons and you couldn't tap the layer button to close its own modal.
- The layer-control modal now **scrolls vertically** when space is tight: its
  2-column flow moved into a `height:auto` child, so overflow scrolls the panel
  down instead of spilling sideways into extra columns (no more horizontal
  scrollbar).
- Sized for an iPhone SE; covered by a new headless test (`check-mobile-layout`).

## v40 — 2026-06-25

Passes are always visualized as a **normalized density**, never raw counts.
**JS/UI only — display-only and colour-invariant; the engine, export and
bit-parity are untouched.**

- A single run's passes are subtree-size *counts*, while the multi-reference
  density path already normalizes by `H·W` twice — so the two read on wildly
  different scales (a 3C channel showing `12` instead of the density's `~1e-10`).
  Count-based passes are now scaled by `1/(H·W)²` into the **same units as the
  density**, at every passes render point (graph vectors, graph/raster rasters,
  the difference view) — never energy. Fields already normalized (max < 1) are
  left untouched, so density runs aren't double-divided. Because it's a constant
  scale, the percentile-normalized colour/pattern is unchanged — only the
  displayed numbers and auto-bound placeholders move to density units. The
  GeoTIFF export stays counts.

## v39 — 2026-06-25

Density-display polish, dataset export/import, and map fixes. **JS/UI only —
the compute engine, Web Worker and Rust backend are untouched and stay
bit-parity.**

- **Graph-mode passes (3C):** the network-passes vectors keep a true orange
  (and the terrain channel a true azure) — intensity is now encoded as opacity
  instead of a multiply that darkened mid-values into a muddy yellow-brown, so
  min/max edits read clearly. The **"filtro média N"** filter now applies to the
  network channel: precise vectors when empty, a rasterised + mean-smoothed field
  when set (and the difference view composites network + terrain into a single
  orange/azure raster, like raster mode). The **3C.a passes** and **3B energy**
  min/max inputs now show the resolved auto numbers as their placeholders (they
  were stuck on the static `p10`/`p90`/`auto`).
- **Sidebar:** once the groups overflow one column, they balance evenly across
  the columns (minimum height variance) instead of overloading column 1.
- **Map:** the rmsampa-v2 hydrography overlay renders crisp on HiDPI / retina
  displays and no longer disappears when you zoom past ~z17 — `detectRetina` with
  a DPR-aware native-zoom cap, so it never requests the non-existent z17 tiles.
- **Group 0 — export/import** of the four input datasets, same format both ways:
  1A DEM and 1C mask as GeoTIFF, 1B network and 1D bridges as GeoPackage (a new
  in-browser `.gpkg` writer, QGIS-readable).
- **Layer-control panel** is now resizable to two columns by dragging its left
  edge, matching the sidebar.

## v38 — 2026-06-25

A UI/UX review pass. **JS/UI only — the compute engine, Web Worker and Rust
backend are untouched and stay bit-parity.**

### Units

- The **energy budget stays in kJ**, so the cost coefficients α/β are labelled
  **kJ/m** again (reverting v37's J/m). No engine change — only the nomenclature.
- **Downhill recovery (η) is now a 0–100 percent** input (default 10), divided by
  100 at the compute reads; bundles keep the 0–1 fraction and a one-time
  persistence migration scales an existing `0.1` up to `10`.

### Visual & interaction

- The **collapse/expand group cue is a quiet grey bar** now, not a loud near-white
  border that out-shouted the green/orange/yellow/red **status** colours.
- **"Baixar bundle" is a secondary button** so **"Calcular"** is the only primary.
- **Drawing**: the active draw button shows an **armed** state and **Esc cancels**
  a draw; the **"Concluído em…" pill auto-dismisses**; the disabled **"Calcular"**
  button now **explains what it needs**; enabling density **auto-opens** the
  points/references group.

### Accessibility

- Icon buttons, file pickers and the layer-panel rows now have **bilingual
  accessible names**; native checkboxes/radios/sliders get `accent-color`;
  reorder/help/lang **touch targets ≥24px**; **reduced-motion** respected; the
  floating layer panel is `role="region"` (not a fake modal).

### i18n / copy / mobile

- Fixed PT/EN leaks (calibration text, budget tooltip); **shortened two over-long
  select options** so they no longer clip; PT Twitter description; the help-modal
  title; the "Cláudio" credit typo.
- **Mobile**: the locate button hides while the drawer is open and the layer
  button moves to the bottom stack; the drawer gains bottom padding.

### Example datasets

- **1B** gains a one-click **"Viário RMSampa"** loader (the ~145 MB RMSampa road
  network `.gpkg`) and **1C** an **"Águas RMSampa"** water-mask loader (a ~2.4 MB
  `.tif` covering the full RMSampa region), both fetched from the bucket. `deploy.sh` now excludes the `vector/` and `mask/`
  prefixes from the bucket prune (same out-of-band pattern as `census/`).

## v37 — 2026-06-25

UI refinements on top of v36. **JS/UI only — the compute engine, Web Worker and
Rust backend are untouched and stay bit-parity.**

### Changes

- **Sidebar groups reordered & trimmed.** 1B–1D and 2A–2C controls were
  regrouped/renamed; "maximizar energia" and the "origem das referências"
  dropdown were removed.
- **Multi-column sidebar.** Each column now fills top-to-bottom before content
  spills into the next, and the panel scrolls **vertically only** — no
  horizontal scrollbar when content is tall.
- **Label tables.** The 1B network parameters and the 2A parameters are now
  2-column **label | input** tables. Cost coefficients are labelled **J/m**
  (α ≈ 0.008 J/m, β ≈ 1 J/m) and the budget in **kJ**; "recuperação na descida"
  stays a 0–1 fraction (shown as %).
- **Results styling moved to the layer panel.** The energy-field, trajectory-
  density and legend controls (former 3B–3D) now live at the bottom of the
  on-map **Controle de camadas** panel; its × button was removed (the layer
  button toggles it and Esc closes it). Statistics (3A) stay in the sidebar.
- **Group highlight.** Collapsed groups read grey, expanded groups white — the
  same border + left-bar treatment as the green/orange/yellow/red status
  colours, which still take priority. 1C/1D now turn **green** when you've drawn
  barriers/corridors/portals, even with nothing else loaded.
- **Branding.** The app title is now **Simujaules** with the tagline
  *"Imaginador de caminhos fáceis para o encontro."*

### Fixes

- Collapsing the sidebar no longer blanks the map (the map cell now fills the
  viewport and Leaflet re-fits).
- The rmsampa-v2 hydrography overlay no longer requests (404) tiles past zoom 16
  — it upscales the z16 tiles instead.
- **Deploy:** `deploy.sh` now excludes the `census/` prefix from its
  `--delete-unmatched-destination-objects` prune, so the out-of-band population
  FlatGeobuf survives deploys.

## v36 — 2026-06-24

A large UI/UX overhaul. **JS/UI only — the compute engine, Web Worker and Rust
backend are untouched and stay bit-parity; the no-op invariant holds (with no
drawings/overrides the compute grid is byte-identical).**

### Features

- **Nested collapsible groups.** The sidebar is reorganised into numbered,
  collapsible `<details>` groups: **0** Import/Export · **1** Inputs
  (1A DEM · 1B network · 1C barrier mask · 1D bridges) · **2** Compute setup
  (2A Parameters · 2B Points & references · 2C Execution) · **3** Results
  (3A Statistics · 3B Energy field · 3C Trajectory density [3C.a network /
  3C.b terrain] · 3D Legend). Everything starts collapsed except 1A; groups
  auto-expand as you load a DEM / network / mask / run / bundle. Each group
  shows a **status colour** (green/orange/yellow/red) reflecting its state.
- **Layer control panel.** All layer visibility/opacity/stacking-order +
  basemap (now including an **Esri satellite** option) + reference-marker
  toggle moved into a **non-blocking, top-right on-map panel** ("Controle de
  camadas"), opened from a floating map button that highlights while open.
  Each layer is one row: reorder arrows, visibility, name, opacity.
- **Floating compute feedback.** The progress bar + status/log messages now
  float in a dismissable pill at the bottom of the map, so they stay visible
  regardless of the sidebar layout.
- **Draggable multi-column sidebar.** Drag the sidebar's right border to snap
  it to 1–4 fixed-width columns (desktop/landscape); the hamburger also
  collapses/expands the docked sidebar on desktop. Both are remembered.
- **Full config persistence + portability.** Every toggle/value now persists
  across sessions; Group 0 gains **Export / Import / Reset** config buttons,
  and bundles embed the entire UI state (not just the parameter subset).
- **On-map drawing tools (Leaflet-Geoman).** Draw **barrier** and **passable
  corridor** polygons (1C) and **portal** lines (1D) directly on the map; they
  feed the compute (barriers block, corridors reopen, portals are bridge
  shortcuts) and round-trip through config + bundles.
- **Smaller touches:** density tweaks follow the displayed channel (terrain vs
  network); passes auto-max uses p90 of cells above auto-min; density bounds
  show in scientific notation; locate drops a marker + accuracy circle; the
  credit line moved into the help modal.

### Notes

- Adds the **leaflet-geoman** CDN library (SRI-pinned, runtime-cached offline
  like the other libs). Sampling-strategy order is now Censo (default) / Sobol
  / Uniforme (Halton dropped).

## v35 — 2026-06-24

Two changes ship together, numbered **v35** to avoid a version clash with the
in-flight `feature/ui-overhaul` branch (which already uses v33).

### Changed

- **App moved to its own domain.** The simulator now lives at the root of
  **https://simujaules.pedalhidrografi.co/** (a dedicated `gs://simujaules`
  bucket) instead of `telhas.pedalhidrografi.co/simujoules/`. The brand is
  spelled **Simujaules** — a deliberate, affective typo of *joules*.
  - Absolute URLs (canonical / Open Graph / schema.org, the bundled example
    DEMs, the census FlatGeobuf, `sitemap.xml`, `llms.txt`) repoint to the new
    root.
  - The RDF `@vocab` namespace IRI deliberately **stays** on
    `telhas.pedalhidrografi.co/simujoules/vocab/…` (a stable linked-data
    identifier) and resolves to the new domain via a redirect, so previously
    exported bundles keep validating.
  - Shared raster assets (the `rmsampa-v2` overlay and FABDEM tiles) stay on
    `telhas`.

### Features

- **Cloud compute now works when the app is accessed remotely**, not just from
  localhost. The "Nuvem (VM orquestrada)" option is available from
  `simujaules.pedalhidrografi.co`; fill in the **Orchestrator URL** and the new
  **Cloud password** to use it.
  - The orchestrator is now a public, **password-gated Cloud Run** service. It
    creates / starts / stops / **deletes** the GCP spot VM on demand. The
    browser sends the large compute payloads **directly to the VM over HTTPS**
    (Caddy on the VM, TLS via Cloudflare DNS-01) — they don't fit through Cloud
    Run, so only the lifecycle calls go to the orchestrator.
  - The same password gates both the control plane (orchestrator) and the data
    plane (the VM). On a wrong password / unreachable orchestrator / boot
    failure, the run falls back to the in-browser worker pool.
  - The VM uses an **ephemeral IP** (no idle-billed static address); the
    orchestrator rewrites the `compute.simujaules.pedalhidrografi.co` DNS record
    to it on each start. After **30 days idle** the VM is **deleted** (rebuilt
    on demand on next use), so long-term idle cost is ~0.
- No engine / numeric changes; all compute output is identical.

## v32 — 2026-06-24

### Features

- **New "IBGE 2022 census (population density)" reference-sampling strategy.** A
  fourth option in the density panel's *Sampling strategy* selector. Instead of
  spreading reference points uniformly (pseudo-random / Sobol / Halton), it
  samples them by **where people actually live** — a live, in-browser port of
  `census/sample_census.py`:
  - Fetches the census **setores** intersecting the current DEM's bounding box
    from a cloud-hosted **FlatGeobuf** over **HTTP Range requests** — only the
    bbox slice transfers (a few hundred KB for a city), never the ~450 MB
    national file. The dataset is the IBGE 2022 *malha de setores* joined to the
    *básico* population (`v0001`), built by the new `census/build_fgb.py` and
    served from `gs://telhas/simujoules/census/setores_br_pop.fgb`.
  - Weights each setor by `pop · (area clipped to the DEM / full area)`, picks
    setores by a **1-D Sobol inverse-CDF**, and places each point inside its
    setor with a **2-D Sobol** bbox draw + point-in-polygon rejection (structural
    parity with the Python; bit-parity is not required).
  - **Brazil-only** and **online-only** (consistent with the Overpass/FABDEM/
    cloud features) — clear messages when the DEM is projected, outside Brazil,
    has no populated setores, or the network/library is unavailable. Replaces the
    current reference set (like the GeoJSON file loader); JS-only, backend
    untouched. Adds the `flatgeobuf` CDN library (runtime-cached like the others).

## v30 — 2026-06-23

### Fixes

- **Bundles now round-trip the "Comparar com cenário sem rede" (compare) view.**
  Export/import was unaware of the compare scenario: it saved only the constrained
  `energy`/`passes`, and metadata never recorded the `#vec-compare` toggle — so a
  reloaded compare bundle lost the displayed-scenario picker and the difference /
  unconstrained views entirely. Now `downloadBundle` writes the unconstrained
  energy + passes and the saved (network-masked, interp-filled) difference field
  (`energy_unconstrained.tif`, `energy_difference.tif`, `passes_unconstrained.tif`),
  `buildMetadata` records `compare` plus the previously-missing `e-max-mode`, and
  load restores the toggle and rebuilds `energyAlt`/`passesAlt` so the scenario
  picker and the orange/blue difference view come back without recomputing.
  (Graph-mode "follow the vectors" compare restore remains a known follow-up —
  graph results aren't cached in the bundle yet.)

## v29 — 2026-06-23

### Features

- **Difference (network-cost) passes view: colourblind-safe recolour.** The
  two-scenario overlay went from light **red/green** (invisible to red–green
  colour-blindness; overlap only a soft yellow) to an **orange (network,
  constrained) / azure-blue (terrain, unconstrained)** additive-complement pair
  that sums to **white** — so where both scenarios route together brightness is
  maximal, while each colour alone sits on the blue–yellow opponent axis and
  stays discriminable under the common red–green CVD. The two passes control
  groups now carry colour-chip labels (**Network** / **Terrain**) so it's clear
  which channel each drives.

## v28 — 2026-06-23

### Internal

- **Network interpolation pool budgeted by `deviceMemory`.** The post-compute IDW
  network fill sized its worker pool against a fixed 1.5 GB budget, which pinned
  large DEMs (e.g. the 135 M-cell `sampa_geral`) to a single interp worker. It now
  budgets against `navigator.deviceMemory` (like `densityPoolSize`) plus the
  `#max-workers` override, so the interp parallelises across cores when the RAM is
  free (it runs after the Dijkstra workers are released; in Cloud mode the browser
  never ran them). Output unchanged.

## v27 — 2026-06-23

### Features

- **Cloud "keep VM warm between runs" toggle.** With it ticked, a run no longer
  stops the cloud VM when it finishes — the VM stays up so the next run reuses it
  instantly (only the first run of a session pays the ~1–2 min boot). The
  orchestrator lease + the in-VM idle-watchdog stop it after ~15 min idle (hard
  cap 2 h). In keep-warm mode, hiding/switching the tab no longer stops the VM;
  only a real page unload does. Default stays "stop after each run" (cost-safe).

## v26 — 2026-06-23

### Features

- **Cloud compute source.** The single "Use native backend (Rust)" checkbox is
  now a three-way **Compute source** selector: **Browser** (in-page worker pool,
  the default), **Localhost** (the native Rust backend, with its URL field), and
  **Cloud**. Cloud drives a small local orchestrator (default
  `http://127.0.0.1:8079`) that boots a pre-baked VM on demand, waits for it to
  report healthy, proxies the existing `POST /density` and `POST /single`
  compute requests through it byte-for-byte, then stops the VM after each run
  (and on tab hide via a `sendBeacon` to `/cloud/stop`). While a compute is in
  flight the app extends the VM lease with a periodic `/cloud/keepalive`.
- **Transfer-size estimate.** With Cloud selected, a line shows the estimated
  upload / download bytes and the wire time at an assumed uplink/downlink, so
  the network cost of a remote run is visible before pressing Compute.
- **Cloud is local-only.** The Cloud option is offered only when the applet is
  served from `localhost`/`127.0.0.1`/`[::1]` or `file:` (the orchestrator
  binds loopback); otherwise it's disabled with an explanatory note.
- **Graceful fallback.** On any orchestrator-unreachable or VM-boot failure the
  run falls back to the in-browser worker pool, with a cloud-aware status
  message. Browser/Localhost behaviour and engine bit-parity are unchanged — the
  compute path is untouched; Cloud just sends the same bytes to a proxy URL.

## v25 — 2026-06-22

### Fixes

- **Graph mode locked out the comparison toggles instead of honouring them.**
  v24 greyed out both "Constrain to network" and "Compare with unconstrained"
  while "Compute on network graph (follow the vectors)" was on. Now graph mode
  *runs* the comparison: "Constrain to network" is forced on and locked (graph
  mode is inherently network-constrained), while "Compare with unconstrained"
  stays togglable. With it on, graph mode computes a full-DEM **unconstrained
  raster** scenario alongside the graph compute and exposes the energy
  difference (the cost of being restricted to the network) through the
  "Displayed scenario" picker — graph / unconstrained / difference.
- **The native backend was unusable with multi-reference density off.** "Use
  native backend (Rust)" lived inside the density panel, so it disappeared
  whenever density was unchecked. It's now a top-level compute option (always
  visible).

### Features

- **Native backend single-source energy fields.** The backend previously only
  computed multi-reference density. A new `POST /single` endpoint accelerates
  single-source `from`/`to`/`round` energy-field runs (energy + optional passes)
  on the native server too, with the same auto-fallback to browser workers.
  Top-N routes, the destination path, and "maximize" stay browser-only (the
  backend produces no routes). `energy-worker.js` and `backend/src/main.rs` are
  kept bit-parity — `test-backend.mjs` gained `+single` cases (from/to/round ×
  budget × portals × network × passes), all matching to 0 ULP.

## v24 — 2026-06-21

### Fixes

- **Graph mode silently suppressed the constrained-vs-unconstrained compare.**
  "Compute on network graph (follow the vectors)" wins the run dispatch over the
  raster "Constrain to network" / "Compare with unconstrained" toggles, so with
  graph mode on — and it's persisted in localStorage, so it can be on from a
  prior session — the compare never ran and its "Displayed scenario" dropdown
  (constrained / unconstrained / difference) never appeared. Graph mode now
  **greys out and disables** those two toggles (with an explanatory tooltip)
  while it's on, both on toggle and on load, so the precedence is visible.

## v23 — 2026-06-21

### Features

- **OSM `ele` on bridge/tunnel decks (group 1d).** "Pull bridges & tunnels from
  OSM" now also fetches node `ele` tags and uses the mapped deck elevation for the
  raster **portal** endpoint heights, instead of guessing from the bare-earth DEM
  at the abutments. Per-abutment: the way-end node's `ele` if mapped, else a
  way-level `ele`, else the nearest mapped node from that end. Unmapped ends fall
  back to the DEM (NaN sentinel), so a pull **without** `ele` is byte-identical to
  v22. The mapped elevations are persisted in the bundle (`bridges.geojson`).

### Internal

- Portal endpoint heights (`hu`/`hv`) are threaded through the worker pool and the
  native backend Blob (now 32 B/portal: i32 u, i32 v, f64 lenM, f64 hu, f64 hv).
  `energy-worker.js buildPortalAdj` and `backend/src/main.rs build_portals` apply
  the identical NaN→DEM fallback and stay bit-parity (`test-backend.mjs` `+portals`
  cases now mix NaN and explicit `ele`). Graph mode ("follow the vectors") is
  unchanged (still DEM-based). A* top-N / maximise still ignore portals.

## v22 — 2026-06-21

### Features

- **Pull water from OSM (group 1c).** A new button queries Overpass over the DEM
  extent and builds the impassable mask directly — no GeoTIFF upload needed.
  Impassable =
  - water **areas** (`natural=water` / `waterway=riverbank` / `landuse=reservoir`,
    ways **and** multipolygon relations) — even-odd polygon-filled, islands become
    holes;
  - the open **sea/ocean** (from `natural=coastline`, which OSM stores as a
    directed line with land-left/water-right) — filled by a horizontal **and**
    vertical orientation sweep that sets each span's side locally, so coastline
    gaps/open-ends never cascade into a leak (and islands/bays resolve correctly);
  - **non-tunnelled** `waterway=river` **lines** — supercover-rasterised so an
    8-connected route can't slip across; a **"Rivers (lines) impassable"** toggle
    turns this layer off without re-querying.

  Streams and tunnelled/culverted waterways stay passable. The result feeds the
  existing uploaded-mask pipeline, so Invert, bridge corridors, the overlay, the
  "Apply to compute" toggle, and bundle export all work unchanged. Geographic
  (lon/lat) DEM only.

## v21 — 2026-06-21

### Fixes

- **"Load FABDEM for current viewport" crashed** with `TypeError: t is not a
  function`. The tile-mosaic loop variable (`const t = opened[i]`, a tile)
  shadowed the i18n `t()` function, and the v19/v20 status-string migration
  added a `t("status.fabdem_mosaic", …)` call inside that loop — so it called
  the tile object instead of translating. Renamed the loop variable to `tile`
  (both tile loops in `loadFabdemForView`). App-only; engine/backend unchanged.

## v20 — 2026-06-20

### Fixes & improvements

- **Bridge deck passes/density now show up.** A bridge portal jumps
  abutment→abutment, so the deck's interior cells weren't in the path tree and
  rendered no passes/density even when the bridge carried heavy traffic. Deck
  cells are now painted with the flow crossing the bridge
  (`min(passes[endA], passes[endB])` — the portal's tree-edge flow), so a deck
  reads commensurate with its ends.
- **Groups 1c/1d highlight when loaded.** The impassable-mask (1c) and bridges
  (1d) groups now light up (accent border) once their data is loaded, matching
  1a/1b.
- **Extract bridges from the loaded vector network (1d).** A new
  "Extract from loaded network" button derives bridge/tunnel decks from the
  network already loaded in 1b — offline, no Overpass. Bridge tags are read from
  dedicated `bridge`/`tunnel`/`layer` columns when present, else parsed from an
  OSM-export `other_tags` hstore; reprojection is reused from the network load
  (no re-parse).
- **Toggle 1c/1d on/off.** The impassable-mask (1c) and bridges (1d) groups each
  get an "Apply to compute" checkbox to enable/disable their effect on the
  compute without clearing the loaded data (and it round-trips in bundles).

## v19 — 2026-06-19

### New features

- **OSM bridges & tunnels (group 1d).** A dedicated "Pull bridges & tunnels
  from OSM" control queries Overpass for `way[bridge]` (and optionally
  `tunnel=yes`) over the DEM extent and models each structure as a level deck
  between its two ground abutments. Decks render on the map and persist in
  bundles as `bridges.geojson`. Useful for inland viaducts over valleys/saddles,
  not just water — a bare-earth DEM omits the deck, so routing over a bridge
  otherwise dives into the gap below.
- **Multi-level routing via hybrid portal edges (raster modes).** Each deck
  becomes a portal edge between its end cells at the flat-deck cost, relaxed
  alongside the 8-connected grid edges. The cells **under** the deck keep their
  ground elevation, so the route **over** a bridge and the route **under** it
  (e.g. a cross-street beneath a viaduct) both stay correct — the true
  multi-level case a single-elevation cell-override cannot represent.
- **Graph mode ("follow the vectors") multi-level.** The OSM streets pull now
  captures each way's bridge/tunnel/layer tags; in graph mode a deck crossing a
  way at a different layer no longer forms a junction (overpass), and deck edges
  are flattened to a straight profile between their ground endpoints — so a
  viaduct reads ~flat and routes independently of the road beneath it.

### Internal

- Engine change: `dijkstra`/`densityField` (energy-worker.js) and
  `dijkstra_tree` (backend/src/main.rs) gain portal relaxation; portal costs are
  derived from the deck length + endpoint heights with the same asymmetric model
  in both, so they match bit-for-bit (`backend/test-backend.mjs` gains `+portals`
  parity cases; `test-worker-pool.mjs` gains portal regression cases). With no
  bridges loaded the path is inert — results are byte-identical. A* top-N and the
  max-cost DP path don't use portals yet (an admissible A* heuristic would break).

## v18 — 2026-06-19

### New features

- **Impassable mask (group 1c).** Upload a binary GeoTIFF (1 = impassable,
  e.g. water bodies). It's resampled onto the DEM grid by area-coverage
  majority (a DEM cell is impassable iff ≥50% of its footprint is impassable
  in the source; outside the mask's extent cells are passable), so the mask
  can have a different extent / resolution / CRS than the DEM. Masked cells
  block all routing.
- **Network-carved bridge corridors.** With a vector network loaded (1b), an
  optional toggle lets the network carve narrow passable corridors across the
  mask. Each corridor is levelled to a smooth bridge profile — land elevation
  at each shore, a linear ramp up to a `±` offset at the bridge centre
  (clamped −5…+15 m), then back down — so routing crosses cleanly even where
  the DEM has no-data over water.
- **Verification overlay + bundle round-trip.** A "show on map" toggle paints
  the blocked water (red) and reopened corridors (green). Bundles now include
  `impassable.tif` and restore the mask, corridors and settings on reload.

### Internal

- The impassable mask, corridors and bridge offset are composed entirely
  app-side (`buildComputeGrid()`), so `energy-worker.js` and the Rust backend
  are unchanged — engine bit-parity is preserved. A run with no mask (or an
  all-zero mask) reproduces prior results exactly.

## v17 — 2026-06-19

### Improvements

- **Loaded-state highlight.** The "Load DEM" (1) and "vector network" (1b)
  groups now light up (accent border + left bar) once their data is loaded,
  so it's obvious at a glance what's in play.
- **Choices persist across reloads.** Parameter and visualization settings
  (mode, α/β/η, budget, toggles, N refs, sampling, colormaps, opacities,
  ranges, network params, basemap, …) are saved to `localStorage` and
  restored on the next visit. Session data (the loaded DEM, src/dst, reference
  points) is deliberately not persisted — that's what bundles are for.
- **Point/reference buttons clustered.** "Clear points", "Place random" and
  "Clear refs" now sit together in the Pick-points group with "Clear points"
  on top. In density mode only the src/dst picker fades out (it's replaced by
  references) instead of the whole group, so the reference actions stay live.

### Accessibility

- The status line is now an `aria-live` region, so loads / computes / errors /
  point-picking are announced to assistive tech.
- Every field label is programmatically associated with its input; the layer
  opacity sliders got `aria-label`s; a keyboard `:focus-visible` ring was
  added (there was none); and the example-DEM loaders are real `<button>`s
  instead of `<a href="#">`.

### Sidebar declutter

- The explanatory hint paragraphs were removed from the sidebar and their
  content migrated into the Help modal (`?`), which now also documents the
  maximize/length-DP mode, the OSM/Overpass pull, the native backend,
  worker-pool sizing, QMC sampling, GeoJSON reference loading, the round-trip
  budget modes, and the energy/passes range & blend controls. Nothing was
  lost — just rehomed.

## v16 — 2026-06-19

### Fixes

- Compute-time estimate is now correct for **network-graph and interpolation**
  runs (it was badly off for both):
  - **Graph mode** ("follow the vectors") was estimated with the *raster*
    model — cost ∝ 135 M grid cells — when a graph Dijkstra is ∝ the network's
    **edges**, orders of magnitude fewer. The estimate over-shot by ~1000×. It
    now uses a graph-size model (edges × refs), learned per-network via a new
    online correction.
  - **The IDW interpolation fill is now a separate phase**, not a fixed
    fudge bolted onto the compute. It frequently *dominates* a
    network-constrained run (it fills the whole grid while the compute touches
    only network cells/edges), and it scales with the **max ray distance**,
    which the old term ignored entirely. Graph-mode interp (single-worker) and
    raster-constrained interp (banded across the pool) are sized accordingly.
  - Compute and interpolation are corrected **independently** now — previously
    a slow interpolation inflated the compute correction (and a recompute would
    then over-estimate plain runs).
  - Toggling **Interpolate / Compute-on-graph / Constrain-to-network** (and the
    max-distance and smoothing inputs) now updates the estimate — those
    controls weren't wired to it before.
- Native backend log line is now self-describing: it echoes the request shape
  — `Emax=…, mode=…, type=vector|raster` — alongside the grid/slice info.

## v15 — 2026-06-19

### Improvements

- Reloading an exported bundle now restores **all** saved layers, not just
  the energy and passes rasters. Top-N routes and the maximize path were
  already written to the zip (`routes.geojson` / `path.geojson`), but the
  loader never read them back — it redrew the fields and told you to
  recompute the lines. The GeoJSON is now parsed on reload and its
  coordinates converted back to cell indices (the exact inverse of the
  export mapping, gated on the same strict DEM-dimension match that guards
  the raster replay), so the routes/path come back and recolor exactly like
  a fresh compute, with no recompute needed. Any subset works — a maximize
  bundle restores its path, a top-N bundle its routes, a density bundle just
  its field. (Graph-mode `graph_edges.geojson` is still not restored — it
  needs the full graph object, not just edge geometry.)

## v14 — 2026-06-19 (unreleased)

### Fixes

- Compute-time estimate is now accurate to ~±20% with no systematic bias
  (was up to ~3× low). Two independent errors were found by benchmarking
  estimate-vs-actual across DEMs (sampa_geral/centro/aguapreta), budgets,
  modes, and engines:
  - **Backend density on a large DEM under-estimated ~3×.** The estimate
    assumed parallelism scaled with cores (`min(refs, cores, 8)`), but the
    backend caps concurrent rayon slices to a *memory* budget — each slice
    holds full-grid scratch (~5 GB on the 135 M-cell DEM), so only 1-2 fit
    regardless of core count. It also used a native-speedup constant ~2× too
    low. The backend estimate now replicates the slice cap
    (`min(refs, cores, mem_budget / per_slice)`) — `GET /health` reports
    `mem_budget_bytes` — plus a bandwidth-contention term and a corrected
    nominal speedup.
  - **Small DEMs under-estimated up to ~3.8× at low budgets.** The probe ran
    at a fixed energy budget that *saturated* small grids (explored = the
    whole DEM), so the budget→explored extrapolation was anchored at a
    meaningless point. The calibration probe now caps by settled-cell count
    instead — bounding its wall time to ≤~1.5 s on any DEM (the responsiveness
    target) while always anchoring at an unsaturated point, with the explored
    and per-ref laws scaled from there.
  - An **online correction** now learns actual/predicted per engine from each
    completed compute (EMA), so the estimate converges to this machine and
    server's reality within a run or two — covering the residual the
    inherently server-dependent backend factor can't be predicted a priori.

## v13 — 2026-06-18 (unreleased)

### Features

- "Follow the vectors" network-graph mode (new `graph-engine.js`). When a
  vector network is loaded, the optional *Compute on network graph* toggle
  routes on the real polyline graph instead of the rasterised mask, so
  passes/paths trace the vectors with no staircase, corner-cutting, or
  width-fattening. The network is planarised with a selectable junction mode
  — *also at crossings* (splits segments at intersections so at-grade
  crossings route) or *only shared endpoints* (connects solely where lines
  share a vertex, preserving bridges/overpasses). Edge costs reuse the exact
  asymmetric energy model, sampled along the true geometry over the DEM
  (bit-parity with the grid step asserted in `test-graph-engine.mjs`). All
  compute modes are supported (from/to, round, top-N routes, maximize,
  multi-reference density), results render as a colored-vector overlay, and
  style-knob changes recolor without recomputing. JS-only — the Rust backend
  is untouched.

## v12 — 2026-06-12 (unreleased)

### Performance

- Multi-reference density runs split across a worker pool
  (`min(cores − 1, K, memory cap)`) — near-linear speedup, merged on the
  main thread. Combined with Dijkstra heap optimisations (hole-sifting,
  zero-allocation pops, flat-index neighbour deltas): ~10× on typical
  8-core density runs, bit-identical outputs.
- Optional native Rust backend (`backend/`, **off by default**): density
  runs on all cores via rayon, radix-heap Dijkstra, scratch-buffer reuse,
  ~7× over the sequential JS path; automatic fallback to browser workers.
- Compute-time estimate is now budget- and engine-aware. It was assuming a
  full-grid Dijkstra at a fixed rate, so changing the energy budget didn't
  move it at all (off by ~3-18× on huge DEMs). A one-shot calibration probe
  at DEM load now learns this terrain's real per-cell rate and
  budget→explored relationship; the live estimate scales with the budget
  (explored ∝ (eMax/alpha)²), divides by the density worker-pool size, and
  reflects the native backend when enabled. Shows "estimating…" until the
  probe lands.
- Density compute engine rewritten (`densityField` in `energy-worker.js`):
  one reused scratch set with targeted reset/accumulate over only the
  explored cells (an energy budget makes that a small fraction of the
  grid), and an exact monotone **radix heap** matching the native
  backend's queue. On the 135 M-cell `sampa_geral` DEM (5 refs, budget
  150) this brings the in-browser density run to within ~15-20% of the
  native Rust backend's compute time — both are memory-bandwidth-bound at
  that size, so the residual is the JS-vs-native floor. Like the backend,
  the radix heap settles in exact cost order except on genuine f64 cost
  ties (either equal-cost parent is a valid optimum); the browser density
  field now matches the backend's tie behaviour rather than the old binary
  heap's.
- Density scales to large workloads without crashing. Browser: density
  workers are leaner (passes + density f32, energySum stays f64), and the
  pool memory cap now budgets against `navigator.deviceMemory` with an
  accurate per-worker estimate — so medium DEMs parallelise where they
  couldn't before. A 135 M-cell DEM still runs single-threaded on 16 GB
  (two workers can't fit; `deviceMemory` caps at 8 GB so we can't detect
  bigger machines) — an optional "Max compute workers" override lets users
  who know they have the RAM force parallelism. Backend: it no longer
  OOM-crashes at high ref counts — concurrent rayon slices are capped to a
  memory budget (auto-detected, or `SIMU_MAX_MEM_GB` / `--max-mem-gb` /
  `RAYON_NUM_THREADS`); fewer slices just run more refs serially. Scratch
  `passes` is f32 (parity-safe).

### Features

- Quasi-Monte-Carlo sampling option (Sobol / Halton) for "Place random"
  reference placement; sequences continue across clicks.
- Round-trip budget mode: energy budget can cap each leg (old behaviour,
  default) or the round-trip total ("Budget applies to" select).
- Round-mode passes are filtered: only completable (in-budget, displayed)
  destinations count as trajectory endpoints.
- "Energy color" passes blend mode: corridor hue from the energy field's
  colormap, opacity from the passes intensity (min/max/γ shape the alpha).
- Optional vector-network rendering: black lines at a configurable ground
  width (default 4 m, zoom-compensated) with an opacity slider,
  canvas-rendered, 2 M-vertex safety cap. Layers stack deterministically
  via dedicated panes (default relief < energy < network < passes <
  routes), user-reorderable via the "Layer stacking order" modal
  (persisted per device).
- "Constrain compute to network" toggle — keep a network loaded (and
  drawn) without restricting the search graph.
- Basemap selector: OSM, Carto minimalist dark/light (no labels), or
  solid black / white / gray with no tiles.
- "Export rendered images": zips the displayed energy/passes PNGs with
  world files (.pgw/.prj) — styled layers drop into QGIS georeferenced.
- "Pull streets from OSM": queries Overpass for highway=* over the
  current map view ∩ DEM extent and rasterises the ways as the network —
  no .gpkg needed.
- "Compare with unconstrained": with a constraining network, Compute runs
  both scenarios in parallel and a selector switches the energy layer
  between constrained / unconstrained / difference (the energy cost of
  the network).
- Changelog section in the help modal (collapsed by default).
- SEO/LLM metadata: meta description, canonical URL, Open Graph/Twitter
  cards, schema.org WebApplication JSON-LD, noscript summary, llms.txt,
  sitemap.xml; lang attribute fixed to pt-BR (matches default content).
  deploy.sh ships llms.txt, sitemap.xml and CHANGELOG.md.

- Network interpolation is much faster: an integer chamfer prefilter
  skips cells provably beyond any ray's reach (~4× on networks smaller
  than the DEM), and the fill runs banded across the worker pool
  (~×cores). Outputs stay bit-identical. Smoothing runs as a single
  post-merge pass.
- Scenario comparison extended: passes are computed for both scenarios
  (signed difference shows corridors the network creates), and the
  comparison also works in multi-reference density mode (two sequential
  runs splitting the progress bar, browser pool or native backend). The
  selector now switches energy AND passes together. In "difference" mode
  the passes layer overlays both scenarios — constrained light red,
  unconstrained light green, additively blended (overlap sums to a soft
  yellow, coincident corridors brighten). The channels share one scale by
  default; a green-channel sub-panel (min/max/γ/mean filter, blank =
  inherit red) lets each be tuned independently. The energy difference is analysed on network cells and then
  interpolated across the grid like the constrained field (when interp is
  on).

### Fixes

- PWA manifest restored (deleted in the v11 commit; broke deploys, blocked
  every future service-worker install, and PWA install).
- Service worker: synchronous `Response.clone()` (intermittent cache-write
  failures), `event.waitUntil` on background cache writes, 5xx navigation
  fallback to the cached shell, maskable icons precached.
- CDN libraries get SRI hashes + `crossorigin` — also makes them
  runtime-cacheable, fixing offline mode.
- GeoPackage parser handles ISO Z/M geometry types (1002 etc.) — 3-D
  .gpkg files no longer rasterise to an empty network.
- Stale-result race fixed: loading a DEM/network mid-compute cancels
  in-flight workers (generation counter) instead of rendering old arrays
  onto the new grid.
- Worker crash/load failure now surfaces an error instead of leaving the
  UI stuck on "Computing…".
- User-derived strings escaped before status-bar HTML interpolation.
- Native-backend runs: liveness ticker (elapsed time) while the server
  computes; errors after a successful response surface instead of
  silently recomputing in the browser; response parsed zero-copy (the
  backend 8-byte-aligns its payload); the post-merge network
  interpolation phase shows status + progress (it previously looked like
  a hang on large DEMs).
- Density mode + constraining network: Compute used to abort silently —
  the compute-time network re-snap treated the (always-null in density
  mode) src point as a snap failure and returned before dispatching any
  work. src/dst are now only re-snapped when set; density reference
  points get their own re-snap onto the network (markers follow), and
  "Place random" samples are snapped to the network at placement time.
- Network snap no longer dead-ends: clicks snap to the nearest network
  cell grid-wide (expanding-ring search) instead of being rejected beyond
  the snap-radius input — on sparse networks every click used to fail,
  leaving Compute permanently disabled. Networks that rasterise to 0 cells
  (CRS/geometry mismatch) are rejected loudly instead of silently bricking
  clicks; the GeoPackage geometry column name is now read from
  gpkg_geometry_columns instead of being hardcoded to "geom".
- Bundle-before-DEM order now works: a bundle loaded without (or against
  the wrong) DEM is held as pending — rasters included — and re-applied
  automatically when a DEM with matching dimensions is loaded. Previously
  the DEM load wiped the restored src/dst/ref points and the bundle's
  rasters were lost.
- Density-mode map clicks no longer silently set src/dst when placement
  is "random"; "Refresh style" button no longer loses its PT translation;
  deploy.sh staging-dir leak and GNU-cp portability fixed.

## v11 — 2026-05-13

- Wasm engine removed — JS worker is the only compute engine.
- Fix layered-DP backtrack direction bug (spurious `backtrack_fail`).
- Fix ReferenceError on `autoMax`/`passesMax` in result metadata.

## v8–v10 — 2026-05

- Reverse-optimisation toggle (maximize energy): edge costs inverted
  against a precomputed `MAX_EDGE_COST`.
- Length-constrained max-cost path via layered DP (exactly L edges,
  memory-capped).
- DP failures (unreachable, memory cap) surfaced in the UI via warning
  messages.

## v4–v7 — 2026-05

- DEM relief layer: cmocean.phase elevation × slope hillshade.
- Locate-me button; mobile drawer refinements.
- OOM fixes for 100 M-cell DEMs: reservoir-sampled percentiles,
  stride-downsampled relief canvas, slope buffer dropped after render.
- Same OOM fix applied to the energy/passes renderer; skip relief on
  non-geographic DEMs; harden localStorage for iOS private browsing.

## v1–v3 — 2026-05-08

- First public shell: GeoTIFF DEM loading (geotiff.js 3.x), asymmetric-cost
  8-connected Dijkstra energy fields (α/β/η model), passes count, top-N
  routes with repulsion modes, multi-reference density, vector-network
  constraint (.gpkg via sql.js), GDAL-style IDW fill, bundle export
  (georeferenced GeoTIFFs + JSON-LD metadata), PT/EN i18n, FABDEM viewport
  loader, PWA shell with offline precache.
