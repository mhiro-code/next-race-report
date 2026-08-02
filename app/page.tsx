"use client";

import { useMemo, useState } from "react";
import initialData from "./next-races.json";
import chukyo from "./chukyo-kinen-2026.json";
import { formatPrizeMoney, getPrizeMoney } from "./prize-money";

type RaceRow = { update: string; horse: string; next_race: string; horse_url: string; race_url: string };
type RankingRow = (typeof chukyo.rows)[number] & { rank: number };
const pageSize = 50;
let previousTotal = -1;
let competitionRank = 0;
const rankingByHorse = new Map(chukyo.rows.map((row, index) => {
  if (row.total_yen !== previousTotal) competitionRank = index + 1;
  previousTotal = row.total_yen;
  return [row.horse, { ...row, rank: competitionRank }];
}));

function allRows(): RaceRow[] {
  const source = initialData.rows as RaceRow[];
  const existing = new Map(source.map((row) => [row.horse, row]));
  const specialNames = new Set(chukyo.rows.map((row) => row.horse));
  return [
    ...source.filter((row) => !specialNames.has(row.horse) && row.next_race !== chukyo.race),
    ...chukyo.rows.map((row) => ({
      update: existing.get(row.horse)?.update ?? "",
      horse: row.horse,
      next_race: chukyo.race,
      horse_url: `https://db.netkeiba.com/horse/${row.ketto_num}/`,
      race_url: chukyo.source_url,
    })),
  ];
}

function money(yen: number) { return yen ? formatPrizeMoney(yen) : "0万円"; }

export default function Home() {
  const rows = useMemo(allRows, []);
  const [query, setQuery] = useState("");
  const [race, setRace] = useState("すべて");
  const [newOnly, setNewOnly] = useState(false);
  const [page, setPage] = useState(1);
  const races = useMemo(() => [...new Set(rows.map((row) => row.next_race))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"ja")), [rows]);
  const detailed = race === chukyo.race;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ja");
    const result = rows.filter((row) =>
      (!term || row.horse.toLocaleLowerCase("ja").includes(term) || row.next_race.toLocaleLowerCase("ja").includes(term)) &&
      (race === "すべて" || row.next_race === race) && (!newOnly || row.update === "NEW"));
    return result.sort((a,b) => {
      if (race === "すべて") return a.horse.localeCompare(b.horse,"ja");
      const ar = rankingByHorse.get(a.horse); const br = rankingByHorse.get(b.horse);
      if (ar && br) return br.total_yen - ar.total_yen || a.horse.localeCompare(b.horse,"ja");
      return (getPrizeMoney(b.horse_url,b.horse)?.yen ?? -1) - (getPrizeMoney(a.horse_url,a.horse)?.yen ?? -1) || a.horse.localeCompare(b.horse,"ja");
    });
  }, [newOnly, query, race, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((Math.min(page,pages)-1)*pageSize, Math.min(page,pages)*pageSize);
  const cutoff = chukyo.rows[chukyo.full_gate - 1];

  return <main>
    <header className="siteHeader"><div className="headerInner"><div className="brand"><span className="brandMark">R</span><div><p className="eyebrow">RACE PLANNER</p><p className="brandName">次走予定・出走順位目安</p></div></div><a className="sourceLink" href={detailed ? chukyo.source_url : initialData.source_url} target="_blank" rel="noreferrer">掲載元を開く ↗</a></div></header>
    <section className="hero"><div className="heroTop"><div><p className="kicker">NEXT RACE DIRECTORY</p><h1>次の一戦を、<br/>順位の目安まで。</h1><p className="lead">次走予定を検索し、対象レースでは収得賞金の加算期間を含めた出走順位の目安を確認できます。</p></div><div className="refreshPanel"><p>掲載ページ更新</p><strong>{initialData.page_updated}</strong><p className="message">次走予定は管理者がGitHub Actionsから更新します。収得賞金はTARGETのローカルデータを使用しています。</p></div></div><div className="stats"><div><strong>{rows.length}</strong><span>登録馬</span></div><div><strong>{races.length}</strong><span>予定レース</span></div><div><strong>{detailed ? chukyo.full_gate : rows.filter(r=>r.update==="NEW").length}</strong><span>{detailed ? "フルゲート" : "NEW"}</span></div></div></section>
    <section className="content">
      <div className="filterCard"><label className="searchField"><span>馬名・レース名</span><div className="inputWrap"><span>⌕</span><input value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}} placeholder="例：中京記念、ラヴァンダ"/></div></label><label><span>予定レース</span><select value={race} onChange={e=>{setRace(e.target.value);setPage(1)}}><option>すべて</option>{races.map(name=><option key={name}>{name}</option>)}</select></label><div className="sortGuide"><span>並び順</span><strong>{race === "すべて" ? "馬名50音順" : "出走順位の目安順"}</strong></div><label className="checkLabel"><input type="checkbox" checked={newOnly} onChange={e=>{setNewOnly(e.target.checked);setPage(1)}}/><span>NEWのみ</span></label></div>
      {detailed && <aside className="raceSummary"><div><p className="eyebrow">RACE DETAIL</p><h2>{chukyo.race} <small>{chukyo.grade}</small></h2><p>{chukyo.race_date.replaceAll("-","/")}・{chukyo.venue}・{chukyo.distance}・{chukyo.conditions}</p></div><div className="cutoff"><span>16頭なら現時点の目安</span><strong>{cutoff.horse}・{money(cutoff.total_yen)}</strong></div></aside>}
      <div className="resultBar"><p><strong>{filtered.length}</strong>頭を表示</p>{(query||race!=="すべて"||newOnly)&&<button className="clearButton" onClick={()=>{setQuery("");setRace("すべて");setNewOnly(false);setPage(1)}}>条件をクリア</button>}</div>
      <div className="tableCard"><table className={detailed?"rankingTable":""}><thead><tr>{detailed ? <><th>順位目安</th><th>馬名</th><th>想定騎手</th><th className="numeric">現在</th><th className="numeric">1年加算</th><th className="numeric">2年GI加算</th><th className="numeric totalHead">合計</th><th className="numeric">斤量</th><th>次走</th></> : <><th>更新</th><th>馬名</th><th className="numeric">収得賞金（平地）</th><th>予定レース</th></>}</tr></thead><tbody>
        {shown.map(row=>{const detail=rankingByHorse.get(row.horse) as RankingRow|undefined; return detailed && detail ? <tr key={row.horse} className={detail.rank===chukyo.full_gate?"cutoffRow":""}><td><span className="rankBadge">{detail.rank}</span></td><td><a href={row.horse_url} target="_blank" rel="noreferrer">{row.horse}↗</a></td><td>{detail.jockey||<span className="unverified">未定</span>}</td><td className="numeric">{money(detail.current_yen)}</td><td className="numeric plus">+{money(detail.one_year_yen)}</td><td className="numeric plus">+{money(detail.two_year_g1_yen)}</td><td className="numeric totalCell">{money(detail.total_yen)}</td><td className="numeric">{detail.weight_kg}kg<small className="estimate">目安</small></td><td><a href={chukyo.source_url} target="_blank" rel="noreferrer">{chukyo.race}↗</a></td></tr> : <tr key={`${row.horse}-${row.next_race}`}><td>{row.update==="NEW"&&<span className="newBadge">NEW</span>}</td><td><a href={row.horse_url} target="_blank" rel="noreferrer">{row.horse}↗</a></td><td className="numeric">{getPrizeMoney(row.horse_url,row.horse)?formatPrizeMoney(getPrizeMoney(row.horse_url,row.horse)!.yen):<span className="unverified">未取得</span>}</td><td>{row.race_url?<a href={row.race_url} target="_blank" rel="noreferrer">{row.next_race}↗</a>:row.next_race}</td></tr>})}
        {!shown.length&&<tr><td className="empty" colSpan={detailed?9:4}>条件に一致する馬が見つかりません。</td></tr>}
      </tbody></table></div>
      {pages>1&&<nav className="pagination"><button disabled={page===1} onClick={()=>setPage(v=>Math.max(1,v-1))}>← 前へ</button><span>{page} / {pages}</span><button disabled={page===pages} onClick={()=>setPage(v=>Math.min(pages,v+1))}>次へ →</button></nav>}
      <p className="notice">※{detailed ? chukyo.calculation_note + " 斤量は別定条件から算出した暫定値です。" : "掲載情報は出走予定の段階です。取材後・公開後に変更される場合があります。"}</p>
    </section>
  </main>;
}
