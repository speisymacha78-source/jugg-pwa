import type { MachineId } from "./model";
import { ODDS } from "./model";

export type AdjustedStats = {
  games: number;
  big: number;
  reg: number;
  diff?: number; // 区間差枚（final-base）
};

export type InferenceResult = {
  posterior: number[];      // 設定1..6
  expectedSetting: number;  // 例 4.80
  p4plus: number;
  p56: number;
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

export function infer(machine: MachineId, stats: AdjustedStats): InferenceResult {
  const table = ODDS[machine];
  const post = posteriorByBonus(table.big, table.reg, stats.games, stats.big, stats.reg);
  const expectedSetting = post.reduce((acc, p, i) => acc + (i + 1) * p, 0);
  const p4plus = post[3] + post[4] + post[5];
  const p56 = post[4] + post[5];

  const { grapeOddsFromDiff, grapeCoinsFromDiff } = grapeFromDiff(stats);

  return { posterior: post, expectedSetting, p4plus, p56, grapeOddsFromDiff, grapeCoinsFromDiff };
}

function posteriorByBonus(
  bigOdds: ReadonlyArray<number>,
  regOdds: ReadonlyArray<number>,
  n: number,
  xB: number,
  xR: number
): number[] {
  const logw: number[] = [];
  for (let i = 0; i < 6; i++) {
    const pB = 1 / bigOdds[i];
    const pR = 1 / regOdds[i];
    const pN = Math.max(1e-12, 1 - pB - pR);

    const xN = Math.max(0, n - xB - xR);

    const ll =
      xB * Math.log(pB) +
      xR * Math.log(pR) +
      xN * Math.log(pN);

    logw.push(ll);
  }
  return softmaxLogWeights(logw);
}

// ---- あなたの式（共通固定） ----
//
// ぶどう獲得枚数(逆算) =
//   差枚 + G*3 - (BB*239.25 + RB*95.25 + G*(3*(1/7.3) + 2*(1/35)))
//
// ぶどう確率(逆算) = G / ( (ぶどう獲得枚数(逆算)/8) ) = 8G / grapeCoins
//
function grapeFromDiff(stats: AdjustedStats): { grapeOddsFromDiff?: number; grapeCoinsFromDiff?: number } {
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
