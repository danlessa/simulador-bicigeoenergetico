// Long-edge precomputation evaluation (§9.1): store every long move's
// profile-integrated cost in per-heading tables once, then relax by table
// lookup. KEY STRUCTURAL FACT this harness tests: in a single Dijkstra each
// directed edge is integrated EXACTLY ONCE (the settled guard means each
// cell's out-edges are scanned once), so precomputation cannot reduce work
// for a single search — the win can only be AMORTIZED across a density pool
// (K refs share the grid: one precompute, K lookup-only searches). Measured
// here: exactness vs on-demand integration, single-search timing (predicted
// ~no gain), and density-style amortized timing (predicted → naive-cost
// floor as K grows). Memory price is reported per mode.
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(new URL("../census/noop.js", import.meta.url));
const GeoTIFF = require("geotiff");

// ---- mirrors (identical to docs/grid-sens.mjs) ------------------------------
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
  return { aRoll: mg * crr / keff / KJ, aAero: aeroCoef / keff / KJ, beta: mg / keff / KJ,
           climbThr: 0.02, abRatio: crr + aeroCoef / mg, epsOffset: 0.13 };
}
function smoothHeightsInPlace(height, mask, H, W, dxM, dyM, sigmaM) {
  const axes = [
    { pix: dxM, stride: 1, lines: H, len: W, lineStride: W },
    { pix: dyM, stride: W, lines: W, len: H, lineStride: 1 },
  ];
  const maxLen = Math.max(W, H);
  const src = new Float64Array(maxLen), val = new Float64Array(maxLen), wgt = new Float64Array(maxLen);
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
          val[i] += w * src[j]; wgt[i] += w;
        }
      }
      for (let i = 0; i < len; i++) if (mask[base + i * stride] && wgt[i] > 0) height[base + i * stride] = val[i] / wgt[i];
    }
  }
}
const gcdF = (a, b) => (b ? gcdF(b, a % b) : a);
function sqOffsets(level) {
  let oct = [[1, 0], [1, 1]];
  for (let l = 0; l < level; l++) {
    const next = [];
    for (let i = 0; i < oct.length - 1; i++) next.push(oct[i], [oct[i][0] + oct[i + 1][0], oct[i][1] + oct[i + 1][1]]);
    next.push(oct[oct.length - 1]);
    oct = next;
  }
  const set = new Map();
  for (const [a, b] of oct)
    for (const [dr, dc] of [[a, b], [b, a]])
      for (const sr of [1, -1]) for (const sc of [1, -1])
        set.set(`${dr * sr || 0},${dc * sc || 0}`, [dr * sr || 0, dc * sc || 0]);
  return [...set.values()];
}
function dijkstraK(height, mask, H, W, dxM, dyM, cost, seedR, seedC, offs) {
  const N = H * W;
  const E = new Float32Array(N).fill(Infinity);
  const settled = new Uint8Array(N);
  const K = offs.length;
  const dIdx = new Int32Array(K), dist = new Float64Array(K);
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
      if (!isLong) edge = v2Edge(dist[k], height[nIdx] - hHere, cost);
      else {
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
            const tr = fr - r1, tc = fc - c1, b0 = r1 * W + c1;
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
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

// ---- main --------------------------------------------------------------------
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]] : null).filter(Boolean));
const DEM_PATH = args.dem || "sampa_centro.tif"; // curl -O https://simujaules.pedalhidrografi.co/dem/sampa_centro.tif
const tif = await GeoTIFF.fromArrayBuffer(readFileSync(DEM_PATH).buffer);
const img = await tif.getImage();
const [ox, oy] = img.getOrigin();
const [degX, degYn] = img.getResolution();
const degY = Math.abs(degYn);
let [r0, c0, H, W] = (args.crop || "500,1200,900,900").split(",").map(Number);
const latMid = oy - (r0 + H / 2) * degY;
let dxM = degX * 111320 * Math.cos(latMid * Math.PI / 180);
let dyM = degY * 110574;
const ras = await img.readRasters({ window: [c0, r0, c0 + W, r0 + H], interleave: true });
let height = new Float32Array(H * W), mask = new Uint8Array(H * W);
for (let i = 0; i < H * W; i++) {
  const v = ras[i];
  if (Number.isFinite(v) && v > -100 && v < 9000) { height[i] = v; mask[i] = 1; }
}
const DEC = parseInt(args.decimate || "0", 10);
if (DEC > 1) {
  smoothHeightsInPlace(height, mask, H, W, dxM, dyM, DEC * Math.min(dxM, dyM) / 2);
  const H2 = Math.floor(H / DEC), W2 = Math.floor(W / DEC);
  const h2 = new Float32Array(H2 * W2), m2 = new Uint8Array(H2 * W2);
  for (let r = 0; r < H2; r++) for (let c = 0; c < W2; c++) {
    h2[r * W2 + c] = height[r * DEC * W + c * DEC];
    m2[r * W2 + c] = mask[r * DEC * W + c * DEC];
  }
  height = h2; mask = m2; H = H2; W = W2; dxM *= DEC; dyM *= DEC;
} else if (Math.min(dxM, dyM) <= 10) {
  smoothHeightsInPlace(height, mask, H, W, dxM, dyM, 10);
}
console.log(`grid ${H}×${W}, pixel ${dxM.toFixed(1)}×${dyM.toFixed(1)} m`);
const cost = deriveCost();
const NS = parseInt(args.sources || "3", 10);
const srcs = [];
const golden = 0.6180339887;
for (let k = 0; srcs.length < NS && k < 200; k++) {
  let r = Math.floor(H * (0.2 + 0.6 * ((k * golden) % 1)));
  let c = Math.floor(W * (0.2 + 0.6 * ((k * golden * golden) % 1)));
  let ok = false;
  for (let t = 0; t < 400 && !ok; t++) { if (mask[r * W + c]) ok = true; else { r = (r + 7) % H; c = (c + 13) % W; } }
  if (ok && !srcs.some(([rr, cc]) => Math.hypot(rr - r, cc - c) < Math.min(H, W) / 8)) srcs.push([r, c]);
}

const O8 = sqOffsets(0), O16 = sqOffsets(1), O32 = sqOffsets(2);

// Precompute long-edge cost tables: for each long offset (directed), a
// Float64Array where T[v] = profile-integrated cost of the edge
// (v - offset) → v. Same sub-step loop as dijkstraK's on-demand path (same
// op order ⇒ bit-identical sums). Invalid edges (off-grid / masked sweep)
// store Infinity.
function precomputeLong(height, mask, H, W, dxM, dyM, cost, offs) {
  const N = H * W;
  const tables = new Map(); // key "dr,dc" -> Float64Array
  let cells = 0;
  const t0 = Date.now();
  for (const [dr, dc] of offs) {
    if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) continue;
    const T = new Float64Array(N).fill(Infinity);
    const distM = Math.hypot(dr * dyM, dc * dxM);
    const n = 2 * Math.max(Math.abs(dr), Math.abs(dc));
    const sub = distM / n;
    for (let vr = 0; vr < H; vr++) {
      for (let vc = 0; vc < W; vc++) {
        const ur = vr - dr, uc = vc - dc;
        if (ur < 0 || ur >= H || uc < 0 || uc >= W) continue;
        const u = ur * W + uc, v = vr * W + vc;
        if (!mask[u] || !mask[v]) continue;
        // sweep-passability + profile integral, EXACTLY as dijkstraK does it
        let blocked = false;
        for (let s = 1; s < n; s++) {
          const rr = Math.round(ur + dr * s / n), cc = Math.round(uc + dc * s / n);
          if ((rr !== ur || cc !== uc) && (rr !== vr || cc !== vc) && !mask[rr * W + cc]) { blocked = true; break; }
        }
        if (blocked) continue;
        let edge = 0, hPrev = height[u];
        for (let s = 1; s <= n; s++) {
          let hs;
          if (s === n) hs = height[v];
          else {
            const fr = ur + dr * s / n, fc = uc + dc * s / n;
            const r1 = Math.min(H - 2, Math.max(0, Math.floor(fr)));
            const c1 = Math.min(W - 2, Math.max(0, Math.floor(fc)));
            const tr = fr - r1, tc = fc - c1, b0 = r1 * W + c1;
            hs = height[b0] * (1 - tr) * (1 - tc) + height[b0 + 1] * (1 - tr) * tc +
                 height[b0 + W] * tr * (1 - tc) + height[b0 + W + 1] * tr * tc;
          }
          edge += v2Edge(sub, hs - hPrev, cost);
          hPrev = hs;
        }
        T[v] = edge;
        cells++;
      }
    }
    tables.set(`${dr},${dc}`, T);
  }
  return { tables, secs: (Date.now() - t0) / 1000, entries: cells };
}

// Dijkstra with table-lookup long edges (unit moves computed as usual).
function dijkstraPre(height, mask, H, W, dxM, dyM, cost, seedR, seedC, offs, tables) {
  const N = H * W;
  const E = new Float32Array(N).fill(Infinity);
  const settled = new Uint8Array(N);
  const K = offs.length;
  const dIdx = new Int32Array(K);
  const dist = new Float64Array(K);
  const longT = [];
  for (let k = 0; k < K; k++) {
    const [dr, dc] = offs[k];
    dIdx[k] = dr * W + dc;
    dist[k] = Math.hypot(dr * dyM, dc * dxM);
    longT.push((Math.abs(dr) > 1 || Math.abs(dc) > 1) ? tables.get(`${dr},${dc}`) : null);
  }
  const maxR = Math.max(...offs.map(([dr]) => Math.abs(dr)));
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
      const T = longT[k];
      let edge;
      if (T) {
        edge = T[nIdx];
        if (edge === Infinity) continue;
      } else {
        edge = v2Edge(dist[k], height[nIdx] - hHere, cost);
      }
      const t = g + edge;
      if (t < E[nIdx]) { E[nIdx] = t; push(t, nIdx); }
    }
  }
  return E;
}

const NREUSE = 8; // density-style amortization: K searches sharing one precompute
for (const [name, offs] of [["sq16", O16], ["sq32", O32]]) {
  const nLong = offs.filter(([a, b]) => Math.abs(a) > 1 || Math.abs(b) > 1).length;
  console.log(`\n== ${name} (${offs.length} moves, ${nLong} long) — tables: ${(nLong * 8 * H * W / 1e6).toFixed(0)} MB f64 (${(nLong * 4 * H * W / 1e6).toFixed(0)} MB f32) on this grid ==`);
  const { tables, secs: tPre } = precomputeLong(height, mask, H, W, dxM, dyM, cost, offs);
  console.log(`  precompute: ${tPre.toFixed(2)}s`);
  let tProfile = 0, tLookup = 0, maxD = 0, mismatch = 0;
  for (const [sr, sc] of srcs.slice(0, NREUSE)) {
    let t0 = Date.now();
    const A = dijkstraK(height, mask, H, W, dxM, dyM, cost, sr, sc, offs);
    tProfile += (Date.now() - t0) / 1000;
    t0 = Date.now();
    const B = dijkstraPre(height, mask, H, W, dxM, dyM, cost, sr, sc, offs, tables);
    tLookup += (Date.now() - t0) / 1000;
    for (let i = 0; i < H * W; i++) {
      const a = A[i], b = B[i];
      if (Number.isFinite(a) !== Number.isFinite(b)) mismatch++;
      else if (Number.isFinite(a)) maxD = Math.max(maxD, Math.abs(a - b));
    }
  }
  const K = Math.min(NREUSE, srcs.length);
  console.log(`  exactness vs on-demand: max|Δ|=${maxD.toExponential(2)} kJ, finite-mismatch=${mismatch}  (${K} sources)`);
  console.log(`  single search:  on-demand ${(tProfile / K).toFixed(2)}s   lookup ${(tLookup / K).toFixed(2)}s   (lookup+precompute for K=1: ${(tLookup / K + tPre).toFixed(2)}s)`);
  console.log(`  density-style (K=${K}): on-demand ${tProfile.toFixed(2)}s   precompute+lookup ${(tPre + tLookup).toFixed(2)}s   → ×${(tProfile / (tPre + tLookup)).toFixed(2)} speedup`);
}
