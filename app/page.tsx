"use client";

import { useMemo, useState } from "react";
import initialData from "./next-races.json";
import chukyo from "./chukyo-kinen-2026.json";
import weekly from "./weekly-graded-races-2026.json";
import { formatPrizeMoney, getPrizeMoney } from "./prize-money";

type RaceRow = {
  update: string;
  horse: string;
  next_race: string;
  horse_url: string;
  race_url: string;
};

type DetailRow = {
  ketto_num: string;
  horse: string;
  jockey: string;
  current_yen: number;
  one_year_yen: number;
  two_year_g1_yen: number;
  total_yen: number;
  weight_kg: number | null;
};

type RaceDetail = {
  race: string;
  race_date: string;
  venue: string;
  grade: string;
  distance: string;
  conditions: string;
  full_gate: number;
  registration_count?: number;
  source_url: string;
  calculation_note: string;
  rows: DetailRow[];
};

type RankedRow = DetailRow & { rank: number };
type RankedRace = RaceDetail & { rows: RankedRow[] };

const pageSize = 50;
const detailedRaces: RaceDetail[] = [
  chukyo as RaceDetail,
  ...(weekly.races as RaceDetail[]),
];

const rankedRaces: RankedRace[] = detailedRaces.map((detail) => {
  let previousTotal = -1;
  let competitionRank = 0;
  return {
    ...detail,
    rows: detail.rows.map((row, index) => {
      if (row.total_yen !== previousTotal) competitionRank = index + 1;
      previousTotal = row.total_yen;
      return { ...row, rank: competitionRank };
    }),
  };
});

const rankingByEntry = new Map(
  rankedRaces.flatMap((detail) =>
    detail.rows.map((row) => [`${detail.race}\0${row.horse}`, row] as const),
  ),
);

function allRows(): RaceRow[] {
  const source = initialData.rows as RaceRow[];
  const existing = new Map(source.map((row) => [row.horse, row]));
  const detailedNames = new Set(
    rankedRaces.flatMap((detail) => detail.rows.map((row) => row.horse)),
  );
  const detailedRaceNames = new Set(rankedRaces.map((detail) => detail.race));

  return [
    ...source.filter(
      (row) =>
        !detailedNames.has(row.horse) &&
        !detailedRaceNames.has(row.next_race),
    ),
    ...rankedRaces.flatMap((detail) =>
      detail.rows.map((row) => ({
        update: existing.get(row.horse)?.update ?? "",
        horse: row.horse,
        next_race: detail.race,
        horse_url: `https://db.netkeiba.com/horse/${row.ketto_num}/`,
        race_url: detail.source_url,
      })),
    ),
  ];
}

function money(yen: number) {
  return yen ? formatPrizeMoney(yen) : "0万円";
}

export default function Home() {
  const rows = useMemo(() => allRows(), []);
  const [query, setQuery] = useState("");
  const [race, setRace] = useState("すべて");
  const [newOnly, setNewOnly] = useState(false);
  const [page, setPage] = useState(1);

  const races = useMemo(
    () =>
      [...new Set(rows.map((row) => row.next_race))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ja")),
    [rows],
  );
  const selectedRace = rankedRaces.find((detail) => detail.race === race);
  const detailed = Boolean(selectedRace);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ja");
    const result = rows.filter(
      (row) =>
        (!term ||
          row.horse.toLocaleLowerCase("ja").includes(term) ||
          row.next_race.toLocaleLowerCase("ja").includes(term)) &&
        (race === "すべて" || row.next_race === race) &&
        (!newOnly || row.update === "NEW"),
    );

    return result.sort((a, b) => {
      if (race === "すべて") {
        return (
          a.horse.localeCompare(b.horse, "ja") ||
          a.next_race.localeCompare(b.next_race, "ja")
        );
      }
      const ar = rankingByEntry.get(`${race}\0${a.horse}`);
      const br = rankingByEntry.get(`${race}\0${b.horse}`);
      if (ar && br) {
        return (
          br.total_yen - ar.total_yen ||
          a.horse.localeCompare(b.horse, "ja")
        );
      }
      return (
        (getPrizeMoney(b.horse_url, b.horse)?.yen ?? -1) -
          (getPrizeMoney(a.horse_url, a.horse)?.yen ?? -1) ||
        a.horse.localeCompare(b.horse, "ja")
      );
    });
  }, [newOnly, query, race, rows]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const registrationCount = selectedRace
    ? selectedRace.registration_count ?? selectedRace.rows.length
    : 0;
  const hasExclusions = selectedRace
    ? registrationCount > selectedRace.full_gate
    : false;
  const cutoff = hasExclusions
    ? selectedRace?.rows[selectedRace.full_gate - 1]
    : undefined;

  return (
    <main>
      <header className="siteHeader">
        <div className="headerInner">
          <div className="brand">
            <span className="brandMark">R</span>
            <div>
              <p className="eyebrow">RACE PLANNER</p>
              <p className="brandName">次走予定・出走順位目安</p>
            </div>
          </div>
          <a
            className="sourceLink"
            href={selectedRace?.source_url ?? initialData.source_url}
            target="_blank"
            rel="noreferrer"
          >
            掲載元を開く ↗
          </a>
        </div>
      </header>

      <section className="hero">
        <div className="heroTop">
          <div>
            <p className="kicker">NEXT RACE DIRECTORY</p>
            <h1>次の一戦を、<br />順位の目安まで。</h1>
            <p className="lead">
              次走予定を検索し、対象レースでは収得賞金の加算期間を含めた出走順位の目安を確認できます。
            </p>
          </div>
          <div className="refreshPanel">
            <p>掲載ページ更新</p>
            <strong>{initialData.page_updated}</strong>
            <p className="message">
              次走予定は管理者がGitHub Actionsから更新します。収得賞金はTARGETのローカルデータを使用しています。
            </p>
          </div>
        </div>
        <div className="stats">
          <div><strong>{rows.length}</strong><span>登録</span></div>
          <div><strong>{races.length}</strong><span>予定レース</span></div>
          <div>
            <strong>{selectedRace ? selectedRace.full_gate : rows.filter((row) => row.update === "NEW").length}</strong>
            <span>{selectedRace ? "フルゲート" : "NEW"}</span>
          </div>
        </div>
      </section>

      <section className="content">
        <div className="filterCard">
          <label className="searchField">
            <span>馬名・レース名</span>
            <div className="inputWrap">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="例：CBC賞、フィオライア"
              />
            </div>
          </label>
          <label>
            <span>予定レース</span>
            <select
              value={race}
              onChange={(event) => {
                setRace(event.target.value);
                setPage(1);
              }}
            >
              <option>すべて</option>
              {races.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <div className="sortGuide">
            <span>並び順</span>
            <strong>{race === "すべて" ? "馬名50音順" : "出走順位の目安順"}</strong>
          </div>
          <label className="checkLabel">
            <input
              type="checkbox"
              checked={newOnly}
              onChange={(event) => {
                setNewOnly(event.target.checked);
                setPage(1);
              }}
            />
            <span>NEWのみ</span>
          </label>
        </div>

        {selectedRace && (
          <aside className="raceSummary">
            <div>
              <p className="eyebrow">RACE DETAIL</p>
              <h2>{selectedRace.race} <small>{selectedRace.grade}</small></h2>
              <p>
                {selectedRace.race_date.replaceAll("-", "/")}・{selectedRace.venue}・
                {selectedRace.distance}・{selectedRace.conditions}
              </p>
            </div>
            <div className="cutoff">
              {cutoff ? (
                <>
                  <span>{selectedRace.full_gate}頭目の現時点の目安</span>
                  <strong>{cutoff.horse}・{money(cutoff.total_yen)}</strong>
                </>
              ) : (
                <>
                  <span>登録状況</span>
                  <strong>
                    登録{registrationCount}頭／フルゲート{selectedRace.full_gate}頭
                    {registrationCount < selectedRace.full_gate ? "（全頭出走可能）" : ""}
                  </strong>
                </>
              )}
            </div>
          </aside>
        )}

        <div className="resultBar">
          <p><strong>{filtered.length}</strong>頭を表示</p>
          {(query || race !== "すべて" || newOnly) && (
            <button
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
          <table className={detailed ? "rankingTable" : ""}>
            <thead>
              <tr>
                {detailed ? (
                  <>
                    <th>順位目安</th>
                    <th>馬名</th>
                    <th>想定騎手</th>
                    <th className="numeric">現在</th>
                    <th className="numeric">1年加算</th>
                    <th className="numeric">2年GI加算</th>
                    <th className="numeric totalHead">合計</th>
                    <th className="numeric">斤量</th>
                    <th>次走</th>
                  </>
                ) : (
                  <>
                    <th>更新</th>
                    <th>馬名</th>
                    <th className="numeric">収得賞金（平地）</th>
                    <th>予定レース</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const detail = rankingByEntry.get(`${race}\0${row.horse}`);
                return detailed && detail && selectedRace ? (
                  <tr
                    key={`${row.horse}-${row.next_race}`}
                    className={
                      hasExclusions && detail.rank === selectedRace.full_gate
                        ? "cutoffRow"
                        : ""
                    }
                  >
                    <td><span className="rankBadge">{detail.rank}</span></td>
                    <td><a href={row.horse_url} target="_blank" rel="noreferrer">{row.horse}↗</a></td>
                    <td>{detail.jockey || <span className="unverified">未定</span>}</td>
                    <td className="numeric">{money(detail.current_yen)}</td>
                    <td className="numeric plus">+{money(detail.one_year_yen)}</td>
                    <td className="numeric plus">+{money(detail.two_year_g1_yen)}</td>
                    <td className="numeric totalCell">{money(detail.total_yen)}</td>
                    <td className="numeric">
                      {detail.weight_kg === null ? (
                        <span className="unverified">未発表</span>
                      ) : (
                        <>
                          {detail.weight_kg}kg
                          {selectedRace.race === "中京記念" && (
                            <small className="estimate">目安</small>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <a href={selectedRace.source_url} target="_blank" rel="noreferrer">
                        {selectedRace.race}↗
                      </a>
                    </td>
                  </tr>
                ) : (
                  <tr key={`${row.horse}-${row.next_race}`}>
                    <td>{row.update === "NEW" && <span className="newBadge">NEW</span>}</td>
                    <td><a href={row.horse_url} target="_blank" rel="noreferrer">{row.horse}↗</a></td>
                    <td className="numeric">
                      {getPrizeMoney(row.horse_url, row.horse)
                        ? formatPrizeMoney(getPrizeMoney(row.horse_url, row.horse)!.yen)
                        : <span className="unverified">未取得</span>}
                    </td>
                    <td>
                      {row.race_url ? (
                        <a href={row.race_url} target="_blank" rel="noreferrer">{row.next_race}↗</a>
                      ) : row.next_race}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td className="empty" colSpan={detailed ? 9 : 4}>
                    条件に一致する馬が見つかりません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <nav className="pagination">
            <button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← 前へ</button>
            <span>{currentPage} / {pages}</span>
            <button disabled={currentPage === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>次へ →</button>
          </nav>
        )}

        <p className="notice">
          ※{selectedRace
            ? selectedRace.calculation_note +
              (selectedRace.conditions.includes("ハンデ") && selectedRace.rows.some((row) => row.weight_kg === null)
                ? " ハンデ未発表のため斤量による優先条件はまだ反映していません。"
                : selectedRace.race === "中京記念"
                  ? " 斤量は別定条件から算出した暫定値です。"
                  : "")
            : "掲載情報は出走予定の段階です。取材後・公開後に変更される場合があります。"}
        </p>
      </section>
    </main>
  );
}