import React, { useEffect, useMemo, useState } from "react";
import {
  MACHINE_LABEL,
  uid,
  todayKey,
  clampInt,
  parseSignedInt,
} from "./lib/model";
import type { AppState, DaySession, MachineId, Play } from "./lib/model";
import {
  loadState,
  saveState,
  downloadBackup,
  importBackupFile,
} from "./lib/storage";
import { infer } from "./lib/inference";

type View =
  | { kind: "calendar" }
  | { kind: "day"; dateKey: string }
  | { kind: "play"; dateKey: string; playId: string }
  | { kind: "counter"; dateKey: string; playId: string }
  | { kind: "judge"; dateKey: string; playId: string };

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function normalizeState(state: AppState | null): AppState {
  const now = Date.now();
  const next: AppState = state ?? { version: 1, sessions: {} };

  next.version = 1;
  next.sessions ??= {};

  for (const k of Object.keys(next.sessions)) {
    const s = next.sessions[k];
    if (!s) continue;

    s.dateKey ??= k;
    s.plays ??= [];
    s.updatedAt ??= now;

    for (const p of s.plays) {
      p.id ??= uid("play");
      p.createdAt ??= now;

      p.machine ??= "MYJUG";
      p.baseGamesTotal ??= 0;
      p.baseBigTotal ??= 0;
      p.baseRegTotal ??= 0;
      p.currentGamesTotal ??= p.baseGamesTotal;

      p.bigSingleCount ??= 0;
      p.bigCherryCount ??= 0;
      p.regSingleCount ??= 0;
      p.regCherryCount ??= 0;

      p.grapesCount ??= 0;
      p.cherriesCount ??= 0;

      p.checkpoints ??= [];
    }
  }
  return next;
}

function keyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function bonusTotals(play: Play) {
  const bb = (play.bigSingleCount ?? 0) + (play.bigCherryCount ?? 0);
  const rb = (play.regSingleCount ?? 0) + (play.regCherryCount ?? 0);
  return { bb, rb };
}

function sessionStats(play: Play) {
  const games = Math.max(
    0,
    (play.currentGamesTotal ?? 0) - (play.baseGamesTotal ?? 0)
  );
  const t = bonusTotals(play);
  return { games, big: t.bb, reg: t.rb };
}

/* =========================
   Counter Screen component (UPDATED)
   ========================= */
type BonusPick = "bb" | "rb";

function CounterScreen(props: {
  dateKey: string;
  play: Play;
  onBack: () => void;
  onJudge: () => void;
  onSetGamesTotal: (gamesTotal: number) => void;
  onBump: (d: {
    bigSingle?: number;
    bigCherry?: number;
    regSingle?: number;
    regCherry?: number;
    grape?: number;
    cherry?: number;
  }) => void;
}) {
  const { play, onBack, onJudge, onSetGamesTotal, onBump } = props;

  // ===== 区間（自分が打ち始めてから） =====
  const seg = sessionStats(play);

  const bbSingle = play.bigSingleCount ?? 0;
  const bbCherry = play.bigCherryCount ?? 0;
  const rbSingle = play.regSingleCount ?? 0;
  const rbCherry = play.regCherryCount ?? 0;

  const grapes = play.grapesCount ?? 0;
  const cherries = play.cherriesCount ?? 0;

  const bb = bbSingle + bbCherry;
  const rb = rbSingle + rbCherry;

  const odds = (n: number, g: number) =>
    n > 0 ? `1/${(g / Math.max(1, n)).toFixed(1)}` : "—";

  const segGames = seg.games;

  const bbSingleOdds = segGames > 0 ? odds(bbSingle, segGames) : "—";
  const bbCherryOdds = segGames > 0 ? odds(bbCherry, segGames) : "—";
  const rbSingleOdds = segGames > 0 ? odds(rbSingle, segGames) : "—";
  const rbCherryOdds = segGames > 0 ? odds(rbCherry, segGames) : "—";
  const grapeOdds = segGames > 0 ? odds(grapes, segGames) : "—";
  const cherryOdds = segGames > 0 ? odds(cherries, segGames) : "—";
  const bonusOdds = segGames > 0 ? odds(bb + rb, segGames) : "—";

  const [pick, setPick] = useState<BonusPick | null>(null);

  // ★フラッシュ用（背景ではなく固定オーバーレイで確実に見せる）
  const [flashColor, setFlashColor] = useState<string | null>(null);

  function flashOverlay(color: string) {
    // 連打でも確実に再発火
    setFlashColor(null);
    requestAnimationFrame(() => {
      setFlashColor(color);
      window.setTimeout(() => setFlashColor(null), 70);
    });
  }

  function vibrate(ms: number) {
    try {
      // iOS Safari/PWAは効かないことが多い（効けばラッキー）
      // @ts-ignore
      if (navigator?.vibrate) navigator.vibrate(ms);
    } catch {}
  }

  return (
    <div className="wrap dark">
      {/* ★フラッシュオーバーレイ */}
      {flashColor && (
        <div className="flashOverlay" style={{ backgroundColor: flashColor }} />
      )}

      <Header
        title="カウンター"
        left={
          <button className="btn" onClick={onBack}>
            戻る
          </button>
        }
        right={
          <button className="btn primary" onClick={onJudge}>
            判別
          </button>
        }
      />

      <div className="card counterCard">
        {/* 上段：2000G/12/11 */}
        <div className="counterTop">
          <div className="counterTopLine">
            <span className="counterTopMono">
              {segGames}G/{bb}/{rb}
            </span>
          </div>
        </div>

        {/* 中段：ぶどう/チェリー + 確率 */}
        <div className="counterMid">
          <div className="counterMidRow">
            <div className="midItem">
              <div className="midLabel grape">ブドウ</div>
              <div className="midValue">{grapes}</div>
              <div className="midOdds">{grapeOdds}</div>
            </div>

            <div className="midItem">
              <div className="midLabel cherry">チェリー</div>
              <div className="midValue">{cherries}</div>
              <div className="midOdds">{cherryOdds}</div>
            </div>

            <div className="midItem">
              <div className="midLabel white">合算</div>
              <div className="midValue">{bb + rb}</div>
              <div className="midOdds">{bonusOdds}</div>
            </div>
          </div>

          <div className="counterMidRow smallRow">
            <div className="smallItem">
              <div className="smallKey pink">BB単独</div>
              <div className="smallVal">
                {bbSingle} ({bbSingleOdds})
              </div>
            </div>
            <div className="smallItem">
              <div className="smallKey pink">BB重複</div>
              <div className="smallVal">
                {bbCherry} ({bbCherryOdds})
              </div>
            </div>
          </div>

          <div className="counterMidRow smallRow">
            <div className="smallItem">
              <div className="smallKey yellow">RB単独</div>
              <div className="smallVal">
                {rbSingle} ({rbSingleOdds})
              </div>
            </div>
            <div className="smallItem">
              <div className="smallKey yellow">RB重複</div>
              <div className="smallVal">
                {rbCherry} ({rbCherryOdds})
              </div>
            </div>
          </div>
        </div>

        {/* 下段：ボタン群 */}
        <div className="counterBtns">
          {/* Gは手入力 */}
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="label" style={{ minWidth: 72 }}>
              G(累計)
            </label>
            <input
              className="input"
              inputMode="numeric"
              value={String(play.currentGamesTotal ?? 0)}
              onChange={(e) => {
                const v = clampInt(parseSignedInt(e.target.value), 0, 9999999);
                onSetGamesTotal(v);
              }}
            />
          </div>

          {/* BB / RB / ぶどう / チェリー */}
          <div className="btnGrid">
            <button className="btn bigBtn bb" onClick={() => setPick("bb")}>
              BB
            </button>
            <button className="btn bigBtn rb" onClick={() => setPick("rb")}>
              RB
            </button>

            <button
              className="btn bigBtn grape"
              onClick={() => {
                onBump({ grape: 1 });
                flashOverlay("#7CFF5B"); // ★黄緑
                vibrate(12);
              }}
            >
              ブドウ
            </button>

            <button
              className="btn bigBtn cherry"
              onClick={() => {
                onBump({ cherry: 1 });
                flashOverlay("#ff3b30"); // ★赤
                vibrate(10);
              }}
            >
              チェリー
            </button>
          </div>

          {/* 手入力（ぶどう/チェリーも） */}
          <div className="row" style={{ marginTop: 10 }}>
            <label className="label">手入力</label>
            <div className="inlineInputs">
              <NumBox
                label="ブドウ"
                value={grapes}
                onChange={(v) => onBump({ grape: v - grapes })}
              />
              <NumBox
                label="チェリー"
                value={cherries}
                onChange={(v) => onBump({ cherry: v - cherries })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* BB/RB押下時：単独orチェリー重複を選ぶ */}
      {pick && (
        <Modal title={pick === "bb" ? "BB" : "RB"} onClose={() => setPick(null)}>
          <div className="modalBtns">
            <button
              className="btn modalBtn"
              onClick={() => {
                if (pick === "bb") onBump({ bigSingle: 1 });
                else onBump({ regSingle: 1 });
                setPick(null);
              }}
            >
              単独
            </button>

            <button
              className="btn modalBtn"
              onClick={() => {
                if (pick === "bb") onBump({ bigCherry: 1 });
                else onBump({ regCherry: 1 });
                setPick(null);
              }}
            >
              チェリー重複
            </button>

            <button
              className="btn modalBtn danger"
              onClick={() => {
                // 減算（0未満にしない）— 呼び出し側で clamp
                if (pick === "bb") {
                  if (bbSingle > 0) onBump({ bigSingle: -1 });
                  else if (bbCherry > 0) onBump({ bigCherry: -1 });
                } else {
                  if (rbSingle > 0) onBump({ regSingle: -1 });
                  else if (rbCherry > 0) onBump({ regCherry: -1 });
                }
                setPick(null);
              }}
            >
              -1
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================
   Judge Screen
   ========================= */
function JudgeScreen(props: {
  dateKey: string;
  play: Play;
  onBackToCounter: () => void;
  onBackToPlay: () => void;
  onSaveInference: (cache: NonNullable<Play["inferCache"]>) => void;
}) {
  const { play, onBackToCounter, onBackToPlay, onSaveInference } = props;

  const st = sessionStats(play);
  const diff =
    play.baseDiffTotal != null && play.finalDiffTotal != null
      ? play.finalDiffTotal - play.baseDiffTotal
      : undefined;

  const totals = bonusTotals(play);

  const statsForInfer = {
    segGames: st.games,
    bigSingle: play.bigSingleCount ?? 0,
    bigCherry: play.bigCherryCount ?? 0,
    regSingle: play.regSingleCount ?? 0,
    regCherry: play.regCherryCount ?? 0,
    grapes: play.grapesCount ?? 0,
    nonOverlapCherries: play.cherriesCount ?? 0,
    midCherryBig: play.midCherryBigCount ?? 0,
    totalGames: play.currentGamesTotal ?? 0,
    totalBig: (play.baseBigTotal ?? 0) + totals.bb,
    totalReg: (play.baseRegTotal ?? 0) + totals.rb,
    diff,
  };

  const info = st.games > 0 ? infer(play.machine, statsForInfer) : null;

  // 「判別画面を見た時点の推定」を履歴に残す（簡素表示で使う）
  useEffect(() => {
    if (!info) return;
    const posterior = info.posterior ?? [];
    let bestIdx = 0;
    for (let i = 1; i < posterior.length; i++) {
      if ((posterior[i] ?? 0) > (posterior[bestIdx] ?? 0)) bestIdx = i;
    }
    const cache = {
      mapSetting: bestIdx + 1,
      expectedSetting: info.expectedSetting,
      p4plus: info.p4plus,
      p56: info.p56,
      updatedAt: Date.now(),
    };

    const prev = play.inferCache;
    const same =
      prev &&
      prev.mapSetting === cache.mapSetting &&
      Math.abs(prev.expectedSetting - cache.expectedSetting) < 1e-6 &&
      Math.abs(prev.p4plus - cache.p4plus) < 1e-6 &&
      Math.abs(prev.p56 - cache.p56) < 1e-6;
    if (!same) onSaveInference(cache);
    // play は参照が頻繁に変わるので依存から外す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  return (
    <div className="wrap">
      <Header
        title="設定推測"
        left={
          <button className="btn" onClick={onBackToCounter}>
            カウンターへ
          </button>
        }
        right={
          <button className="btn" onClick={onBackToPlay}>
            台詳細へ
          </button>
        }
      />

      <div className="card">
        <div className="kv">
          <div className="kvRow">
            <div className="kvKey">区間</div>
            <div className="kvVal">
              {st.games}G / BB{st.big} / RB{st.reg}
            </div>
          </div>

          <hr className="hr" />

          <div className="kvRow">
            <div className="kvKey">期待設定</div>
            <div className="kvVal big">
              {info ? info.expectedSetting.toFixed(2) : "—"}
            </div>
          </div>

          <div className="kvRow">
            <div className="kvKey">P(設定4以上)</div>
            <div className="kvVal">
              {info ? `${(info.p4plus * 100).toFixed(1)}%` : "—"}
            </div>
          </div>

          <div className="kvRow">
            <div className="kvKey">P(設定5/6)</div>
            <div className="kvVal">
              {info ? `${(info.p56 * 100).toFixed(1)}%` : "—"}
            </div>
          </div>

          {info?.grapeOddsFromDiff && (
            <>
              <hr className="hr" />
              <div className="kvRow">
                <div className="kvKey">差枚逆算ぶどう</div>
                <div className="kvVal">
                  1/{info.grapeOddsFromDiff.toFixed(2)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {info && (
        <div className="card">
          <div className="titleRow">
            <div className="title">事後確率</div>
          </div>
          <div className="bars">
            {info.posterior.map((p, idx) => (
              <div className="barRow" key={idx}>
                <div className="barLabel">設定{idx + 1}</div>
                <div className="barTrack">
                  <div className="barFill" style={{ width: `${p * 100}%` }} />
                </div>
                <div className="barVal">{(p * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {info && (
        <div className="card">
          <div className="titleRow">
            <div className="title">重み（参考）</div>
          </div>
          <div className="mono" style={{ fontSize: 12, opacity: 0.85 }}>
            {Object.entries(info.weightsUsed)
              .map(([k, v]) => `${k}:${v}`)
              .join(" / ")}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Main App
   ========================= */
export default function App() {
  const [state, setState] = useState<AppState>(() =>
    normalizeState(loadState())
  );
  const [view, setView] = useState<View>({ kind: "calendar" });
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  // カレンダー上で選択した日（簡素表示用）
  const [calendarPick, setCalendarPick] = useState<string | null>(null);

  const dateKey = useMemo(() => {
    if (view.kind === "day") return view.dateKey;
    if (view.kind === "play") return view.dateKey;
    if (view.kind === "counter") return view.dateKey;
    if (view.kind === "judge") return view.dateKey;
    return todayKey();
  }, [view]);

  const session = useMemo(
    () => ensureSession(state, dateKey),
    [state, dateKey]
  );
  const play = useMemo(() => {
    if (
      view.kind === "play" ||
      view.kind === "counter" ||
      view.kind === "judge"
    ) {
      return findPlay(session, view.playId);
    }
    return null;
  }, [session, view]);

  function commit(mutator: (draft: AppState) => void) {
    setState((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      saveState(next);
      return next;
    });
  }

  // ====== Calendar view ======
  if (view.kind === "calendar") {
    const first = startOfMonth(month);
    const startDow = first.getDay(); // 0=Sun
    const cells: { dateKey: string; day: number; inMonth: boolean }[] = [];

    // prev month blanks
    for (let i = 0; i < startDow; i++)
      cells.push({ dateKey: "", day: 0, inMonth: false });

    // days
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    for (let day = 1; day <= last.getDate(); day++) {
      const d = new Date(first.getFullYear(), first.getMonth(), day);
      cells.push({ dateKey: keyFromDate(d), day, inMonth: true });
    }
    while (cells.length % 7 !== 0)
      cells.push({ dateKey: "", day: 0, inMonth: false });

    const pickedKey = calendarPick;
    const pickedSession = pickedKey ? state.sessions[pickedKey] : undefined;

    return (
      <div className="wrap">
        <Header
          title="稼働カレンダー"
          left={
            <button className="btn" onClick={() => setMonth(addMonths(month, -1))}>
              前月
            </button>
          }
          right={
            <button className="btn" onClick={() => setMonth(addMonths(month, 1))}>
              次月
            </button>
          }
        />

        <div className="card">
          <div className="row between">
            <div className="title">
              {first.getFullYear()}年{first.getMonth() + 1}月
            </div>
            <div className="row">
              <button
                className="btn"
                onClick={() => setView({ kind: "day", dateKey: todayKey() })}
              >
                今日
              </button>
            </div>
          </div>

          <div className="grid7">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <div key={w} className="dow">
                {w}
              </div>
            ))}
            {cells.map((c, idx) => (
              <button
                key={idx}
                className={`cell ${c.inMonth ? "" : "blank"} ${
                  c.dateKey === todayKey() ? "today" : ""
                } ${
                  pickedKey && c.dateKey === pickedKey ? "selected" : ""
                }`}
                onClick={() => {
                  if (!c.dateKey) return;
                  setCalendarPick(c.dateKey);
                }}
                disabled={!c.inMonth}
              >
                <div className="cellDay">{c.day || ""}</div>
                {c.dateKey && state.sessions[c.dateKey]?.plays?.length ? (
                  <div className="cellDot">{state.sessions[c.dateKey].plays.length}</div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* 選択日の簡素表示 */}
        {pickedKey ? (
          <div className="card">
            <div className="row between">
              <div>
                <div className="title">{pickedKey}</div>
                <div className="muted">
                  {pickedSession?.plays?.length ? `${pickedSession.plays.length}台` : "稼働なし"}
                </div>
              </div>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => setView({ kind: "day", dateKey: pickedKey })}
                >
                  開く
                </button>
                <button className="btn" onClick={() => setCalendarPick(null)}>
                  ×
                </button>
              </div>
            </div>

            {pickedSession?.plays?.length ? (
              <>
                <hr className="hr" />
                {pickedSession.plays
                  .slice()
                  .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
                  .map((p) => {
                    const seg = sessionStats(p);
                    const cache = p.inferCache;
                    return (
                      <div key={p.id} className="row between" style={{ marginBottom: 8 }}>
                        <div>
                          <div className="title">{MACHINE_LABEL[p.machine] ?? p.machine}</div>
                          <div className="muted">
                            {seg.games}G / BB{seg.big} / RB{seg.reg}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="title">
                            推定{cache ? cache.mapSetting : "—"}
                          </div>
                          <div className="muted">
                            {cache ? `E=${cache.expectedSetting.toFixed(2)} / P4+ ${(cache.p4plus * 100).toFixed(0)}%` : "判別未保存"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </>
            ) : null}
          </div>
        ) : null}

        <div className="card">
          <div className="row between">
            <div className="title">バックアップ</div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => downloadBackup(state)}>
              ダウンロード
            </button>
            <label className="btn">
              インポート
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  importBackupFile(f).then((st) => {
                    if (!st) return;
                    const next = normalizeState(st);
                    setState(next);
                    saveState(next);
                    alert("インポートしました");
                  });
                }}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // ====== Day view ======
  if (view.kind === "day") {
    const s = ensureSession(state, view.dateKey);
    return (
      <div className="wrap">
        <Header
          title={`${view.dateKey}`}
          left={
            <button className="btn" onClick={() => setView({ kind: "calendar" })}>
              カレンダー
            </button>
          }
          right={
            <button
              className="btn primary"
              onClick={() => {
                const newPlay: Play = {
                  id: uid("play"),
                  machine: "MYJUG",
                  baseGamesTotal: 0,
                  baseBigTotal: 0,
                  baseRegTotal: 0,
                  currentGamesTotal: 0,

                  bigSingleCount: 0,
                  bigCherryCount: 0,
                  regSingleCount: 0,
                  regCherryCount: 0,

                  grapesCount: 0,
                  cherriesCount: 0,

                  checkpoints: [],
                  createdAt: Date.now(),
                };

                commit((draft) => {
                  const ss = ensureSession(draft, view.dateKey);
                  ss.plays.push(newPlay);
                  ss.updatedAt = Date.now();
                });

                setView({ kind: "play", dateKey: view.dateKey, playId: newPlay.id });
              }}
            >
              + 台追加
            </button>
          }
        />

        {s.plays.length === 0 ? (
          <div className="card">
            <div className="muted">この日はまだ台がありません。</div>
          </div>
        ) : (
          s.plays.map((p) => {
            const seg = sessionStats(p);
            return (
              <div className="card" key={p.id}>
                <div className="row between">
                  <div>
                    <div className="title">{MACHINE_LABEL[p.machine] ?? p.machine}</div>
                    <div className="muted">
                      区間 {seg.games}G / BB{seg.big} / RB{seg.reg}
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="btn"
                      onClick={() => setView({ kind: "counter", dateKey: view.dateKey, playId: p.id })}
                    >
                      カウンター
                    </button>
                    <button
                      className="btn"
                      onClick={() => setView({ kind: "judge", dateKey: view.dateKey, playId: p.id })}
                    >
                      判別
                    </button>
                    <button
                      className="btn"
                      onClick={() => setView({ kind: "play", dateKey: view.dateKey, playId: p.id })}
                    >
                      詳細
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  // ====== Play details ======
  if (view.kind === "play" && play) {
    return (
      <div className="wrap">
        <Header
          title="台詳細"
          left={
            <button className="btn" onClick={() => setView({ kind: "day", dateKey: view.dateKey })}>
              戻る
            </button>
          }
          right={
            <div className="row">
              <button
                className="btn"
                onClick={() => setView({ kind: "counter", dateKey: view.dateKey, playId: play.id })}
              >
                カウンター
              </button>
              <button
                className="btn"
                onClick={() => setView({ kind: "judge", dateKey: view.dateKey, playId: play.id })}
              >
                判別
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (!confirm("この台を削除しますか？")) return;
                  commit((draft) => {
                    const s = ensureSession(draft, view.dateKey);
                    s.plays = s.plays.filter((x) => x.id !== play.id);
                    s.updatedAt = Date.now();
                  });
                  setView({ kind: "day", dateKey: view.dateKey });
                }}
              >
                削除
              </button>
            </div>
          }
        />

        <div className="card">
          <div className="row">
            <label className="label">機種</label>
            <select
              className="input"
              value={play.machine}
              onChange={(e) => {
                const v = e.target.value as MachineId;
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.machine = v;
                  s.updatedAt = Date.now();
                });
              }}
            >
              <option value="MYJUG">マイジャグラーV</option>
              <option value="IM">SアイムジャグラーEX</option>
              <option value="GOGO">ゴーゴージャグラー</option>
              <option value="FUNKY">ファンキージャグラー</option>
            </select>
          </div>

          <div className="row">
            <label className="label">台番（任意）</label>
            <input
              className="input"
              value={play.table ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.table = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>

          <hr className="hr" />

          <div className="row">
            <label className="label">開始G(累計)</label>
            <input
              className="input"
              inputMode="numeric"
              value={String(play.baseGamesTotal ?? 0)}
              onChange={(e) => {
                const v = clampInt(parseSignedInt(e.target.value), 0, 9999999);
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.baseGamesTotal = v;
                  if ((p.currentGamesTotal ?? 0) < v) p.currentGamesTotal = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>

          <div className="row">
            <label className="label">開始BB(累計)</label>
            <input
              className="input"
              inputMode="numeric"
              value={String(play.baseBigTotal ?? 0)}
              onChange={(e) => {
                const v = clampInt(parseSignedInt(e.target.value), 0, 999999);
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.baseBigTotal = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>

          <div className="row">
            <label className="label">開始RB(累計)</label>
            <input
              className="input"
              inputMode="numeric"
              value={String(play.baseRegTotal ?? 0)}
              onChange={(e) => {
                const v = clampInt(parseSignedInt(e.target.value), 0, 999999);
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.baseRegTotal = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>

          <hr className="hr" />

          <div className="row">
            <label className="label">開始差枚(任意)</label>
            <SignedIntInput
              value={play.baseDiffTotal}
              onCommit={(v) => {
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.baseDiffTotal = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>

          <div className="row">
            <label className="label">最終差枚(任意)</label>
            <SignedIntInput
              value={play.finalDiffTotal}
              onCommit={(v) => {
                commit((draft) => {
                  const s = ensureSession(draft, view.dateKey);
                  const p = findPlay(s, play.id);
                  if (!p) return;
                  p.finalDiffTotal = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="row between">
            <div className="title">メモ</div>
          </div>
          <textarea
            className="textarea"
            value={session.note ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              commit((draft) => {
                const s = ensureSession(draft, view.dateKey);
                s.note = v;
                s.updatedAt = Date.now();
              });
            }}
          />
        </div>
      </div>
    );
  }

  // ====== Counter ======
  if (view.kind === "counter" && play) {
    return (
      <CounterScreen
        dateKey={view.dateKey}
        play={play}
        onBack={() => setView({ kind: "day", dateKey: view.dateKey })}
        onJudge={() =>
          setView({ kind: "judge", dateKey: view.dateKey, playId: play.id })
        }
        onSetGamesTotal={(gamesTotal) => {
          commit((draft) => {
            const s = ensureSession(draft, view.dateKey);
            const p = findPlay(s, play.id);
            if (!p) return;
            p.currentGamesTotal = gamesTotal;
            s.updatedAt = Date.now();
          });
        }}
        onBump={(d) => {
          commit((draft) => {
            const s = ensureSession(draft, view.dateKey);
            const p = findPlay(s, play.id);
            if (!p) return;

            const dec = (x: number, delta: number) => Math.max(0, (x ?? 0) + delta);

            if (d.bigSingle) p.bigSingleCount = dec(p.bigSingleCount ?? 0, d.bigSingle);
            if (d.bigCherry) p.bigCherryCount = dec(p.bigCherryCount ?? 0, d.bigCherry);
            if (d.regSingle) p.regSingleCount = dec(p.regSingleCount ?? 0, d.regSingle);
            if (d.regCherry) p.regCherryCount = dec(p.regCherryCount ?? 0, d.regCherry);
            if (d.grape) p.grapesCount = dec(p.grapesCount ?? 0, d.grape);
            if (d.cherry) p.cherriesCount = dec(p.cherriesCount ?? 0, d.cherry);

            s.updatedAt = Date.now();
          });
        }}
      />
    );
  }

  // ====== Judge ======
  if (view.kind === "judge" && play) {
    return (
      <JudgeScreen
        dateKey={view.dateKey}
        play={play}
        onBackToCounter={() =>
          setView({ kind: "counter", dateKey: view.dateKey, playId: play.id })
        }
        onBackToPlay={() =>
          setView({ kind: "play", dateKey: view.dateKey, playId: play.id })
        }
        onSaveInference={(cache) => {
          commit((draft) => {
            const s = ensureSession(draft, view.dateKey);
            const p = findPlay(s, play.id);
            if (!p) return;
            p.inferCache = cache;
            s.updatedAt = Date.now();
          });
        }}
      />
    );
  }

  return (
    <div className="wrap">
      <div className="card">不正な状態です。</div>
    </div>
  );
}

/* =========================
   UI helpers
   ========================= */
function Header(props: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="header">
      <div className="headerSide">{props.left}</div>
      <div className="headerTitle">{props.title}</div>
      <div className="headerSide right">{props.right}</div>
    </div>
  );
}

function Modal(props: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modalBack" onClick={props.onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitle">{props.title}</div>
          <button className="btn" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="modalBody">{props.children}</div>
      </div>
    </div>
  );
}

function NumBox(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="numBox">
      <div className="numLabel">{props.label}</div>
      <input
        className="input"
        inputMode="numeric"
        value={String(props.value)}
        onChange={(e) => {
          const v = clampInt(parseSignedInt(e.target.value), 0, 9999999);
          props.onChange(v);
        }}
      />
    </div>
  );
}

function SignedIntInput(props: {
  value?: number;
  onCommit: (v?: number) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const [text, setText] = useState<string>(props.value == null ? "" : String(props.value));

  useEffect(() => {
    const next = props.value == null ? "" : String(props.value);
    // ユーザーが入力中に勝手に戻すのを防ぐため、完全一致のときだけ同期
    if (text === next) return;
    // value 変更（別画面から復帰/インポート等）は反映
    setText(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  return (
    <input
      className="input"
      inputMode={props.inputMode ?? "numeric"}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);

        const s = (t ?? "").trim();
        if (s === "") {
          props.onCommit(undefined);
          return;
        }
        if (s === "-") {
          // 途中入力を許可（確定はしない）
          return;
        }
        if (/^-?\d+$/.test(s)) {
          props.onCommit(parseSignedInt(s));
        }
      }}
      onBlur={() => {
        const s = (text ?? "").trim();
        if (s === "" || s === "-") {
          setText("");
          props.onCommit(undefined);
          return;
        }
        if (/^-?\d+$/.test(s)) {
          const v = parseSignedInt(s);
          setText(String(v));
          props.onCommit(v);
        } else {
          // 不正入力は元に戻す
          const back = props.value == null ? "" : String(props.value);
          setText(back);
        }
      }}
    />
  );
}

/* =========================
   State helpers
   ========================= */
function ensureSession(state: AppState, dateKey: string): DaySession {
  state.sessions ??= {};
  if (!state.sessions[dateKey]) {
    state.sessions[dateKey] = {
      dateKey,
      plays: [],
      updatedAt: Date.now(),
    };
  }
  return state.sessions[dateKey];
}

function findPlay(session: DaySession, playId: string): Play | null {
  return session.plays.find((p) => p.id === playId) ?? null;
}
