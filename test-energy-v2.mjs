// test-energy-v2.mjs — locks the v2 leg-energy closed form (the route evaluator
// behind refEnergyKJ in app.js) and the ε descent-recovery estimator to the
// canonical model in bicycling-energy-model/notas.md (v2) + compare.mjs. The
// aggregate ε used by refEnergyKJ mirrors regime_compare.mjs's epsGeom (journal
// Entry 18/WI-1, 2026-07-06); the per-edge grade-local ε (epsEstimate here)
// still mirrors the v2Edge/energy-worker.js formula, unchanged by WI-1.
// Run: node test-energy-v2.mjs
//
// These are PURE MIRRORS of app.js's readCost()/refEnergyKJ() math (same
// hand-kept-in-sync rule as test-water-raster.mjs / census mirrors — app.js is a
// browser module and can't be imported here). Keep them in step with app.js.

let failures = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond, extra = "") { console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? "  — " + extra : ""}`); if (!cond) failures++; }

// São Paulo's local gravity (IAG-USP absolute gravimetry), not the textbook
// 9.81 — mirrors app.js's G_SP; re-baselined in v63 (long note there). The
// assertions below are written in terms of G, so they track it automatically.
const G = 9.7864;

// ── mirror of app.js flatEqSpeed() + readCost() (physics → kJ cost bundle) ────
function flatEqSpeed(P, m, crr, cda, rho, keff) {
  const a = crr * m * G, b = 0.5 * rho * cda;
  let lo = 0, hi = 40;
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2;
    const wheel = (a + b * v * v) * v;
    if (wheel < keff * P) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}
function deriveCost({ mass, crr, cda, rho, keff, pFlat, climbThrPct, kSmooth = 1 }) {
  const vf = flatEqSpeed(pFlat, mass, crr, cda, rho, keff), mg = mass * G, KJ = 1000;
  const aeroCoef = 0.5 * rho * cda * vf * vf;
  return {
    aRoll: mg * crr / keff / KJ,
    aAero: aeroCoef / keff / KJ,
    beta: mg * kSmooth / keff / KJ,   // k_smooth multiplies the gravity term
    climbThr: climbThrPct / 100,
    abRatio: crr + aeroCoef / mg,     // un-smoothed (independent of kSmooth)
    epsOffset: 0.13,
  };
}

// ── mirror of the deadband + closed-form evaluator (refEnergyKJ) ──────────────
function deadband(h, tau) {
  const out = new Float64Array(h.length);
  let y = h[0]; out[0] = y;
  for (let i = 1; i < h.length; i++) {
    if (h[i] > y + tau) y = h[i] - tau; else if (h[i] < y - tau) y = h[i] + tau;
    out[i] = y;
  }
  return out;
}
function epsEstimate(c, sbar) {
  if (!(sbar > 0)) return 0;
  let eps = Math.min(1, c.abRatio / sbar) - c.epsOffset;
  return eps < 0 ? 0 : eps > 1 ? 1 : eps;
}
// epsGeomAgg — mirror of bicycling-energy-model regime_compare.mjs epsGeom
// (journal Entry 18/WI-1), ported into refEnergyKJ: resample the RAW
// (pre-deadband) profile into 30 m cells, accumulate the drop-weighted
// Σ drop_k·min(1, abRatio/(drop_k/30)) over descending cells, divide by the
// total drop, THEN subtract epsOffset and clamp₀₁ ONCE on that aggregate
// (never per-cell). x/h are the RAW cumulative distance/elevation arrays
// (same length, index-aligned) — NOT the τ-deadbanded hS used by the walk
// below.
function epsGeomAgg(x, h, abRatio, epsOffset) {
  const N = x.length - 1, DX = 30, x0 = x[0], totalM = x[N] - x0, nc = Math.floor(totalM / DX);
  if (nc < 2) return 0;
  let j = 0;
  const hAt = (d) => {
    while (j < N - 1 && x[j + 1] < d) j++;
    const seg = x[j + 1] - x[j], f = seg > 1e-9 ? (d - x[j]) / seg : 0;
    return h[j] * (1 - f) + h[j + 1] * f;
  };
  const cellH = new Float64Array(nc + 1);
  for (let k = 0; k <= nc; k++) cellH[k] = hAt(x0 + k * DX);
  let Hd = 0, epsW = 0;
  for (let k = 0; k < nc; k++) {
    const dh = cellH[k + 1] - cellH[k];
    if (dh < 0) { const drop = -dh; Hd += drop; epsW += drop * Math.min(1, abRatio / (drop / DX)); }
  }
  if (Hd < 1) return 0;
  return Math.max(0, Math.min(1, epsW / Hd - epsOffset));
}
// segs: [{ d, dh }]. Returns leg energy in kJ (coefficients are kJ-based).
function refEnergyKJ(segs, c, tau = 2) {
  const n = segs.length;
  const x = new Float64Array(n + 1);
  const h = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { x[i + 1] = x[i] + segs[i].d; h[i + 1] = h[i] + segs[i].dh; }
  const hS = deadband(h, tau);
  let X = 0, Xnc = 0, hPlus = 0, hMinus = 0;
  for (let i = 0; i < n; i++) {
    const d = segs[i].d; if (!(d > 0)) continue;
    const dh = hS[i + 1] - hS[i];
    X += d;
    if (dh >= 0) { hPlus += dh; if (dh < c.climbThr * d) Xnc += d; }
    else { hMinus += -dh; Xnc += d; }
  }
  const eps = epsGeomAgg(x, h, c.abRatio, c.epsOffset);   // drop-weighted 30 m-cell ε on the RAW profile
  return c.aRoll * X + c.aAero * Xnc + c.beta * (hPlus - eps * hMinus);
}

// ── 1. ε estimator — the notas.md worked example (RMC200 Mogi) ────────────────
{
  // α/β = 0.0202, s̄ = 3.4% ⇒ min(1, 0.0202/0.034) − 0.13 = 0.464 (measured 0.47).
  const c = { abRatio: 0.0202, epsOffset: 0.13 };
  const eps = epsEstimate(c, 0.034);
  ok("ε(RMC200) ≈ 0.46", approx(eps, 0.464, 2e-3), `got ${eps.toFixed(4)}`);
  // Clamp at 1 then minus offset on a gentle descent below the flat-resistance grade.
  ok("ε gentle descent clamps to 1−offset", approx(epsEstimate(c, 0.005), 0.87, 1e-9), `got ${epsEstimate(c, 0.005)}`);
  // Very steep ⇒ little recovery, then floors at 0.
  ok("ε steep descent floors at 0", epsEstimate(c, 1.0) === 0, `got ${epsEstimate(c, 1.0)}`);
}

// ── 2. 2 m deadband rejects sub-τ jitter, keeps real climbs ───────────────────
{
  // ±1 m wiggle around a flat line → 0 net ascent after a 2 m deadband.
  const h = [0, 1, 0, 1, 0, 1, 0];
  const hS = deadband(h, 2);
  let gain = 0; for (let i = 1; i < hS.length; i++) { const d = hS[i] - hS[i - 1]; if (d > 0) gain += d; }
  ok("deadband removes ±1 m jitter (0 gain)", approx(gain, 0), `got ${gain}`);
  // A real 50 m climb survives (lagging by τ): net rise 50−2 = 48.
  const h2 = deadband([0, 50], 2);
  ok("deadband keeps a 50 m climb (−τ lag)", approx(h2[1] - h2[0], 48), `got ${h2[1] - h2[0]}`);
}

// ── 3. closed form: rolling everywhere, aero OFF climbs, gravity ± recovery ───
{
  const c = { aRoll: 0.5, aAero: 0.5, beta: 10, climbThr: 0.05, abRatio: 0.1, epsOffset: 0.13 };
  // 1000 m flat, then 100 m at +20 m (grade 0.2 ≥ climbThr ⇒ no aero), then
  // 100 m at −20 m (grade 0.2 descent). Profile differences exceed the 2 m
  // deadband, so smoothing leaves h± intact (lagging endpoints cancel in Δ).
  const segs = [
    { d: 1000, dh: 0 },     // flat
    { d: 100, dh: 20 },     // climb (no aero)
    { d: 100, dh: -20 },    // descent (full flat aero + ε recovery)
  ];
  // Hand derivation. X/Xnc/hPlus/hMinus come off the DEADBANDED profile:
  // cumulative h=[0,0,20,0]; deadband τ=2 LAGS each move by τ → hS=[0,0,18,2],
  // so Δ=[0,+18,−16]: X=1200, Xnc=1000(flat)+100(desc)=1100, hPlus=18, hMinus=16.
  // ε (WI-1) instead resamples the RAW (undeadbanded) profile — same h=[0,0,20,0]
  // at raw x=[0,1000,1100,1200] — into 30 m cells. Reimplemented here
  // independently of epsGeomAgg: the peak at x=1100 doesn't land on a 30 m
  // boundary (nearest are 1080/1110), so it straddles into cell [1080,1110]
  // (net +2 m, still net-ascending there) — only the 3 cells from 1110 to 1200
  // are net-descending, each dropping 6 m (30 m·0.2 grade), so the aggregate
  // Hd = 18 m (not the raw 20 m swing) and every counted cell shares the same
  // 0.2 grade, so ε reduces to a single min(1, abRatio/0.2) - epsOffset.
  const rawX = [0, 1000, 1100, 1200], rawH = [0, 0, 20, 0];
  let jj = 0;
  const hAtRaw = (d) => {
    while (jj < rawX.length - 2 && rawX[jj + 1] < d) jj++;
    const seg = rawX[jj + 1] - rawX[jj], f = seg > 1e-9 ? (d - rawX[jj]) / seg : 0;
    return rawH[jj] * (1 - f) + rawH[jj + 1] * f;
  };
  // hAtRaw's cursor `jj` only moves forward, so cells must be precomputed in
  // ascending d order (as epsGeomAgg does) — evaluating a later cell before an
  // earlier one would advance jj past where the earlier one needs it.
  const cellH3 = new Float64Array(41);   // nc = floor(1200/30) = 40
  for (let k = 0; k <= 40; k++) cellH3[k] = hAtRaw(k * 30);
  let Hd3 = 0, epsW3 = 0;
  for (let k = 0; k < 40; k++) {
    const dh = cellH3[k + 1] - cellH3[k];
    if (dh < 0) { const drop = -dh; Hd3 += drop; epsW3 += drop * Math.min(1, c.abRatio / (drop / 30)); }
  }
  ok("hand-derived Hd = 18 m (peak straddles a 30 m boundary)", approx(Hd3, 18), `got ${Hd3}`);
  const eps = Math.max(0, Math.min(1, epsW3 / Hd3 - c.epsOffset));
  const want = c.aRoll * 1200 + c.aAero * 1100 + c.beta * (18 - eps * 16);
  ok("closed form matches hand derivation", approx(refEnergyKJ(segs, c), want), `got ${refEnergyKJ(segs, c)} want ${want}`);

  // Aero is charged OFF climbs only: a pure climb pays no aero, a flat of equal
  // distance does — so the flat costs aAero·d more on the distance term. (Use
  // the deadbanded climb height so the gravity term cancels exactly.)
  const flat = refEnergyKJ([{ d: 100, dh: 0 }], c);
  const climb = refEnergyKJ([{ d: 100, dh: 20 }], c); // grade 0.2 ≥ climbThr
  const cd = deadband([0, 20], 2); const hp = cd[1] - cd[0]; // smoothed climb = 18
  ok("aero charged off climbs only",
    approx((climb - c.beta * hp) - flat, -c.aAero * 100),
    `climb−grav=${(climb - c.beta * hp).toFixed(4)} flat=${flat.toFixed(4)}`);
}

// ── 4. readCost() sanity: physics → kJ coefficients in a believable range ─────
{
  const c = deriveCost({ mass: 75, crr: 0.008, cda: 0.45, rho: 1.1, keff: 0.97, pFlat: 80, climbThrPct: 2 });
  // beta = m·g·k_smooth/k_eff in kJ/m ≈ 75·9.7864/0.97/1000 ≈ 0.757 at k_smooth=1.
  ok("beta ≈ m·g/keff (kJ/m)", approx(c.beta, 75 * G / 0.97 / 1000, 1e-9), `got ${c.beta.toFixed(4)}`);
  // abRatio (flat-resistance grade) lands in a sane 1–3% band for road cycling.
  ok("abRatio in 1–3% band", c.abRatio > 0.01 && c.abRatio < 0.03, `got ${c.abRatio.toFixed(4)}`);
  ok("climbThr = 2%", approx(c.climbThr, 0.02), `got ${c.climbThr}`);
  // k_smooth scales beta (the gravity term) but NOT abRatio (the ε grade).
  const cs = deriveCost({ mass: 75, crr: 0.008, cda: 0.45, rho: 1.1, keff: 0.97, pFlat: 80, climbThrPct: 2, kSmooth: 0.74 });
  ok("k_smooth scales beta", approx(cs.beta, 0.74 * c.beta, 1e-12), `got ${cs.beta.toFixed(4)}`);
  ok("k_smooth leaves abRatio", approx(cs.abRatio, c.abRatio, 1e-12), `got ${cs.abRatio.toFixed(4)}`);
}

// ── 5. WI-1: refEnergyKJ's ε mirrors epsGeom (drop-weighted 30 m cells) ───────
// (a) A mixed-grade descent where the OLD lumped mean grade s̄ = H₋/X₋ and the
//     NEW drop-weighted 30 m-cell aggregate visibly disagree. Two 300 m
//     segments (boundary lands exactly on a 30 m cell edge, so there's no
//     interpolation straddle): a steep 10% stretch (drop 30 m) then a gentle
//     2% stretch (drop 6 m). aRoll/aAero are zeroed and beta=1 so the
//     refEnergyKJ output reduces to exactly −ε·hMinus, isolating ε.
{
  const c = { aRoll: 0, aAero: 0, beta: 1, climbThr: 0.02, abRatio: 0.03, epsOffset: 0.13 };
  const segsMixed = [
    { d: 300, dh: -30 },  // steep: grade 0.10, drop 30 m
    { d: 300, dh: -6 },   // gentle: grade 0.02, drop 6 m
  ];
  // Independent expectation (NOT via epsGeomAgg): each 300 m stretch splits
  // into 10 uniform 30 m cells of its own constant grade, so the cell-weighted
  // sum reduces to per-segment drop·min(1, abRatio/segmentGrade).
  const dA = 30, sA = 0.10, dB = 6, sB = 0.02;
  const epsW = dA * Math.min(1, c.abRatio / sA) + dB * Math.min(1, c.abRatio / sB);
  const Hd = dA + dB;
  const epsGeomExpected = Math.max(0, Math.min(1, epsW / Hd - c.epsOffset));
  const sbar = Hd / 600;   // OLD lumped mean descent grade over the whole 600 m
  const epsLumped = Math.max(0, Math.min(1, Math.min(1, c.abRatio / sbar) - c.epsOffset));
  ok("mixed-grade descent: drop-weighted ε visibly differs from lumped ε",
    Math.abs(epsGeomExpected - epsLumped) > 0.05,
    `geom ${epsGeomExpected.toFixed(4)} vs lumped ${epsLumped.toFixed(4)}`);
  // hMinus off the deadbanded profile (tau=2 default) — reuses the
  // already-tested deadband(), not refEnergyKJ's internals.
  const hSmoothed = deadband([0, -30, -36], 2);
  let hMinusExpected = 0;
  for (let i = 0; i < hSmoothed.length - 1; i++) { const dh = hSmoothed[i + 1] - hSmoothed[i]; if (dh < 0) hMinusExpected += -dh; }
  const want = c.beta * (0 - epsGeomExpected * hMinusExpected);
  const got = refEnergyKJ(segsMixed, c);
  ok("refEnergyKJ mirrors drop-weighted epsGeom on a mixed-grade descent",
    approx(got, want, 1e-9), `got ${got.toFixed(4)} want ${want.toFixed(4)}`);

  // (b) Constant-grade descent — lumped and drop-weighted MUST agree exactly
  // (every 30 m cell shares the same grade, so the weighted average degenerates
  // to the single grade-local value): regression-equality check.
  const segsConst = [{ d: 900, dh: -45 }];   // constant 5% grade, 30-cell-aligned
  const sConst = 45 / 900;
  const epsConstExpected = Math.max(0, Math.min(1, Math.min(1, c.abRatio / sConst) - c.epsOffset));
  const hSmoothedConst = deadband([0, -45], 2);
  const hMinusConst = -(hSmoothedConst[1] - hSmoothedConst[0]);
  const wantConst = c.beta * (0 - epsConstExpected * hMinusConst);
  const gotConst = refEnergyKJ(segsConst, c);
  ok("constant-grade descent: drop-weighted ε ≡ lumped mean-grade ε (regression)",
    approx(gotConst, wantConst, 1e-9), `got ${gotConst.toFixed(4)} want ${wantConst.toFixed(4)}`);
}

// ── 6. Clamp-neutrality guard (journal Entry 18) ──────────────────────────────
// The per-edge descent cost's PRE-CLAMP value (before the trailing max(0,·) in
// help.formula / energy-worker.js v2Edge) must stay > 0 across a sweep of
// (distance, grade, physical-parameter bundle) — machine-checks that the
// clamp stays dead code if the cost model ever changes. epsEstimate() here is
// the per-edge grade-local ε (unchanged by WI-1; WI-1 only touched the
// aggregate estimator refEnergyKJ uses for reference-geometry readouts).
{
  const dists = [1, 5, 30, 100, 500, 2000];
  const grades = [0.001, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2];
  const masses = [45, 75, 110, 150];
  const crrs = [0.003, 0.008, 0.015, 0.02];
  const cdas = [0.25, 0.40, 0.55, 0.70];
  const rhos = [0.9, 1.1, 1.3];
  const keffs = [0.85, 0.92, 0.97, 1.0];
  const pFlats = [40, 80, 150, 300];
  const kSmooths = [1, 0.74, 0.5];   // kSmooth < 1 should only widen the margin
  let minPreClamp = Infinity, n = 0, worst = null;
  for (const mass of masses) for (const crr of crrs) for (const cda of cdas) for (const rho of rhos)
    for (const keff of keffs) for (const pFlat of pFlats) for (const kSmooth of kSmooths) {
      const c = deriveCost({ mass, crr, cda, rho, keff, pFlat, climbThrPct: 2, kSmooth });
      for (const d of dists) for (const s of grades) {
        n++;
        const drop = s * d;
        const eps = epsEstimate(c, s);
        const preClamp = c.aRoll * d + c.aAero * d - eps * c.beta * drop;
        if (preClamp < minPreClamp) { minPreClamp = preClamp; worst = { mass, crr, cda, rho, keff, pFlat, kSmooth, d, s }; }
      }
    }
  ok("descent pre-clamp cost stays > 0 across the full param sweep", minPreClamp > 0,
    `min ${minPreClamp.toExponential(3)} over ${n} combos` + (worst ? ` @ ${JSON.stringify(worst)}` : ""));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
