// Regression test for the max-density segment search (energy-worker.js kind
// "maxseg") — no DEM file needed. Drives the worker through its real
// onmessage handler and asserts:
//   1. quality against EXACT self-avoiding-path enumeration on small grids
//      (square AND anisotropic cells) — the heuristic must land within a
//      pinned fraction of the true simple-path optimum, and the returned
//      path must be valid (8-neighbour steps, allowed cells, NO revisits,
//      reported sum/length matching the polyline's own recomputed values);
//   2. a ridge field is followed end to end (the intended use);
//   3. the SHUTTLE-DEGENERACY regression: on a realistic corridor field with
//      a hot pinch point, the result must be a simple path that actually
//      spans ~the target length — the old layered walk-DP collapsed onto a
//      4 km stretch traversed 5× here (why the walk formulation was dropped);
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
function moveLens(dx, dy) {
  const diag = Math.hypot(dx, dy);
  return [diag, dy, diag, dx, dx, diag, dy, diag];
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

// Exact reference: enumerate every SIMPLE path (self-avoiding, any start)
// whose length lands in [target, target + maxEdge] — the same stopping band
// the search uses (it halts at the first step crossing the target) — plus
// under-length dead ends, and return the max Σ d̄·len. Exponential; small
// grids only.
function exactBest(density, allowed, H, W, dx, dy, targetLenM) {
  const lens = moveLens(dx, dy);
  const maxEdge = Math.max(...lens);
  let best = -Infinity;
  const visited = new Uint8Array(H * W);
  const step = (r, c, len, val) => {
    if (len >= targetLenM) { if (val > best) best = val; return; }
    let extended = false;
    for (let k = 0; k < 8; k++) {
      const nr = r + DRS[k], nc = c + DCS[k];
      if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
      const n = nr * W + nc;
      if (!allowed[n] || visited[n]) continue;
      const nl = len + lens[k];
      if (nl > targetLenM + maxEdge) continue;
      extended = true;
      visited[n] = 1;
      step(nr, nc, nl, val + 0.5 * (density[r * W + c] + density[n]) * lens[k]);
      visited[n] = 0;
    }
    if (!extended && val > best) best = val; // dead end below target still counts
  };
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!allowed[i]) continue;
      visited[i] = 1;
      step(r, c, 0, 0);
      visited[i] = 0;
    }
  return best;
}

// Validity checks on a returned path + recomputed sum/length. `strict` now:
// a max-density segment must be a SIMPLE path — no revisits at all.
function auditPath(m, density, allowed, H, W, dx, dy) {
  const lens = moveLens(dx, dy);
  const p = m.path;
  let ok = p.length >= 2;
  const seen = new Set();
  let sum = 0, len = 0;
  for (let i = 0; i < p.length; i++) {
    if (!allowed[p[i]]) ok = false;
    if (seen.has(p[i])) ok = false; // revisit → not a simple path
    seen.add(p[i]);
    if (i === 0) continue;
    const ar = (p[i - 1] / W) | 0, ac = p[i - 1] - ar * W;
    const br = (p[i] / W) | 0, bc = p[i] - br * W;
    let k = -1;
    for (let j = 0; j < 8; j++) if (DRS[j] === br - ar && DCS[j] === bc - ac) k = j;
    if (k === -1) { ok = false; continue; } // not an 8-neighbour step
    sum += 0.5 * (density[p[i - 1]] + density[p[i]]) * lens[k];
    len += lens[k];
  }
  return { ok, sum, len };
}

// ---- 1. exact-enumeration quality + path validity (square & anisotropic) ----
for (const { name, dx, dy } of [
  { name: "square cells (dx=dy=100)", dx: 100, dy: 100 },
  { name: "anisotropic cells (dx=60, dy=100)", dx: 60, dy: 100 },
]) {
  console.log(`exact-enumeration quality — ${name}`);
  const H = 6, W = 6, N = H * W;
  const rnd = prng(1234);
  const density = new Float32Array(N);
  for (let i = 0; i < N; i++) density[i] = rnd() * 10;
  const allowed = new Uint8Array(N).fill(1);
  allowed[8] = 0; allowed[27] = 0; // two holes
  const targetLenM = 500;

  const ref = exactBest(density, allowed, H, W, dx, dy, targetLenM);
  const { done, error } = run({
    kind: "maxseg",
    density: new Float32Array(density), allowed: new Uint8Array(allowed),
    H, W, dx, dy, targetLenM,
  });
  assert(!error && done, `worker returned a result${error ? ` (error: ${error.message})` : ""}`);
  if (done) {
    const ratio = done.sum / ref;
    // Heuristic, not exact — but on a 6×6 field it must land close to the
    // true simple-path optimum. Deterministic (fixed seed), so a pinned
    // floor is safe; report the actual ratio for the log.
    assert(ratio >= 0.9 && ratio <= 1.0 + 1e-9,
      `within 10% of the exact simple-path optimum (ratio ${ratio.toFixed(3)}: ${done.sum.toFixed(1)} vs ${ref.toFixed(1)})`);
    const audit = auditPath(done, density, allowed, H, W, dx, dy);
    assert(audit.ok, "path is a valid SIMPLE path (8-neighbour, allowed, no revisits)");
    assert(Math.abs(audit.sum - done.sum) <= 1e-9 * Math.max(1, Math.abs(done.sum)),
      "reported sum == the path's own recomputed line integral");
    assert(Math.abs(audit.len - done.lengthM) <= 1e-9 * Math.max(1, done.lengthM),
      "reported length == the path's own recomputed length");
    assert(done.revisitFrac === 0, "revisitFrac is 0 (simple path by construction)");
  }
}

// ---- 2. ridge following ----
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
    assert(onRidge / done.path.length >= 0.9, `path stays on the ridge (${onRidge}/${done.path.length} cells)`);
    assert(done.lengthM >= 0.95 * targetLenM && done.lengthM <= targetLenM + 150,
      `length ≈ target (${done.lengthM.toFixed(0)} m vs ${targetLenM} m)`);
    const audit = auditPath(done, density, allowed, H, W, dx, dy);
    assert(audit.ok, "simple path");
  }
}

// ---- 3. SHUTTLE-DEGENERACY regression (why the walk-DP was replaced) ----
// Realistic corridor field: a main corridor with a hot pinch point + two
// weaker branches. The old layered walk-DP returned a 20 km walk collapsed
// onto rows 100–101 × 4 km, revisitFrac 0.78 — invisible on the map. The
// simple-path search must actually span the target length.
{
  console.log("shuttle-degeneracy regression (corridor field, 20 km)");
  const H = 200, W = 300, N = H * W, dx = 100, dy = 100;
  const density = new Float32Array(N);
  for (let c = 0; c < W; c++) {
    const peak = Math.exp(-((c - 150) ** 2) / (2 * 60 ** 2));
    density[100 * W + c] += 10 * (0.3 + 0.7 * peak);
  }
  for (let r = 0; r < 100; r++) density[r * W + 150] += 3;
  for (let r = 100; r < H; r++) density[r * W + (r - 100 + 60)] += 2;
  const rnd = prng(42);
  for (let i = 0; i < N; i++) density[i] += 0.05 * rnd();
  const allowed = new Uint8Array(N).fill(1);
  const targetLenM = 20000;
  const { done, error } = run({ kind: "maxseg", density, allowed, H, W, dx, dy, targetLenM });
  assert(!error && done, `worker returned a result${error ? ` (error: ${error.message})` : ""}`);
  if (done) {
    const audit = auditPath(done, density, allowed, H, W, dx, dy);
    assert(audit.ok, "simple path (zero revisits — the old DP had 78%)");
    assert(done.lengthM >= 0.95 * targetLenM,
      `full target length reached (${(done.lengthM / 1000).toFixed(1)} km)`);
    let rMin = 1e9, rMax = -1e9, cMin = 1e9, cMax = -1e9;
    for (const idx of done.path) {
      const r = (idx / W) | 0, c = idx - r * W;
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (c < cMin) cMin = c; if (c > cMax) cMax = c;
    }
    const bboxKm = Math.hypot((rMax - rMin) * dy, (cMax - cMin) * dx) / 1000;
    assert(bboxKm >= 10, `path actually spreads (bbox diagonal ${bboxKm.toFixed(1)} km ≥ 10 km; the old DP gave 4 km)`);
    let onCorridor = 0;
    for (const idx of done.path) if (density[idx] > 1) onCorridor++;
    assert(onCorridor / done.path.length >= 0.8,
      `path follows the corridors (${(100 * onCorridor / done.path.length).toFixed(0)}% of cells on corridor)`);
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
    assert(!crossed, "path stays on one side of the wall");
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
    H, W, dx: 100, dy: 100, targetLenM: 300, // < 4 cells
  });
  assert(!done && error && /too_short/.test(error.message), "target < 4 cells errors as too_short");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall ok");
process.exit(failures ? 1 : 0);
