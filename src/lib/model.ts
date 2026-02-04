export type MachineId = string;

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
