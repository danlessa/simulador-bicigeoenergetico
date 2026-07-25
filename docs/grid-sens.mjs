// Grid-connectivity sensitivity analysis: how much does the 8-connected move
// grid OVERESTIMATE optimal energy vs richer neighborhoods (16 = +knight
// moves, 32 = +max-3 coprime moves) on a real DEM?
//
// Mirrors (hand-copied, same rule as the repo's other mirror tests):
//   - v2Edge            ← energy-worker.js (via test-worker-pool.mjs mirror)
//   - deriveCost        ← census/census-density.mjs (readCost fold, app defaults)
//   - smoothHeightsInPlace ← test-dem-smoothing.mjs (v55 app-side pre-smoothing)
// The 8-neighbor field is validated against the REAL energy-worker.js run in
// a sandbox before any comparison — if that check fails, nothing else counts.
//
// Usage: node docs/grid-sens.mjs [--dem path] [--crop r0,c0,h,w] [--sources n]
//                                [--decimate k] [--flat]
// Needs census/node_modules (npm install in census/ — geotiff) and the DEM:
//   curl -O https://simujaules.pedalhidrografi.co/dem/sampa_centro.tif
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(new URL("../census/noop.js", import.meta.url));
const GeoTIFF = require("geotiff");

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]] : null).filter(Boolean),
);
const DEM_PATH = args.dem || "sampa_centro.tif"; // curl -O https://simujaules.pedalhidrografi.co/dem/sampa_centro.tif
const N_SOURCES = parseInt(args.sources || "6", 10);
const FLAT = args.flat === "1" && "flat" in args;

// ---- v2Edge mirror (energy-worker.js) --------------------------------------
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

// ---- deriveCost mirror (census/census-density.mjs ← app.js readCost) -------
// G_SP — Sao Paulo's local gravity (IAG-USP absolute gravimetry), NOT the
// textbook 9.81: mirrors app.js's G_SP, re-baselined in v63 (long note there).
// The Entry 23/25/26 numbers in the research notes were produced at 9.81, so a
// re-run now reads ~0.24% lower in absolute energy; the ratios they conclude on
// are gravity-insensitive. Kept in step with the app deliberately: a mirror at a
// different gravity would no longer describe what the app computes.
const G_SP = 9.7864;
function flatEqSpeed(P, m, crr, cda, rho, keff) {
  const a = crr * m * G_SP, b = 0.5 * rho * cda;
  let lo = 0, hi = 40;
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2;
    if ((a + b * v * v) * v < keff * P) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}
function deriveCost() {
  const m = 75, crr = 0.008, cda = 0.45, rho = 1.1, keff = 0.97, pFlat = 80;
  const vf = flatEqSpeed(pFlat, m, crr, cda, rho, keff);
  const g = G_SP, mg = m * g, KJ = 1000;   // local SP gravity — see G_SP above
  const aeroCoef = 0.5 * rho * cda * vf * vf;
  return {
    aRoll: mg * crr / keff / KJ,
    aAero: aeroCoef / keff / KJ,
    beta: mg * 1 / keff / KJ,
    climbThr: 0.02,
    abRatio: crr + aeroCoef / mg,
    epsOffset: 0.13,
  };
}

// ---- smoothHeightsInPlace mirror (test-dem-smoothing.mjs / app.js v55) -----
function smoothHeightsInPlace(height, mask, H, W, dxM, dyM, sigmaM) {
  const axes = [
    { pix: dxM, stride: 1, lines: H, len: W, lineStride: W },
    { pix: dyM, stride: W, lines: W, len: H, lineStride: 1 },
  ];
  const maxLen = Math.max(W, H);
  const src = new Float64Array(maxLen);
  const val = new Float64Array(maxLen);
  const wgt = new Float64Array(maxLen);
  for (const { pix, stride, lines, len, lineStride } of axes) {
    const sigmaPx = sigmaM / pix;
    if (!(sigmaPx > 0.3)) continue;
    const R = Math.max(1, Math.round(3 * sigmaPx));
    const kern = new Float64Array(2 * R + 1);
    for (let k = -R; k <= R; k++) kern[k + R] = Math.exp(-(k * k) / (2 * sigmaPx * sigmaPx));
    for (let ln = 0; ln < lines; ln++) {
      const base = ln * lineStride;
      for (let i = 0; i < len; i++) src[i] = height[base + i * stride];
      val.fill(0, 0, len); wgt.fill(0, 0, len);
      for (let i = 0; i < len; i++) {
        if (!mask[base + i * stride]) continue;
        const lo = Math.max(0, i - R), hi = Math.min(len - 1, i + R);
        for (let j = lo; j <= hi; j++) {
          if (!mask[base + j * stride]) continue;
          const w = kern[j - i + R];
          val[i] += w * src[j];
          wgt[i] += w;
        }
      }
      for (let i = 0; i < len; i++) {
        if (mask[base + i * stride] && wgt[i] > 0) height[base + i * stride] = val[i] / wgt[i];
      }
    }
  }
}

// ---- neighborhoods ----------------------------------------------------------
// Square-grid move sets by Farey / Stern–Brocot level: level 0 = the 8-move
// set ((1,0) + (1,1) per octant); each level inserts the mediant between
// adjacent heading vectors → 16, 32, 64, 128 moves. (Levels 0–2 coincide
// with the max-norm≤R coprime sets; 64/128 are the Farey continuations.)
function sqOffsets(level) {
  let oct = [[1, 0], [1, 1]];
  for (let l = 0; l < level; l++) {
    const next = [];
    for (let i = 0; i < oct.length - 1; i++) {
      next.push(oct[i], [oct[i][0] + oct[i + 1][0], oct[i][1] + oct[i + 1][1]]);
    }
    next.push(oct[oct.length - 1]);
    oct = next;
  }
  const set = new Map();
  for (const [a, b] of oct)
    for (const [dr, dc] of [[a, b], [b, a]])
      for (const sr of [1, -1])
        for (const sc of [1, -1])
          set.set(`${dr * sr || 0},${dc * sc || 0}`, [dr * sr || 0, dc * sc || 0]);
  return [...set.values()];
}
const SQ4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // von Neumann (degenerate baseline)

// ---- generic Dijkstra (mirrors the worker's relax rules: f32 E storage,
// f64 heap keys, settled-byte staleness filter, settled neighbors never
// relaxed). Long moves additionally require the swept cells passable
// (supercover sampling) so a knight move can't tunnel through nodata.
//
// edgeMode for moves longer than one cell:
//   "endpoint" — cost from the endpoints' Δh only (the naive generalization;
//                long edges SKIP intermediate relief, so on bumpy terrain
//                they under-count real climb — a discretization change, not
//                a jaggedness fix);
//   "profile"  — cost integrated along the segment (bilinear height samples
//                every ~1 cell, v2Edge summed per sub-segment): same terrain
//                sampling as the unit grid, richer HEADINGS only. This is
//                the apples-to-apples jaggedness measurement.
// 8-neighbor moves always use the single-step cost (exactly the app).  -----
function dijkstraK(height, mask, H, W, dxM, dyM, cost, seedR, seedC, offs, edgeMode = "profile") {
  const N = H * W;
  const E = new Float32Array(N).fill(Infinity);
  const settled = new Uint8Array(N);
  // pre-derive per-offset distance + swept-cell templates
  const K = offs.length;
  const dIdx = new Int32Array(K);
  const dist = new Float64Array(K);
  const sweep = [];
  for (let k = 0; k < K; k++) {
    const [dr, dc] = offs[k];
    dIdx[k] = dr * W + dc;
    dist[k] = Math.hypot(dr * dyM, dc * dxM);
    const n = 2 * Math.max(Math.abs(dr), Math.abs(dc));
    const cells = [];
    for (let i = 1; i < n; i++) {
      const rr = Math.round(dr * i / n), cc = Math.round(dc * i / n);
      if ((rr || cc) && !(rr === dr && cc === dc)) cells.push(rr * W + cc);
    }
    sweep.push(Int32Array.from([...new Set(cells)]));
  }
  const maxR = Math.max(...offs.map(([dr]) => Math.abs(dr)));
  // binary heap
  let heapP = new Float64Array(1 << 16), heapV = new Int32Array(1 << 16), hn = 0;
  const push = (p, v) => {
    if (hn === heapP.length) {
      const p2 = new Float64Array(hn * 2); p2.set(heapP); heapP = p2;
      const v2 = new Int32Array(hn * 2); v2.set(heapV); heapV = v2;
    }
    let i = hn++;
    heapP[i] = p; heapV[i] = v;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (heapP[par] <= heapP[i]) break;
      const tp = heapP[par], tv = heapV[par];
      heapP[par] = heapP[i]; heapV[par] = heapV[i];
      heapP[i] = tp; heapV[i] = tv;
      i = par;
    }
  };
  const pop = () => {
    const p = heapP[0], v = heapV[0];
    hn--;
    heapP[0] = heapP[hn]; heapV[0] = heapV[hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < hn && heapP[l] < heapP[m]) m = l;
      if (r < hn && heapP[r] < heapP[m]) m = r;
      if (m === i) break;
      const tp = heapP[m], tv = heapV[m];
      heapP[m] = heapP[i]; heapV[m] = heapV[i];
      heapP[i] = tp; heapV[i] = tv;
      i = m;
    }
    return [p, v];
  };
  const seed = seedR * W + seedC;
  E[seed] = 0; push(0, seed);
  while (hn > 0) {
    const [g, idx] = pop();
    if (settled[idx]) continue;
    settled[idx] = 1;
    const r = (idx / W) | 0, c = idx - r * W, hHere = height[idx];
    const inner = r >= maxR && r < H - maxR && c >= maxR && c < W - maxR;
    for (let k = 0; k < K; k++) {
      let nIdx;
      if (inner) nIdx = idx + dIdx[k];
      else {
        const nr = r + offs[k][0], nc = c + offs[k][1];
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        nIdx = nr * W + nc;
      }
      if (!mask[nIdx] || settled[nIdx]) continue;
      const sw = sweep[k];
      let blocked = false;
      for (let s = 0; s < sw.length; s++) if (!mask[idx + sw[s]]) { blocked = true; break; }
      if (blocked) continue;
      let edge;
      const [dr, dc] = offs[k];
      const isLong = Math.abs(dr) > 1 || Math.abs(dc) > 1;
      if (!isLong || edgeMode === "endpoint") {
        edge = v2Edge(dist[k], height[nIdx] - hHere, cost);
      } else {
        // profile-integrated: bilinear height samples every ~1 cell
        const n = 2 * Math.max(Math.abs(dr), Math.abs(dc));
        const sub = dist[k] / n;
        edge = 0;
        let hPrev = hHere;
        for (let s = 1; s <= n; s++) {
          let hs;
          if (s === n) hs = height[nIdx];
          else {
            const fr = r + dr * s / n, fc = c + dc * s / n;
            const r1 = Math.min(H - 2, Math.max(0, Math.floor(fr)));
            const c1 = Math.min(W - 2, Math.max(0, Math.floor(fc)));
            const tr = fr - r1, tc = fc - c1;
            const b0 = r1 * W + c1;
            hs = height[b0] * (1 - tr) * (1 - tc) + height[b0 + 1] * (1 - tr) * tc +
                 height[b0 + W] * tr * (1 - tc) + height[b0 + W + 1] * tr * tc;
          }
          edge += v2Edge(sub, hs - hPrev, cost);
          hPrev = hs;
        }
      }
      const t = g + edge;
      if (t < E[nIdx]) { E[nIdx] = t; push(t, nIdx); }
    }
  }
  return E;
}

// ---- hexagonal-lattice Dijkstra over the same terrain ------------------------
// Axial coords: node (q,r) at x = a(q + r/2), y = a(√3/2)r, spacing a = the
// raster's min pixel. Heights are bilinear resamples of the SAME (smoothed)
// raster. N6 = the six unit-distance moves (60° headings); with `twelve`,
// also the six √3-distance "hex-diagonal" moves (30°-offset headings),
// profile-integrated in 2 sub-steps like the square long moves.
function hexDijkstra(height, mask, H, W, dxM, dyM, cost, seedR, seedC, twelve) {
  const a = Math.min(dxM, dyM);
  const Wm = (W - 1) * dxM, Hm = (H - 1) * dyM;
  const rowH = a * Math.sqrt(3) / 2;
  const Nr = Math.floor(Hm / rowH) + 1;
  const C = Math.floor(Wm / a);
  const qb = (r) => Math.ceil(-r / 2);
  const NN = Nr * C;
  const hgt = new Float64Array(NN);
  const xs = new Float64Array(NN), ys = new Float64Array(NN);
  const okN = new Uint8Array(NN);
  const cellOf = new Int32Array(NN).fill(-1);
  const bilin = (fr, fc) => {
    const r1 = Math.max(0, Math.min(H - 2, Math.floor(fr)));
    const c1 = Math.max(0, Math.min(W - 2, Math.floor(fc)));
    const tr = fr - r1, tc = fc - c1, b0 = r1 * W + c1;
    return height[b0] * (1 - tr) * (1 - tc) + height[b0 + 1] * (1 - tr) * tc +
           height[b0 + W] * tr * (1 - tc) + height[b0 + W + 1] * tr * tc;
  };
  for (let r = 0; r < Nr; r++) {
    const y = r * rowH;
    for (let j = 0; j < C; j++) {
      const q = qb(r) + j;
      const x = a * (q + r / 2);
      if (x < 0 || x > Wm) continue;
      const i = r * C + j;
      const cr = Math.round(y / dyM), cc = Math.round(x / dxM);
      if (cr < 0 || cr >= H || cc < 0 || cc >= W || !mask[cr * W + cc]) continue;
      okN[i] = 1;
      xs[i] = x; ys[i] = y;
      hgt[i] = bilin(y / dyM, x / dxM);
      cellOf[i] = cr * W + cc;
    }
  }
  const D6 = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];    // dist a
  const D12 = [[1, 1], [-1, 2], [-2, 1], [-1, -1], [1, -2], [2, -1]]; // dist √3·a
  const E = new Float32Array(NN).fill(Infinity);
  const settled = new Uint8Array(NN);
  let heapP = new Float64Array(1 << 16), heapV = new Int32Array(1 << 16), hn = 0;
  const push = (p, v) => {
    if (hn === heapP.length) {
      const p2 = new Float64Array(hn * 2); p2.set(heapP); heapP = p2;
      const v2 = new Int32Array(hn * 2); v2.set(heapV); heapV = v2;
    }
    let i = hn++;
    heapP[i] = p; heapV[i] = v;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (heapP[par] <= heapP[i]) break;
      const tp = heapP[par], tv = heapV[par];
      heapP[par] = heapP[i]; heapV[par] = heapV[i];
      heapP[i] = tp; heapV[i] = tv;
      i = par;
    }
  };
  const pop = () => {
    const p = heapP[0], v = heapV[0];
    hn--;
    heapP[0] = heapP[hn]; heapV[0] = heapV[hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < hn && heapP[l] < heapP[m]) m = l;
      if (r < hn && heapP[r] < heapP[m]) m = r;
      if (m === i) break;
      const tp = heapP[m], tv = heapV[m];
      heapP[m] = heapP[i]; heapV[m] = heapV[i];
      heapP[i] = tp; heapV[i] = tv;
      i = m;
    }
    return [p, v];
  };
  // seed: nearest ok node to the source cell (exact scan — once per run)
  const sx = seedC * dxM, sy = seedR * dyM;
  let seed = -1, best = Infinity;
  for (let i = 0; i < NN; i++) {
    if (!okN[i]) continue;
    const d = (xs[i] - sx) ** 2 + (ys[i] - sy) ** 2;
    if (d < best) { best = d; seed = i; }
  }
  E[seed] = 0; push(0, seed);
  const neigh = twelve ? [...D6.map((d) => [d, 1]), ...D12.map((d) => [d, 2])] : D6.map((d) => [d, 1]);
  while (hn > 0) {
    const [g, idx] = pop();
    if (settled[idx]) continue;
    settled[idx] = 1;
    const r = (idx / C) | 0, j = idx - r * C, q = qb(r) + j;
    for (const [[dq, dr], sub] of neigh) {
      const r2 = r + dr, q2 = q + dq;
      if (r2 < 0 || r2 >= Nr) continue;
      const j2 = q2 - qb(r2);
      if (j2 < 0 || j2 >= C) continue;
      const i2 = r2 * C + j2;
      if (!okN[i2] || settled[i2]) continue;
      const d = sub === 1 ? a : a * Math.sqrt(3);
      let edge;
      if (sub === 1) edge = v2Edge(d, hgt[i2] - hgt[idx], cost);
      else {
        const hm = bilin((ys[idx] + ys[i2]) / 2 / dyM, (xs[idx] + xs[i2]) / 2 / dxM);
        edge = v2Edge(d / 2, hm - hgt[idx], cost) + v2Edge(d / 2, hgt[i2] - hm, cost);
      }
      const t = g + edge;
      if (t < E[i2]) { E[i2] = t; push(t, i2); }
    }
  }
  return { E, cellOf, okN, xs, ys, NN, nodeArea: (Math.sqrt(3) / 2) * a * a };
}

// ---- real-worker reference (8-neighbor validation) --------------------------
function loadWorker() {
  const src = readFileSync(new URL("../energy-worker.js", import.meta.url), "utf8");
  const messages = [];
  const sandbox = { postMessage: (m) => messages.push(m), self: {}, performance, console };
  new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
  return (msg) => {
    messages.length = 0;
    sandbox.self.onmessage({ data: msg });
    const err = messages.find((m) => m.kind === "error");
    if (err) throw new Error(err.message);
    return messages.find((m) => m.kind === "done");
  };
}

// ---- stats helpers ----------------------------------------------------------
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
function pctStats(vals) {
  vals.sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { n: vals.length, mean, med: q(vals, 0.5), p90: q(vals, 0.9), p99: q(vals, 0.99), max: vals[vals.length - 1] };
}
const fmt = (s) => `n=${s.n}  mean=${(100 * s.mean).toFixed(2)}%  med=${(100 * s.med).toFixed(2)}%  p90=${(100 * s.p90).toFixed(2)}%  p99=${(100 * s.p99).toFixed(2)}%  max=${(100 * s.max).toFixed(2)}%`;

// ---- main --------------------------------------------------------------------
const tif = await GeoTIFF.fromArrayBuffer(readFileSync(DEM_PATH).buffer);
const img = await tif.getImage();
const fullW = img.getWidth(), fullH = img.getHeight();
const [ox, oy] = img.getOrigin();
const [degX, degYneg] = img.getResolution();
const degY = Math.abs(degYneg);

// central crop (the "small DEM")
let [r0, c0, H, W] = (args.crop || "").split(",").map(Number);
if (!(H > 0)) { H = 1200; W = 1200; r0 = (fullH - H) >> 1; c0 = (fullW - W) >> 1; }
let latMid = oy - (r0 + H / 2) * degY;
let dxM = degX * 111320 * Math.cos(latMid * Math.PI / 180);
let dyM = degY * 110574;

const ras = await img.readRasters({ window: [c0, r0, c0 + W, r0 + H], interleave: true });
let height = new Float32Array(H * W);
let mask = new Uint8Array(H * W);
let nBad = 0;
for (let i = 0; i < H * W; i++) {
  const v = ras[i];
  if (Number.isFinite(v) && v > -100 && v < 9000) { height[i] = v; mask[i] = 1; }
  else { height[i] = 0; nBad++; }
}
if (FLAT) height.fill(750);
console.log(`DEM crop ${H}×${W} @ (${r0},${c0}), pixel ≈ ${dxM.toFixed(2)}×${dyM.toFixed(2)} m, nodata cells: ${nBad}${FLAT ? "  [FLAT control: heights constant]" : ""}`);

// --decimate k: emulate a coarse DEM (e.g. k=6 ≈ 30 m from the 5 m IGC) —
// anti-alias smooth at σ = k·pixel/2, then keep every k-th sample. The app
// applies NO further smoothing at 30 m (the v55 auto rule skips coarse
// sources), matching real usage of a 30 m source.
const DECIMATE = parseInt(args.decimate || "0", 10);
if (DECIMATE > 1) {
  if (!FLAT) smoothHeightsInPlace(height, mask, H, W, dxM, dyM, DECIMATE * Math.min(dxM, dyM) / 2);
  const H2 = Math.floor(H / DECIMATE), W2 = Math.floor(W / DECIMATE);
  const h2 = new Float32Array(H2 * W2), m2 = new Uint8Array(H2 * W2);
  for (let r = 0; r < H2; r++)
    for (let c = 0; c < W2; c++) {
      h2[r * W2 + c] = height[r * DECIMATE * W + c * DECIMATE];
      m2[r * W2 + c] = mask[r * DECIMATE * W + c * DECIMATE];
    }
  height = h2; mask = m2; H = H2; W = W2; dxM *= DECIMATE; dyM *= DECIMATE;
  console.log(`decimated ×${DECIMATE} → ${H}×${W}, pixel ≈ ${dxM.toFixed(2)}×${dyM.toFixed(2)} m (anti-aliased σ=${(DECIMATE * Math.min(dxM / DECIMATE, dyM / DECIMATE) / 2).toFixed(1)} m)`);
} else if (!FLAT && Math.min(dxM, dyM) <= 10) {
  // v55 app-side pre-smoothing (auto: σ = 10 m when min pixel ≤ 10 m)
  smoothHeightsInPlace(height, mask, H, W, dxM, dyM, 10);
  console.log("applied σ=10 m mask-normalized Gaussian pre-smoothing (v55 auto rule)");
}

const cost = deriveCost();
console.log(`cost bundle: aRoll=${cost.aRoll.toExponential(3)} aAero=${cost.aAero.toExponential(3)} beta=${cost.beta.toExponential(3)} (kJ/m, kJ/m-climb)`);

// sources: spread interior points, snapped to passable
const srcs = [];
const golden = 0.6180339887;
for (let k = 0; srcs.length < N_SOURCES && k < 200; k++) {
  let r = Math.floor(H * (0.2 + 0.6 * ((k * golden) % 1)));
  let c = Math.floor(W * (0.2 + 0.6 * ((k * golden * golden) % 1)));
  let ok = false;
  for (let t = 0; t < 400 && !ok; t++) { if (mask[r * W + c]) ok = true; else { r = (r + 7) % H; c = (c + 13) % W; } }
  if (ok && !srcs.some(([rr, cc]) => Math.hypot(rr - r, cc - c) < Math.min(H, W) / 8)) srcs.push([r, c]);
}
console.log(`sources: ${JSON.stringify(srcs)}`);

// ---- validation: harness 8-neighbor ≡ real worker ---------------------------
{
  const run = loadWorker();
  const [sr, sc] = srcs[0];
  const t0 = Date.now();
  const ref = run({
    kind: "run", H, W, dx: dxM, dy: dyM, cost,
    seedR: sr, seedC: sc, goalR: -1, goalC: -1, mode: "from",
    height: new Float32Array(height), mask: new Uint8Array(mask),
  });
  const mine = dijkstraK(height, mask, H, W, dxM, dyM, cost, sr, sc, sqOffsets(0));
  let maxD = 0, mismatch = 0;
  for (let i = 0; i < H * W; i++) {
    const a = ref.energy[i], b = mine[i];
    if (Number.isFinite(a) !== Number.isFinite(b)) mismatch++;
    else if (Number.isFinite(a)) maxD = Math.max(maxD, Math.abs(a - b));
  }
  console.log(`validation vs energy-worker.js (8-neighbor): max|Δ|=${maxD.toExponential(2)} kJ, finite-mismatch=${mismatch}  (${Date.now() - t0} ms)`);
  if (maxD > 1e-4 || mismatch) { console.error("VALIDATION FAILED — aborting"); process.exit(1); }
}

// ---- the sensitivity runs ----------------------------------------------------
// Mode ladder, all profile-integrated (same terrain sampling, richer headings):
//   square 4 / 8 / 16 / 32 / 64 / 128 (Farey levels) + hexagonal 6 / 12.
// sq128 is the near-continuum REFERENCE; every mode's overestimate is
// E_mode/E_ref − 1 at route-scale targets. sq16/sq32 additionally run with
// naive endpoint-Δh long edges to expose the terrain-skipping artifact.
const minDistM = 800; // route-scale targets only (near-field ratios are noisy)
const MODES = [
  { name: "sq4",        sq: SQ4 },
  { name: "hex6",       hex: false },
  { name: "sq8",        sq: sqOffsets(0) },
  { name: "hex12",      hex: true },
  { name: "sq16",       sq: sqOffsets(1) },
  { name: "sq32",       sq: sqOffsets(2) },
  { name: "sq64",       sq: sqOffsets(3) },
  { name: "sq128",      sq: sqOffsets(4), ref: true },
  { name: "sq16-naive", sq: sqOffsets(1), edgeMode: "endpoint" },
  { name: "sq32-naive", sq: sqOffsets(2), edgeMode: "endpoint" },
];
const vsRef = Object.fromEntries(MODES.filter((m) => !m.ref).map((m) => [m.name, []]));
const vs8 = { sq16: [], sq32: [] };
const byAngle = Array.from({ length: 9 }, () => []); // sq8 vs sq16, by heading
const reachArea = Object.fromEntries(MODES.map((m) => [m.name, 0])); // m² within q50(E8)

for (const [sr, sc] of srcs) {
  const t0 = Date.now();
  const fields = {};
  for (const m of MODES) {
    fields[m.name] = m.sq
      ? dijkstraK(height, mask, H, W, dxM, dyM, cost, sr, sc, m.sq, m.edgeMode || "profile")
      : hexDijkstra(height, mask, H, W, dxM, dyM, cost, sr, sc, m.hex);
  }
  console.log(`  src(${sr},${sc}): ${MODES.length} fields in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const Eref = fields.sq128;
  const E8 = fields.sq8;

  // budget for the reach comparison: median of the app's own (sq8) field
  const finE = [];
  for (let i = 0; i < H * W; i++) if (mask[i] && Number.isFinite(E8[i])) finE.push(E8[i]);
  finE.sort((x, y) => x - y);
  const b50 = q(finE, 0.5);

  for (const m of MODES) {
    const f = fields[m.name];
    if (m.sq) {
      const E = f;
      const cellArea = dxM * dyM;
      for (let i = 0; i < H * W; i++) {
        if (!mask[i]) continue;
        const e = E[i];
        if (Number.isFinite(e) && e <= b50) reachArea[m.name] += cellArea;
        if (m.ref) continue;
        const ref = Eref[i];
        if (!Number.isFinite(e) || !Number.isFinite(ref) || ref <= 0) continue;
        const r = (i / W) | 0, c = i - r * W;
        const dMet = Math.hypot((r - sr) * dyM, (c - sc) * dxM);
        if (dMet < minDistM) continue;
        vsRef[m.name].push(e / ref - 1);
        if (m.name === "sq16" || m.name === "sq32") {
          const a8 = E8[i];
          if (Number.isFinite(a8)) vs8[m.name].push(a8 / e - 1);
        }
        if (m.name === "sq16") {
          const a8 = E8[i];
          if (Number.isFinite(a8) && e > 0) {
            let ang = Math.atan2(Math.abs((r - sr) * dyM), Math.abs((c - sc) * dxM)) * 180 / Math.PI;
            if (ang > 45) ang = 90 - ang;
            byAngle[Math.min(8, Math.floor(ang / 5))].push(a8 / e - 1);
          }
        }
      }
    } else {
      // hex: evaluate at hex nodes, mapped to the nearest raster cell
      const { E, cellOf, okN, xs, ys, NN, nodeArea } = f;
      const sx = sc * dxM, sy = sr * dyM;
      for (let i = 0; i < NN; i++) {
        if (!okN[i]) continue;
        const e = E[i];
        if (Number.isFinite(e) && e <= b50) reachArea[m.name] += nodeArea;
        const ref = Eref[cellOf[i]];
        if (!Number.isFinite(e) || !Number.isFinite(ref) || ref <= 0) continue;
        if (Math.hypot(xs[i] - sx, ys[i] - sy) < minDistM) continue;
        vsRef[m.name].push(e / ref - 1);
      }
    }
  }
}

console.log(`\n== overestimate vs sq128 reference (profile edges; targets ≥ ${minDistM} m, ${srcs.length} sources) ==`);
for (const m of MODES) {
  if (m.ref || !vsRef[m.name].length) continue;
  console.log(`  ${m.name.padEnd(11)} ${fmt(pctStats(vsRef[m.name]))}`);
}
console.log(`== headline: the app's 8-grid vs 16/32 (profile) ==`);
console.log(`  E8 vs E16:  ${fmt(pctStats(vs8.sq16))}`);
console.log(`  E8 vs E32:  ${fmt(pctStats(vs8.sq32))}`);
console.log(`== E8/E16−1 (profile) by direction (° off nearest grid axis; flat theory peaks ~22.5°) ==`);
for (let b = 0; b < 9; b++) {
  if (!byAngle[b].length) continue;
  const s = pctStats(byAngle[b]);
  console.log(`  ${String(b * 5).padStart(2)}–${b * 5 + 5}°: med=${(100 * s.med).toFixed(2)}%  p90=${(100 * s.p90).toFixed(2)}%  (n=${s.n})`);
}
console.log(`== reachable AREA within the q50(E8) budget (km², summed over sources) ==`);
const base = reachArea.sq8;
for (const m of MODES) {
  if (m.edgeMode === "endpoint") continue;
  console.log(`  ${m.name.padEnd(6)} ${(reachArea[m.name] / 1e6).toFixed(2)} km²  (${m.name === "sq8" ? "baseline" : (reachArea[m.name] >= base ? "+" : "") + (100 * (reachArea[m.name] / base - 1)).toFixed(2) + "%"})`);
}
