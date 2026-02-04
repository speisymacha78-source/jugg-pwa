export type MachineId = "MYJUG" | "IM" | "GOGO" | "FUNKY";

export const MACHINE_LABEL: Record<MachineId, string> = {
  MYJUG: "マイジャグラーV",
  IM: "SアイムジャグラーEX",
  GOGO: "ゴーゴージャグラー",
  FUNKY: "ファンキージャグラー",
};

export type Checkpoint = {
  id: string;
  ts: number;
  gamesTotal: number;
  bigTotal: number;
  regTotal: number;
};

export type Play = {
  id: string;
  machine: MachineId;
  table?: string;

  // 前任者（開始時点）の表示器累計
  baseGamesTotal: number;
  baseBigTotal: number;
  baseRegTotal: number;
  baseDiffTotal?: number; // 差枚逆算に必要

  // 最終（やめ時）の表示器累計差枚
  finalDiffTotal?: number;

  // ★表示器の「現在の累計G」だけを手入力で保持（ボタン加算しない）
  currentGamesTotal: number;

  // ★ボーナス（あなたの稼働区間の回数）
  bigSingleCount: number; // BIG単独
  bigCherryCount: number; // BIGチェリー重複
  regSingleCount: number; // REG単独
  regCherryCount: number; // REGチェリー重複

  // ★小役（あなたの稼働区間の回数）
  grapesCount: number;    // ぶどう
  cherriesCount: number;  // 非重複チェリーのみ

  // ★ファンキー等で使う可能性がある追加カウント（未使用なら0でOK）
  midCherryBigCount?: number; // 中段チェリーBIG（ファンキー：1-4 vs 5-6で差）

  checkpoints: Checkpoint[];
  createdAt: number;

  /**
   * 判別結果（表示用キャッシュ）
   * - 「当時の判定」を固定して履歴として残すために保存する
   */
  inferCache?: {
    mapSetting: number;        // 1..6（事後確率最大）
    expectedSetting: number;   // 例: 4.80
    p4plus: number;            // P(4以上)
    p56: number;               // P(5/6)
    updatedAt: number;
  };
};

export type DaySession = {
  dateKey: string; // YYYY-MM-DD
  hall?: string;
  note?: string;
  plays: Play[];
  updatedAt: number;
};

export type AppState = {
  version: 1;
  sessions: Record<string, DaySession>;
};

/**
 * 設定別分母テーブル（設定1..6）
 * - 値は「1/○○」の○○（分母）
 * - 推測側では p = 1/denom を使う
 */
export type MetricId =
  | "totalBig"
  | "totalReg"
  | "singleBig"
  | "singleReg"
  | "cherryBig"
  | "cherryReg"
  | "grape"
  | "nonOverlapCherry"
  | "midCherryBig";

export type MachineOdds = Partial<Record<MetricId, number[]>>;

export const ODDS: Record<MachineId, MachineOdds> = {
  // ---- マイジャグラーV（あなた提示表） ----
  MYJUG: {
    singleBig: [420.103, 414.785, 404.543, 376.644, 348.596, 341.333],
    singleReg: [655.360, 595.782, 496.485, 404.543, 390.095, 327.680],
    cherryBig: [1365.333, 1365.333, 1365.333, 1365.333, 1337.469, 1129.931],
    cherryReg: [1092.267, 1092.267, 1040.254, 1024.0, 862.316, 762.047],
    grape: [5.910, 5.870, 5.830, 5.800, 5.760, 5.670],
    nonOverlapCherry: [38.10, 38.10, 36.82, 35.62, 35.62, 35.62],
  },

  // ---- ネオアイム（あなた提示表） ----
  IM: {
    totalBig: [273.1, 269.7, 269.7, 259.0, 259.0, 255.0],
    totalReg: [439.8, 399.6, 331.0, 315.1, 255.0, 255.0],
    singleBig: [387.78698, 381.02326, 381.02326, 370.25989, 370.25989, 362.07735],
    singleReg: [636.27184, 569.87826, 471.48201, 445.82313, 362.07735, 362.07735],
    cherryBig: [923.04225, 923.04225, 923.04225, 862.31579, 862.31579, 862.31579],
    cherryReg: [1424.69565, 1337.46939, 1110.77966, 1074.36066, 862.31579, 862.31579],
    grape: [6.02, 6.02, 6.02, 6.02, 6.02, 5.85],
  },

  // ---- ゴージャグ（あなた提示表） ----
  GOGO: {
    totalBig: [259.0, 258.0, 257.0, 254.0, 247.3, 234.9],
    totalReg: [354.2, 332.7, 306.2, 268.6, 247.3, 234.9],
    singleBig: [346.751, 344.926, 343.120, 343.120, 332.670, 316.599],
    singleReg: [471.482, 448.877, 417.427, 362.077, 330.990, 316.599],
    cherryBig: [1024.0, 1024.0, 1024.0, 978.149, 963.765, 910.222],
    cherryReg: [1424.696, 1285.020, 1149.754, 1040.254, 978.149, 910.222],
    grape: [6.25, 6.20, 6.15, 6.07, 6.00, 5.92],
  },

  // ---- ファンキー（あなた提示表） ----
  FUNKY: {
    totalBig: [266.4, 259.0, 256.0, 249.2, 240.1, 219.9],
    totalReg: [439.8, 407.1, 366.1, 322.8, 299.3, 262.1],
    singleBig: [404.54, 397.19, 394.80, 383.25, 374.49, 334.37],
    singleReg: [630.15, 585.14, 512.00, 448.88, 404.54, 352.34],
    cherryBig: [1424.70, 1365.33, 1365.33, 1365.33, 1285.02, 1260.31],
    cherryReg: [1456.36, 1337.47, 1285.02, 1149.75, 1149.75, 1024.00],
    grape: [5.94, 5.93, 5.88, 5.83, 5.80, 5.77],
    // 中段チェリーBIG：1-4 (1/16384), 5-6 (1/10922.7)
    midCherryBig: [16384.0, 16384.0, 16384.0, 16384.0, 10922.7, 10922.7],
  },
};

// ---- ID / 日付ユーティリティ ----
export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function clampInt(x: number, min = 0, max = 1e9): number {
  const v = Math.trunc(Number.isFinite(x) ? x : 0);
  return Math.min(max, Math.max(min, v));
}

export function parseSignedInt(s: string): number {
  const t = (s ?? "").trim();
  if (!t) return 0;
  const v = Number(t);
  if (!Number.isFinite(v)) return 0;
  return Math.trunc(v);
}

export function dateFromKey(key: string): Date {
  // key: YYYY-MM-DD
  const [y, m, d] = key.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
