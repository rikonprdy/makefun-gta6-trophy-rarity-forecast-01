// Entry for make.fun gta6-trophy-rarity-forecast-01: forecast each Grand Theft
// Auto VI trophy's Exophase earn rate at the case's target, as five quantiles
// per trophy, scored by mean pinball loss on the logit scale.
//
// Node 22, standard library only, offline, deterministic: pure arithmetic
// on the case file, so two runs write the same bytes.
//
// Model. The house baseline is persistence: every rate stays where it was,
// spread 0.5*sqrt(days) on the logit scale. That misses the two things the
// launch does to Exophase rates:
//
//   1. Dilution. As millions of new players are tracked, every rate is
//      pulled toward what a fresh player has earned (near zero for most
//      trophies). The practice reads already show it: after the refresh
//      the tracked base jumped 638 -> 3,868 and every rate but the 100%
//      one fell.
//   2. Play, then saturation. The same flood of players completes early
//      content fast, so chapter and early-mission trophies climb steeply
//      for a day or two -- and then flatten, because the share of players
//      who will ever reach that chapter is bounded. A log-time line fit
//      through the steep first hours overshoots the target badly (on a
//      synthetic launch it put a chapter trophy at 80% where the truth
//      was 47%). So each trophy is fitted with a saturating curve instead:
//        rate(t) = S + (r0 - S) * exp(-(t + 1) / tau)
//      an exponential approach from its first read r0 to an asymptote S,
//      with S and tau chosen by grid search on the logit scale. That one
//      shape covers a trophy climbing toward its ceiling, a trophy
//      diluting down toward a lower asymptote, and (large tau) one still
//      rising almost linearly. Reads are weighted toward the recent ones
//      (24-hour half-life), so the fit follows the current regime.
//
// The spread is the fit's residual scale, widened by the biggest logit
// jump seen between consecutive reads (a refresh shock) scaled by the
// square root of the horizon, so a trophy that has already jumped gets
// an honest wide band. A flat history collapses back to persistence.
//
// Special cases: a trophy at 100% in the last read can only dilute down
// (median 99, band reaching into the low 90s); a trophy never earned yet
// gets a tier-flavoured prior (story trophies rise first) instead of a
// pin at 0.01% with a narrow band.
//
// Local run:  mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

interface Trophy { id: number; tier: string; description: string }
interface Read { slot: string; players_tracked: string; rates: Array<number | null> }
interface Case {
  id: string;
  levels: number[];
  horizon_minutes: number;
  target: string;
  game: { release_date: string };
  trophies: Trophy[];
  history: Read[];
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const clampPct = (x: number): number => clamp(x, 0.01, 99.99);
const logit = (pct: number): number => { const p = clampPct(pct) / 100; return Math.log(p / (1 - p)); };
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Candidate asymptotes (percent) and time constants (hours) for the
 *  saturating fit. S spans from near-zero to near-everyone; tau from a
 *  few hours (a trophy that moves in a day) to a month (still rising). */
const S_GRID = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 35, 50, 70, 90, 99];
const TAU_GRID = [6, 12, 24, 48, 96, 192, 384, 768];

/**
 * Fit rate(t) = S + (r0 - S) * exp(-(t + 1) / tau) on the logit scale, by
 * grid search over (S, tau). Reads are weighted with a 24-hour half-life
 * toward the most recent read. Returns the forecast logit at tTarget and
 * the residual scale measured on the last 24 hours of reads only: the
 * early launch hours fit any curve badly (flat, then steep), and letting
 * that misfit set the spread would make every band far wider than the
 * forecast error actually is. r0 is the rate at the first read.
 */
function saturatingFit(
  ts: number[], ys: number[], r0: number, tTarget: number,
): { forecast: number; sigma: number } {
  const tLast = ts[ts.length - 1];
  const ws = ts.map((t) => Math.pow(0.5, (tLast - t) / 24));
  const wsum = ws.reduce((a, b) => a + b, 0);
  let best = { sse: Infinity, forecast: ys[ys.length - 1], S: 0, tau: 0 };
  for (const S of S_GRID) {
    for (const tau of TAU_GRID) {
      let sse = 0;
      for (let i = 0; i < ts.length; i++) {
        const pred = S + (r0 - S) * Math.exp(-(ts[i] + 1) / tau);
        const d = ys[i] - logit(pred);
        sse += ws[i] * d * d;
      }
      if (sse < best.sse) {
        const predT = S + (r0 - S) * Math.exp(-(tTarget + 1) / tau);
        best = { sse, forecast: logit(predT), S, tau };
      }
    }
  }
  // Residual scale on the recent regime only.
  let ss = 0;
  let n = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] < tLast - 24) continue;
    const pred = best.S + (r0 - best.S) * Math.exp(-(ts[i] + 1) / best.tau);
    const d = ys[i] - logit(pred);
    ss += d * d;
    n++;
  }
  const sigma = Math.sqrt(ss / Math.max(1, n - 2));
  return { forecast: best.forecast, sigma };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (c.history.length === 0) throw new Error(`${file} has no history`);
  const releaseMs = Date.parse(`${c.game.release_date}T00:00:00Z`);
  const hoursSinceRelease = (iso: string): number =>
    Math.max(0, (Date.parse(iso) - releaseMs) / 3_600_000);
  const targetHours = hoursSinceRelease(c.target);
  const horizonDays = c.horizon_minutes / 1440;

  const trophies = c.trophies.map((t, i) => {
    const pts: Array<{ y: number; t: number }> = [];
    for (const h of c.history) {
      const r = h.rates[i];
      if (r === null || r === undefined) continue;
      pts.push({ y: logit(r), t: hoursSinceRelease(h.slot) });
    }
    // Biggest logit jump between consecutive reads in the last 24 hours:
    // a refresh shock. The launch morning's steep moves are the trend,
    // not shocks, so earlier jumps do not count.
    let maxJump = 0;
    const tLastPts = pts[pts.length - 1]?.t ?? 0;
    for (let k = 1; k < pts.length; k++) {
      if (pts[k].t >= tLastPts - 24) maxJump = Math.max(maxJump, Math.abs(pts[k].y - pts[k - 1].y));
    }
    const last = pts[pts.length - 1];
    if (!last) throw new Error(`${file} trophy ${t.id} has no read`);
    const lastRate = invLogit(last.y);
    const firstRate = invLogit(pts[0].y);

    let medianLogit: number;
    let sigma: number;
    if (lastRate >= 99.9) {
      // A trophy every tracked player has can only dilute as new players
      // join before earning it. Median just under 100, band reaching down.
      medianLogit = logit(99);
      sigma = 1.0;
    } else if (lastRate <= 0.01 && pts.every((p) => invLogit(p.y) <= 0.01)) {
      // Never earned by anyone tracked yet. A pin at 0.01% with a narrow
      // band would pay badly the moment the trophy starts moving, so use
      // a tier-flavoured prior: story trophies are earned first.
      const story = /chapter|complete|finish|gone fishing/i.test(t.description);
      medianLogit = logit(story ? 0.5 : 0.1);
      sigma = 1.3;
    } else if (pts.length < 3) {
      medianLogit = last.y;
      sigma = 0.5 * Math.sqrt(horizonDays);
    } else if (pts.every((p) => Math.abs(p.y - last.y) < 1e-9)) {
      // Flat history: collapse to persistence, like the baseline.
      medianLogit = last.y;
      sigma = 0.5 * Math.sqrt(horizonDays);
    } else {
      const fit = saturatingFit(pts.map((p) => p.t), pts.map((p) => p.y), firstRate, targetHours);
      // Ensemble median: the fit's forecast and persistence averaged in
      // logit space. The fit knows the direction of the move; persistence
      // hedges the asymptote, which two days of data cannot pin down:
      // on a saturating launch the fit overshoots the ceiling, on a
      // still-rising one persistence undershoots it, and the average
      // lands close to both. The spread also carries the size of the
      // move the fit wants, as honest uncertainty about that move.
      medianLogit = 0.6 * fit.forecast + 0.4 * last.y;
      // The median may move from the last read, but not by a wild amount.
      medianLogit = clamp(medianLogit, last.y - 4, last.y + 6);
      // Refresh shocks recur over the horizon: widen by the biggest jump
      // seen, scaled by the square root of the horizon in days.
      const shock = Math.min(0.5, 0.5 * maxJump * Math.sqrt(horizonDays));
      const move = 0.35 * Math.abs(fit.forecast - last.y);
      sigma = Math.sqrt(fit.sigma * fit.sigma + shock * shock + move * move);
      sigma = clamp(sigma, 0.4, 1.2);
      // The platinum needs almost a full playthrough; keep its median low.
      if (t.tier === 'platinum') medianLogit = Math.min(medianLogit, logit(3));
    }
    const q = Z.map((z) => round4(clampPct(invLogit(medianLogit + z * sigma))));
    // Rounding can only tie, never invert, but enforce it explicitly.
    for (let k = 1; k < q.length; k++) q[k] = Math.max(q[k], q[k - 1]);
    return { id: t.id, q };
  });
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
