const pageSize = 50;
const state = {
  data: null,
  specials: [],
  dataLab: new Map(),
  jra: {},
  rows: [],
  query: "",
  race: "すべて",
  newOnly: false,
  page: 1,
};

const $ = (id) => document.getElementById(id);
const e = {
  source: $("source-link"),
  updated: $("page-updated"),
  horseCount: $("horse-count"),
  raceCount: $("race-count"),
  third: $("third-stat"),
  thirdLabel: $("third-label"),
  query: $("query"),
  race: $("race-filter"),
  sort: $("sort-guide"),
  newOnly: $("new-only"),
  summary: $("race-summary"),
  raceTitle: $("race-title"),
  raceMeta: $("race-meta"),
  cutoffLabel: $("cutoff-label"),
  cutoff: $("cutoff-value"),
  count: $("result-count"),
  clear: $("clear-button"),
  table: $("results-table"),
  head: $("table-head"),
  body: $("race-rows"),
  pagination: $("pagination"),
  prev: $("previous-page"),
  next: $("next-page"),
  pageNo: $("page-number"),
  notice: $("notice"),
};

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const horseId = (url) => url.match(/\/horse\/(\d{10})/)?.[1];

const format = (yen) => {
  if (yen === null || yen === undefined) return "未取得";
  const man = yen / 10000;
  if (man >= 10000) {
    const oku = Math.floor(man / 10000);
    const rest = man % 10000;
    return rest
      ? `${oku}億${rest.toLocaleString("ja-JP")}万円`
      : `${oku}億円`;
  }
  return `${man.toLocaleString("ja-JP")}万円`;
};

const prize = (row) => {
  const id = horseId(row.horse_url);
  return (id && state.dataLab.get(id)) || state.jra[row.horse];
};

function selectedRace() {
  return state.specials.find((special) => special.race === state.race);
}

function normalizePublishedRanking(value) {
  const race = value.race || {};
  return {
    race: race.name || "",
    race_date: race.race_date || "",
    venue: race.venue || "",
    grade: race.grade || "",
    distance: "",
    conditions: race.conditions || "",
    full_gate: race.full_gate ?? null,
    registration_count: race.registration_count,
    registration_count_status: race.registration_count_status,
    target_registration_count: race.target_registration_count ?? null,
    source_url: value.source_url || "",
    stage: value.stage || "special",
    generated_at: value.generated_at || null,
    target_data_updated_at: value.target_data_updated_at || null,
    calculation_note:
      value.calculation_note || "TARGETローカルデータから計算した順位目安です。",
    rows: (value.rows || []).map((row) => ({
      ketto_num: row.ketto_num || "",
      horse: row.horse || "",
      jockey: row.jockey || "",
      current_yen: typeof row.current_yen === "number" ? row.current_yen : null,
      one_year_yen:
        typeof row.period1_yen === "number"
          ? row.period1_yen
          : typeof row.one_year_yen === "number"
            ? row.one_year_yen
            : null,
      two_year_g1_yen:
        typeof row.period2_g1_yen === "number"
          ? row.period2_g1_yen
          : typeof row.two_year_g1_yen === "number"
            ? row.two_year_g1_yen
            : null,
      total_yen:
        typeof row.decision_yen === "number"
          ? row.decision_yen
          : typeof row.total_yen === "number"
            ? row.total_yen
            : null,
      weight_kg: typeof row.weight_kg === "number" ? row.weight_kg : null,
      rank: typeof row.rank === "number" ? row.rank : null,
      ranking_status: typeof row.ranking_status === "string" ? row.ranking_status : "",
      status_label: typeof row.status_label === "string" ? row.status_label : "",
      source_kind: typeof row.source_kind === "string" ? row.source_kind : "",
      affiliation: typeof row.affiliation === "string" ? row.affiliation : "JRA",
      status: typeof row.status === "string" ? row.status : "",
    })),
  };
}

function link(url, label) {
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}↗</a>`
    : esc(label);
}

function rankRace(special) {
  let previousTotal = null;
  let rank = 0;
  return new Map(
    special.rows.map((row, index) => {
      if (Object.prototype.hasOwnProperty.call(row, "rank")) {
        previousTotal = row.total_yen;
        return [row.horse, { ...row, rank: row.rank }];
      }
      if (row.total_yen !== null && row.total_yen !== previousTotal) rank = index + 1;
      previousTotal = row.total_yen;
      return [row.horse, { ...row, rank }];
    }),
  );
}

function composeRows() {
  const detailedNames = new Set(
    state.specials.flatMap((special) => special.rows.map((row) => row.horse)),
  );
  const detailedRaceNames = new Set(
    state.specials.map((special) => special.race),
  );
  const original = new Map(state.data.rows.map((row) => [row.horse, row]));

  state.rows = [
    ...state.data.rows.filter(
      (row) =>
        !detailedNames.has(row.horse) &&
        !detailedRaceNames.has(row.next_race),
    ),
    ...state.specials.flatMap((special) =>
      special.rows.map((row) => ({
        update: original.get(row.horse)?.update || "",
        horse: row.horse,
        next_race: special.race,
        horse_url: row.ketto_num ? `https://db.netkeiba.com/horse/${row.ketto_num}/` : "",
        race_url: special.source_url,
      })),
    ),
  ];
}

function filtered() {
  const term = state.query.trim().toLocaleLowerCase("ja");
  const special = selectedRace();
  const ranking = special ? rankRace(special) : new Map();

  return state.rows
    .filter(
      (row) =>
        (!term ||
          row.horse.toLocaleLowerCase("ja").includes(term) ||
          row.next_race.toLocaleLowerCase("ja").includes(term)) &&
        (state.race === "すべて" || row.next_race === state.race) &&
        (!state.newOnly || row.update === "NEW"),
    )
    .sort((a, b) => {
      if (state.race === "すべて") {
        return (
          a.horse.localeCompare(b.horse, "ja") ||
          a.next_race.localeCompare(b.next_race, "ja")
        );
      }
      const ar = ranking.get(a.horse);
      const br = ranking.get(b.horse);
      if (ar && br) {
        if (special.stage === "confirmed") {
          return a.horse.localeCompare(b.horse, "ja");
        }
        if (ar.rank === null && br.rank !== null) return 1;
        if (ar.rank !== null && br.rank === null) return -1;
        if (ar.rank !== null && br.rank !== null && ar.rank !== br.rank) {
          return ar.rank - br.rank;
        }
        if (ar.total_yen === null && br.total_yen !== null) return 1;
        if (ar.total_yen !== null && br.total_yen === null) return -1;
        return (
          (br.total_yen ?? -1) - (ar.total_yen ?? -1) ||
          a.horse.localeCompare(b.horse, "ja")
        );
      }
      return (
        (prize(b)?.yen ?? -1) -
          (prize(a)?.yen ?? -1) ||
        a.horse.localeCompare(b.horse, "ja")
      );
    });
}

function render() {
  const special = selectedRace();
  const detailed = Boolean(special);
  const confirmed = special?.stage === "confirmed";
  const ranking = special ? rankRace(special) : new Map();
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.page = Math.min(state.page, pages);
  const shown = rows.slice(
    (state.page - 1) * pageSize,
    state.page * pageSize,
  );

  e.count.textContent = rows.length;
  e.clear.hidden = !(state.query || state.race !== "すべて" || state.newOnly);
  e.sort.textContent =
    state.race === "すべて" ? "馬名50音順" : confirmed ? "確定出走馬順" : "出走順位の目安順";
  e.summary.hidden = !detailed;
  e.table.className = detailed ? "rankingTable" : "";
  e.third.textContent = detailed
    ? special.full_gate ?? "—"
    : state.rows.filter((row) => row.update === "NEW").length;
  e.thirdLabel.textContent = detailed ? "フルゲート" : "NEW";
  e.source.href = detailed ? special.source_url : state.data.source_url;

  if (special) {
    const registrationCount =
      special.registration_count ?? special.rows.length;
    const hasExclusions = !confirmed && special.full_gate !== null && registrationCount > special.full_gate;
    const cutoff = hasExclusions
      ? special.rows[(special.full_gate ?? 1) - 1]
      : null;

    e.raceTitle.innerHTML =
      `${esc(special.race)} <small>${esc(special.grade)}</small>`;
    e.raceMeta.textContent =
      `${special.race_date.replaceAll("-", "/")}・${special.venue}・` +
      `${special.distance}・${special.conditions}`;
    e.raceMeta.textContent +=
      `・TARGET更新 ${special.target_data_updated_at || "未取得"}・順位計算 ${special.generated_at || "未取得"}`;
    if (confirmed) {
      e.cutoffLabel.textContent = "最終版";
      e.cutoff.textContent = `確定出走馬 ${registrationCount}頭`;
    } else if (cutoff) {
      e.cutoffLabel.textContent =
        `${special.full_gate}頭目の現時点の目安`;
      e.cutoff.textContent = `${cutoff.horse}・${format(cutoff.total_yen)}`;
    } else {
      e.cutoffLabel.textContent = "登録状況";
      e.cutoff.textContent =
        `${special.registration_count_status === "candidate_count" ? "候補" : "登録"}${registrationCount}頭／フルゲート${special.full_gate ?? "未取得"}頭` +
        (special.full_gate !== null && registrationCount < special.full_gate ? "（全頭出走可能）" : "");
    }

    e.head.innerHTML = confirmed
      ? '<tr><th>馬名</th><th>所属</th><th>状態</th></tr>'
      : '<tr><th>順位目安</th><th>馬名</th><th>所属</th><th>想定騎手</th>' +
        '<th class="numeric">現在</th><th class="numeric">1年加算</th>' +
        '<th class="numeric">2年GⅠ加算</th><th class="numeric totalHead">合計</th>' +
        '<th class="numeric">斤量</th><th>次走</th><th>状態</th></tr>';

    e.body.innerHTML = shown
      .map((row) => {
        const detail = ranking.get(row.horse);
        const cutoffClass =
          hasExclusions && detail.rank === special.full_gate
            ? "cutoffRow"
            : "";
        const weight =
          detail.weight_kg === null
            ? '<span class="unverified">未発表</span>'
            : `${detail.weight_kg}kg`;

        if (confirmed) {
          return `<tr class="${cutoffClass}"><td>${link(row.horse_url, row.horse)}</td><td>${esc(detail.affiliation || "JRA")}</td><td>${esc(detail.status_label || "確定")}</td></tr>`;
        }
        return (
          `<tr class="${cutoffClass}"><td><span class="rankBadge">${detail.rank ?? "—"}</span></td>` +
          `<td>${link(row.horse_url, row.horse)}</td>` +
          `<td>${esc(detail.affiliation || "JRA")}</td>` +
          `<td>${detail.jockey ? esc(detail.jockey) : '<span class="unverified">未定</span>'}</td>` +
          `<td class="numeric">${format(detail.current_yen)}</td>` +
          `<td class="numeric plus">${detail.one_year_yen === null ? "未取得" : `+${format(detail.one_year_yen)}`}</td>` +
          `<td class="numeric plus">${detail.two_year_g1_yen === null ? "未取得" : `+${format(detail.two_year_g1_yen)}`}</td>` +
          `<td class="numeric totalCell">${format(detail.total_yen)}</td>` +
          `<td class="numeric">${weight}</td>` +
          `<td>${link(special.source_url, special.race)}</td>` +
          `<td>${esc(detail.status_label || (detail.ranking_status === "calculated" ? "計算済み" : "順位未計算"))}</td></tr>`
        );
      })
      .join("");

    const weightNote = confirmed ? "" :
      special.conditions.includes("ハンデ") &&
      special.rows.some((row) => row.weight_kg === null)
        ? " ハンデ未発表のため斤量による優先条件はまだ反映していません。"
        : "";
    e.notice.textContent = `※${special.calculation_note}${weightNote}`;
  } else {
    e.head.innerHTML =
      '<tr><th>更新</th><th>馬名</th><th class="numeric">収得賞金（平地）</th><th>予定レース</th></tr>';
    e.body.innerHTML = shown
      .map(
        (row) =>
          `<tr><td>${row.update === "NEW" ? '<span class="newBadge">NEW</span>' : ""}</td>` +
          `<td>${link(row.horse_url, row.horse)}</td>` +
          `<td class="numeric">${prize(row) ? format(prize(row).yen) : '<span class="unverified">未取得</span>'}</td>` +
          `<td>${link(row.race_url, row.next_race)}</td></tr>`,
      )
      .join("");
    e.notice.textContent =
      "※掲載情報は出走予定の段階です。取材後・公開後に変更される場合があります。";
  }

  if (!shown.length) {
    e.body.innerHTML =
      `<tr><td class="empty" colspan="${detailed ? confirmed ? 3 : 11 : 4}">条件に一致する馬が見つかりません。</td></tr>`;
  }

  e.pagination.hidden = pages <= 1;
  e.prev.disabled = state.page === 1;
  e.next.disabled = state.page === pages;
  e.pageNo.textContent = `${state.page} / ${pages}`;
}

async function load() {
  try {
    const version = `?v=${Date.now()}`;
    const [race, rankings, lab, jra] = await Promise.all([
      fetch(`./app/next-races.json${version}`),
      fetch(`./app/race-rankings/index.json${version}`),
      fetch(`./app/data-lab-prize-money.json${version}`),
      fetch(`./app/jra-prize-money.json${version}`),
    ]);
    if (
      !race.ok ||
      !rankings.ok ||
      !lab.ok ||
      !jra.ok
    ) {
      throw new Error("data load failed");
    }

    state.data = await race.json();
    const rankingData = await rankings.json();
    state.specials = (rankingData.races || []).map(normalizePublishedRanking);
    state.jra = await jra.json();
    state.dataLab = new Map(
      (await lab.json()).map((item) => [
        item.KettoNum,
        { yen: item.PrizeYen },
      ]),
    );

    composeRows();
    const races = [...new Set(state.rows.map((row) => row.next_race))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ja"));
    e.race.innerHTML =
      "<option>すべて</option>" +
      races.map((raceName) => `<option>${esc(raceName)}</option>`).join("");
    e.updated.textContent = state.data.page_updated;
    e.horseCount.textContent = state.rows.length;
    e.raceCount.textContent = races.length;
    render();
  } catch {
    e.body.innerHTML =
      '<tr><td class="empty">データを読み込めませんでした。</td></tr>';
  }
}

e.query.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.page = 1;
  render();
});
e.race.addEventListener("change", (event) => {
  state.race = event.target.value;
  state.page = 1;
  render();
});
e.newOnly.addEventListener("change", (event) => {
  state.newOnly = event.target.checked;
  state.page = 1;
  render();
});
e.clear.addEventListener("click", () => {
  state.query = "";
  state.race = "すべて";
  state.newOnly = false;
  state.page = 1;
  e.query.value = "";
  e.race.value = "すべて";
  e.newOnly.checked = false;
  render();
});
e.prev.addEventListener("click", () => {
  state.page--;
  render();
});
e.next.addEventListener("click", () => {
  state.page++;
  render();
});

load();
