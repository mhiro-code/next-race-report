"use client";

import { useMemo, useState } from "react";
import initialData from "./next-races.json";
import { formatPrizeMoney, prizeMoneyByHorse } from "./prize-money";
import { applyClusterCupRows } from "./cluster-cup";

type RaceRow = {
  update: string;
  horse: string;
  next_race: string;
  horse_url: string;
  race_url: string;
};

type RacePayload = {
  source_url: string;
  page_updated: string;
  retrieved_at: string;
  rows: RaceRow[];
};

const pageSize = 50;

export default function Home() {
  const [data, setData] = useState<RacePayload>({
    ...initialData,
    rows: applyClusterCupRows(initialData.rows),
  });
  const [query, setQuery] = useState("");
  const [race, setRace] = useState("すべて");
  const [newOnly, setNewOnly] = useState(false);
  const [sort, setSort] = useState<"horse" | "race" | "prize">("horse");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  const races = useMemo(
    () =>
      [...new Set(data.rows.map((row) => row.next_race))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ja")),
    [data],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    const rows = data.rows.filter((row) => {
      const matchesQuery =
        !normalized ||
        row.horse.toLocaleLowerCase("ja").includes(normalized) ||
        row.next_race.toLocaleLowerCase("ja").includes(normalized);
      const matchesRace = race === "すべて" || row.next_race === race;
      const matchesNew = !newOnly || row.update === "NEW";
      return matchesQuery && matchesRace && matchesNew;
    });
    return rows.sort((a, b) => {
      if (sort === "horse") return a.horse.localeCompare(b.horse, "ja");
      if (sort === "prize") {
        const difference =
          (prizeMoneyByHorse[b.horse]?.yen ?? -1) -
          (prizeMoneyByHorse[a.horse]?.yen ?? -1);
        return difference || a.horse.localeCompare(b.horse, "ja");
      }
      return (
        a.next_race.localeCompare(b.next_race, "ja") ||
        a.horse.localeCompare(b.horse, "ja")
      );
    });
  }, [data, newOnly, query, race, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const displayed = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const newCount = data.rows.filter((row) => row.update === "NEW").length;
  const raceCount = new Set(data.rows.map((row) => row.next_race)).size;
  const verifiedCount = data.rows.filter((row) => prizeMoneyByHorse[row.horse]).length;

  function resetPage() {
    setPage(1);
  }

  async function refreshData() {
    setRefreshing(true);
    setMessage("");
    try {
      const response = await fetch("/api/next-races", { cache: "no-store" });
      if (!response.ok) throw new Error("refresh failed");
      const next = (await response.json()) as RacePayload;
      setData({ ...next, rows: applyClusterCupRows(next.rows) });
      setRace("すべて");
      setPage(1);
      setMessage(`${next.rows.length}頭の最新情報を取得しました`);
    } catch {
      setMessage("最新情報を取得できませんでした。時間を置いて再度お試しください。");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main>
      <header className="siteHeader">
        <div className="headerInner">
          <div className="brand">
            <span className="brandMark">R</span>
            <div>
              <p className="eyebrow">RACE PLANNER</p>
              <p className="brandName">古馬 次走予定</p>
            </div>
          </div>
          <a
            className="sourceLink"
            href={data.source_url}
            target="_blank"
            rel="noreferrer"
          >
            掲載元を開く <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <section className="hero">
        <div className="heroTop">
          <div>
            <p className="kicker">NEXT RACE DIRECTORY</p>
            <h1>次の一戦を、<br />すぐ見つける。</h1>
            <p className="lead">
              netkeiba「次走想定（古馬）」を、検索・レース絞り込みに対応した一覧で確認できます。
            </p>
          </div>
          <div className="refreshPanel">
            <p>掲載ページ更新</p>
            <strong>{data.page_updated}</strong>
            <button type="button" onClick={refreshData} disabled={refreshing}>
              <span className={refreshing ? "spin" : ""} aria-hidden="true">↻</span>
              {refreshing ? "取得中…" : "最新データを再取得"}
            </button>
            {message && <p className="message" role="status">{message}</p>}
          </div>
        </div>

        <div className="stats" aria-label="データ概要">
          <div><strong>{data.rows.length}</strong><span>登録馬</span></div>
          <div><strong>{raceCount}</strong><span>予定レース</span></div>
          <div><strong>{newCount}</strong><span>NEW</span></div>
        </div>
      </section>

      <section className="content">
        <div className="filterCard">
          <label className="searchField">
            <span>馬名・レース名</span>
            <div className="inputWrap">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetPage();
                }}
                placeholder="例：札幌記念、メイショウタバル"
              />
            </div>
          </label>
          <label>
            <span>予定レース</span>
            <select
              value={race}
              onChange={(event) => {
                setRace(event.target.value);
                resetPage();
              }}
            >
              <option>すべて</option>
              {races.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>並び順</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as "horse" | "race" | "prize");
                resetPage();
              }}
            >
              <option value="horse">馬名順</option>
              <option value="race">レース名順</option>
              <option value="prize">収得賞金の高い順</option>
            </select>
          </label>
          <label className="checkLabel">
            <input
              type="checkbox"
              checked={newOnly}
              onChange={(event) => {
                setNewOnly(event.target.checked);
                resetPage();
              }}
            />
            <span>NEWのみ</span>
          </label>
        </div>

        <div className="resultBar">
          <p><strong>{filtered.length}</strong>頭を表示</p>
          <p className="verification">
            JRA公式照合済み <strong>{verifiedCount}</strong> / {data.rows.length}頭
          </p>
          {(query || race !== "すべて" || newOnly) && (
            <button
              type="button"
              className="clearButton"
              onClick={() => {
                setQuery("");
                setRace("すべて");
                setNewOnly(false);
                setPage(1);
              }}
            >
              条件をクリア
            </button>
          )}
        </div>

        <div className="tableCard">
          <table>
            <thead>
              <tr>
                <th>更新</th>
                <th>馬名</th>
                <th className="prizeHeader">収得賞金（平地）</th>
                <th>予定レース</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((row) => (
                <tr key={`${row.horse}-${row.next_race}`}>
                  <td>{row.update === "NEW" && <span className="newBadge">NEW</span>}</td>
                  <td>
                    <a href={row.horse_url} target="_blank" rel="noreferrer">
                      {row.horse}<span aria-hidden="true">↗</span>
                    </a>
                  </td>
                  <td className="prizeCell">
                    {prizeMoneyByHorse[row.horse] ? (
                      <a
                        href={prizeMoneyByHorse[row.horse].jraUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`JRA公式・${prizeMoneyByHorse[row.horse].verifiedAt}確認`}
                      >
                        {formatPrizeMoney(prizeMoneyByHorse[row.horse].yen)}
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="unverified">未取得</span>
                    )}
                  </td>
                  <td>
                    {row.race_url ? (
                      <a href={row.race_url} target="_blank" rel="noreferrer">
                        {row.next_race}<span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      row.next_race
                    )}
                  </td>
                </tr>
              ))}
              {displayed.length === 0 && (
                <tr><td className="empty" colSpan={4}>条件に一致する馬が見つかりません。</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <nav className="pagination" aria-label="ページ送り">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              ← 前へ
            </button>
            <span>{currentPage} / {totalPages}</span>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              次へ →
            </button>
          </nav>
        )}

        <p className="notice">
          ※掲載情報は出走予定の段階です。取材後・公開後に変更される場合があります。
        </p>
      </section>
    </main>
  );
}
