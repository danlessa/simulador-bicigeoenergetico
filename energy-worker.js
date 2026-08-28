// energy-worker.js — runs Dijkstra in a Web Worker so the UI stays responsive.
//
// Cost model per directed edge u -> v, dh = h_v - h_u (the v2 leg-energy model
// from bicycling-energy-model/notas.md, per-edge realisation — see v2Edge()).
// The engine is parameterised by a `cost` bundle (physics folded once in app.js
// and shipped identically to this worker AND the Rust backend, so they stay
// bit-parity):
//   cost = { aRoll, aAero, beta, climbThr, abRatio, epsOffset }
//     aRoll  = m·g·Crr / k_eff           (kJ per ground metre, always)
//     aAero  = ½·ρ·CdA·v_f² / k_eff       (kJ per ground metre, only OFF climbs)
//     beta   = m·g / k_eff               (kJ per metre of climb)
//     climbThr = climb-grade threshold   (grade ≥ this ⇒ drop aero, e.g. 0.02)
//     abRatio  = Crr + ½ρCdA·v_f²/(m·g)  (flat-resistance grade, = α/β)
//     epsOffset = 0.13                   (empirical descent-recovery offset)
// Per directed edge (dist = ground length, dh = signed rise):
//   dh ≥ 0: aRoll·dist + (grade<climbThr ? aAero·dist : 0) + beta·dh
//   dh < 0: max(0, aRoll·dist + aAero·dist − ε·beta·|dh|),
//           ε = clamp₀₁(min(1, abRatio·dist/|dh|) − epsOffset)
// The trailing max(0, ·) on descents is provably dead code (journal Entry 18's
// dead-clamp proof: the grade-local ε keeps every descent edge cost at or
// above a strictly positive floor — same bound as `descFloor` in the A*
// heuristic below, ~617-637). Kept ONLY as defensive bit-parity code — do NOT
// remove it on one side (JS/Rust) without the other, and never remove it at
// all without re-running the Entry 18 proof (verify_v2edge_clamp.mjs) against
// the changed formula.
//
// Modes: "from" | "to" | "round"
// Always returns a Float32Array of energies (Infinity for unreachable).
// If a destination cell is given, also returns the reconstructed path
// (array of [r, c] pairs) and its energy/length.

// ------- Binary heap on a flat typed array (priority, payload) -------
// We pack each entry as two Float64 + Int32 in parallel arrays.
// Heap ordered by `priorities[i]`.
function createHeap(initialCapacity = 1024) {
  return {
    priorities: new Float64Array(initialCapacity),
    payloads: new Int32Array(initialCapacity),
    size: 0,
    capacity: initialCapacity,
  };
}
function heapGrow(h) {
  const newCap = h.capacity * 2;
  const np = new Float64Array(newCap);
  const nl = new Int32Array(newCap);
  np.set(h.priorities);
  nl.set(h.payloads);
  h.priorities = np;
  h.payloads = nl;
  h.capacity = newCap;
}
// Both sift loops move a "hole" instead of swapping pairs — one write per
// level instead of four — and the pop path allocates nothing: callers read
// the top via h.priorities[0] / h.payloads[0], then call heapRemoveTop(h).
// (The old heapPop returned a fresh {priority, payload} object per call,
// which is millions of short-lived allocations over one Dijkstra run.)
function heapPush(h, priority, payload) {
  if (h.size >= h.capacity) heapGrow(h);
  const pr = h.priorities, pl = h.payloads;
  let i = h.size++;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (pr[parent] <= priority) break;
    pr[i] = pr[parent];
    pl[i] = pl[parent];
    i = parent;
  }
  pr[i] = priority;
  pl[i] = payload;
}
function heapRemoveTop(h) {
  const n = --h.size;
  if (n <= 0) return;
  const pr = h.priorities, pl = h.payloads;
  const movedP = pr[n];
  const movedV = pl[n];
  let i = 0;
  while (true) {
    let child = 2 * i + 1;
    if (child >= n) break;
    if (child + 1 < n && pr[child + 1] < pr[child]) child++;
    if (pr[child] >= movedP) break;
    pr[i] = pr[child];
    pl[i] = pl[child];
    i = child;
  }
  pr[i] = movedP;
  pl[i] = movedV;
}

// ------- v2 per-edge leg-energy cost -------
// THE single cost function — every engine (dijkstra, densityField, astar, the
// layered-DP, portals) routes through it, and backend/src/main.rs::v2_edge is a
// byte-identical port (same operation order so test-backend.mjs stays parity).
// `dist` = ground length (m), `dh` = signed rise (m). c = the cost bundle.
function v2Edge(dist, dh, c) {
  if (dh >= 0) {
    const aero = (dh < c.climbThr * dist) ? c.aAero * dist : 0;
    return c.aRoll * dist + aero + c.beta * dh;
  }
  const ndh = -dh;
  let eps = c.abRatio * dist / ndh;
  if (eps > 1) eps = 1;
  eps -= c.epsOffset;
  if (eps < 0) eps = 0;
  const e = c.aRoll * dist + c.aAero * dist - eps * c.beta * ndh;
  return e < 0 ? 0 : e;
}

// ------- Dijkstra -------
// height: Float32Array of length H*W (row-major)
// mask:   Uint8Array of length H*W, 1 = passable
// seedR, seedC: integer pixel coords of anchor
// reverse: if true, score forward edge nbr->here (i.e. compute energy TO seed)
// trackParents: keep parent links for path reconstruction
// wantPasses:   also compute the per-cell "passes count" (route-density /
//               subtree size in the shortest-path tree), as in the QGIS
//               energy-and-passes plugin. Forces parent + settle-order
//               tracking and runs a reverse-walk subtree accumulation at
//               the end. Returns a Float64Array (counts can exceed 2^24).
// wantTree:     keep parents + settle order, skip the passes accumulation —
//               the caller runs subtreePasses() itself, optionally with an
//               include mask (round mode filters endpoints by combined-leg
//               feasibility, which a single run can't know).
// Returns { E, parents, passes, order, orderLen }; parents/passes/order may
// be null depending on the flags.
// Build the bridge-portal adjacency (hybrid raster + sparse graph overlay).
// Each bridge is a deck shortcut between its two ground abutment cells (u, v),
// traversed at the flat-deck cost — the same asymmetric model as a grid edge,
// with the deck length in metres and dh = h(v) − h(u). The cells UNDER the deck
// keep their ground elevation, so the over-bridge route (this portal) and the
// under-bridge ground route coexist on the 2.5-D grid. Returns a Map
// cell → [{ to, fwd, bwd }] (fwd = real cost in this direction, bwd = the
// reverse, so a `reverse` search uses bwd — mirroring the grid dh sign flip),
// or null when there are no portals. `mask` is the EFFECTIVE mask (DEM ∧
// network): a portal whose endpoint is masked out is dropped.
// portalHU/portalHV: per-portal deck-END elevations (from OSM `ele`). NaN means
// "no mapped ele" → fall back to the DEM height at the abutment cell, so a pull
// without ele is byte-identical to before. Both engines (this + Rust build_portals)
// must apply the SAME fallback for parity.
function buildPortalAdj(portalU, portalV, portalLenM, portalHU, portalHV, height, mask, costc) {
  if (!portalU || !portalU.length) return null;
  const cost = (lenM, dh) => v2Edge(lenM, dh, costc);
  const adj = new Map();
  const add = (a, b, fwd, bwd) => {
    let arr = adj.get(a);
    if (!arr) { arr = []; adj.set(a, arr); }
    arr.push({ to: b, fwd, bwd });
  };
  for (let i = 0; i < portalU.length; i++) {
    const u = portalU[i], v = portalV[i], L = portalLenM[i];
    if (u < 0 || v < 0 || u === v) continue;
    if (!mask[u] || !mask[v]) continue; // endpoint not traversable (e.g. network-constrained off the bridge)
    const hu = (portalHU && !Number.isNaN(portalHU[i])) ? portalHU[i] : height[u];
    const hv = (portalHV && !Number.isNaN(portalHV[i])) ? portalHV[i] : height[v];
    const costUV = cost(L, hv - hu), costVU = cost(L, hu - hv);
    add(u, v, costUV, costVU);
    add(v, u, costVU, costUV);
  }
  return adj.size ? adj : null;
}

function dijkstra(opts) {
  const {
    height, mask, H, W,
    seedR, seedC,
    cost,
    dx, dy,
    reverse, trackParents,
    wantPasses,
    // wantTree: keep parents + settle order and return them WITHOUT the
    // passes accumulation. Round mode uses this so the caller can compute
    // FILTERED passes after combining both legs' energies (the filter —
    // "is this cell's round trip within budget?" — isn't knowable inside
    // a single leg's run).
    wantTree = false,
    eMax = 0,                  // 0 = no budget; >0 = stop expanding past this
    // Reverse-optimisation: when true, every edge cost is replaced with
    // (maxEdgeCost − cost) before relaxation. Dijkstra then finds the
    // "least inverted-cost" path, which is the same as "most original-
    // cost" path among same-length paths.
    maximize = false,
    maxEdgeCost = 0,
    // Bridge portal edges: Map cell → [{ to, fwd, bwd }] deck shortcuts.
    portalAdj = null,
    // Per-cell progress messages get scaled into the range
    // [progressBase, progressBase + progressScale]. Default = full range,
    // i.e. one Dijkstra spans the whole bar. The density loop overrides
    // these to keep the overall compute monotonic 0→1 across N refs.
    progressBase = 0,
    progressScale = 1,
    // Optional move set from buildMoves() (4–128 directions). null = the
    // classic 8 (bit-parity default). Long moves are profile-integrated.
    moves = null,
  } = opts;

  const N = H * W;

  // Move offsets and their ground distances. Typed arrays (not JS arrays)
  // so the relax loop reads unboxed values, plus precomputed flat-index
  // deltas: interior cells (~99% of the grid) skip the per-neighbor
  // row/col bounds arithmetic entirely.
  const mv = moves || buildMoves(8, W, dx, dy);
  const { K: MK, drs, dcs, dists, dIdx, subN, isLong, maxR } = mv;

  const E = new Float32Array(N);
  E.fill(Infinity);
  const seedIdx = seedR * W + seedC;
  E[seedIdx] = 0;

  // wantPasses/wantTree need parent links for the subtree walk.
  const keepParents = trackParents || wantPasses || wantTree;
  const parents = keepParents ? new Int32Array(N).fill(-1) : null;
  // Which parent links used a LONG move (passes stamping over swept cells;
  // portals and unit moves never stamp). Only needed when both long moves
  // and a passes walk are in play.
  const parentLong = (keepParents && mv.hasLong) ? new Uint8Array(N) : null;
  // `settled` filters stale heap entries. Using a boolean per-cell flag
  // instead of `g > E[idx]` because E is f32 and heap priorities are f64
  // (JS Number) — the precision mismatch would let multiple non-stale
  // entries pop for the same cell, blowing up the heap and capping the
  // reachable field at ~200 m before the heap drained.
  const settled = new Uint8Array(N);
  // Sequence of cells in pop order; required for the passes accumulation.
  const order = (wantPasses || wantTree) ? new Int32Array(N) : null;
  let orderLen = 0;

  const heap = createHeap(Math.min(N, 1 << 16));
  heapPush(heap, 0, seedIdx);

  let progressed = 0;
  const reportEvery = Math.max(1000, Math.floor(N / 50));

  while (heap.size > 0) {
    const g = heap.priorities[0];
    const idx = heap.payloads[0];
    heapRemoveTop(heap);
    if (settled[idx]) continue;
    settled[idx] = 1;
    if (order) order[orderLen++] = idx;

    progressed++;
    if (progressed % reportEvery === 0) {
      // Coarse progress: fraction of mask cells settled (approximation),
      // scaled into the caller's slice of the overall progress bar.
      const local = progressed / N;
      postMessage({ kind: "progress", progress: progressBase + local * progressScale });
    }

    const r = (idx / W) | 0;
    const c = idx - r * W;
    const hHere = height[idx];
    const inner = r >= maxR && r < H - maxR && c >= maxR && c < W - maxR;

    for (let k = 0; k < MK; k++) {
      let nIdx;
      if (inner) {
        nIdx = idx + dIdx[k];
      } else {
        const nr = r + drs[k];
        const nc = c + dcs[k];
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        nIdx = nr * W + nc;
      }
      if (!mask[nIdx]) continue;
      // Symmetric guard to the settled-flag staleness check: don't even
      // attempt to relax an already-settled neighbour. f32 storage of E
      // means `tentative < E[nIdx]` can spuriously fire on a settled cell
      // and corrupt its `parents[nIdx]` (overwriting it to point at a cell
      // that was settled AFTER nIdx) — which strands that cell's subtree
      // contribution during the passes-count reverse walk.
      if (settled[nIdx]) continue;

      let edge;
      if (isLong[k]) {
        // Long move: profile-integrated (maximize never has long moves —
        // the run handler forces nDirs = 8 under maximize).
        edge = longEdgeCost(height, mask, H, W, r, c, drs[k], dcs[k], dists[k], subN[k], reverse, cost);
        if (edge === Infinity) continue;
      } else {
        const hNbr = height[nIdx];
        const dh = reverse ? hHere - hNbr : hNbr - hHere;
        edge = v2Edge(dists[k], dh, cost);
      }

      // Reverse the optimisation by inverting against the global cap.
      if (maximize) {
        edge = maxEdgeCost - edge;
        if (edge < 0) edge = 0; // belt-and-suspenders guard
      }

      const tentative = g + edge;
      // Energy budget: skip cells beyond the allowance. Settled-but-out-of-
      // budget cells just stay at E=Infinity (treated as "unreachable" by
      // the renderer / passes-count subtree walk).
      if (eMax > 0 && tentative > eMax) continue;
      if (tentative < E[nIdx]) {
        E[nIdx] = tentative;
        if (parents) {
          parents[nIdx] = idx;
          if (parentLong) parentLong[nIdx] = isLong[k];
        }
        heapPush(heap, tentative, nIdx);
      }
    }

    // Bridge portal edges (deck shortcuts) — relaxed exactly like grid edges:
    // settled guard, maximize inversion, eMax budget, parent/heap update. The
    // cells under the deck are never touched, so under-bridge routes are intact.
    if (portalAdj) {
      const padj = portalAdj.get(idx);
      if (padj) {
        for (let pi = 0; pi < padj.length; pi++) {
          const p = padj[pi];
          const nIdx = p.to;
          if (settled[nIdx]) continue;
          let edge = reverse ? p.bwd : p.fwd;
          if (maximize) { edge = maxEdgeCost - edge; if (edge < 0) edge = 0; }
          const tentative = g + edge;
          if (eMax > 0 && tentative > eMax) continue;
          if (tentative < E[nIdx]) {
            E[nIdx] = tentative;
            if (parents) {
              parents[nIdx] = idx;
              if (parentLong) parentLong[nIdx] = 0; // portal, not a long grid move
            }
            heapPush(heap, tentative, nIdx);
          }
        }
      }
    }
  }

  const passes = (wantPasses && order)
    ? subtreePasses(parents, order, orderLen, N, null)
    : null;
  if (passes) stampLongPasses(passes, parents, parentLong, order, orderLen, mv.sweepByDelta, settled);

  return {
    E,
    parents: (trackParents || wantTree) ? parents : null,
    parentLong: (trackParents || wantTree) ? parentLong : null,
    passes,
    order: wantTree ? order : null,
    settled: wantTree ? settled : null,
    orderLen,
    moves: mv,
  };
}

// Subtree accumulation for the passes count: walk the settle order in
// reverse, adding each cell's count to its parent. Result: passes[c] =
// number of counted cells whose shortest path to the seed traverses c.
// `include` (optional Uint8Array of 0/1) selects which cells count as
// trajectory ENDPOINTS — round mode passes the "round trip is within
// budget / both legs reachable" mask, so only displayed destinations
// contribute. Intermediate cells need no filtering: a corridor cell over
// the budget still carries optimal legs serving within-budget cells.
function subtreePasses(parents, order, orderLen, N, include) {
  const passes = new Float64Array(N);
  for (let j = 0; j < orderLen; j++) {
    const idx = order[j];
    passes[idx] = include ? include[idx] : 1;
  }
  for (let j = orderLen - 1; j >= 0; j--) {
    const idx = order[j];
    const p = parents[idx];
    if (p >= 0) passes[p] += passes[idx];
  }
  return passes;
}

// ------- Move sets (grid neighborhoods, 4–128 directions) -------
// The move-directions option (docs/grid-connectivity-sensitivity-2026-07-11.md):
// richer heading sets shrink the 8-grid's optimal-energy overestimate
// (~⅔ gone at 16 directions on the measured terrain). Levels follow the
// Farey/Stern–Brocot ladder — each level inserts the mediant between
// adjacent heading vectors: 8 → 16 (adds the knight moves) → 32 → 64 → 128.
// nDirs=4 is the von-Neumann baseline. THE FIRST 8 MOVES OF EVERY SET ≥ 8
// ARE THE CLASSIC 8 IN THE CLASSIC ORDER, so nDirs=8 (the default) performs
// exactly today's operations in today's order — bit-parity with the Rust
// backend depends on that. Long moves (max(|dr|,|dc|) > 1) are
// PROFILE-INTEGRATED: bilinear height samples every ~1 cell along the
// segment, v2Edge per sub-step — a long move costed from its endpoints' Δh
// alone would flatten the relief it crosses and UNDER-estimate (measured:
// the naive variant flips the error sign at 30 m). nDirs ≠ 8 is
// browser-only (app.js never routes such runs to the Rust backend).
function buildMoves(nDirs, W, dx, dy) {
  let vecs;
  if (nDirs === 4) {
    vecs = [[-1, 0], [0, -1], [0, 1], [1, 0]];
  } else {
    // classic 8 first, classic order (the bit-parity anchor for nDirs = 8)
    vecs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const level = { 16: 1, 32: 2, 64: 3, 128: 4 }[nDirs] || 0;
    if (level > 0) {
      let oct = [[1, 0], [1, 1]];
      for (let l = 0; l < level; l++) {
        const next = [];
        for (let i = 0; i < oct.length - 1; i++) {
          next.push(oct[i], [oct[i][0] + oct[i + 1][0], oct[i][1] + oct[i + 1][1]]);
        }
        next.push(oct[oct.length - 1]);
        oct = next;
      }
      const seen = new Set(vecs.map(([a, b]) => `${a},${b}`));
      for (const [a, b] of oct) {
        for (const [dr, dc] of [[a, b], [b, a]]) {
          for (const sr of [1, -1]) {
            for (const sc of [1, -1]) {
              const vr = dr * sr || 0, vc = dc * sc || 0;
              const key = `${vr},${vc}`;
              if (!seen.has(key)) { seen.add(key); vecs.push([vr, vc]); }
            }
          }
        }
      }
    }
  }
  const K = vecs.length;
  const diag = Math.hypot(dx, dy);
  const drs = new Int32Array(K), dcs = new Int32Array(K), dIdx = new Int32Array(K);
  const dists = new Float64Array(K), subN = new Int32Array(K);
  const isLong = new Uint8Array(K);
  const sweepByDelta = new Map(); // parent-edge delta → swept intermediate cell deltas
  let maxR = 1;
  for (let k = 0; k < K; k++) {
    const [dr, dc] = vecs[k];
    drs[k] = dr; dcs[k] = dc;
    dIdx[k] = dr * W + dc;
    // Unit moves reuse the EXACT legacy expressions (dx / dy / hypot(dx,dy))
    // — the nDirs=8 default must stay bit-identical to the historical engine.
    dists[k] = (dr === 0) ? dx * Math.abs(dc)
             : (dc === 0) ? dy * Math.abs(dr)
             : (Math.abs(dr) === 1 && Math.abs(dc) === 1) ? diag
             : Math.hypot(dr * dy, dc * dx);
    const m = Math.max(Math.abs(dr), Math.abs(dc));
    if (m > 1) {
      isLong[k] = 1;
      subN[k] = 2 * m;
      maxR = Math.max(maxR, m);
      // supercover-ish template of intermediate cells (relative to the edge
      // START) — used for passes stamping over the cells a long move crosses
      const cells = [];
      for (let s = 1; s < subN[k]; s++) {
        const rr = Math.round(dr * s / subN[k]), cc = Math.round(dc * s / subN[k]);
        if ((rr || cc) && !(rr === dr && cc === dc)) cells.push(rr * W + cc);
      }
      sweepByDelta.set(dIdx[k], Int32Array.from([...new Set(cells)]));
    }
  }
  return { nDirs, K, drs, dcs, dIdx, dists, subN, isLong, maxR, sweepByDelta, hasLong: maxR > 1 };
}

// Profile-integrated cost of one long move (r,c) → (r+dr, c+dc): bilinear
// height samples every ~1 cell, v2Edge per sub-segment. `flip` negates each
// sub-step's dh — travel in the reverse direction (mode "to" / round's bwd
// leg), matching the unit-edge `reverse` dh flip. Any sample whose bilinear
// support touches an unpassable cell (nodata heights are garbage) blocks the
// move (returns Infinity) — the long-move analog of the unit mask check.
function longEdgeCost(height, mask, H, W, r, c, dr, dc, distM, n, flip, cost) {
  const sub = distM / n;
  let e = 0, hPrev = height[r * W + c];
  for (let s = 1; s <= n; s++) {
    let hs;
    if (s === n) {
      hs = height[(r + dr) * W + (c + dc)];
    } else {
      const fr = r + dr * s / n, fc = c + dc * s / n;
      const r1 = Math.min(H - 2, Math.max(0, Math.floor(fr)));
      const c1 = Math.min(W - 2, Math.max(0, Math.floor(fc)));
      const b0 = r1 * W + c1;
      if (!mask[b0] || !mask[b0 + 1] || !mask[b0 + W] || !mask[b0 + W + 1]) return Infinity;
      const tr = fr - r1, tc = fc - c1;
      hs = height[b0] * (1 - tr) * (1 - tc) + height[b0 + 1] * (1 - tr) * tc +
           height[b0 + W] * tr * (1 - tc) + height[b0 + W + 1] * tr * tc;
    }
    e += v2Edge(sub, flip ? hPrev - hs : hs - hPrev, cost);
    hPrev = hs;
  }
  return e;
}

// Long moves carry flow OVER their intermediate cells without stepping
// through them — without this, passes corridors turn gappy wherever a long
// move wins. Stamp each used long edge's flow (the child's subtree count)
// onto the cells its segment sweeps. `parentLong` marks which parent links
// used a long move (portals and unit moves must NOT stamp — a portal deck
// deliberately skips the cells under it). Flows are read BEFORE any stamp
// is applied: a swept cell's own subtree count must not contaminate other
// edges' flows. Stamps land only on cells SETTLED by this search — an
// unsettled intermediate (over-budget under eMax) must not receive passes:
// it is outside `order`, so the density accumulate/reset loops would never
// visit it (the count would leak into the next ref's field).
function stampLongPasses(passes, parents, parentLong, order, orderLen, sweepByDelta, settledArr) {
  if (!sweepByDelta || sweepByDelta.size === 0 || !parentLong) return;
  const si = [], sv = [];
  for (let j = 0; j < orderLen; j++) {
    const idx = order[j];
    if (!parentLong[idx]) continue;
    const p = parents[idx];
    if (p < 0) continue;
    const sw = sweepByDelta.get(idx - p);
    if (!sw) continue;
    const flow = passes[idx];
    if (!(flow > 0)) continue;
    for (let s = 0; s < sw.length; s++) {
      const cell = p + sw[s];
      if (settledArr && !settledArr[cell]) continue;
      si.push(cell); sv.push(flow);
    }
  }
  for (let i = 0; i < si.length; i++) passes[si[i]] += sv[i];
}

// ------- String pulling (post-hoc route shortcutting) -------
// Shorten a computed grid path by joining node pairs with straight segments
// costed by the SAME profile integration long moves use (longEdgeCost, so a
// segment through nodata is blocked and the polyline's energy is its own
// per-sub-step v2Edge sum — viewing ≡ routing holds for the pulled line).
// Windowed DP (any pair ≤ 64 nodes apart), iterated over the surviving
// breakpoints so the effective shortcut range grows geometrically; stops
// when a round improves < 0.1 %. Measured (docs/grid-pull.mjs): recovers
// ~44 % of the 8-grid's median route-energy overestimate at ~tens of ms per
// path — the residual is corridor lock-in (the polyline can only visit the
// original path's cells), which no post-hoc pass can recover. `flip` = mode
// "to" (travel dst→seed: every sub-step dh negates, like the engines'
// `reverse`). Returns { path, energy } or null when no improvement.
function stringPullPath(height, mask, H, W, dx, dy, cost, path, flip) {
  const seg = (a, b) => {
    const ar = (a / W) | 0, ac = a - ar * W;
    const br = (b / W) | 0, bc = b - br * W;
    const dr = br - ar, dc = bc - ac;
    const m = Math.max(Math.abs(dr), Math.abs(dc));
    if (m === 0) return 0;
    const distM = Math.hypot(dr * dy, dc * dx);
    return longEdgeCost(height, mask, H, W, ar, ac, dr, dc, distM, Math.max(1, 2 * m), flip, cost);
  };
  let nodes = path, best = Infinity;
  for (let round = 0; round < 4; round++) {
    const L = nodes.length;
    const dp = new Float64Array(L).fill(Infinity);
    const from = new Int32Array(L).fill(-1);
    dp[0] = 0;
    for (let j = 1; j < L; j++) {
      for (let i = Math.max(0, j - 64); i < j; i++) {
        if (dp[i] === Infinity) continue;
        const cand = dp[i] + seg(nodes[i], nodes[j]);
        if (cand < dp[j]) { dp[j] = cand; from[j] = i; }
      }
    }
    if (!(dp[L - 1] < best * 0.999)) { best = Math.min(best, dp[L - 1]); break; }
    best = dp[L - 1];
    const kept = [];
    for (let j = L - 1; ; j = from[j]) { kept.push(nodes[j]); if (j === 0) break; }
    kept.reverse();
    nodes = kept;
    if (nodes.length < 3) break;
  }
  if (!Number.isFinite(best)) return null;
  return { path: nodes, energy: best };
}

// ------- Multi-reference density (optimised, scratch-reused) -------
// Equivalent to looping dijkstra() per ref + subtree walk + accumulate, but:
//   - ONE scratch set (E/settled/parents/order/passes), allocated once and
//     TARGETED-RESET between refs — only the explored cells (tracked in
//     `order`) are touched, not all H·W. With an energy budget the explored
//     region is a small fraction of the grid, so this turns per-ref O(N)
//     overhead into O(explored), the dominant win on large DEMs.
//   - accumulation also iterates `order`, not the whole grid.
// Cost model is identical to dijkstra(); from/to are bit-exact vs the old
// per-ref path, round differs only by f64 summation regrouping (~1e-17,
// below export/display precision). Returns raw partials (density carries
// the first /N, like densityPartial); caller does the second /N + avgE.
function densityField(opts) {
  const {
    height, mask, H, W, refPoints, dmode,
    cost, dx, dy,
    eMax = 0, maximize = false, maxEdgeCost = 0, eMaxTotalCap = 0,
    portalAdj = null, // bridge portal edges: Map cell → [{ to, fwd, bwd }]
    onProgress = null,
    // Optional: invoked once per reference with (settleCount, budgetReached)
    // — the explored-cell count and the energy of the last-settled cell.
    // Used by the calibration probe to learn this DEM's reach-vs-budget and
    // rate laws. No effect when omitted.
    onExplored = null,
    // Probe-only: stop each search after settling this many cells (0 = no
    // cap). Bounds the calibration probe's wall time regardless of DEM size
    // so it returns an estimate in under a few seconds. Zero-cost (one
    // short-circuited compare per pop) when 0 — the normal compute path.
    maxSettled = 0,
    // Optional accessibility sampling: flat cell indices (Int32Array, −1 =
    // out-of-grid) of ALL K original refs. When set, each ref's energy field
    // is sampled at these cells right before the per-ref scratch reset,
    // filling one row of the K×|refCells| pairwise matrix (Infinity where
    // unreached / ref skipped). MUST stay null on the calibration probe: a
    // maxSettled-truncated search would record non-optimal finite energies.
    refCells = null,
    // Optional move set from buildMoves() (4–128 directions). null = the
    // classic 8 (bit-parity default; the probe always runs with null).
    moves = null,
  } = opts;
  const N = H * W;
  const mv = moves || buildMoves(8, W, dx, dy);
  const { K: MK, drs, dcs, dists, dIdx, subN, isLong, maxR } = mv;

  // Long-edge cost TABLES, built lazily per travel direction: a density run
  // executes K searches over ONE grid, so each long edge's profile integral
  // is reused K times — precompute pays back after ~3 refs (measured in
  // docs/grid-longedge.mjs; K=1 would lose, which is why single-source
  // dijkstra() integrates on demand). f64 tables keep the values
  // bit-identical to on-demand integration (same op order). Memory:
  // 8 B/cell per long move per direction — densityPoolSize() budgets it.
  const useTables = mv.hasLong && refPoints.length >= 3;
  const tablesByRev = [null, null];
  const longTables = (rev) => {
    if (!useTables) return null;
    const i = rev ? 1 : 0;
    if (tablesByRev[i]) return tablesByRev[i];
    const t = new Array(MK).fill(null);
    for (let k = 0; k < MK; k++) {
      if (!isLong[k]) continue;
      const T = new Float64Array(N).fill(Infinity);
      const dr = drs[k], dc = dcs[k];
      const r0 = Math.max(0, -dr), r1 = H - Math.max(0, dr);
      const c0 = Math.max(0, -dc), c1 = W - Math.max(0, dc);
      for (let r = r0; r < r1; r++) {
        const base = r * W;
        for (let c = c0; c < c1; c++) {
          const u = base + c;
          if (!mask[u] || !mask[u + dIdx[k]]) continue;
          T[u] = longEdgeCost(height, mask, H, W, r, c, dr, dc, dists[k], subN[k], rev, cost);
        }
      }
      t[k] = T;
    }
    tablesByRev[i] = t;
    return t;
  };

  // `density` and the `passes` scratch are Float32 (not Float64): subtree
  // counts are exact integers up to 2^24, and density values are exact
  // dyadic rationals (count/N) in f32 on small grids, so pooled-vs-single
  // stays bit-identical (test-worker-pool's maxD===0); on large budgets f32
  // loses ~1e-7, invisible under the p10/p90-clipped, gamma density render.
  // `energySum` stays Float64 — it accumulates large energy VALUES (not small
  // counts), where f32 grouping diverges ~1e-3 between pooled and single and
  // the mean would lose precision. Net per-worker saving ≈ 8 B/cell
  // (non-round) / 12 (round). `density` carries the first /N.
  const density = new Float32Array(N);
  const energySum = new Float64Array(N);
  const energyCount = new Int32Array(N);
  // Pairwise accessibility matrix: row k = ref k's energy sampled at every
  // refCells entry (row-major, slice-rows × KC). Rows of refs this loop
  // skips (off-grid / off-mask) stay all-Infinity — indices are NEVER
  // compacted, so pooled slices and the Rust backend agree per original
  // ref index.
  const KC = refCells ? refCells.length : 0;
  const matrix = refCells ? new Float32Array(refPoints.length * KC).fill(Infinity) : null;

  const E = new Float32Array(N).fill(Infinity);
  const settled = new Uint8Array(N);
  const parents = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const passes = new Float32Array(N);
  const pLong = mv.hasLong ? new Uint8Array(N) : null;
  // Round mode keeps a second search resident so both legs combine per ref.
  const round = dmode === "round";
  const E2 = round ? new Float32Array(N).fill(Infinity) : null;
  const settled2 = round ? new Uint8Array(N) : null;
  const parents2 = round ? new Int32Array(N).fill(-1) : null;
  const order2 = round ? new Int32Array(N) : null;
  const passes2 = round ? new Float32Array(N) : null;
  const pLong2 = (round && mv.hasLong) ? new Uint8Array(N) : null;

  // Exact monotone radix heap on the f64 keys, reused across all searches.
  // Same structure as the Rust backend's: 65 buckets indexed by the highest
  // bit where the key differs from the last-popped minimum; pop drains
  // bucket 0, refilling it by redistributing the lowest non-empty bucket
  // around the new minimum. O(1) amortised push, O(64) amortised pop — far
  // less per-op work than a binary heap's O(log n) sift on the multi-million
  // entry frontiers a budgeted density search produces. It pops the EXACT
  // minimum, so the settle order matches a binary heap except on genuine
  // f64 cost ties (where either equal-cost parent is a valid optimum — the
  // same tie behaviour the native backend already has). Bit extraction uses
  // a typed-array union view (JIT-fast; DataView method calls are not).
  const _ub = new ArrayBuffer(8), _uf = new Float64Array(_ub), _u32 = new Uint32Array(_ub);
  const NB = 65;
  const bPri = [], bVal = [], bLen = new Int32Array(NB);
  for (let i = 0; i < NB; i++) { bPri.push(new Float64Array(16)); bVal.push(new Int32Array(16)); }
  let lastHi = 0, lastLo = 0, rlen = 0;
  const bucketOf = (p) => {
    _uf[0] = p; const hi = _u32[1], lo = _u32[0];
    const xh = hi ^ lastHi; if (xh !== 0) return 33 + (31 - Math.clz32(xh));
    const xl = lo ^ lastLo; if (xl === 0) return 0; return 1 + (31 - Math.clz32(xl));
  };
  const rClear = () => { for (let i = 0; i < NB; i++) bLen[i] = 0; lastHi = 0; lastLo = 0; rlen = 0; };
  const rPush = (p, v) => {
    const b = bucketOf(p); let L = bLen[b];
    if (L >= bPri[b].length) { const a = new Float64Array(L * 2); a.set(bPri[b]); bPri[b] = a; const c = new Int32Array(L * 2); c.set(bVal[b]); bVal[b] = c; }
    bPri[b][L] = p; bVal[b][L] = v; bLen[b] = L + 1; rlen++;
  };
  const rTop = [0, 0];
  const rPop = () => {
    if (rlen === 0) return false;
    if (bLen[0] === 0) {
      let i = 1; while (bLen[i] === 0) i++;
      const pr = bPri[i], va = bVal[i], L = bLen[i];
      let mn = pr[0]; for (let j = 1; j < L; j++) if (pr[j] < mn) mn = pr[j];
      _uf[0] = mn; lastHi = _u32[1]; lastLo = _u32[0];
      for (let j = 0; j < L; j++) {
        const p = pr[j], v = va[j]; const b = bucketOf(p); let M = bLen[b];
        if (M >= bPri[b].length) { const a = new Float64Array(M * 2); a.set(bPri[b]); bPri[b] = a; const c = new Int32Array(M * 2); c.set(bVal[b]); bVal[b] = c; }
        bPri[b][M] = p; bVal[b][M] = v; bLen[b] = M + 1;
      }
      bLen[i] = 0;
    }
    const L = bLen[0] - 1; rTop[0] = bPri[0][L]; rTop[1] = bVal[0][L]; bLen[0] = L; rlen--; return true;
  };

  // Budget reached by the last cell the most recent search settled (its
  // energy). Only meaningful under maxSettled (the probe); the calibration
  // reads it to learn what budget a given explored-cell count corresponds to.
  let lastStopG = 0;
  // One budget-limited Dijkstra into the given scratch arrays; returns the
  // settle count (order length). reverse flips dh (energy TO the seed).
  // pLongA (nullable) records which parent links used a long move; tbl
  // (nullable) is longTables(reverse) for O(1) long-edge lookups.
  function search(seedR, seedC, reverse, Ea, settledA, parentsA, orderA, pLongA, tbl) {
    let orderLen = 0; rClear();
    // Reset per search and record every settle: on a maxSettled break this is
    // the cap cell's energy, on clean exhaustion the frontier (last settled)
    // energy. Previously only the break assigned it, so a search that
    // exhausted before the cap reported a STALE budget (0 for the first ref,
    // or the prior ref's), which floored the probe's bStar to 1 and blew up
    // the budget→explored extrapolation.
    lastStopG = 0;
    const seed = seedR * W + seedC;
    Ea[seed] = 0; rPush(0, seed);
    while (rPop()) {
      const g = rTop[0], idx = rTop[1] | 0;
      if (settledA[idx]) continue;
      settledA[idx] = 1; orderA[orderLen++] = idx;
      lastStopG = g; // energy of the most-recently-settled cell (non-decreasing)
      if (maxSettled !== 0 && orderLen >= maxSettled) break;
      const r = (idx / W) | 0, c = idx - r * W, hHere = height[idx];
      const inner = r >= maxR && r < H - maxR && c >= maxR && c < W - maxR;
      for (let k = 0; k < MK; k++) {
        let nIdx;
        if (inner) nIdx = idx + dIdx[k];
        else { const nr = r + drs[k], nc = c + dcs[k]; if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue; nIdx = nr * W + nc; }
        if (!mask[nIdx] || settledA[nIdx]) continue;
        let edge;
        if (isLong[k]) {
          edge = tbl ? tbl[k][idx]
               : longEdgeCost(height, mask, H, W, r, c, drs[k], dcs[k], dists[k], subN[k], reverse, cost);
          if (edge === Infinity) continue;
        } else {
          const dh = reverse ? hHere - height[nIdx] : height[nIdx] - hHere;
          edge = v2Edge(dists[k], dh, cost);
        }
        if (maximize) { edge = maxEdgeCost - edge; if (edge < 0) edge = 0; }
        const t = g + edge;
        if (eMax > 0 && t > eMax) continue;
        if (t < Ea[nIdx]) {
          Ea[nIdx] = t; parentsA[nIdx] = idx;
          if (pLongA) pLongA[nIdx] = isLong[k];
          rPush(t, nIdx);
        }
      }
      // Bridge portal edges (deck shortcuts). Portal-reached cells are settled
      // and added to `order`, so the targeted reset + subtree-passes walk below
      // already cover them.
      if (portalAdj) {
        const padj = portalAdj.get(idx);
        if (padj) for (let pi = 0; pi < padj.length; pi++) {
          const p = padj[pi]; const nIdx = p.to;
          if (settledA[nIdx]) continue;
          let edge = reverse ? p.bwd : p.fwd;
          if (maximize) { edge = maxEdgeCost - edge; if (edge < 0) edge = 0; }
          const t = g + edge;
          if (eMax > 0 && t > eMax) continue;
          if (t < Ea[nIdx]) {
            Ea[nIdx] = t; parentsA[nIdx] = idx;
            if (pLongA) pLongA[nIdx] = 0; // portal, not a long grid move
            rPush(t, nIdx);
          }
        }
      }
    }
    return orderLen;
  }

  const K = refPoints.length;
  for (let k = 0; k < K; k++) {
    const [refR, refC] = refPoints[k];
    if (refR < 0 || refR >= H || refC < 0 || refC >= W) continue;
    if (!mask[refR * W + refC]) continue;

    if (!round) {
      const len = search(refR, refC, dmode === "to", E, settled, parents, order, pLong, longTables(dmode === "to"));
      if (onExplored) onExplored(len, lastStopG);
      for (let j = 0; j < len; j++) passes[order[j]] = 1;
      for (let j = len - 1; j >= 0; j--) { const idx = order[j]; const p = parents[idx]; if (p >= 0) passes[p] += passes[idx]; }
      stampLongPasses(passes, parents, pLong, order, len, mv.sweepByDelta, settled);
      // Accessibility row: sample this ref's field at every ref cell BEFORE
      // the reset below wipes E. Untouched cells read Infinity.
      if (matrix) for (let j = 0; j < KC; j++) {
        const cj = refCells[j];
        if (cj >= 0) matrix[k * KC + j] = E[cj];
      }
      for (let j = 0; j < len; j++) {
        const idx = order[j];
        density[idx] += passes[idx] / N;
        energySum[idx] += E[idx]; energyCount[idx] += 1;
        E[idx] = Infinity; settled[idx] = 0; parents[idx] = -1; passes[idx] = 0;
        if (pLong) pLong[idx] = 0;
      }
    } else {
      const lf = search(refR, refC, false, E, settled, parents, order, pLong, longTables(false));
      const lb = search(refR, refC, true, E2, settled2, parents2, order2, pLong2, longTables(true));
      if (onExplored) onExplored(lf + lb);
      // Filtered subtree passes: a destination counts only if BOTH legs
      // reach it (and the round trip is within the total cap, if set).
      for (let j = 0; j < lf; j++) { const idx = order[j]; const fi = E[idx], bi = E2[idx]; passes[idx] = (bi < Infinity && !(eMaxTotalCap > 0 && fi + bi > eMaxTotalCap)) ? 1 : 0; }
      for (let j = lf - 1; j >= 0; j--) { const idx = order[j]; const p = parents[idx]; if (p >= 0) passes[p] += passes[idx]; }
      stampLongPasses(passes, parents, pLong, order, lf, mv.sweepByDelta, settled);
      for (let j = 0; j < lb; j++) { const idx = order2[j]; const fi = E[idx], bi = E2[idx]; passes2[idx] = (fi < Infinity && !(eMaxTotalCap > 0 && fi + bi > eMaxTotalCap)) ? 1 : 0; }
      for (let j = lb - 1; j >= 0; j--) { const idx = order2[j]; const p = parents2[idx]; if (p >= 0) passes2[p] += passes2[idx]; }
      stampLongPasses(passes2, parents2, pLong2, order2, lb, mv.sweepByDelta, settled2);
      for (let j = 0; j < lf; j++) {
        const idx = order[j];
        density[idx] += passes[idx] / N;
        const fi = E[idx], bi = E2[idx];
        if (bi < Infinity && !(eMaxTotalCap > 0 && fi + bi > eMaxTotalCap)) { energySum[idx] += Math.fround(fi + bi); energyCount[idx] += 1; }
      }
      for (let j = 0; j < lb; j++) density[order2[j]] += passes2[order2[j]] / N;
      // Accessibility row (round): the masked round-trip total — same
      // predicate + f32 rounding as the energySum accumulation above.
      if (matrix) for (let j = 0; j < KC; j++) {
        const cj = refCells[j];
        if (cj < 0) continue;
        const fi = E[cj], bi = E2[cj];
        if (fi < Infinity && bi < Infinity && !(eMaxTotalCap > 0 && fi + bi > eMaxTotalCap)) {
          matrix[k * KC + j] = Math.fround(fi + bi);
        }
      }
      for (let j = 0; j < lf; j++) { const idx = order[j]; E[idx] = Infinity; settled[idx] = 0; parents[idx] = -1; passes[idx] = 0; if (pLong) pLong[idx] = 0; }
      for (let j = 0; j < lb; j++) { const idx = order2[j]; E2[idx] = Infinity; settled2[idx] = 0; parents2[idx] = -1; passes2[idx] = 0; if (pLong2) pLong2[idx] = 0; }
    }
    if (onProgress) onProgress((k + 1) / K);
  }
  return { density, energySum, energyCount, matrix };
}

// ------- A* with iterative-penalization for top-N routes -------
// Single shortest path from `start` to `goal` under the v2 cost model (v2Edge),
// with a per-cell penalty multiplier on the distance-cost component:
//   mult = penalty ^ usedCount[v];
//   edge += (mult - 1) * (aRoll + aAero) * dist
// Penalty applies to the destination cell of each edge. The gravitational
// (beta * dh) term is NOT penalized — climb is unavoidable.
//
// `reverse` mirrors dijkstra()'s: each search edge here→nbr is scored with the
// opposite-direction cost (dh = hHere − hNbr), so the returned energy measures
// travel goal→start (mode "to": from the dst marker to the seed), matching the
// reverse field. The heuristic below flips its climb term accordingly.
//
// Heuristic: see the derivation at `descFloor` below — admissible AND
// consistent under the v2 cost model (the old aRoll·dist bound was NOT: cheap
// descents undercut it, so top-N route #1 could come out suboptimal).
function astar(opts) {
  const {
    height, mask, H, W,
    startR, startC, goalR, goalC,
    cost,
    dx, dy,
    penalty, usedCount,
    repulsionMode = "per-cell",   // "per-cell" | "linear" | "square"
    distUsed = null,               // Float32Array of distance-to-nearest-used
    eMax = 0,                      // 0 = no budget; >0 abandon past this
    maximize = false,              // invert edge cost against maxEdgeCost
    maxEdgeCost = 0,
    reverse = false,               // score edges in the opposite travel direction
  } = opts;
  const N = H * W;
  const diag = Math.hypot(dx, dy);
  const drs = new Int32Array([-1, -1, -1, 0, 0, 1, 1, 1]);
  const dcs = new Int32Array([-1, 0, 1, -1, 1, -1, 0, 1]);
  const dists = new Float64Array([diag, dy, diag, dx, dx, diag, dy, diag]);
  const dIdx = new Int32Array(8);
  for (let k = 0; k < 8; k++) dIdx[k] = drs[k] * W + dcs[k];

  const startIdx = startR * W + startC;
  const goalIdx = goalR * W + goalC;
  // Bounds check is hard, but mask check is soft: if start/goal aren't on
  // the (effective) mask the search can still run — relaxation refuses to
  // step *through* off-mask cells, but we let the seed itself sit there.
  // This matches dijkstra() and means top-N still produces routes when the
  // user dropped src/dst before loading a vector network constraint.
  if (startIdx < 0 || startIdx >= N || goalIdx < 0 || goalIdx >= N) {
    return { path: null, energy: Infinity, length: 0 };
  }

  const E = new Float32Array(N); E.fill(Infinity);
  const L = new Float32Array(N); L.fill(Infinity);
  const parents = new Int32Array(N).fill(-1);
  const settled = new Uint8Array(N);

  const hGoal = height[goalIdx];
  // In maximize mode we don't have a useful admissible heuristic for the
  // inverted cost (it would be an upper bound on the remaining path,
  // which depends on path length). Falling back to h=0 makes A* behave
  // as Dijkstra — slower, but correctness is preserved (h=0 is admissible
  // for any non-negative cost).
  //
  // Otherwise: admissible + consistent per-metre floors on the v2 cost.
  // Descent credit bound: ε·s ≤ (1 − epsOffset)·abRatio for EVERY grade s
  // (s ≤ abRatio ⇒ ε ≤ 1−epsOffset so ε·s ≤ (1−epsOffset)·abRatio;
  //  s > abRatio ⇒ ε·s = max(0, abRatio − epsOffset·s) < (1−epsOffset)·abRatio),
  // so a descent metre costs at least descFloor. A climb/flat metre costs at
  // least climbFloor (aero drops at grades ≥ climbThr). Then, with distLB the
  // straight-line remaining distance (a true lower bound on path length):
  //   h1 = min(climbFloor, descFloor)·distLB
  //   h2 = min(aRoll, descFloor)·distLB + beta·(net climb to the goal)
  // h2's distance coefficient is NOT min(climbFloor, descFloor): on a climb
  // edge the beta term already claims beta·dh, leaving only aRoll·d guaranteed
  // on top (aero may be dropped). Both are edge-consistent (h(u)−h(v) ≤
  // cost(u,v): the distance parts because their coefficients lower-bound every
  // per-metre cost net of the beta term; the beta term only shrinks across
  // descents, whose cost is ≥ descFloor·d), so h = max(h1, h2) is too — and
  // the iterative top-N penalties only ADD cost, so admissibility against the
  // penalised graph is preserved. Under `reverse` the remaining search leg
  // idx→goal is travelled goal→idx, so the climb term flips to the rise FROM
  // the goal UP to here.
  const descFloor = Math.max(0, cost.aRoll + cost.aAero - (1 - cost.epsOffset) * cost.beta * cost.abRatio);
  const climbFloor = cost.aRoll + Math.min(cost.aAero, cost.beta * cost.climbThr);
  const minPerM = Math.min(climbFloor, descFloor);
  const distCoefClimb = Math.min(cost.aRoll, descFloor);
  const heuristic = maximize ? (() => 0) : (idx) => {
    const r = (idx / W) | 0;
    const c = idx - r * W;
    const dr = (r - goalR) * dy;
    const dc = (c - goalC) * dx;
    const distLB = Math.hypot(dr, dc);
    const climb = reverse ? Math.max(0, height[idx] - hGoal) : Math.max(0, hGoal - height[idx]);
    return Math.max(minPerM * distLB, distCoefClimb * distLB + cost.beta * climb);
  };

  E[startIdx] = 0;
  L[startIdx] = 0;
  const heap = createHeap(Math.min(N, 1 << 16));
  // Heap key is f = g + h; we encode (f<<32) -- but JS numbers are f64 so just
  // push (f, packed) where packed encodes g and idx. Simpler: push f as priority,
  // store idx in payload. We re-derive g from E[idx] when popped.
  heapPush(heap, heuristic(startIdx), startIdx);

  while (heap.size > 0) {
    const idx = heap.payloads[0];
    const fTop = heap.priorities[0]; // f = g + h (f64) — read BEFORE removeTop
    heapRemoveTop(heap);
    if (settled[idx]) continue;
    settled[idx] = 1;
    if (idx === goalIdx) break;

    // Recover g from the f64 heap priority (g = f − h) rather than the f32
    // E[idx]: keeps the accumulated path cost f64-exact along the route, like
    // dijkstra()'s `g = heap.priorities[0]`. h is deterministic (0 in maximize
    // mode), so f − h reproduces the f64 tentative that was pushed.
    const g = fTop - heuristic(idx);
    const r = (idx / W) | 0;
    const c = idx - r * W;
    const hHere = height[idx];
    const inner = r > 0 && r < H - 1 && c > 0 && c < W - 1;

    for (let k = 0; k < 8; k++) {
      let nIdx;
      if (inner) {
        nIdx = idx + dIdx[k];
      } else {
        const nr = r + drs[k];
        const nc = c + dcs[k];
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        nIdx = nr * W + nc;
      }
      if (!mask[nIdx] || settled[nIdx]) continue;

      const hNbr = height[nIdx];
      const dh = reverse ? hHere - hNbr : hNbr - hHere;
      const dist = dists[k];

      let edge = v2Edge(dist, dh, cost);

      // Reverse-optimisation: invert the base cost before the repulsion
      // penalty is layered on. The penalty itself still ADDS to the
      // (already inverted) cost — that keeps repulsion behaving as
      // "avoid already-used cells" in both directions of optimisation.
      if (maximize) {
        edge = maxEdgeCost - edge;
        if (edge < 0) edge = 0;
      }

      // Apply the repulsion penalty. It scales the distance-cost component
      // `distCost` (= (aRoll+aAero)·dist, the v2 flat-resistance distance term,
      // the analog of v1's `alpha·dist`). Three modes:
      //   per-cell:  multiplier = penalty^used_count[v], applied to distCost.
      //              Sharp edges; only cells you've already traversed are
      //              expensive. Same as the QGIS plugin.
      //   linear:    extra cost = (penalty / (d + 1)) * distCost, where d
      //              is the cell's Euclidean distance (in cells) to the
      //              nearest previously-used cell. Soft 1/r decay; pushes
      //              the route away from prior corridors even where they
      //              don't directly overlap.
      //   square:    extra cost = (penalty / (d² + 1)) * distCost —
      //              same idea but with 1/r² (point-charge-like) falloff.
      const distCost = (cost.aRoll + cost.aAero) * dist;
      if (repulsionMode === "per-cell") {
        const used = usedCount[nIdx] | 0;
        if (used > 0) {
          const mult = Math.pow(penalty, used);
          edge += (mult - 1) * distCost;
        }
      } else if (distUsed) {
        const d = distUsed[nIdx];
        if (Number.isFinite(d)) {
          const denom = repulsionMode === "square" ? d * d + 1 : d + 1;
          edge += (penalty / denom) * distCost;
        }
      }

      const tentative = g + edge;
      if (eMax > 0 && tentative > eMax) continue;
      if (tentative < E[nIdx]) {
        E[nIdx] = tentative;
        L[nIdx] = L[idx] + dist;
        parents[nIdx] = idx;
        heapPush(heap, tentative + heuristic(nIdx), nIdx);
      }
    }
  }

  if (!settled[goalIdx]) return { path: null, energy: Infinity, length: 0 };

  // Reconstruct path
  const path = [];
  let i = goalIdx;
  const cap = N + 1;
  let steps = 0;
  while (i >= 0 && steps++ < cap) {
    path.push(i);
    i = parents[i];
  }
  path.reverse();
  return { path, energy: E[goalIdx], length: L[goalIdx] };
}

// Two-pass 8-neighbour Chamfer (3-4) distance transform. For each cell the
// output approximates the Euclidean distance (in cell units) to the nearest
// "seed" cell (where seedMask[i] != 0). Cells in the seed set themselves get
// distance 0; isolated cells get Infinity.
//
// 3-4 weights mean cardinal moves cost 3 and diagonal moves cost 4; we
// divide by 3 at the end so the output is in approximate cell-distance
// units. Worst-case error vs. true Euclidean is ~5%, which is fine for the
// repulsion-penalty use case here.
function chamferDistanceTransform(seedMask, H, W) {
  const N = H * W;
  const D = 3, DD = 4;
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = seedMask[i] ? 0 : Infinity;
  // Forward pass: top→bottom, left→right
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const idx = r * W + c;
      if (dist[idx] === 0) continue;
      let v = dist[idx];
      if (r > 0) {
        if (c > 0)        v = Math.min(v, dist[idx - W - 1] + DD);
                          v = Math.min(v, dist[idx - W] + D);
        if (c < W - 1)    v = Math.min(v, dist[idx - W + 1] + DD);
      }
      if (c > 0)          v = Math.min(v, dist[idx - 1] + D);
      dist[idx] = v;
    }
  }
  // Backward pass: bottom→top, right→left
  for (let r = H - 1; r >= 0; r--) {
    for (let c = W - 1; c >= 0; c--) {
      const idx = r * W + c;
      if (dist[idx] === 0) continue;
      let v = dist[idx];
      if (c < W - 1)      v = Math.min(v, dist[idx + 1] + D);
      if (r < H - 1) {
        if (c > 0)        v = Math.min(v, dist[idx + W - 1] + DD);
                          v = Math.min(v, dist[idx + W] + D);
        if (c < W - 1)    v = Math.min(v, dist[idx + W + 1] + DD);
      }
      dist[idx] = v;
    }
  }
  // Convert from chamfer-3-4 units to approximate cell-distance units.
  for (let i = 0; i < N; i++) {
    if (Number.isFinite(dist[i])) dist[i] /= D;
  }
  return dist;
}

// Specialised 3-4 chamfer for the idwFill prefilter: Int32 distances in raw
// chamfer units (no /3 normalisation pass), clamped at `limit + 4` so the
// propagation never grows numbers past what the cutoff comparison needs.
// ~2-3× cheaper than the general Float32 transform above.
function chamferFar3(seedMask, H, W, limit) {
  const N = H * W;
  const D = 3, DD = 4;
  const cap = limit + DD;
  const dist = new Int32Array(N);
  for (let i = 0; i < N; i++) dist[i] = seedMask[i] ? 0 : cap;
  // Forward pass: top→bottom, left→right
  for (let r = 0; r < H; r++) {
    const rowOff = r * W;
    for (let c = 0; c < W; c++) {
      const idx = rowOff + c;
      let v = dist[idx];
      if (v === 0) continue;
      if (r > 0) {
        if (c > 0)        { const t = dist[idx - W - 1] + DD; if (t < v) v = t; }
                          { const t = dist[idx - W] + D;      if (t < v) v = t; }
        if (c < W - 1)    { const t = dist[idx - W + 1] + DD; if (t < v) v = t; }
      }
      if (c > 0)          { const t = dist[idx - 1] + D;      if (t < v) v = t; }
      dist[idx] = v < cap ? v : cap;
    }
  }
  // Backward pass: bottom→top, right→left
  for (let r = H - 1; r >= 0; r--) {
    const rowOff = r * W;
    for (let c = W - 1; c >= 0; c--) {
      const idx = rowOff + c;
      let v = dist[idx];
      if (v === 0) continue;
      if (c < W - 1)      { const t = dist[idx + 1] + D;      if (t < v) v = t; }
      if (r < H - 1) {
        if (c > 0)        { const t = dist[idx + W - 1] + DD; if (t < v) v = t; }
                          { const t = dist[idx + W] + D;      if (t < v) v = t; }
        if (c < W - 1)    { const t = dist[idx + W + 1] + DD; if (t < v) v = t; }
      }
      dist[idx] = v < cap ? v : cap;
    }
  }
  return dist;
}

// GDAL-style fillnodata: for each non-network cell within demMask, walk
// outward in 8 directions until a network cell with a finite energy is
// found (up to maxDistance cells per direction). The cell's filled value
// is the inverse-squared-distance-weighted mean of those (up to 8) hits.
// Cells with no hits stay Infinity.
//
// Optional 3×3 box smoothing afterwards — network cells are preserved so
// smoothing only shifts the fill values.
//
//   E:           Float32Array; energies from the constrained Dijkstra.
//   networkMask: 1 on network cells.
//   demMask:     1 on every cell that should be filled.
//   maxDistance: ray search cap, in cells.
//   smoothing:   number of 3×3 box-smooth passes over the fill (0 = none).
function fillAcrossNetwork(E, networkMask, demMask, H, W, dx, dy, maxDistance, smoothing, onProgress) {
  const out = idwFill(E, networkMask, demMask, H, W, dx, dy, maxDistance, onProgress);
  let buf = out;
  for (let s = 0; s < smoothing; s++) {
    buf = boxSmoothPreserveNetwork(buf, networkMask, demMask, H, W);
  }
  return buf;
}

// rowStart/rowEnd (optional) restrict the FILLED rows to a band — the app's
// interp worker pool partitions the grid by rows; inputs are always the full
// grid since rays read up to maxDistance beyond the band edges. Output cells
// outside the band keep their input values.
function idwFill(E, networkMask, demMask, H, W, dx, dy, maxDistance, onProgress, rowStart = 0, rowEnd = H) {
  const N = H * W;
  const out = new Float32Array(E);
  const dDiag = Math.hypot(dx, dy);
  // Eight rays: dr, dc, per-step Euclidean cost. Typed columns — same
  // order as the original triplet array, so hit-sum order (and therefore
  // float rounding) is unchanged.
  const drs = new Int32Array([-1, -1, 0, 1, 1, 1, 0, -1]);
  const dcs = new Int32Array([0, 1, 1, 1, 0, -1, -1, -1]);
  const steps = new Float64Array([dy, dDiag, dx, dDiag, dy, dDiag, dx, dDiag]);
  const max = Math.max(1, maxDistance | 0);
  const bandRows = Math.max(1, rowEnd - rowStart);
  const reportEvery = Math.max(1, Math.floor(bandRows / 25));

  // Distance-transform prefilter: a ray can reach at most maxDistance·√2
  // cells (Euclidean), so cells whose nearest seed is provably farther get
  // Infinity without walking 8 rays — that's the bulk of the work on
  // sparse networks (misses cost the full 8·maxDistance steps; hits are
  // cheap). The chamfer transform is ±~6% approximate, so the cutoff
  // carries a 10% safety margin: cells inside the margin still walk (and
  // miss) their rays, keeping the output bit-identical.
  const seedMask = new Uint8Array(N);
  let anySeed = false;
  for (let i = 0; i < N; i++) {
    if (networkMask[i] && E[i] < Infinity) { seedMask[i] = 1; anySeed = true; }
  }
  // Integer chamfer in raw 3-4 units, clamped just above the cutoff — two
  // cheap passes regardless of network shape (global density heuristics
  // fail on clustered networks, where the prefilter matters most).
  // cutoffC3 is the cutoff in chamfer units with a 10% margin for the
  // transform's ±~6% error; marginal cells still walk (and miss) their
  // rays, so the output is bit-identical to the unfiltered version.
  const cutoffC3 = Math.ceil(1.1 * Math.SQRT2 * max * 3);
  const distNet = anySeed ? chamferFar3(seedMask, H, W, cutoffC3) : null;

  for (let r = rowStart; r < rowEnd; r++) {
    if (onProgress && (r - rowStart) % reportEvery === 0) onProgress((r - rowStart) / bandRows);
    const rowOff = r * W;
    for (let c = 0; c < W; c++) {
      const idx = rowOff + c;
      if (!demMask[idx]) continue;
      // Network cells with finite E are the seeds — leave them alone.
      if (networkMask[idx] && E[idx] < Infinity) continue;
      // No seeds at all → nothing can fill; beyond the (chamfer-unit)
      // cutoff → no ray can possibly hit, skip the walk.
      if (!anySeed || distNet[idx] > cutoffC3) { out[idx] = Infinity; continue; }

      let weighted = 0;
      let weightSum = 0;
      for (let k = 0; k < 8; k++) {
        const dr = drs[k], dc = dcs[k], step = steps[k];
        let nr = r, nc = c, dist = 0;
        for (let s = 0; s < max; s++) {
          nr += dr; nc += dc; dist += step;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) break;
          const ni = nr * W + nc;
          // Walk over any cells (network or not) but only contribute when we
          // hit a network cell with a finite seed value. The loop terminates
          // at the first such hit per direction.
          if (networkMask[ni] && E[ni] < Infinity) {
            const w = 1 / (dist * dist);
            weighted += E[ni] * w;
            weightSum += w;
            break;
          }
        }
      }
      out[idx] = weightSum > 0 ? weighted / weightSum : Infinity;
    }
  }
  return out;
}

// 3×3 average over cells within demMask. Network cells keep their input
// value (we never want smoothing to leak into the actual analysis output);
// other cells get the mean of any finite neighbours, which softens the
// IDW fill's directional artefacts.
function boxSmoothPreserveNetwork(E, networkMask, demMask, H, W) {
  const out = new Float32Array(E);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const idx = r * W + c;
      if (!demMask[idx] || networkMask[idx] || !Number.isFinite(E[idx])) continue;
      let sum = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          const ni = nr * W + nc;
          if (!demMask[ni] || !Number.isFinite(E[ni])) continue;
          sum += E[ni]; n++;
        }
      }
      if (n > 0) out[idx] = sum / n;
    }
  }
  return out;
}

// Reconstruct a path from the parents array; returns flat indices.
function reconstructPath(parents, goalIdx) {
  const path = [];
  let idx = goalIdx;
  while (idx >= 0) {
    path.push(idx);
    idx = parents[idx];
  }
  path.reverse();
  return path;
}

// ------- Length-constrained max-cost path (layered DP) -------
// Finds the path from src to dst of exactly L edges that maximises the
// sum of original edge costs, by running a Bellman-Ford-style relaxation
// L times over the grid. Each iteration t computes dist[t][v] = max-cost
// path of exactly t edges from src to v. Memory dominates: we keep one
// Uint8Array per (t, v) for path reconstruction → ≈ L · H · W bytes.
//
// Caveats:
//   - "Path of length L" is in edge count, not metres. Diagonal moves
//     cover dx·√2 per edge.
//   - The graph isn't a DAG (8-neighbour grid has cycles). Layered DP
//     treats each (cell, t) pair as a separate DAG node, which means the
//     resulting path *can* revisit cells across different t. In practice
//     for short L and asymmetric costs this is rare, but we don't add
//     a no-backtrack constraint — that would multiply the state by 8.
//   - Memory cap below refuses runs above ~256 MB of parent storage.
//     Large DEMs limit usable L to a few dozen; the only safe escape is
//     to crop the DEM (FABDEM-viewport loader is the easiest way).

const MAX_DP_PARENT_BYTES = 256 * 1024 * 1024;

function maxCostPathOfLength(opts) {
  const {
    height, mask, H, W,
    startR, startC, goalR, goalC,
    cost, dx, dy,
    L,
    progressBase = 0,
    progressScale = 1,
    reverse = false,          // score edges in the opposite travel direction
                              // (mode "to": field/path/top-N all measure
                              // travel goal→seed — mirror that here).
  } = opts;
  const N = H * W;

  // Memory cap. Parent storage is the dominant allocation; the two
  // dist arrays are 8 N bytes regardless of L.
  if (L <= 0 || L > 5000) {
    return { path: null, energy: -Infinity, length: 0, error: "bad_L" };
  }
  if (N * L > MAX_DP_PARENT_BYTES) {
    return {
      path: null, energy: -Infinity, length: 0,
      error: `memory_cap (L·N = ${(N * L / 1024 / 1024).toFixed(0)} MB > ${MAX_DP_PARENT_BYTES / 1024 / 1024} MB)`,
    };
  }

  const drs = [-1, -1, -1, 0, 0, 1, 1, 1];
  const dcs = [-1, 0, 1, -1, 1, -1, 0, 1];
  const diag = Math.hypot(dx, dy);
  const dists = [diag, dy, diag, dx, dx, diag, dy, diag];

  const start = startR * W + startC;
  const goal  = goalR  * W + goalC;
  if (start < 0 || start >= N || goal < 0 || goal >= N) {
    return { path: null, energy: -Infinity, length: 0, error: "oob" };
  }

  // Two alternating dist arrays. prev[v] holds dist[t-1][v]; we write
  // dist[t][v] into curr[v], then swap.
  let prev = new Float32Array(N);
  let curr = new Float32Array(N);
  prev.fill(-Infinity);
  prev[start] = 0;

  // parentDir[(t-1)·N + v] = direction (0..7) of the neighbour we came
  // from when reaching v at step t. 255 = no path found yet to (t, v).
  // Stored as a flat Uint8Array because Int32 would 4× the memory and we
  // only need 3 bits.
  const parentDir = new Uint8Array(N * L).fill(255);

  for (let t = 1; t <= L; t++) {
    curr.fill(-Infinity);
    for (let r = 0; r < H; r++) {
      const rowBase = r * W;
      for (let c = 0; c < W; c++) {
        const v = rowBase + c;
        if (!mask[v]) continue;
        const hv = height[v];

        let bestVal = -Infinity;
        let bestDir = 255;
        for (let k = 0; k < 8; k++) {
          const nr = r + drs[k];
          const nc = c + dcs[k];
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          const n = nr * W + nc;
          // Soft seed, like dijkstra/astar: an off-mask start can still act
          // as a predecessor (the search is allowed to STEP FROM it), it
          // just can't be stepped THROUGH later — n === start is the only
          // off-mask cell with a finite prev[] value (prev[start] = 0 at
          // t=0), so this only ever admits the seed itself.
          if (!mask[n] && n !== start) continue;
          const pVal = prev[n];
          if (!Number.isFinite(pVal)) continue;

          // Same cost model as Dijkstra/A*: the v2 per-edge leg energy.
          const dh = reverse ? height[n] - hv : hv - height[n];
          const dist = dists[k];
          const edge = v2Edge(dist, dh, cost);
          const cand = pVal + edge;
          if (cand > bestVal) {
            bestVal = cand;
            bestDir = k;
          }
        }
        curr[v] = bestVal;
        if (bestDir !== 255) {
          parentDir[(t - 1) * N + v] = bestDir;
        }
      }
    }

    // Swap prev/curr.
    const tmp = prev; prev = curr; curr = tmp;

    // Coarse progress per layer.
    if (t === L || t % Math.max(1, Math.floor(L / 25)) === 0) {
      postMessage({ kind: "progress", progress: progressBase + progressScale * (t / L) });
    }
  }

  // After the loop, prev[v] = dist[L][v]. Bail if the goal wasn't reached
  // in exactly L edges.
  if (!Number.isFinite(prev[goal])) {
    return {
      path: null, energy: -Infinity, length: 0,
      error: "unreachable",
      energyField: prev,
    };
  }

  // Reconstruct by walking parentDir backwards from (L, goal).
  //
  // The relaxation loop stores `bestDir = k`, where neighbour n is at
  // offset (drs[k], dcs[k]) from v — i.e. n IS the predecessor at step
  // t-1. So to move from v back to its predecessor we ADD the offset,
  // not subtract it. The previous code did `r - drs[dir]`, which sent
  // the walk in the opposite direction and eventually landed on a cell
  // with parentDir=255 (because that wrong-direction cell wasn't on the
  // actual max-cost chain), producing the spurious "backtrack_fail".
  const path = new Array(L + 1);
  path[L] = goal;
  let v = goal;
  for (let t = L; t >= 1; t--) {
    const dir = parentDir[(t - 1) * N + v];
    if (dir === 255) {
      return {
        path: null, energy: -Infinity, length: 0,
        error: "backtrack_fail",
        energyField: prev,
      };
    }
    const r = (v / W) | 0;
    const c = v - r * W;
    const nr = r + drs[dir];
    const nc = c + dcs[dir];
    v = nr * W + nc;
    path[t - 1] = v;
  }

  // Geometric length in metres.
  let pathLen = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const ar = (a / W) | 0, ac = a - ar * W;
    const br = (b / W) | 0, bc = b - br * W;
    pathLen += Math.hypot((br - ar) * dy, (bc - ac) * dx);
  }

  return {
    path,
    energy: prev[goal],
    length: pathLen,
    energyField: prev, // dist[L][v] for every cell — use as the field overlay
  };
}

// ------- Max-density segment (multi-start self-avoiding greedy search) -------
// Post-hoc analysis over a computed density/passes field: find a continuous
// SIMPLE path (no cell revisited) of ~target metric length that maximises the
// density line integral Σ d̄·len (d̄ = trapezoid mean of the two endpoint cells
// per edge). Runs on a grid coarsened by app.js (block-mean density) —
// display/analysis layer only, no energy semantics, no backend counterpart.
//
// Why not exact DP: this is the orienteering problem (NP-hard for simple
// paths). A layered DP over WALKS is exact for the walk relaxation but
// degenerates on real corridor fields — with only immediate backtracking
// forbidden, the optimum is to turn around in a 3-cell loop and re-harvest
// the single hottest stretch over and over (measured: a 20 km "segment"
// collapsed onto 4 km of corridor traversed 5×). A warning can't fix that;
// the deliverable has to be a simple path.
//
// Algorithm: from each of ≤ MAXSEG_STARTS well-separated high-density seed
// cells, grow a self-avoiding path TWO-ENDED (either endpoint may extend, so
// a seed in the middle of a corridor grows both ways); each candidate step is
// scored by its own edge reward plus a short greedy self-avoiding ROLLOUT
// (depth MAXSEG_ROLLOUT) past it, which carries the search across local dips
// and junctions. Keep the best run — full-length runs by reward, else the
// longest. Corridor fields are ridge-shaped, which is exactly where greedy
// ridge-following is strong; test-maxseg.mjs pins quality against exact
// self-avoiding enumeration on small grids and against analytic optima on
// synthetic corridor fields.

const MAXSEG_MAX_CELLS = 16 * 1024 * 1024; // app coarsens to ≤ ~4 M — hard stop here
const MAXSEG_STARTS = 24;      // seed cells (spacing-filtered from the top pool)
const MAXSEG_TOP_POOL = 4096;  // top-density pool the seeds are drawn from
const MAXSEG_ROLLOUT = 12;      // lookahead depth per candidate step
// Turn penalty exponent (DEFAULT — the app passes msg.turnExp from the 3C.c
// knob): candidate steps are SCORED as reward × ((1 + cos Δθ)/2)^exp against
// the leg's previous direction (1 = straight, →0 near a reversal). Without it
// the raw objective rewards SNAKING: where the coarsened corridor is 2–3
// cells wide, weaving across its width packs more Σ d̄·len into the hot band
// than following its spine (measured: a straight 3-wide corridor came back
// at sinuosity 1.41 with 100% ≥90° turns). 0 disables.
const MAXSEG_TURN_EXP = 0.5;
// Elongation (anti-round-trip) exponent DEFAULT (msg.elongExp from the same
// panel): each step is additionally scored × ((1 + g)/2)^exp against TWO
// reference points, where g is the step's change to the distance from that
// reference per metre (+1 = straight away, −1 = straight back toward it):
//   - GLOBAL: the other endpoint — penalises end-to-end round-trip shapes
//     (a leg curling back toward the other end), prefers chord-like segments;
//   - LOCAL: a trailing anchor msg.elongLookbackM metres back along the path
//     — penalises the U-turn of a local out-and-back lobe, which the global
//     reference misses when the lobe is perpendicular to the main chord.
// The anchor alone can't stop the RETURN LANE of an out-and-back (past one
// lookback beyond the U-turn, the return moves AWAY from its trailing
// anchor), so a third term does: a proximity HALO — a step landing within
// MAXSEG_HALO_CELLS of an already-visited path cell is scored × 0.02^exp
// (soft widened self-avoidance: the segment shouldn't hug itself). Only the
// path's own immediate tail is exempt — cells within ~4·radius of path
// length behind, i.e. what a smooth path necessarily keeps inside its own
// halo — NOT the whole lookback window (an early version exempted a full
// lookback and the first lookback-worth of every return lane rode free).
// 0 disables all three (pure density corridor). Every exponent steers the
// SEARCH only — the reported sum stays the drawn polyline's own raw line
// integral.
const MAXSEG_ELONG_EXP = 0.5;
const MAXSEG_HALO_CELLS = 2;   // Chebyshev radius of the self-proximity halo

function maxDensitySegment(opts) {
  const {
    density, allowed, H, W, dx, dy, targetLenM,
    turnExp = MAXSEG_TURN_EXP,
    elongExp = MAXSEG_ELONG_EXP,
    elongLookbackM = 0,          // 0 = local anchor off; app sends auto = L/8
    progressBase = 0, progressScale = 1,
  } = opts;
  const N = H * W;
  // Sanitise the knob values (UI input / older cached app.js): finite, 0–4.
  const tExp = Number.isFinite(turnExp) ? Math.min(4, Math.max(0, turnExp)) : MAXSEG_TURN_EXP;
  const eExp = Number.isFinite(elongExp) ? Math.min(4, Math.max(0, elongExp)) : MAXSEG_ELONG_EXP;
  const lookM = (Number.isFinite(elongLookbackM) && elongLookbackM > 0) ? elongLookbackM : 0;

  const drs = [-1, -1, -1, 0, 0, 1, 1, 1];
  const dcs = [-1, 0, 1, -1, 1, -1, 0, 1];
  const diag = Math.hypot(dx, dy);
  const lens = [diag, dy, diag, dx, dx, diag, dy, diag];
  const minCell = Math.min(dx, dy);

  if (targetLenM < 4 * minCell) return { error: "too_short" };
  if (N > MAXSEG_MAX_CELLS) return { error: `grid_too_big (${N} cells)` };

  // ---- Seed selection: top-density pool, then spacing filter ----
  // Min-heap of the MAXSEG_TOP_POOL highest-density allowed cells (one pass),
  // then greedily keep the densest seeds at least `sep` cells apart so the
  // starts probe different corridors instead of one hot blob.
  const heapIdx = new Int32Array(MAXSEG_TOP_POOL);
  const heapVal = new Float64Array(MAXSEG_TOP_POOL);
  let heapN = 0;
  const heapUp = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapVal[p] <= heapVal[i]) break;
      const tv = heapVal[p]; heapVal[p] = heapVal[i]; heapVal[i] = tv;
      const ti = heapIdx[p]; heapIdx[p] = heapIdx[i]; heapIdx[i] = ti;
      i = p;
    }
  };
  const heapDown = () => {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < heapN && heapVal[l] < heapVal[m]) m = l;
      if (r < heapN && heapVal[r] < heapVal[m]) m = r;
      if (m === i) break;
      const tv = heapVal[m]; heapVal[m] = heapVal[i]; heapVal[i] = tv;
      const ti = heapIdx[m]; heapIdx[m] = heapIdx[i]; heapIdx[i] = ti;
      i = m;
    }
  };
  for (let i = 0; i < N; i++) {
    if (!allowed[i]) continue;
    const v = density[i];
    if (heapN < MAXSEG_TOP_POOL) {
      heapIdx[heapN] = i; heapVal[heapN] = v; heapUp(heapN++);
    } else if (v > heapVal[0]) {
      heapIdx[0] = i; heapVal[0] = v; heapDown();
    }
  }
  if (heapN === 0) return { error: "unreachable" };
  const pool = [];
  for (let i = 0; i < heapN; i++) pool.push([heapVal[i], heapIdx[i]]);
  pool.sort((a, b) => b[0] - a[0]);
  const sep = Math.max(2, Math.round(targetLenM / minCell / 12)); // Chebyshev cells
  const starts = [];
  for (const [, idx] of pool) {
    const r = (idx / W) | 0, c = idx - r * W;
    let far = true;
    for (const s of starts) {
      const sr = (s / W) | 0, sc = s - sr * W;
      if (Math.max(Math.abs(sr - r), Math.abs(sc - c)) < sep) { far = false; break; }
    }
    if (far) starts.push(idx);
    if (starts.length >= MAXSEG_STARTS) break;
  }

  // ---- Two-ended self-avoiding greedy growth with rollout lookahead ----
  // Turn-factor table over metric move directions (anisotropy-aware): row a =
  // the leg's previous move, col k = the candidate move; row 8 = "no previous
  // direction" (only the very first extension of a run). A leg's FIRST step is
  // scored against the REVERSE of the other leg's first move when that exists
  // — the bend at the seed is a bend of the traversed path like any other.
  // Leaving it free let a strongly-straightened path fold into a hairpin "V"
  // (two straight legs, endpoints adjacent — measured sinuosity 2.19). With
  // the coupling, the accumulated penalized score equals the full traversal's
  // pairwise turn objective exactly (turn factors are direction-symmetric),
  // which is also what test-maxseg.mjs's exact reference enumerates.
  const turnF = new Float64Array(9 * 8);
  {
    const ux = new Float64Array(8), uy = new Float64Array(8);
    for (let k = 0; k < 8; k++) {
      const vx = dcs[k] * dx, vy = drs[k] * dy;
      const n = Math.hypot(vx, vy);
      ux[k] = vx / n; uy[k] = vy / n;
    }
    for (let a = 0; a < 8; a++)
      for (let k = 0; k < 8; k++)
        turnF[a * 8 + k] = Math.pow(Math.max(0, (1 + ux[a] * ux[k] + uy[a] * uy[k]) / 2), tExp);
    for (let k = 0; k < 8; k++) turnF[8 * 8 + k] = 1;
  }

  // Elongation (anti-round-trip) factor: g = Δ(head↔tail separation)/stepLen
  // ∈ [−1, 1] by the triangle inequality — +1 straight away from the other
  // endpoint (factor 1), −1 straight back toward it (factor →0). Metric,
  // anisotropy-aware.
  const distM = (r1, c1, r2, c2) => Math.hypot((r1 - r2) * dy, (c1 - c2) * dx);
  const elongF = eExp > 0
    ? (g) => Math.pow(Math.max(0, (1 + g) / 2), eExp)
    : () => 1;

  const visited = new Uint8Array(N);
  const rollMarks = new Int32Array(MAXSEG_ROLLOUT);
  // stamp[cell] = path length at which the REAL path visited the cell
  // (−1 = not on the path). Rollout temp-cells never stamp — the halo is
  // about the established path, and rollout cells are "recent" by definition.
  // stamp[cell] = SIGNED along-path coordinate at which the real path visited
  // the cell: head leg +cum, tail leg −cum, seed 0, NaN = not on the path.
  // Signed coordinates make proximity age = |Δcoord| the true along-path
  // separation — with plain run-length stamps, the two legs extending in
  // alternation kept opposite-leg neighbours "recent" forever, and a
  // lockstep twin-lane descent rode the tail exemption unpenalised.
  const stamp = new Float32Array(N);
  const haloF = (eExp > 0 && lookM > 0) ? Math.pow(0.02, eExp) : 1;
  // Tail exemption: a turn-penalised smooth path keeps its radius-2
  // neighbours ≤ ~2–3 cells behind, so anything ≥ 3 cells of along-path
  // separation inside the halo is self-hugging. Deliberately cell-scale,
  // NOT the lookback window (an early version exempted a full lookback and
  // the first lookback-worth of every return lane rode free).
  const haloAgeM = 3 * Math.max(dx, dy);
  // Any path cell with along-path separation ≥ haloAgeM within the halo?
  const haloHit = (n, coord) => {
    const r = (n / W) | 0, c = n - r * W;
    const r0 = Math.max(0, r - MAXSEG_HALO_CELLS), r1 = Math.min(H - 1, r + MAXSEG_HALO_CELLS);
    const c0 = Math.max(0, c - MAXSEG_HALO_CELLS), c1 = Math.min(W - 1, c + MAXSEG_HALO_CELLS);
    for (let rr = r0; rr <= r1; rr++) {
      const rowBase = rr * W;
      for (let cc = c0; cc <= c1; cc++) {
        const st = stamp[rowBase + cc];
        if (st === st && Math.abs(coord - st) >= haloAgeM) return true; // st===st: not NaN
      }
    }
    return false;
  };

  // Greedy self-avoiding continuation from `from` (arrived via `fromDir`),
  // depth-limited; returns the summed PENALIZED reward (turn + elongation,
  // the latter against the FIXED other endpoint `otherR/otherC`). Temp-marks
  // visited cells and unmarks before returning.
  const rollout = (from, fromDir, otherR, otherC, anchR, anchC, coord0, sideSign) => {
    let cur = from, dir = fromDir, sum = 0, nMarks = 0, coord = coord0;
    const fr = (from / W) | 0, fc = from - fr * W;
    let dOther = distM(fr, fc, otherR, otherC);
    let dAnch = anchR >= 0 ? distM(fr, fc, anchR, anchC) : 0;
    for (let d = 0; d < MAXSEG_ROLLOUT; d++) {
      const r = (cur / W) | 0, c = cur - r * W;
      let bestS = -Infinity, bestN = -1, bestK = -1, bestD1 = 0, bestD2 = 0;
      for (let k = 0; k < 8; k++) {
        const nr = r + drs[k], nc = c + dcs[k];
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        const n = nr * W + nc;
        if (!allowed[n] || visited[n]) continue;
        let s = 0.5 * (density[cur] + density[n]) * lens[k] * turnF[dir * 8 + k];
        let d1 = 0, d2 = 0;
        if (eExp > 0) {
          d1 = distM(nr, nc, otherR, otherC);
          s *= elongF((d1 - dOther) / lens[k]);
          if (anchR >= 0) {
            d2 = distM(nr, nc, anchR, anchC);
            s *= elongF((d2 - dAnch) / lens[k]);
          }
          if (haloF < 1 && haloHit(n, coord + sideSign * lens[k])) s *= haloF;
        }
        if (s > bestS) { bestS = s; bestN = n; bestK = k; bestD1 = d1; bestD2 = d2; }
      }
      if (bestN < 0) break;
      sum += bestS;
      visited[bestN] = 1;
      rollMarks[nMarks++] = bestN;
      cur = bestN;
      dir = bestK;
      dOther = bestD1;
      dAnch = bestD2;
      coord += sideSign * lens[bestK];
    }
    for (let i = 0; i < nMarks; i++) visited[rollMarks[i]] = 0;
    return sum;
  };

  // Binary searches over a leg's cumulative-length array (monotonic).
  const bsearchLE = (cum, x) => {
    let lo = 0, hi = cum.length - 1, res = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cum[m] <= x) { res = m; lo = m + 1; } else hi = m - 1; }
    return res;
  };
  const bsearchGE = (cum, x) => {
    let lo = 0, hi = cum.length - 1, res = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cum[m] >= x) { res = m; hi = m - 1; } else lo = m + 1; }
    return res;
  };

  const best = { Rsel: -Infinity, Rraw: 0, len: 0, rho: 0, path: null };
  for (let si = 0; si < starts.length; si++) {
    const s = starts[si];
    visited.fill(0);
    visited[s] = 1;
    stamp.fill(NaN);
    stamp[s] = 0;
    const headArr = [], tailArr = []; // cells beyond s on each side, in growth order
    const headCum = [], tailCum = []; // cumulative metric length seed → cell
    let headEnd = s, tailEnd = s;
    let headLen = 0, tailLen = 0;    // each leg's metric length
    let headDir = 8, tailDir = 8;    // 8 = no previous direction yet
    let headDir0 = 8, tailDir0 = 8;  // each leg's FIRST outward move (kink coupling)
    let len = 0, Rraw = 0, Rpen = 0;

    // Local anti-round-trip anchor for one side: the path cell ~lookM metres
    // BEHIND that end along the path (through the seed into the other leg if
    // this leg is shorter). Returns −1 when the whole path is shorter than
    // lookM — the anchor would coincide with the other end, which the global
    // reference already covers.
    const anchorCell = (side) => {
      if (!(eExp > 0) || !(lookM > 0)) return -1;
      const lenA = side === 0 ? headLen : tailLen;
      if (lenA >= lookM) {
        const arrA = side === 0 ? headArr : tailArr;
        const cumA = side === 0 ? headCum : tailCum;
        const i = bsearchLE(cumA, lenA - lookM);
        return i >= 0 ? arrA[i] : s; // nothing that far back on the leg → the seed
      }
      const arrB = side === 0 ? tailArr : headArr;
      const cumB = side === 0 ? tailCum : headCum;
      const i = bsearchGE(cumB, lookM - lenA);
      return i >= 0 ? arrB[i] : -1;
    };

    while (len < targetLenM) {
      let bestScore = -Infinity, bestN = -1, bestK = -1, bestBase = 0, bestPen = 0, bestSide = 0;
      for (let side = 0; side < 2; side++) {
        const end = side === 0 ? headEnd : tailEnd;
        let endDir = side === 0 ? headDir : tailDir;
        // Seed-kink coupling: this leg's first step bends the path at the
        // seed relative to the other leg's first (outward) move — score it
        // against that move's reverse (7 − k mirrors the classic tables).
        if (endDir === 8) {
          const otherFirst = side === 0
            ? (tailArr.length ? tailDir0 : 8)
            : (headArr.length ? headDir0 : 8);
          if (otherFirst !== 8) endDir = 7 - otherFirst;
        }
        const r = (end / W) | 0, c = end - r * W;
        // GLOBAL elongation reference: the OTHER end — extending this leg
        // toward it is round-trip-shaped, away from it is chord-shaped.
        const other = side === 0 ? tailEnd : headEnd;
        const otherR = (other / W) | 0, otherC = other - otherR * W;
        const d0 = distM(r, c, otherR, otherC);
        // LOCAL reference: the trailing anchor lookM metres behind this end —
        // catches out-and-back lobes the chord reference can't see.
        const anch = anchorCell(side);
        const anchR = anch >= 0 ? (anch / W) | 0 : -1;
        const anchC = anch >= 0 ? anch - anchR * W : -1;
        const dA0 = anch >= 0 ? distM(r, c, anchR, anchC) : 0;
        // Signed along-path coordinate this side extends toward (head +, tail −).
        const sideSign = side === 0 ? 1 : -1;
        const legLen = side === 0 ? headLen : tailLen;
        for (let k = 0; k < 8; k++) {
          const nr = r + drs[k], nc = c + dcs[k];
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          const n = nr * W + nc;
          if (!allowed[n] || visited[n]) continue;
          const coordN = sideSign * (legLen + lens[k]);
          const base = 0.5 * (density[end] + density[n]) * lens[k];
          let pen = base * turnF[endDir * 8 + k];
          if (eExp > 0) {
            pen *= elongF((distM(nr, nc, otherR, otherC) - d0) / lens[k]);
            if (anch >= 0) pen *= elongF((distM(nr, nc, anchR, anchC) - dA0) / lens[k]);
            if (haloF < 1 && haloHit(n, coordN)) pen *= haloF;
          }
          visited[n] = 1;
          const score = pen + rollout(n, k, otherR, otherC, anchR, anchC, coordN, sideSign);
          visited[n] = 0;
          if (score > bestScore) {
            bestScore = score; bestN = n; bestK = k; bestBase = base; bestPen = pen; bestSide = side;
          }
        }
      }
      if (bestN < 0) break; // both ends stuck (mask pocket / grid corner)
      visited[bestN] = 1;
      if (bestSide === 0) {
        if (!headArr.length) headDir0 = bestK;
        headArr.push(bestN); headEnd = bestN; headDir = bestK;
        headLen += lens[bestK]; headCum.push(headLen);
      } else {
        if (!tailArr.length) tailDir0 = bestK;
        tailArr.push(bestN); tailEnd = bestN; tailDir = bestK;
        tailLen += lens[bestK]; tailCum.push(tailLen);
      }
      len += lens[bestK];
      stamp[bestN] = bestSide === 0 ? headLen : -tailLen; // signed along-path coord
      Rraw += bestBase;
      Rpen += bestPen;
    }

    // Straightness ρ = chord / length — the length-weighted circular mean
    // resultant of the step headings (the traversal-oriented step vectors sum
    // to exactly the tail→head chord), i.e. 1 − circular variance. With the
    // elongation knob on, run selection weights the penalized reward by ρ^exp
    // so among the seeds a low-circular-spread (straighter) run wins ties.
    const chord = distM((headEnd / W) | 0, headEnd % W, (tailEnd / W) | 0, tailEnd % W);
    const rho = len > 0 ? chord / len : 0;
    const Rsel = eExp > 0 ? Rpen * Math.pow(Math.max(rho, 1e-6), eExp) : Rpen;

    // Prefer runs that reached (≈) the target; among those, max SELECTION
    // score (penalized reward × straightness weight) — the raw integral is
    // what gets reported.
    const full = len >= 0.95 * targetLenM;
    const bFull = best.len >= 0.95 * targetLenM;
    if ((full && !bFull) || (full === bFull && (full ? Rsel > best.Rsel : len > best.len))) {
      const path = new Int32Array(headArr.length + 1 + tailArr.length);
      let p = 0;
      for (let i = headArr.length - 1; i >= 0; i--) path[p++] = headArr[i];
      path[p++] = s;
      for (let i = 0; i < tailArr.length; i++) path[p++] = tailArr[i];
      best.Rsel = Rsel; best.Rraw = Rraw; best.len = len; best.rho = rho; best.path = path;
    }
    postMessage({ kind: "progress", progress: progressBase + progressScale * ((si + 1) / starts.length) });
  }

  if (!best.path || best.path.length < 2) return { error: "unreachable" };

  return {
    path: best.path,
    sum: best.Rraw,          // Σ d̄·len over the path (density · metres) — RAW,
                             // the drawn line's own integral (the shape
                             // penalties steer the search, never the readout)
    lengthM: best.len,       // true metric length (exact edge sum)
    straightness: best.rho,  // chord/length ∈ (0,1] — 1 − circular variance
                             // of the step headings (1 = perfectly straight)
    revisitFrac: 0,          // simple path by construction (kept for API shape)
  };
}

// ------- Worker message handler -------
// Vector-network graph routing lives in a sibling module (shared with the node
// test). importScripts only exists in a real Worker; in the node test harness
// (new Function sandbox) it's absent and the graph kinds are never exercised,
// so the guard keeps test-worker-pool.mjs working while the browser gets the
// engine. graph-engine.js assigns self.GraphEngine.
if (typeof importScripts === "function") {
  try { importScripts("graph-engine.js"); } catch (e) { /* graph mode unavailable; grid paths unaffected */ }
}

self.onmessage = (ev) => {
  const msg = ev.data;

  // Standalone IDW-fill job. Used by the density worker pool: the pool
  // merges per-worker partial fields on the main thread, so the optional
  // network interpolation (which lives here, next to its helpers) runs as
  // a follow-up task on the merged energy field.
  if (msg.kind === "interp") {
    try {
      const rowStart = msg.rowStart ?? 0;
      const rowEnd = msg.rowEnd ?? msg.H;
      const onProgress = (frac) => postMessage({ kind: "progress", progress: frac });
      if (rowStart > 0 || rowEnd < msg.H) {
        // Pool band: fill only [rowStart, rowEnd) and return that slice.
        // Smoothing is NOT applied per band (it would seam at the edges) —
        // the app runs a separate "smooth" pass over the merged grid.
        const out = idwFill(
          msg.energy, msg.networkMask, msg.mask, msg.H, msg.W, msg.dx, msg.dy,
          msg.interpMaxDistance, onProgress, rowStart, rowEnd,
        );
        const band = out.slice(rowStart * msg.W, rowEnd * msg.W);
        postMessage({ kind: "interp-done", energy: band, rowStart, rowEnd }, [band.buffer]);
      } else {
        const filled = fillAcrossNetwork(
          msg.energy, msg.networkMask, msg.mask, msg.H, msg.W, msg.dx, msg.dy,
          msg.interpMaxDistance, msg.interpSmoothing, onProgress,
        );
        postMessage({ kind: "interp-done", energy: filled }, [filled.buffer]);
      }
    } catch (err) {
      postMessage({ kind: "error", message: err.message });
    }
    return;
  }

  // Post-merge smoothing for the banded interp path: N box-smooth passes
  // over the full merged grid (cheap relative to the fill itself).
  if (msg.kind === "smooth") {
    try {
      let buf = msg.energy;
      for (let s = 0; s < (msg.iters | 0); s++) {
        buf = boxSmoothPreserveNetwork(buf, msg.networkMask, msg.mask, msg.H, msg.W);
      }
      postMessage({ kind: "smooth-done", energy: buf }, [buf.buffer]);
    } catch (err) {
      postMessage({ kind: "error", message: err.message });
    }
    return;
  }

  // Max-density segment: post-hoc layered DP over a coarsened density field
  // (see maxDensitySegment). Standalone job like "interp" — no grid/energy
  // state involved, so it never touches the run paths or backend parity.
  if (msg.kind === "maxseg") {
    try {
      const res = maxDensitySegment(msg);
      if (res.error) postMessage({ kind: "error", message: res.error });
      else {
        postMessage(
          { kind: "maxseg-done", path: res.path, sum: res.sum, lengthM: res.lengthM, straightness: res.straightness, revisitFrac: res.revisitFrac },
          [res.path.buffer],
        );
      }
    } catch (err) {
      postMessage({ kind: "error", message: err.message });
    }
    return;
  }

  // Calibration probe: learn this DEM's real allocation cost and per-ref
  // search throughput so the main thread's pre-flight estimate can scale
  // with the energy budget instead of assuming a fixed full-grid rate.
  // Two phases: (a) time a fresh full-N scratch allocation (dominated by
  // first-touch on huge DEMs); (b) run densityField with a couple of refs
  // at a fixed calibration budget, capturing total time + explored cells.
  // perRef = (totalMs − allocMs) / nRefs isolates the per-ref work from the
  // one-time allocation (see app.js startCalibrationProbe).
  if (msg.kind === "probe") {
    try {
      const { height, mask, H, W, dx, dy, cost, refPoints, maxSettled } = msg;
      const N = H * W;
      const tA = performance.now();
      // Mirror densityField's non-round scratch set so the measured alloc
      // matches what a real run pays. Touch each so the JIT can't elide.
      const _e = new Float32Array(N).fill(Infinity);
      const _s = new Uint8Array(N);
      const _p = new Int32Array(N).fill(-1);
      const _o = new Int32Array(N);
      const _pa = new Float32Array(N);
      _e[0] = 0; _s[0] = 1; _p[0] = 0; _o[0] = 0; _pa[0] = 0;
      const allocMs = performance.now() - tA;

      // ONE unbudgeted search per ref, stopped after maxSettled cells. This
      // bounds the probe's wall time regardless of DEM size (the 3 s ceiling)
      // while anchoring the estimate at an UNSATURATED point: we learn this
      // terrain's (budgetReached → explored) and (explored → perRef) at the
      // cell count, then the estimate scales from there. budgetReached
      // (energy of the last settled cell) varies per ref with local relief;
      // we average it. perRef = (totalMs − allocMs)/nRefs isolates search+walk.
      let exploredTotal = 0, budgetReachedSum = 0;
      const t0 = performance.now();
      densityField({
        height, mask, H, W, refPoints, dmode: "from",
        cost, dx, dy, eMax: 0, maxSettled,
        maximize: false, maxEdgeCost: 0, eMaxTotalCap: 0,
        onExplored: (len, budgetReached) => { exploredTotal += len; budgetReachedSum += budgetReached; },
      });
      const totalMs = performance.now() - t0;
      postMessage({
        kind: "probe-done", allocMs, totalMs, exploredTotal,
        budgetReached: budgetReachedSum / refPoints.length,
        nRefs: refPoints.length, N,
      });
    } catch (err) {
      postMessage({ kind: "error", message: err.message });
    }
    return;
  }

  // Build the routable graph from network polylines + DEM (once per network
  // load). Returns transferable typed arrays the app caches as state.networkGraph
  // and ships back with every graphRun. See graph-engine.js for the data shape.
  if (msg.kind === "graphBuild") {
    try {
      const g = GraphEngine.buildGraph(msg.lines, msg.dem, msg.opts);
      const transfer = [
        g.nodeR.buffer, g.nodeC.buffer, g.nodeH.buffer, g.nodeValid.buffer, g.edgeA.buffer, g.edgeB.buffer,
        g.edgeLenM.buffer, g.edgeStepM.buffer, g.profOff.buffer, g.profH.buffer,
        g.csrHead.buffer, g.csrSource.buffer, g.csrTarget.buffer, g.csrEdge.buffer, g.csrAtoB.buffer,
      ];
      postMessage({ kind: "graph-built", graph: g, gen: msg.gen }, transfer);
    } catch (err) {
      postMessage({ kind: "error", message: err.message });
    }
    return;
  }

  // Run one compute (any mode) on the cached graph. The big per-edge / per-node
  // arrays transfer back; path/routes are small plain objects.
  if (msg.kind === "graphRun") {
    try {
      const g = msg.graph, p = msg.params;
      // Snap src/dst/ref pixel coords to graph nodes here — the main thread has
      // no engine; the graph (and nearestNode) live in the worker. Integer
      // [r,c] cells index at CORNERS while the graph nodes carry fractional
      // grid coords (centres at integer+0.5) — snap from the cell centre.
      if (p.srcRC) p.srcNode = GraphEngine.nearestNode(g, p.srcRC[0] + 0.5, p.srcRC[1] + 0.5);
      if (p.dstRC) p.dstNode = GraphEngine.nearestNode(g, p.dstRC[0] + 0.5, p.dstRC[1] + 0.5);
      if (p.refRCs) p.refNodes = p.refRCs.map((rc) => GraphEngine.nearestNode(g, rc[0] + 0.5, rc[1] + 0.5));
      const res = GraphEngine.computeGraph(g, p);
      const transfer = [res.edgePasses.buffer];
      if (res.edgeEnergy) transfer.push(res.edgeEnergy.buffer);
      if (res.nodeEnergy) transfer.push(res.nodeEnergy.buffer);
      postMessage({ kind: "graph-result", result: res, gen: msg.gen }, transfer);
    } catch (err) {
      postMessage({ kind: "error", message: err.message });
    }
    return;
  }

  if (msg.kind !== "run") return;

  const t0 = performance.now();
  const {
    height, mask, H, W, dx, dy,
    seedR, seedC,
    goalR, goalC,                                        // optional, may be -1 / -1
    mode,                                                 // "from" | "to" | "round"
    cost,                                                 // v2 cost bundle (see v2Edge)
    wantPasses = false,                                  // route-density toggle
    wantTopN = false,                                    // top-N routes toggle
    nRoutes = 1,                                         // number of top-N iterations
    penalty = 2.0,                                       // strength of repulsion
    repulsionMode = "per-cell",                          // "per-cell" | "linear" | "square"
    eMax = 0,                                            // energy budget (0 = none)
    eMaxMode = "leg",                                    // round mode only: "leg" caps each
                                                         // direction at eMax (totals reach
                                                         // 2·eMax); "total" caps the sum —
                                                         // legs still search up to eMax each
                                                         // (a leg can never exceed the total),
                                                         // then over-budget sums are masked
                                                         // to Infinity. Ignored outside round
                                                         // (one leg IS the total there).
    wantDensity = false,                                  // multi-ref passes density
    refPoints = null,                                     // [[r0,c0],[r1,c1], …]
    densityMode = "from",                                 // mode for each ref's Dijkstra
    densityPartial = false,                               // return un-normalised partial sums (worker pool)
    networkMask = null,                                   // optional binary mask over the DEM grid
    wantNetworkInterp = false,                            // fill non-network cells via IDW from network seeds
    interpMaxDistance = 50,                               // ray search cap, in cells
    interpSmoothing = 0,                                  // number of 3×3 smoothing passes
    maximize = false,                                     // reverse the optimisation: prefer expensive edges
    maximizeLength = 0,                                   // >0 → layered-DP max-cost path of exactly L edges
    wantMatrix = false,                                   // density only: pairwise ref↔ref energy matrix
    matrixCells = null,                                   // Int32Array of ALL K refs' flat cells (−1 = off-grid)
    nDirs = 8,                                            // move directions: 4 | 8 | 16 | 32 | 64 | 128
    stringPull = false,                                   // post-hoc shortcutting of the displayed route(s)
  } = msg;

  const wantPath = goalR >= 0 && goalC >= 0;
  // Move set (docs/grid-connectivity-sensitivity-2026-07-11.md). Maximize
  // forces the classic 8: the inversion bound (maxEdgeCost) is a
  // single-grid-edge property, so a long move would invert to a clamped-0
  // free shortcut — the same degeneracy that excludes portals there. The
  // A* top-N / layered-DP paths always use the classic 8 regardless
  // (admissible-heuristic scope); stringPull below smooths them post hoc.
  const nDirsEff = (maximize || ![4, 8, 16, 32, 64, 128].includes(nDirs | 0)) ? 8 : (nDirs | 0);
  // Defense in depth: app.js already zeroes eMax before sending under
  // maximize (v49 fix for a prior finding — an unconverted kJ budget
  // pruned nearly everything on the inverted cost, silently emptying the
  // field), but the engine itself must not rely on the sender doing that
  // (a stale SW-cached app.js, or an external /density-style caller).
  // Every eMax use below in this handler goes through eMaxEff instead.
  const eMaxEff = maximize ? 0 : eMax;
  // Round-trip total budget (see eMaxMode above). The per-leg Dijkstras
  // still run with eMaxEff — a leg can never exceed the total — and the
  // combine loops below mask sums beyond this cap to Infinity.
  const eMaxTotalCap = (eMaxMode === "total" && eMaxEff > 0) ? eMaxEff : 0;
  const goalIdx = wantPath ? goalR * W + goalC : -1;
  const N = H * W;

  // For maximize mode we replace each edge cost with (MAX_EDGE_COST − cost)
  // before running Dijkstra. The output is still non-negative (Dijkstra
  // works) and minimising the inverted sum is approximately maximising
  // the original sum — biased toward shorter paths in the inverted space,
  // which here means paths with the highest per-edge original cost. We
  // bound MAX_EDGE_COST upfront from the global height range and the
  // diagonal step so the inversion is safe for every neighbour pair.
  let maxEdgeCost = 0;
  if (maximize) {
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < N; i++) {
      if (mask[i]) {
        const h = height[i];
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    const dh = Number.isFinite(minH) && Number.isFinite(maxH) ? (maxH - minH) : 0;
    const diag = Math.hypot(dx, dy);
    // 1.001 buffer so even the absolute worst-case original edge cost
    // can't push the inverted value to zero (which would make the cell
    // free and degenerate the search). Worst per-edge cost = rolling + flat
    // aero over the diagonal + the full climb term.
    maxEdgeCost = ((cost.aRoll + cost.aAero) * diag + cost.beta * Math.max(dh, 1e-6)) * 1.001;
  }

  // When a network mask is supplied, Dijkstra runs on the AND of the DEM
  // mask and the network mask. We keep `mask` (the full DEM mask) around
  // so the post-compute interpolation step can fill non-network cells.
  let effMask = mask;
  if (networkMask) {
    effMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) effMask[i] = (mask[i] && networkMask[i]) ? 1 : 0;
  }

  // Bridge portal edges (hybrid raster + sparse graph overlay). Cost uses the
  // same asymmetric model + the effective mask, so it composes with the network
  // constraint. Shared across all refs/legs. Top-N (A*) and the max-cost DP
  // path don't use portals yet (A*'s admissible heuristic would break).
  // Portals are EXCLUDED from maximize mode: maxEdgeCost bounds only a single
  // grid edge, so a long deck cost would invert to a clamped-0 "free" max-cost
  // shortcut (degenerate). Mirror the backend (handle_density) and the A*/DP
  // exclusion. Bridges + "maximize energy" isn't a meaningful combination anyway.
  const portalAdj = maximize ? null : buildPortalAdj(msg.portalU, msg.portalV, msg.portalLenM, msg.portalHU, msg.portalHV, height, effMask, cost);

  const moves = buildMoves(nDirsEff, W, dx, dy);

  let energy;
  let passes = null;
  let matrixOut = null;     // density accessibility matrix (non-partial path)
  let path = null;          // single best path (top-N supersedes this with `routes`)
  let pathEnergy = null;
  let pathLengthCells = null;
  let routes = null;        // top-N output: [{ path, energy, length, shared }, ...]

  // Helper: Euclidean length in metres of a flat-index path under (dx, dy).
  function pathLength(p) {
    let len = 0;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      const ar = (a / W) | 0, ac = a - ar * W;
      const br = (b / W) | 0, bc = b - br * W;
      len += Math.hypot((br - ar) * dy, (bc - ac) * dx);
    }
    return len;
  }

  try {
    if (wantDensity && Array.isArray(refPoints) && refPoints.length > 0) {
      // Density path. Mutually exclusive with the regular from/to/round
      // branches — running one of those before this would double-count the
      // first ref and add a bogus extra cycle to the progress bar.
      //
      // For each reference point, run a Dijkstra (with passes), normalise
      // by H*W, sum across references, normalise by H*W again. The energy
      // layer is the per-cell mean of all refs' energy fields (counting
      // only refs from which the cell is reachable). Cells unreachable
      // from every ref stay Infinity (rendered transparent).
      const dmode = densityMode || "from";
      // Optimised engine: one reused scratch set, targeted reset/accumulate
      // over explored cells only (see densityField). The `density` it
      // returns already carries the first /N (matching the old per-ref
      // path); the second /N + avgE happen below.
      const { density, energySum, energyCount, matrix } = densityField({
        height, mask: effMask, H, W,
        refPoints, dmode,
        cost, dx, dy,
        eMax: eMaxEff, maximize, maxEdgeCost, eMaxTotalCap,
        portalAdj,
        // Accessibility matrix: never under maximize (inverted costs would
        // yield meaningless "energies"); the probe path (kind: "probe")
        // never reaches this branch, so refCells stays probe-clean.
        refCells: (wantMatrix && !maximize && matrixCells) ? matrixCells : null,
        moves,
        onProgress: (frac) => postMessage({ kind: "progress", progress: frac }),
      });

      // Worker-pool mode: hand back the raw accumulators (density before
      // the second /N, energy as sum + reach-count) so the main thread can
      // merge several workers' slices before normalising. Buffers are
      // transferred — this worker is done with them.
      if (densityPartial) {
        const t1 = performance.now();
        const transfer = [density.buffer, energySum.buffer, energyCount.buffer];
        if (matrix) transfer.push(matrix.buffer);
        postMessage(
          {
            kind: "done",
            partial: true,
            density, energySum, energyCount,
            matrix: matrix || null,
            elapsedMs: t1 - t0,
          },
          transfer,
        );
        return;
      }

      // Second density normalisation.
      for (let i = 0; i < N; i++) density[i] /= N;

      // Average energy: sum / count, Infinity where no ref reached.
      const avgE = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        avgE[i] = energyCount[i] > 0 ? energySum[i] / energyCount[i] : Infinity;
      }

      passes = density;
      energy = avgE;
      matrixOut = matrix || null;
    } else if (mode === "from") {
      const r = dijkstra({
        height, mask: effMask, H, W,
        seedR, seedC,
        cost, dx, dy,
        reverse: false, trackParents: wantPath,
        wantPasses, eMax: eMaxEff,
        maximize, maxEdgeCost, portalAdj, moves,
      });
      energy = r.E;
      passes = r.passes;
      if (wantPath && Number.isFinite(energy[goalIdx])) {
        path = reconstructPath(r.parents, goalIdx);
        pathEnergy = energy[goalIdx];
      }
    } else if (mode === "to") {
      const r = dijkstra({
        height, mask: effMask, H, W,
        seedR, seedC,
        cost, dx, dy,
        reverse: true, trackParents: wantPath,
        wantPasses, eMax: eMaxEff,
        maximize, maxEdgeCost, portalAdj, moves,
      });
      energy = r.E;
      passes = r.passes;
      if (wantPath && Number.isFinite(energy[goalIdx])) {
        path = reconstructPath(r.parents, goalIdx);
        pathEnergy = energy[goalIdx];
      }
    } else {
      // round trip: forward + reverse, sum. Passes are computed AFTER the
      // combine (wantTree defers the subtree walk) so that only displayed
      // destinations — both legs reachable AND within the budget semantics
      // — count as trajectory endpoints.
      const f = dijkstra({
        height, mask: effMask, H, W,
        seedR, seedC,
        cost, dx, dy,
        reverse: false, trackParents: wantPath,
        wantTree: wantPasses, eMax: eMaxEff,
        maximize, maxEdgeCost, portalAdj, moves,
      });
      const b = dijkstra({
        height, mask: effMask, H, W,
        seedR, seedC,
        cost, dx, dy,
        reverse: true, trackParents: false,
        wantTree: wantPasses, eMax: eMaxEff,
        maximize, maxEdgeCost, portalAdj, moves,
      });
      energy = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = f.E[i];
        const c = b.E[i];
        const s = a + c;
        // Total-budget mode masks over-budget round trips.
        energy[i] = (a === Infinity || c === Infinity || (eMaxTotalCap > 0 && s > eMaxTotalCap))
          ? Infinity : s;
      }
      if (wantPasses) {
        const include = new Uint8Array(N);
        for (let i = 0; i < N; i++) include[i] = Number.isFinite(energy[i]) ? 1 : 0;
        passes = subtreePasses(f.parents, f.order, f.orderLen, N, include);
        stampLongPasses(passes, f.parents, f.parentLong, f.order, f.orderLen, moves.sweepByDelta, f.settled);
        const pb = subtreePasses(b.parents, b.order, b.orderLen, N, include);
        stampLongPasses(pb, b.parents, b.parentLong, b.order, b.orderLen, moves.sweepByDelta, b.settled);
        for (let i = 0; i < N; i++) passes[i] += pb[i];
      }
      // For round trip, the "path" is ambiguous (outbound vs return differ).
      // Report the outbound path here for visualisation.
      if (wantPath && Number.isFinite(energy[goalIdx])) {
        path = reconstructPath(f.parents, goalIdx);
        pathEnergy = energy[goalIdx];
      }
    }

    // Top-N: iterative penalization on top of the energy field. We keep the
    // already-computed energy/passes; each iteration runs A* with the running
    // usedCount so subsequent paths deviate.
    if (wantTopN && wantPath) {
      routes = [];
      const usedCount = new Int32Array(N);
      // For linear/square modes we need a binary "has-been-used" mask for the
      // distance transform. For per-cell mode, distUsed is unused.
      const usedMask =
        (repulsionMode === "linear" || repulsionMode === "square")
          ? new Uint8Array(N)
          : null;
      let distUsed = null;
      const k = Math.max(1, Math.min(20, nRoutes | 0));
      // per-cell mode raises `penalty` to an integer power (Math.pow(penalty,
      // used)); a sub-1 value would SHRINK the edge cost below its base value,
      // producing negative A* edge weights (breaks settled-cell finality).
      // linear/square modes add penalty/denom * distCost, which stays >= 0
      // for any penalty > 0 — those keep the permissive clamp.
      const pen = repulsionMode === "per-cell"
        ? (penalty > 1 ? penalty : 1)
        : (penalty > 0 ? penalty : 1.0);
      for (let r = 0; r < k; r++) {
        // Recompute the distance transform if any cells have been used so
        // far. On the first iteration nothing's been used → distUsed is
        // null, the penalty term in astar() is silently zero.
        if (usedMask && r > 0) {
          distUsed = chamferDistanceTransform(usedMask, H, W);
        }
        const res = astar({
          height, mask: effMask, H, W,
          startR: seedR, startC: seedC,
          goalR, goalC,
          cost, dx, dy,
          penalty: pen, usedCount,
          repulsionMode, distUsed,
          eMax: eMaxEff,
          maximize, maxEdgeCost,
          // Mode "to" fields/paths measure travel dst→seed (dijkstra
          // reverse:true) — score the routes in that same direction. Round
          // stays forward-only (outbound leg); app.js discloses that.
          reverse: mode === "to",
        });
        if (!res.path) break;
        let shared = 0;
        for (let j = 0; j < res.path.length; j++) {
          if (usedCount[res.path[j]] > 0) shared++;
        }
        // res.energy is astar()'s SEARCH cost — it includes the repulsion
        // penalty layered on top of the base edge cost (routes 2..N only;
        // route #1 has usedCount all-zero so its search cost already equals
        // its true energy). That penalty exists to steer the search away
        // from prior routes; it isn't energy a rider spends. Recompute the
        // un-penalised (true) energy by re-summing v2Edge over the path's
        // consecutive cells, in the same travel direction astar scored it
        // in (reverse: mode === "to"). Skip this in maximize mode — there
        // res.energy is the inverted-cost search total, not a v2Edge sum,
        // and the field/route the user sees is meant to reflect that.
        let trueE = res.energy;
        if (!maximize) {
          trueE = 0;
          for (let j = 1; j < res.path.length; j++) {
            const a = res.path[j - 1], b = res.path[j];
            const ar = (a / W) | 0, ac = a - ar * W;
            const br = (b / W) | 0, bc = b - br * W;
            const d = Math.hypot((br - ar) * dy, (bc - ac) * dx);
            const dh = (mode === "to") ? (height[a] - height[b]) : (height[b] - height[a]);
            trueE += v2Edge(d, dh, cost);
          }
        }
        routes.push({
          path: res.path,
          energy: trueE,
          length: res.length,
          shared,
        });
        for (let j = 0; j < res.path.length; j++) {
          usedCount[res.path[j]] += 1;
          if (usedMask) usedMask[res.path[j]] = 1;
        }
        // Coarse progress per iteration
        postMessage({ kind: "progress", progress: (r + 1) / k });
      }
    }

    // String pulling (optional): shorten the displayed route(s) post hoc.
    // Round is excluded (its "path" is the outbound leg but its energy is
    // the round-trip total — pulling one leg would desynchronise them);
    // maximize is excluded (an inverted-cost path is not a v2Edge sum). A
    // network-constrained run self-limits: segments leaving the network are
    // mask-blocked, so pulling only straightens within corridors.
    let stringPulled = false;
    if (stringPull && !maximize && mode !== "round") {
      const flip = mode === "to";
      if (path && path.length > 2 && pathEnergy != null) {
        const pulled = stringPullPath(height, effMask, H, W, dx, dy, cost, path, flip);
        if (pulled && pulled.energy < pathEnergy) {
          path = pulled.path; pathEnergy = pulled.energy; stringPulled = true;
        }
      }
      if (routes) {
        for (const rt of routes) {
          if (!rt.path || rt.path.length <= 2) continue;
          const pulled = stringPullPath(height, effMask, H, W, dx, dy, cost, rt.path, flip);
          if (pulled && pulled.energy < rt.energy) {
            rt.path = pulled.path; rt.energy = pulled.energy; rt.length = pathLength(pulled.path);
            stringPulled = true;
          }
        }
      }
    }

    // Path length for the single non-top-N output
    if (path) pathLengthCells = pathLength(path);

    // Length-constrained max-cost path (layered DP). Overrides the path
    // + energy field produced by the inverted Dijkstra above. We still
    // ran that first so the user sees *something* if the DP refuses
    // (out-of-memory cap, no L-edge path to the goal, …); the dispatch
    // here clobbers those only on success. The routes array from top-N
    // is also dropped — "L-constrained top-N" isn't a thing in this
    // implementation, the path you get is the single optimum.
    if (maximize && maximizeLength > 0 && wantPath) {
      const dp = maxCostPathOfLength({
        height, mask: effMask, H, W,
        startR: seedR, startC: seedC,
        goalR, goalC,
        cost, dx, dy,
        L: maximizeLength,
        // Mode "to" measures travel dst→seed everywhere else (field,
        // single path, top-N astar) — mirror that here so the DP path
        // isn't scored in the opposite direction from what it overlays.
        // Round stays forward-only (outbound leg), same as top-N.
        reverse: mode === "to",
      });
      // Always log the DP outcome to the console so it's clear whether the
      // length constraint actually kicked in.
      console.info(
        "[maximize/dp]",
        dp.error
          ? `failed: ${dp.error}`
          : `L=${maximizeLength}, energy=${dp.energy.toFixed(2)}, length=${dp.length.toFixed(0)} m`,
      );
      if (dp.error) {
        // Surface the failure to the UI; main thread routes 'warning'
        // through the status bar. Keep the inverted-Dijkstra outputs
        // so the user still sees the field.
        // Structured (key + args) so app.js can route it through the
        // STRINGS/t() i18n table instead of displaying this English
        // sentence verbatim; `message` stays as a plain-English fallback
        // for non-i18n consumers (node harnesses, older cached app.js).
        postMessage({
          kind: "warning",
          key: "warn.dp_skipped",
          args: [String(dp.error)],
          message: `Length-constrained DP did not run (${dp.error}). ` +
                   `Showing the inverted-Dijkstra path instead — try a larger L ` +
                   `(at minimum ~Chebyshev distance between src and dst).`,
        });
      } else if (dp.path) {
        path = dp.path;
        pathEnergy = dp.energy;
        pathLengthCells = dp.length;
        if (dp.energyField) energy = dp.energyField;
        routes = null; // top-N is meaningless under a length constraint
      }
    }

    // Optional: GDAL-style IDW fill of non-network cells. 8-ray search to
    // network seeds capped at interpMaxDistance, 1/d² weighting, then up
    // to interpSmoothing 3×3 box passes (network cells preserved).
    // Visualisation only — the analysis output stays constrained.
    if (wantNetworkInterp && networkMask && energy) {
      energy = fillAcrossNetwork(
        energy, networkMask, mask, H, W, dx, dy,
        interpMaxDistance, interpSmoothing,
      );
    }

    const t1 = performance.now();
    const out = {
      kind: "done",
      energy,
      passes,
      path,                  // null or array of flat indices
      pathEnergy,            // null or number
      pathLengthM: pathLengthCells,
      routes,                // null or array of route objects
      elapsedMs: t1 - t0,
    };
    if (matrixOut) out.matrix = matrixOut;
    if (stringPulled) out.stringPulled = true;
    const transfer = [energy.buffer];
    if (passes) transfer.push(passes.buffer);
    if (matrixOut) transfer.push(matrixOut.buffer);
    postMessage(out, transfer);
  } catch (err) {
    postMessage({ kind: "error", message: err.message });
  }
};
