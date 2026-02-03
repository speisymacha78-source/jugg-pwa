export type MachineId = "MYJUG" | "IM";

export const MACHINE_LABEL: Record<MachineId, string> = {
  MYJUG: "マイジャグラーV",
  IM: "SアイムジャグラーEX",
};

export type Checkpoint = {
  id: string;
  ts: number; // unix ms
  gamesTotal: number; // 表示器の累計G
  bigTotal: number;   // 表示器の累計BB
  regTotal: number;   // 表示器の累計RB
};

export type Play = {
  id: string;
  machine: MachineId;
  table?: string;

  // 前任者（開始時点）の累計（表示器）
  baseGamesTotal: number;
  baseBigTotal: number;
  baseRegTotal: number;
  baseDiffTotal?: number; // 前任者の累計差枚（必須ではないが、ブドウ逆算に必要）

  // 最終（やめ時）の累計差枚（表示器）
  finalDiffTotal?: number;

  checkpoints: Checkpoint[];
  createdAt: number;
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
  sessions: Record<string, DaySession>; // dateKey -> session
};

// ---- 確率テーブル（設定1..6） ----
export const ODDS = {
  MYJUG: {
    big: [273.1, 270.8, 266.4, 254.0, 240.1, 229.1],
    reg: [409.6, 385.5, 336.1, 290.0, 268.6, 229.1],
  },
  IM: {
    big: [273.1, 269.7, 269.7, 259.0, 259.0, 255.0],
    reg: [439.8, 399.6, 331.0, 315.1, 255.0, 255.0],
  },
} as const;

// ---- 乱数ID ----
export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function keyFromDate(d: Date): string {
  return todayKey(d);
}

export function clampInt(n: number, min: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.trunc(n));
}

export function parseSignedInt(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace("+", ""));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
