// Regression test for the max-density segment DP (energy-worker.js kind
// "maxseg") — no DEM file needed. Drives the worker through its real
// onmessage handler and asserts:
//   1. exact equivalence with a brute-force walk enumeration on small grids
//      (square AND anisotropic cells) — the DP's (cell, arrival-direction)
//      state, length quantisation, and final-window rule are all pinned;
//   2. the returned walk is valid: 8-neighbour steps, no immediate
//      backtracking, allowed cells only, reported sum/length match the
//      polyline's own recomputed values;
//   3. a ridge field is followed (the intended use: corridor extraction);
//   4. a blocked wall is never crossed;
//   5. the app-side block-mean coarsening (mirror of app.js
//      coarsenFieldForMaxseg — hand-kept-in-sync) handles masked/NaN cells
//      and partial edge blocks;
//   6. the too_short guard errors instead of returning garbage.
// Run: node test-maxseg.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));

function loadWorker() {
  const src = readFileSync(join(here, "energy-worker.js"), "utf8");
  const messages = [];
  const sandbox = { postMessage: (m) => messages.push(m), self: {}, performance, console };
  new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
  return (msg) => {
    messages.length = 0;
    sandbox.self.onmessage({ data: msg });
    return {
      done: messages.find((m) => m.kind === "maxseg-done") || null,
      error: messages.find((m) => m.kind === "error") || null,
    };
  };
}

const run = loadWorker();

let failures = 0;
function assert(cond, label) {
  console.log(`  ${cond ? "✓" : "✗ FAIL:"} ${label}`);
  if (!cond) failures++;
}

// Shared move tables — must match the worker's (classic 8, classic order).
const DRS = [-1, -1, -1, 0, 0, 1, 1, 1];
const DCS = [-1, 0, 1, -1, 1, -1, 0, 1];
function moveTables(dx, dy) {
  const diag = Math.hypot(dx, dy);
  const lens = [diag, dy, diag, dx, dx, diag, dy, diag];
  const u = Math.min(dx, dy) / 2;
  const units = lens.map((l) => Math.max(1, Math.round(l / u)));
  return { lens, units, maxU: Math.max(...units) };
}

// Deterministic pseudo-random field (mulberry32).
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Brute-force reference: enumerate every walk (any allowed start, 8-neighbour
// moves, no immediate backtrack) with total units in (K − maxU, K], maximising
// the same trapezoid line integral, accumulated in the same walk order.
function bruteBest(density, allowed, H, W, dx, dy, targetLenM) {
  const { lens, units, maxU } = moveTables(dx, dy);
  const u = Math.min(dx, dy) / 2;
  const K = Math.round(targetLenM / u);
  const lo = K - maxU;
  let best = -Infinity;
  const step = (r, c, prevK, usedUnits, val) => {
    if (usedUnits > lo && val > best) best = val;
    for (let k = 0; k < 8; k++) {
      if (prevK !== -1 && k === 7 - prevK) continue;
      const nu = usedUnits + units[k];
      if (nu > K) continue;
      const nr = r + DRS[k], nc = c + DCS[k];
      if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
      const a = r * W + c, b = nr * W + nc;
      if (!allowed[b]) continue;
      step(nr, nc, k, nu, val + 0.5 * (density[a] + density[b]) * lens[k]);
    }
  };
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (allowed[r * W + c]) step(r, c, -1, 0, 0);
  return best;
}

// Validity checks on a returned walk + recomputed sum/length.
function auditWalk(m, density, allowed, H, W, dx, dy) {
  const { lens } = moveTables(dx, dy);
  const p = m.path;
  let ok = p.length >= 2;
  let sum = 0, len = 0;
  for (let i = 0; i < p.length; i++) {
    if (!allowed[p[i]]) ok = false;
    if (i >= 2 && p[i] === p[i - 2]) ok = false; // immediate backtrack
    if (i === 0) continue;
    const ar = (p[i - 1] / W) | 0, ac = p[i - 1] - ar * W;
    const br = (p[i] / W) | 0, bc = p[i] - br * W;
    const dr = br - ar, dc = bc - ac;
    let k = -1;
    for (let j = 0; j < 8; j++) if (DRS[j] === dr && DCS[j] === dc) k = j;
    if (k === -1) { ok = false; continue; } // not an 8-neighbour step
    sum += 0.5 * (density[p[i - 1]] + density[p[i]]) * lens[k];
    len += lens[k];
  }
  return { ok, sum, len };
}

// ---- 1+2. brute-force equivalence + walk validity (square & anisotropic) ----
for (const { name, dx, dy } of [
  { name: "square cells (dx=dy=100)", dx: 100, dy: 100 },
  { name: "anisotropic cells (dx=60, dy=100)", dx: 60, dy: 100 },
]) {
  console.log(`brute-force equivalence — ${name}`);
  const H = 6, W = 6, N = H * W;
  const rnd = prng(1234);
  const density = new Float32Array(N);
  for (let i = 0; i < N; i++) density[i] = rnd() * 10;
  const allowed = new Uint8Array(N).fill(1);
  allowed[8] = 0; allowed[27] = 0; // two holes
  const targetLenM = 500; // K = 500/u — small enough to enumerate

  const ref = bruteBest(density, allowed, H, W, dx, dy, targetLenM);
  const { done, error } = run({
    kind: "maxseg",
    density: new Float32Array(density), allowed: new Uint8Array(allowed),
    H, W, dx, dy, targetLenM,
  });
  assert(!error && done, `worker returned a result${error ? ` (error: ${error.message})` : ""}`);
  if (done) {
    assert(Math.abs(done.sum - ref) <= 1e-9 * Math.max(1, Math.abs(ref)),
      `DP optimum == brute force (DP ${done.sum.toFixed(6)}, brute ${ref.toFixed(6)})`);
    const audit = auditWalk(done, density, allowed, H, W, dx, dy);
    assert(audit.ok, "walk is valid (8-neighbour, allowed cells, no immediate backtrack)");
    assert(Math.abs(audit.sum - done.sum) <= 1e-9 * Math.max(1, Math.abs(done.sum)),
      "reported sum == the walk's own recomputed line integral");
    assert(Math.abs(audit.len - done.lengthM) <= 1e-9 * Math.max(1, done.lengthM),
      "reported length == the walk's own recomputed length");
  }
}

// ---- 3. ridge following ----
{
  console.log("ridge field is followed");
  const H = 40, W = 60, N = H * W, dx = 100, dy = 100;
  const rnd = prng(99);
  const density = new Float32Array(N);
  for (let i = 0; i < N; i++) density[i] = 0.01 * rnd();
  for (let c = 0; c < W; c++) density[20 * W + c] = 10 + 0.01 * rnd();
  const allowed = new Uint8Array(N).fill(1);
  const targetLenM = 3000;
  const { done, error } = run({ kind: "maxseg", density, allowed, H, W, dx, dy, targetLenM });
  assert(!error && done, `worker returned a result${error ? ` (error: ${error.message})` : ""}`);
  if (done) {
    let onRidge = 0;
    for (const idx of done.path) if (((idx / W) | 0) === 20) onRidge++;
    assert(onRidge / done.path.length >= 0.9, `walk stays on the ridge (${onRidge}/${done.path.length} cells)`);
    assert(Math.abs(done.lengthM - targetLenM) <= 150,
      `length ≈ target (${done.lengthM.toFixed(0)} m vs ${targetLenM} m)`);
    assert(done.revisitFrac === 0, "no revisits on a ridge field");
  }
}

// ---- 4. blocked wall is never crossed ----
{
  console.log("mask wall respected");
  const H = 20, W = 21, N = H * W, dx = 100, dy = 100;
  const density = new Float32Array(N).fill(1);
  const allowed = new Uint8Array(N).fill(1);
  for (let r = 0; r < H; r++) allowed[r * W + 10] = 0; // vertical wall
  const { done, error } = run({ kind: "maxseg", density, allowed, H, W, dx, dy, targetLenM: 1500 });
  assert(!error && done, "worker returned a result");
  if (done) {
    let crossed = false;
    const side = (idx) => (idx - ((idx / W) | 0) * W) < 10 ? 0 : 1;
    for (const idx of done.path) if (!allowed[idx]) crossed = true;
    const s0 = side(done.path[0]);
    for (const idx of done.path) if (side(idx) !== s0) crossed = true;
    assert(!crossed, "walk stays on one side of the wall");
  }
}

// ---- 5. app-side coarsening (MIRROR of app.js coarsenFieldForMaxseg —
//         hand-kept-in-sync, same rule as the test-water-raster mirrors) ----
function coarsenFieldForMaxseg(field, mask, H, W, f) {
  const Hc = Math.ceil(H / f), Wc = Math.ceil(W / f);
  const sum = new Float64Array(Hc * Wc);
  const cnt = new Int32Array(Hc * Wc);
  for (let r = 0; r < H; r++) {
    const rowBase = r * W;
    const cBase = ((r / f) | 0) * Wc;
    for (let c = 0; c < W; c++) {
      if (!mask[rowBase + c]) continue;
      const v = field[rowBase + c];
      if (!Number.isFinite(v)) continue;
      const ci = cBase + ((c / f) | 0);
      sum[ci] += v;
      cnt[ci]++;
    }
  }
  const density = new Float32Array(Hc * Wc);
  const allowed = new Uint8Array(Hc * Wc);
  for (let i = 0; i < Hc * Wc; i++) {
    if (cnt[i] > 0) { density[i] = sum[i] / cnt[i]; allowed[i] = 1; }
  }
  return { density, allowed, Hc, Wc };
}
{
  console.log("block-mean coarsening (app.js mirror)");
  const H = 5, W = 7, f = 3; // partial blocks on both edges
  const field = new Float64Array(H * W);
  const mask = new Uint8Array(H * W).fill(1);
  for (let i = 0; i < H * W; i++) field[i] = i;
  field[8] = NaN;   // (1,1): skipped as non-finite
  mask[0] = 0;      // (0,0): masked out
  const { density, allowed, Hc, Wc } = coarsenFieldForMaxseg(field, mask, H, W, f);
  assert(Hc === 2 && Wc === 3, `coarse dims ${Hc}×${Wc} == 2×3`);
  // Block (0,0) covers rows 0–2 × cols 0–2 minus cell 0 (masked) and cell 8 (NaN):
  // cells {1,2,7,9,14,15,16} → mean = 64/7.
  assert(Math.abs(density[0] - 64 / 7) < 1e-6, "block mean skips masked + NaN cells");
  // Block (1,2) covers rows 3–4 × col 6 only: cells {27, 34} → mean 30.5.
  assert(Math.abs(density[1 * Wc + 2] - 30.5) < 1e-6, "partial edge block mean");
  assert(allowed.every((v) => v === 1), "all blocks have ≥1 valid cell → allowed");
  // Fully masked block → not allowed.
  const m2 = new Uint8Array(H * W).fill(1);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m2[r * W + c] = 0;
  const r2 = coarsenFieldForMaxseg(field, m2, H, W, f);
  assert(r2.allowed[0] === 0 && r2.density[0] === 0, "fully-masked block is disallowed");
}

// ---- 6. too_short guard ----
{
  console.log("too_short guard");
  const H = 4, W = 4;
  const { done, error } = run({
    kind: "maxseg",
    density: new Float32Array(H * W).fill(1), allowed: new Uint8Array(H * W).fill(1),
    H, W, dx: 100, dy: 100, targetLenM: 300, // K = 6 < 8
  });
  assert(!done && error && /too_short/.test(error.message), "K < 8 errors as too_short");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall ok");
process.exit(failures ? 1 : 0);
