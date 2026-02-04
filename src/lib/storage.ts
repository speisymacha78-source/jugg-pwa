import type { AppState } from "./model";

const KEY = "jugg_pwa_state_v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, sessions: {} };
    const obj = JSON.parse(raw) as AppState;
    if (!obj || obj.version !== 1 || !obj.sessions) return { version: 1, sessions: {} };
    return obj;
  } catch {
    return { version: 1, sessions: {} };
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function downloadBackup(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jugglog_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importBackupFile(file: File): Promise<AppState> {
  const text = await file.text();
  const obj = JSON.parse(text) as AppState;
  if (!obj || obj.version !== 1 || !obj.sessions) {
    throw new Error("バックアップ形式が違います");
  }
  return obj;
}
