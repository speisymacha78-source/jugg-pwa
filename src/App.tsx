import React, { useMemo, useState } from "react";
import {
  MACHINE_LABEL,
  uid,
  todayKey,
  keyFromDate,
  clampInt,
  parseSignedInt,
} from "./lib/model";
import type { AppState, DaySession, MachineId, Play, Checkpoint } from "./lib/model";

import { loadState, saveState, downloadBackup, importBackupFile } from "./lib/storage";
import { infer } from "./lib/inference";

type View =
  | { kind: "calendar" }
  | { kind: "day"; dateKey: string }
  | { kind: "play"; dateKey: string; playId: string };

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function weekdaySun0(d: Date) {
  return d.getDay(); // 0=Sun
}

function ensureSession(state: AppState, dateKey: string): DaySession {
  const existing = state.sessions[dateKey];
  if (existing) return existing;
  const s: DaySession = { dateKey, hall: "", note: "", plays: [], updatedAt: Date.now() };
  state.sessions[dateKey] = s;
  return s;
}

function findPlay(session: DaySession, playId: string): Play | undefined {
  return session.plays.find((p) => p.id === playId);
}

function latestCheckpoint(play: Play): Checkpoint | undefined {
  if (!play.checkpoints.length) return undefined;
  return [...play.checkpoints].sort((a, b) => a.ts - b.ts)[play.checkpoints.length - 1];
}

function adjustedStats(play: Play) {
  const latest = latestCheckpoint(play);
  if (!latest) return null;

  const games = Math.max(0, latest.gamesTotal - play.baseGamesTotal);
  const big = Math.max(0, latest.bigTotal - play.baseBigTotal);
  const reg = Math.max(0, latest.regTotal - play.baseRegTotal);

  let diff: number | undefined = undefined;
  if (play.baseDiffTotal != null && play.finalDiffTotal != null) {
    diff = play.finalDiffTotal - play.baseDiffTotal;
  }

  return { games, big, reg, diff };
}

function formatPct(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [view, setView] = useState<View>({ kind: "calendar" });

  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));

  function commit(mutator: (draft: AppState) => void) {
    setState((prev) => {
      const next: AppState = structuredClone(prev);
      mutator(next);
      saveState(next);
      return next;
    });
  }

  const sessions = state.sessions;

  const monthGrid = useMemo(() => {
    const first = startOfMonth(monthAnchor);
    const dim = daysInMonth(first);
    const lead = weekdaySun0(first); // 0..6
    const cells: Array<{ dateKey: string; day: number; inMonth: boolean }> = [];

    // leading blanks
    for (let i = 0; i < lead; i++) {
      cells.push({ dateKey: "", day: 0, inMonth: false });
    }
    for (let day = 1; day <= dim; day++) {
      const d = new Date(first.getFullYear(), first.getMonth(), day);
      cells.push({ dateKey: keyFromDate(d), day, inMonth: true });
    }
    // trailing to full weeks
    while (cells.length % 7 !== 0) cells.push({ dateKey: "", day: 0, inMonth: false });
    return cells;
  }, [monthAnchor]);

  // ---- View render ----

  if (view.kind === "calendar") {
    const y = monthAnchor.getFullYear();
    const m = monthAnchor.getMonth() + 1;

    return (
      <div className="wrap">
        <Header
          title={`稼働カレンダー ${y}-${String(m).padStart(2, "0")}`}
          right={
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setMonthAnchor(addMonths(monthAnchor, -1))}>前月</button>
              <button className="btn" onClick={() => setMonthAnchor(addMonths(monthAnchor, 1))}>次月</button>
              <button className="btn" onClick={() => setMonthAnchor(startOfMonth(new Date()))}>今月</button>
            </div>
          }
        />

        <div className="card">
          <div className="dow">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <div key={w} className="dowCell">{w}</div>
            ))}
          </div>

          <div className="grid">
            {monthGrid.map((c, idx) => {
              if (!c.inMonth) return <div key={idx} className="cell empty" />;
              const has = sessions[c.dateKey]?.plays?.length > 0;
              return (
                <button
                  key={c.dateKey}
                  className={`cell ${has ? "has" : ""}`}
                  onClick={() => setView({ kind: "day", dateKey: c.dateKey })}
                >
                  <div className="dayNum">{c.day}</div>
                  {has && <div className="dot" />}
                </button>
              );
            })}
          </div>
        </div>

        <Footer
          onBackup={() => downloadBackup(state)}
          onImport={(file) => {
            importBackupFile(file)
              .then((st) => {
                setState(st);
                saveState(st);
                setView({ kind: "calendar" });
              })
              .catch((e) => alert(String(e?.message ?? e)));
          }}
          onGoToday={() => setView({ kind: "day", dateKey: todayKey() })}
        />
      </div>
    );
  }

  if (view.kind === "day") {
    const dateKey = view.dateKey;
    const session = sessions[dateKey] ?? { dateKey, hall: "", note: "", plays: [], updatedAt: 0 };
    
    return (
      <div className="wrap">
        <Header
          title={`日付 ${dateKey}`}
          left={<button className="btn" onClick={() => setView({ kind: "calendar" })}>戻る</button>}
          right={<button className="btn primary" onClick={() => {
            commit((draft) => {
              const s = ensureSession(draft, dateKey);
              const p: Play = {
                id: uid("play"),
                machine: "MYJUG",
                table: "",
                baseGamesTotal: 0,
                baseBigTotal: 0,
                baseRegTotal: 0,
                baseDiffTotal: undefined,
                finalDiffTotal: undefined,
                checkpoints: [],
                createdAt: Date.now(),
              };
              s.plays.push(p);
              s.updatedAt = Date.now();
            });
          }}>台を追加</button>}
        />

        <div className="card">
          <div className="row">
            <label className="label">ホール（任意）</label>
            <input
              className="input"
              value={session.hall ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                commit((draft) => {
                  const s = ensureSession(draft, dateKey);
                  s.hall = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>

          <div className="row">
            <label className="label">メモ（任意）</label>
            <input
              className="input"
              value={session.note ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                commit((draft) => {
                  const s = ensureSession(draft, dateKey);
                  s.note = v;
                  s.updatedAt = Date.now();
                });
              }}
            />
          </div>
        </div>

        <div className="card">
          <h3 className="h3">台一覧</h3>
          {session.plays.length === 0 ? (
            <div className="muted">まだ台がありません。「台を追加」を押してください。</div>
          ) : (
            <div className="list">
              {session.plays.map((p) => {
                const adj = adjustedStats(p);
                const info = adj ? infer(p.machine, adj) : null;

                return (
                  <button
                    key={p.id}
                    className="listItem"
                    onClick={() => setView({ kind: "play", dateKey, playId: p.id })}
                  >
                    <div className="liMain">
                      <div className="liTitle">
                        {MACHINE_LABEL[p.machine]}
                        {p.table ? ` / 台番 ${p.table}` : ""}
                      </div>
                      <div className="liSub">
                        {adj ? (
                          <>
                            {adj.games}G BB{adj.big} RB{adj.reg}
                            {" / 期待設定 "}
                            {info ? info.expectedSetting.toFixed(2) : "—"}
                          </>
                        ) : (
                          "チェックポイント未入力"
                        )}
                      </div>
                    </div>
                    <div className="liRight">→</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="muted">
            iPhoneで使うとき：同じWi-Fiに接続して、このPCのアドレスにアクセスします（手順は後述）。
          </div>
        </div>
      </div>
    );
  }

  // play view
  const dateKey = view.dateKey;
  const session = sessions[dateKey];
  if (!session) {
    return (
      <div className="wrap">
        <Header title="エラー" left={<button className="btn" onClick={() => setView({ kind: "calendar" })}>戻る</button>} />
        <div className="card">この日付のデータがありません。</div>
      </div>
    );
  }

  const play = findPlay(session, view.playId);
  if (!play) {
    return (
      <div className="wrap">
        <Header title="エラー" left={<button className="btn" onClick={() => setView({ kind: "day", dateKey })}>戻る</button>} />
        <div className="card">この台が見つかりません。</div>
      </div>
    );
  }

  const adj = adjustedStats(play);
  const info = adj ? infer(play.machine, adj) : null;
  const latest = latestCheckpoint(play);

  return (
    <div className="wrap">
      <Header
        title="台詳細"
        left={<button className="btn" onClick={() => setView({ kind: "day", dateKey })}>戻る</button>}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => {
              if (!confirm("この台を削除しますか？")) return;
              commit((draft) => {
                const s = ensureSession(draft, dateKey);
                s.plays = s.plays.filter((x) => x.id !== play.id);
                s.updatedAt = Date.now();
              });
              setView({ kind: "day", dateKey });
            }}>削除</button>
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
                const s = ensureSession(draft, dateKey);
                const p = findPlay(s, play.id);
                if (!p) return;
                p.machine = v;
                s.updatedAt = Date.now();
              });
            }}
          >
            <option value="MYJUG">マイジャグラーV</option>
            <option value="IM">SアイムジャグラーEX</option>
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
                const s = ensureSession(draft, dateKey);
                const p = findPlay(s, play.id);
                if (!p) return;
                p.table = v;
                s.updatedAt = Date.now();
              });
            }}
          />
        </div>
      </div>

      <div className="card">
        <h3 className="h3">前任者データ（開始時点の累計）</h3>
        <BaseEditor
          play={play}
          onSave={(next) => {
            commit((draft) => {
              const s = ensureSession(draft, dateKey);
              const p = findPlay(s, play.id);
              if (!p) return;
              Object.assign(p, next);
              s.updatedAt = Date.now();
            });
          }}
        />
      </div>

      <div className="card">
        <h3 className="h3">途中経過（G/BB/RB）</h3>
        <CheckpointEditor
          play={play}
          onAdd={(cp) => {
            commit((draft) => {
              const s = ensureSession(draft, dateKey);
              const p = findPlay(s, play.id);
              if (!p) return;
              p.checkpoints.push(cp);
              s.updatedAt = Date.now();
            });
          }}
        />

        <div className="list" style={{ marginTop: 10 }}>
          {play.checkpoints
            .slice()
            .sort((a, b) => a.ts - b.ts)
            .map((cp) => (
              <div key={cp.id} className="listItem static">
                <div className="liMain">
                  <div className="liTitle">{new Date(cp.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="liSub">{cp.gamesTotal}G BB{cp.bigTotal} RB{cp.regTotal}</div>
                </div>
              </div>
            ))}
          {play.checkpoints.length === 0 && <div className="muted">まだ入力がありません。</div>}
        </div>
      </div>

      <div className="card">
        <h3 className="h3">最終差枚（累計）</h3>
        <FinalDiffEditor
          play={play}
          onSave={(finalDiffTotal) => {
            commit((draft) => {
              const s = ensureSession(draft, dateKey);
              const p = findPlay(s, play.id);
              if (!p) return;
              p.finalDiffTotal = finalDiffTotal;
              s.updatedAt = Date.now();
            });
          }}
        />
      </div>

      <div className="card">
        <h3 className="h3">結果（あなたの区間）</h3>

        {latest ? (
          <div className="kv">
            <div className="kvRow">
              <div className="kvKey">最新（累計）</div>
              <div className="kvVal">{latest.gamesTotal}G BB{latest.bigTotal} RB{latest.regTotal}</div>
            </div>
            <div className="kvRow">
              <div className="kvKey">区間（現在−前任者）</div>
              <div className="kvVal">
                {adj ? `${adj.games}G BB${adj.big} RB${adj.reg}` : "—"}
              </div>
            </div>

            <hr className="hr" />

            <div className="kvRow">
              <div className="kvKey">期待設定</div>
              <div className="kvVal big">{info ? info.expectedSetting.toFixed(2) : "—"}</div>
            </div>
            <div className="kvRow">
              <div className="kvKey">P(設定4以上)</div>
              <div className="kvVal">{info ? formatPct(info.p4plus) : "—"}</div>
            </div>
            <div className="kvRow">
              <div className="kvKey">P(設定5/6)</div>
              <div className="kvVal">{info ? formatPct(info.p56) : "—"}</div>
            </div>

            <hr className="hr" />

            <div className="kvRow">
              <div className="kvKey">ブドウ逆算（差枚）</div>
              <div className="kvVal">
                {info?.grapeOddsFromDiff
                  ? `1/${info.grapeOddsFromDiff.toFixed(2)}`
                  : "前任者差枚 と 最終差枚 が揃うと計算できます（または推定不能）"}
              </div>
            </div>
            {info?.grapeCoinsFromDiff != null && (
              <div className="kvRow">
                <div className="kvKey">ぶどう獲得枚数(逆算)</div>
                <div className="kvVal">{info.grapeCoinsFromDiff.toFixed(2)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="muted">まず途中経過を1回入力してください。</div>
        )}
      </div>

      <Footer
        onBackup={() => downloadBackup(state)}
        onImport={(file) => {
          importBackupFile(file)
            .then((st) => {
              setState(st);
              saveState(st);
              setView({ kind: "calendar" });
            })
            .catch((e) => alert(String(e?.message ?? e)));
        }}
        onGoToday={() => setView({ kind: "day", dateKey: todayKey() })}
      />
    </div>
  );
}

function Header(props: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="header">
      <div className="hLeft">{props.left}</div>
      <div className="hTitle">{props.title}</div>
      <div className="hRight">{props.right}</div>
    </div>
  );
}

function Footer(props: { onBackup: () => void; onImport: (file: File) => void; onGoToday: () => void }) {
  return (
    <div className="footer">
      <button className="btn" onClick={props.onGoToday}>今日へ</button>
      <button className="btn" onClick={props.onBackup}>バックアップ保存(JSON)</button>
      <label className="btn">
        バックアップ読込(JSON)
        <input
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            props.onImport(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function BaseEditor(props: { play: Play; onSave: (next: Partial<Play>) => void }) {
  const p = props.play;
  const [baseG, setBaseG] = useState(String(p.baseGamesTotal ?? 0));
  const [baseBB, setBaseBB] = useState(String(p.baseBigTotal ?? 0));
  const [baseRB, setBaseRB] = useState(String(p.baseRegTotal ?? 0));
  const [baseDiff, setBaseDiff] = useState(p.baseDiffTotal != null ? String(p.baseDiffTotal) : "");

  return (
    <>
      <div className="row">
        <label className="label">前任者G（累計）</label>
        <input className="input" value={baseG} onChange={(e) => setBaseG(e.target.value)} inputMode="numeric" />
      </div>
      <div className="row">
        <label className="label">前任者BB（累計）</label>
        <input className="input" value={baseBB} onChange={(e) => setBaseBB(e.target.value)} inputMode="numeric" />
      </div>
      <div className="row">
        <label className="label">前任者RB（累計）</label>
        <input className="input" value={baseRB} onChange={(e) => setBaseRB(e.target.value)} inputMode="numeric" />
      </div>
      <div className="row">
        <label className="label">前任者差枚（累計）</label>
        <input className="input" value={baseDiff} onChange={(e) => setBaseDiff(e.target.value)} inputMode="text" />
      </div>
      <div className="muted">
        ブドウ逆算（差枚）には「前任者差枚」と「最終差枚」が必要です。差枚は表示器の累計値を入れてください。
      </div>

      <div style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          onClick={() => {
            const next = {
              baseGamesTotal: clampInt(Number(baseG), 0),
              baseBigTotal: clampInt(Number(baseBB), 0),
              baseRegTotal: clampInt(Number(baseRB), 0),
              baseDiffTotal: parseSignedInt(baseDiff) ?? undefined,
            };
            props.onSave(next);
          }}
        >
          保存
        </button>
      </div>
    </>
  );
}

function CheckpointEditor(props: { play: Play; onAdd: (cp: Checkpoint) => void }) {
  const latest = latestCheckpoint(props.play);

  const [g, setG] = useState(latest ? String(latest.gamesTotal) : "");
  const [b, setB] = useState(latest ? String(latest.bigTotal) : "");
  const [r, setR] = useState(latest ? String(latest.regTotal) : "");

  return (
    <>
      <div className="row">
        <label className="label">累計G（表示器）</label>
        <input className="input" value={g} onChange={(e) => setG(e.target.value)} inputMode="numeric" />
      </div>
      <div className="row">
        <label className="label">累計BB（表示器）</label>
        <input className="input" value={b} onChange={(e) => setB(e.target.value)} inputMode="numeric" />
      </div>
      <div className="row">
        <label className="label">累計RB（表示器）</label>
        <input className="input" value={r} onChange={(e) => setR(e.target.value)} inputMode="numeric" />
      </div>

      <div className="muted">
        途中経過は何回入れてもOK。差枚はここでは入力しません（最終だけ入力）。
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button
          className="btn primary"
          onClick={() => {
            const gamesTotal = clampInt(Number(g), 0);
            const bigTotal = clampInt(Number(b), 0);
            const regTotal = clampInt(Number(r), 0);

            props.onAdd({
              id: uid("cp"),
              ts: Date.now(),
              gamesTotal,
              bigTotal,
              regTotal,
            });
          }}
          disabled={g.trim() === "" || b.trim() === "" || r.trim() === ""}
        >
          追加
        </button>

        <button
          className="btn"
          onClick={() => {
            if (!latest) return;
            setG(String(latest.gamesTotal));
            setB(String(latest.bigTotal));
            setR(String(latest.regTotal));
          }}
          disabled={!latest}
        >
          最新値を再表示
        </button>
      </div>
    </>
  );
}

function FinalDiffEditor(props: { play: Play; onSave: (finalDiffTotal?: number) => void }) {
  const [v, setV] = useState(props.play.finalDiffTotal != null ? String(props.play.finalDiffTotal) : "");

  return (
    <>
      <div className="row">
        <label className="label">最終差枚（累計）</label>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} inputMode="text" />
      </div>

      <div className="muted">
        やめ時に1回入力。ブドウ逆算（差枚）は「前任者差枚」と「最終差枚」が揃うと計算します。
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn primary" onClick={() => props.onSave(parseSignedInt(v) ?? undefined)}>保存</button>
        <button className="btn" onClick={() => { setV(""); props.onSave(undefined); }}>クリア</button>
      </div>
    </>
  );
}

export default App;
