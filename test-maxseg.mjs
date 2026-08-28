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
//   5. the ANTI-ROUND-TRIP knobs (elongExp + elongLookbackM): a hot dead-end
//      spur is traversed ONCE instead of out-and-back (the halo +
//      trailing-anchor terms), and on a U-shaped corridor the straightness
//      ρ = chord/length (1 − circular variance of the headings) rises
//      monotonically with the knob;
//   6. the app-side block-mean coarsening (mirror of app.js
//      coarsenFieldForMaxseg — hand-kept-in-sync) handles masked/NaN cells
//      and partial edge blocks;
//   7. the too_short guard errors instead of returning garbage.
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
// MIRROR of the worker's turn-factor table (MAXSEG_TURN_EXP — hand-kept-in-
// sync): candidate steps are scored as reward × ((1 + cos Δθ)/2)^exp against
// the previous move; the first move of a path is free. The worker's kink
// coupling makes its accumulated penalized score equal this traversal-order
// objective exactly, so the exact reference below enumerates the SAME thing.
const TURN_EXP = 0.5;
function turnTable(dx, dy) {
  const ux = [], uy = [];
  for (let k = 0; k < 8; k++) {
    const vx = DCS[k] * dx, vy = DRS[k] * dy;
    const n = Math.hypot(vx, vy);
    ux.push(vx / n); uy.push(vy / n);
  }
  const tf = [];
  for (let a = 0; a < 8; a++) {
    tf.push([]);
    for (let k = 0; k < 8; k++)
      tf[a].push(Math.pow(Math.max(0, (1 + ux[a] * ux[k] + uy[a] * uy[k]) / 2), TURN_EXP));
  }
  return tf;
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
// under-length dead ends, and return the max TURN-PENALIZED score (the
// search's own objective; turn factors are direction-symmetric, so directed
// enumeration covers every traversal). Exponential; small grids only.
function exactBest(density, allowed, H, W, dx, dy, targetLenM) {
  const lens = moveLens(dx, dy);
  const tf = turnTable(dx, dy);
  const maxEdge = Math.max(...lens);
  let best = -Infinity;
  const visited = new Uint8Array(H * W);
  const step = (r, c, prevK, len, val) => {
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
      const base = 0.5 * (density[r * W + c] + density[n]) * lens[k];
      visited[n] = 1;
      step(nr, nc, k, nl, val + base * (prevK < 0 ? 1 : tf[prevK][k]));
      visited[n] = 0;
    }
    if (!extended && val > best) best = val; // dead end below target still counts
  };
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!allowed[i]) continue;
      visited[i] = 1;
      step(r, c, -1, 0, 0);
      visited[i] = 0;
    }
  return best;
}

// Validity checks on a returned path + recomputed raw sum, penalized score
// (the search objective, for the exact-reference ratio) and length. A
// max-density segment must be a SIMPLE path — no revisits at all.
function auditPath(m, density, allowed, H, W, dx, dy) {
  const lens = moveLens(dx, dy);
  const tf = turnTable(dx, dy);
  const p = m.path;
  let ok = p.length >= 2;
  const seen = new Set();
  let sum = 0, pen = 0, len = 0, prevK = -1;
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
    const base = 0.5 * (density[p[i - 1]] + density[p[i]]) * lens[k];
    sum += base;
    pen += base * (prevK < 0 ? 1 : tf[prevK][k]);
    len += lens[k];
    prevK = k;
  }
  return { ok, sum, pen, len };
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
    kind: "maxseg", turnExp: 0.5, elongExp: 0,
    density: new Float32Array(density), allowed: new Uint8Array(allowed),
    H, W, dx, dy, targetLenM,
  });
  assert(!error && done, `worker returned a result${error ? ` (error: ${error.message})` : ""}`);
  if (done) {
    const audit = auditPath(done, density, allowed, H, W, dx, dy);
    // Heuristic, not exact — but it must land close to the exact optimum of
    // ITS OWN (turn-penalized) objective. Deterministic (fixed seed), so a
    // pinned floor is safe; report the actual ratio for the log. The 0.95
    // floor locks in the budget-capped rollout (uncapped lookahead scored
    // candidates by reward beyond the remaining length and these fields
    // measured 0.86–0.91).
    const ratio = audit.pen / ref;
    assert(ratio >= 0.95 && ratio <= 1.0 + 1e-9,
      `within 5% of the exact penalized optimum (ratio ${ratio.toFixed(3)}: ${audit.pen.toFixed(1)} vs ${ref.toFixed(1)})`);
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
  const { done, error } = run({ kind: "maxseg", turnExp: 0.5, elongExp: 0, density, allowed, H, W, dx, dy, targetLenM });
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

// ---- 3. ZIGZAG regression: wide corridor must be followed along its spine ----
// A corridor 3 cells wide: without the turn penalty the raw objective rewards
// SNAKING across the corridor's width (measured pre-fix: sinuosity 1.41,
// 100% ≥90° turns — the "too ziggy-zaggy" report); and without the seed-kink
// coupling a strong penalty folded the path into a hairpin V (sinuosity 2.19).
{
  console.log("zigzag regression (3-cell-wide corridor)");
  const H = 40, W = 60, N = H * W, dx = 100, dy = 100;
  // Tiny deterministic noise keeps the field non-degenerate: an EXACTLY
  // uniform corridor ties straight vs folded runs to within the turn
  // penalty, and the winner becomes a tie-breaking artefact (real density
  // fields never have exact ties).
  const rnd = prng(7);
  const density = new Float32Array(N);
  for (let i = 0; i < N; i++) density[i] = 0.01 * rnd();
  for (let r = 19; r <= 21; r++) for (let c = 0; c < W; c++) density[r * W + c] = 10 + 0.01 * rnd();
  const allowed = new Uint8Array(N).fill(1);
  const { done, error } = run({ kind: "maxseg", turnExp: 0.5, elongExp: 0, density, allowed, H, W, dx, dy, targetLenM: 3000 });
  assert(!error && done, "worker returned a result");
  if (done) {
    const p = done.path;
    const a = p[0], b = p[p.length - 1];
    const straight = Math.hypot((((a / W) | 0) - ((b / W) | 0)) * dy, ((a % W) - (b % W)) * dx);
    const sinuosity = done.lengthM / straight;
    assert(sinuosity <= 1.15, `sinuosity ${sinuosity.toFixed(2)} ≤ 1.15 (pre-fix: 1.41 snake / 2.19 hairpin)`);
    let sharp = 0;
    for (let i = 2; i < p.length; i++) {
      const d1r = ((p[i - 1] / W) | 0) - ((p[i - 2] / W) | 0), d1c = (p[i - 1] % W) - (p[i - 2] % W);
      const d2r = ((p[i] / W) | 0) - ((p[i - 1] / W) | 0), d2c = (p[i] % W) - (p[i - 1] % W);
      if (d1r * d2r + d1c * d2c <= 0) sharp++; // ≥ 90° turn
    }
    assert(sharp / (p.length - 2) <= 0.05,
      `≥90° turns ≤ 5% of steps (${sharp}/${p.length - 2}; pre-fix: 100%)`);
    let cMin = 1e9, cMax = -1e9;
    for (const idx of p) { const c = idx % W; if (c < cMin) cMin = c; if (c > cMax) cMax = c; }
    assert(cMax - cMin >= 27, `spans the corridor lengthwise (${cMax - cMin} cols; straight 3 km = 30)`);
  }
}

// ---- 4. SHUTTLE-DEGENERACY regression (why the walk-DP was replaced) ----
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
  const { done, error } = run({ kind: "maxseg", turnExp: 0.5, elongExp: 0, density, allowed, H, W, dx, dy, targetLenM });
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
  const { done, error } = run({ kind: "maxseg", turnExp: 0.5, elongExp: 0, density, allowed, H, W, dx, dy, targetLenM: 1500 });
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

// ---- 5. anti-round-trip knobs (elongExp / elongLookbackM) ----
// 5a. A hot 2-wide dead-end spur off a mild corridor: with the knobs off, the
// search harvests the spur out-and-back (a local round-trip lobe — the
// user-reported shape). With the local terms on, the spur is traversed ONCE
// (12 cells = one lane) and the path exits through the background instead of
// doubling back down the adjacent lane.
{
  console.log("anti-round-trip: hot dead-end spur");
  const H = 40, W = 60, N = H * W, dx = 100, dy = 100;
  const density = new Float32Array(N).fill(0.01);
  for (let c = 0; c < W; c++) density[20 * W + c] = 5;
  for (let r = 8; r < 20; r++) { density[r * W + 30] = 30; density[r * W + 31] = 30; }
  const allowed = new Uint8Array(N).fill(1);
  const spurCells = (done) => {
    let n = 0;
    for (const idx of done.path) {
      const r = (idx / W) | 0, c = idx % W;
      if (r < 20 && (c === 30 || c === 31)) n++;
    }
    return n;
  };
  const base = { kind: "maxseg", H, W, dx, dy, targetLenM: 5000, turnExp: 0.5 };
  const mk = () => ({ density: new Float32Array(density), allowed: new Uint8Array(allowed) });
  const off = run({ ...base, ...mk(), elongExp: 0, elongLookbackM: 0 }).done;
  const on = run({ ...base, ...mk(), elongExp: 0.5, elongLookbackM: 625 }).done;
  assert(off && spurCells(off) >= 20, `knobs OFF: out-and-back lobe present (${off && spurCells(off)} spur cells — documents the failure shape)`);
  assert(on && spurCells(on) <= 13, `knobs ON: spur traversed once (${on && spurCells(on)} spur cells ≤ 13)`);
  assert(on && on.straightness >= 0.65, `knobs ON: straightness ${on && on.straightness.toFixed(2)} ≥ 0.65 (off: ${off && off.straightness.toFixed(2)})`);
  if (on) {
    const audit = auditPath(on, density, allowed, H, W, dx, dy);
    assert(audit.ok, "knobs ON: still a valid simple path");
    assert(on.lengthM >= 0.95 * 5000, `knobs ON: full target length (${(on.lengthM / 1000).toFixed(1)} km)`);
  }
}
// 5b. U-shaped corridor: straightness ρ rises monotonically with the knob —
// the circular spread of the step headings shrinks as requested.
{
  console.log("anti-round-trip: U-shaped corridor, ρ vs knob");
  const H = 45, W = 60, N = H * W, dx = 100, dy = 100;
  const density = new Float32Array(N).fill(0.01);
  for (let r = 5; r <= 35; r++) density[r * W + 10] = 10;
  for (let c = 10; c <= 50; c++) density[35 * W + c] = 10;
  for (let r = 35; r >= 5; r--) density[r * W + 50] = 10;
  const allowed = new Uint8Array(N).fill(1);
  const base = { kind: "maxseg", H, W, dx, dy, targetLenM: 9000, turnExp: 0.5 };
  const mk = () => ({ density: new Float32Array(density), allowed: new Uint8Array(allowed) });
  const r0 = run({ ...base, ...mk(), elongExp: 0, elongLookbackM: 0 }).done;
  const r1 = run({ ...base, ...mk(), elongExp: 0.5, elongLookbackM: 1125 }).done;
  const r2 = run({ ...base, ...mk(), elongExp: 2.0, elongLookbackM: 1125 }).done;
  assert(r0 && r1 && r2, "all three knob settings returned results");
  if (r0 && r1 && r2) {
    assert(r0.straightness <= 0.5, `knob 0: follows the U (ρ ${r0.straightness.toFixed(2)} ≤ 0.5)`);
    assert(r1.straightness >= r0.straightness + 0.1,
      `knob 0.5: straighter (ρ ${r1.straightness.toFixed(2)} ≥ ${r0.straightness.toFixed(2)} + 0.1)`);
    assert(r2.straightness >= r1.straightness,
      `knob 2.0: straighter still (ρ ${r2.straightness.toFixed(2)} ≥ ${r1.straightness.toFixed(2)})`);
    for (const [tag, d] of [["0", r0], ["0.5", r1], ["2.0", r2]]) {
      const audit = auditPath(d, density, allowed, H, W, dx, dy);
      assert(audit.ok && d.lengthM >= 0.95 * 9000, `knob ${tag}: valid simple path at full length`);
    }
  }
}

// ---- 5c. consecutive non-overlapping segments (nSegments peeling) ----
// Two parallel corridors of different quality: top-1 lands on the better one;
// with nSegments=2 the second segment must take the OTHER corridor — not the
// adjacent lane of the first (the peeled tube covers ±2 cells) — and share no
// cells with it. Legacy top-level fields must mirror segments[0].
{
  console.log("consecutive segments (peeling)");
  const H = 40, W = 60, N = H * W, dx = 100, dy = 100;
  const rnd = prng(31);
  const density = new Float32Array(N);
  for (let i = 0; i < N; i++) density[i] = 0.01 * rnd();
  for (let c = 0; c < W; c++) density[15 * W + c] = 10 + 0.01 * rnd(); // corridor A
  for (let c = 0; c < W; c++) density[30 * W + c] = 8 + 0.01 * rnd();  // corridor B
  const allowed = new Uint8Array(N).fill(1);
  const { done, error } = run({
    kind: "maxseg", turnExp: 0.5, elongExp: 0, nSegments: 2,
    density, allowed, H, W, dx, dy, targetLenM: 3000,
  });
  assert(!error && done, `worker returned a result${error ? ` (error: ${error.message})` : ""}`);
  if (done) {
    assert(done.segments && done.segments.length === 2, `two segments returned (${done.segments?.length})`);
    if (done.segments?.length === 2) {
      const [s1, s2] = done.segments;
      assert(done.sum === s1.sum && done.path.length === s1.path.length,
        "legacy top-level fields mirror segments[0]");
      const rowOf = (p) => {
        const counts = new Map();
        for (const idx of p) { const r = (idx / W) | 0; counts.set(r, (counts.get(r) || 0) + 1); }
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      };
      assert(rowOf(s1.path) === 15, `segment 1 on the better corridor (row ${rowOf(s1.path)})`);
      assert(rowOf(s2.path) === 30, `segment 2 on the other corridor (row ${rowOf(s2.path)})`);
      const cells1 = new Set(s1.path);
      let shared = 0, nearTube = 0;
      for (const idx of s2.path) {
        if (cells1.has(idx)) shared++;
        const r = (idx / W) | 0, c = idx % W;
        for (const j of s1.path) {
          const jr = (j / W) | 0, jc = j % W;
          if (Math.max(Math.abs(jr - r), Math.abs(jc - c)) <= 2) { nearTube++; break; }
        }
      }
      assert(shared === 0, "no shared cells between segments");
      assert(nearTube === 0, "segment 2 stays out of segment 1's peeled tube (±2 cells)");
      assert(s2.sum > 0 && s2.lengthM >= 0.95 * 3000, "segment 2 is a full-length positive-sum path");
    }
  }
}

// ---- 6. app-side coarsening (MIRROR of app.js coarsenFieldForMaxseg —
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
