import type { MachineId, MachineOdds, MetricId } from "./model";
import { machinesById } from "../machines";

export type AdjustedStats = {
  // 区間（あなたのカウント区間）
  segGames: number;
  bigSingle: number;
  bigCherry: number;
  regSingle: number;
  regCherry: number;
  grapes: number;
  nonOverlapCherries: number;

  // ファンキー等の特殊指標
  midCherryBig?: number;

  // 前任者込み（表示器累計）
  totalGames?: number;
  totalBig?: number;
  totalReg?: number;

  // 差枚逆算用
  diff?: number; // 区間差枚（final-base）
};

export type InferenceResult = {
  posterior: number[];      // 設定1..6
  expectedSetting: number;  // 例 4.80
  p4plus: number;
  p56: number;

  // 表示用（参考）
  weightsUsed: Record<string, number>; // metricId -> weight

  grapeOddsFromDiff?: number; // 1/○○
  grapeCoinsFromDiff?: number;
};

function softmaxLogWeights(logw: number[]): number[] {
  const m = Math.max(...logw);
  const w = logw.map((x) => Math.exp(x - m));
  const z = w.reduce((a, b) => a + b, 0);
  if (z <= 0) return Array(6).fill(1 / 6);
  return w.map((x) => x / z);
}

function safeProbFromDenom(denom: number): number {
  if (!(denom > 0) || !Number.isFinite(denom)) return 1e-12;
  const p = 1 / denom;
  if (!Number.isFinite(p) || p <= 0) return 1e-12;
  return Math.min(1 - 1e-12, Math.max(1e-12, p));
}

function clampCount(k: number, n: number): number {
  const kk = Math.trunc(Number.isFinite(k) ? k : 0);
  if (kk < 0) return 0;
  if (kk > n) return n;
  return kk;
}

function binomLogLik(n: number, k: number, p: number): number {
  // 組合せ項は設定に依存しないので省略（差分の尤度として十分）
  const nn = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  const kk = clampCount(k, nn);
  const pp = Math.min(1 - 1e-12, Math.max(1e-12, p));
  return kk * Math.log(pp) + (nn - kk) * Math.log(1 - pp);
}

/**
 * 設定差スコア：log(p6/p1) = log(D1/D6)
 */
function deltaScore(denoms: number[]): number {
  const d1 = denoms[0];
  const d6 = denoms[5];
  if (!(d1 > 0) || !(d6 > 0)) return 0;
  const r = d1 / d6;
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.log(r);
}

/**
 * 代表確率（p_avg）を作る：設定1..6の平均確率
 */
function avgProb(denoms: number[]): number {
  const ps = denoms.map((d) => safeProbFromDenom(d));
  const m = ps.reduce((a, b) => a + b, 0) / ps.length;
  return Math.min(1 - 1e-12, Math.max(1e-12, m));
}

/**
 * 「設定差 × サンプル効率」で重みを作る。
 * - ブドウだけは最低重みを保証（0禁止）
 */
function buildWeights(_machine: MachineId, odds: MachineOdds, segGames: number): Record<string, number> {
  const G = Math.max(0, segGames);

  const metrics: MetricId[] = [
    "singleReg",
    "cherryReg",
    "singleBig",
    "cherryBig",
    "grape",
    "nonOverlapCherry",
    "midCherryBig",
    "totalBig",
    "totalReg",
  ];

  // E = sqrt(G * p_avg) を計算し、最大で正規化
  const eff: Record<string, number> = {};
  let eMax = 1e-9;

  for (const m of metrics) {
    const den = odds[m];
    if (!den || den.length !== 6) continue;
    const p = avgProb(den);
    const e = Math.sqrt(G * p);
    eff[m] = e;
    if (e > eMax) eMax = e;
  }

  const W: Record<string, number> = {};

  // パラメータ（固定）
  const W_MAX = 3.0;

  for (const m of metrics) {
    const den = odds[m];
    if (!den || den.length !== 6) continue;

    const d = deltaScore(den); // 設定差
    const e = eff[m] ?? 0;
    const factor = 0.6 + 0.4 * (e / eMax); // 0.6..1.0

    // base weight
    let w = d * factor;

    // 最低重み（0禁止の扱い）
    const wMin = (m === "grape") ? 0.60 : 0.05;

    // totalBig/totalRegは、単独/重複と情報が被るので控えめにする（ただし前任者込みのとき役立つ）
    const isTotal = m === "totalBig" || m === "totalReg";
    if (isTotal) w *= 0.40;

    // clamp
    if (!Number.isFinite(w)) w = 0;
    w = Math.max(wMin, Math.min(W_MAX, w));

    W[m] = w;
  }

  return W;
}

export function infer(machine: MachineId, stats: AdjustedStats): InferenceResult {
  const def = machinesById[machine];
  if (!def) {
    throw new Error(`Unknown machine id: ${machine}`);
  }
  const odds = def.odds as MachineOdds;

  const segGames = Math.max(0, Math.trunc(stats.segGames));
  const totalGames = Math.max(0, Math.trunc(stats.totalGames ?? 0));

  // 自分区間の回数
  const kSingleB = Math.max(0, Math.trunc(stats.bigSingle));
  const kCherryB = Math.max(0, Math.trunc(stats.bigCherry));
  const kSingleR = Math.max(0, Math.trunc(stats.regSingle));
  const kCherryR = Math.max(0, Math.trunc(stats.regCherry));
  const kGrape = Math.max(0, Math.trunc(stats.grapes));
  const kNonOvCherry = Math.max(0, Math.trunc(stats.nonOverlapCherries));
  const kMidCherryBig = Math.max(0, Math.trunc(stats.midCherryBig ?? 0));

  // 前任者込みの総回数（ある場合）
  const kTotalB = Math.max(0, Math.trunc(stats.totalBig ?? 0));
  const kTotalR = Math.max(0, Math.trunc(stats.totalReg ?? 0));

  // 重み（設定差×サンプル効率、ブドウ最低重み）
  const weights = buildWeights(machine, odds, segGames);

  const logw: number[] = [];
  for (let i = 0; i < 6; i++) {
    let ll = 0;

    // ---- 区間指標（あなたのカウント）----
    if (odds.singleReg)  ll += weights.singleReg  * binomLogLik(segGames, kSingleR, safeProbFromDenom(odds.singleReg[i]));
    if (odds.cherryReg)  ll += weights.cherryReg  * binomLogLik(segGames, kCherryR, safeProbFromDenom(odds.cherryReg[i]));
    if (odds.singleBig)  ll += weights.singleBig  * binomLogLik(segGames, kSingleB, safeProbFromDenom(odds.singleBig[i]));
    if (odds.cherryBig)  ll += weights.cherryBig  * binomLogLik(segGames, kCherryB, safeProbFromDenom(odds.cherryBig[i]));
    if (odds.grape)      ll += weights.grape      * binomLogLik(segGames, kGrape, safeProbFromDenom(odds.grape[i]));
    if (odds.nonOverlapCherry) ll += weights.nonOverlapCherry * binomLogLik(segGames, kNonOvCherry, safeProbFromDenom(odds.nonOverlapCherry[i]));
    if (odds.midCherryBig)     ll += weights.midCherryBig     * binomLogLik(segGames, kMidCherryBig, safeProbFromDenom(odds.midCherryBig[i]));

    // ---- 前任者込み（表示器累計）----
    // totalBig/totalRegが与えられている＆ODDSに存在する場合のみ使う
    // ※ 情報が被るので weights側で 0.40 係数を掛けて控えめにしている
    if (totalGames > 0) {
      if (odds.totalBig && kTotalB >= 0) ll += weights.totalBig * binomLogLik(totalGames, kTotalB, safeProbFromDenom(odds.totalBig[i]));
      if (odds.totalReg && kTotalR >= 0) ll += weights.totalReg * binomLogLik(totalGames, kTotalR, safeProbFromDenom(odds.totalReg[i]));
    }

    logw.push(ll);
  }

  const post = softmaxLogWeights(logw);
  const expectedSetting = post.reduce((acc, p, idx) => acc + (idx + 1) * p, 0);
  const p4plus = post[3] + post[4] + post[5];
  const p56 = post[4] + post[5];

  const { grapeOddsFromDiff, grapeCoinsFromDiff } = grapeFromDiff({
    games: segGames,
    big: kSingleB + kCherryB,
    reg: kSingleR + kCherryR,
    diff: stats.diff,
  });

  // weightsUsed は見やすいように出す（UI表示したい場合に使える）
  const weightsUsed: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    weightsUsed[k] = Number(v.toFixed(3));
  }

  return {
    posterior: post,
    expectedSetting,
    p4plus,
    p56,
    weightsUsed,
    grapeOddsFromDiff,
    grapeCoinsFromDiff,
  };
}

// ---- ぶどう逆算（あなたの式）----
//
// ぶどう獲得枚数(逆算) =
//   差枚 + G*3 - (BB*239.25 + RB*95.25 + G*(3*(1/7.3) + 2*(1/35)))
//
// ぶどう確率(逆算) = 8G / grapeCoins
//
function grapeFromDiff(stats: { games: number; big: number; reg: number; diff?: number }): { grapeOddsFromDiff?: number; grapeCoinsFromDiff?: number } {
  if (stats.diff == null) return {};
  const G = stats.games;
  if (!(G > 0)) return {};
  const BB = stats.big;
  const RB = stats.reg;
  const D = stats.diff;

  const expectedSmallRoleCoinsPerGame = 3 * (1 / 7.3) + 2 * (1 / 35);

  const grapeCoins =
    D + G * 3 -
    (BB * 239.25 + RB * 95.25 + G * expectedSmallRoleCoinsPerGame);

  if (!Number.isFinite(grapeCoins) || grapeCoins <= 0) {
    return { grapeCoinsFromDiff: Number.isFinite(grapeCoins) ? grapeCoins : undefined };
  }

  const odds = (8 * G) / grapeCoins;
  if (!Number.isFinite(odds) || odds <= 0) {
    return { grapeCoinsFromDiff: grapeCoins };
  }
  return { grapeOddsFromDiff: odds, grapeCoinsFromDiff: grapeCoins };
}
