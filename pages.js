const pageSize = 50;

const state = {
  data: null,
  dataLab: new Map(),
  jra: {},
  query: "",
  race: "すべて",
  newOnly: false,
  sort: "horse",
  page: 1,
};

const elements = {
  sourceLink: document.querySelector("#source-link"),
  pageUpdated: document.querySelector("#page-updated"),
  refreshButton: document.querySelector("#refresh-button"),
  message: document.querySelector("#message"),
  horseCount: document.querySelector("#horse-count"),
  raceCount: document.querySelector("#race-count"),
  newCount: document.querySelector("#new-count"),
  query: document.querySelector("#query"),
  raceFilter: document.querySelector("#race-filter"),
  sortOrder: document.querySelector("#sort-order"),
  newOnly: document.querySelector("#new-only"),
  resultCount: document.querySelector("#result-count"),
  verifiedCount: document.querySelector("#verified-count"),
  totalCount: document.querySelector("#total-count"),
  clearButton: document.querySelector("#clear-button"),
  rows: document.querySelector("#race-rows"),
  pagination: document.querySelector("#pagination"),
  previousPage: document.querySelector("#previous-page"),
  nextPage: document.querySelector("#next-page"),
  pageNumber: document.querySelector("#page-number"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function horseId(url) {
  return url.match(/\/horse\/(\d{10})/)?.[1];
}

function prizeFor(row) {
  const id = horseId(row.horse_url);
  return (id && state.dataLab.get(id)) || state.jra[row.horse];
}

function formatPrizeMoney(yen) {
  const manYen = yen / 10000;
  if (manYen >= 10000) {
    const oku = Math.floor(manYen / 10000);
    const remainder = manYen % 10000;
    return remainder
      ? `${oku}億${remainder.toLocaleString("ja-JP")}万円`
      : `${oku}億円`;
  }
  return `${manYen.toLocaleString("ja-JP")}万円`;
}

function filteredRows() {
  const normalized = state.query.trim().toLocaleLowerCase("ja");
  return state.data.rows
    .filter((row) => {
      const matchesQuery =
        !normalized ||
        row.horse.toLocaleLowerCase("ja").includes(normalized) ||
        row.next_race.toLocaleLowerCase("ja").includes(normalized);
      return (
        matchesQuery &&
        (state.race === "すべて" || row.next_race === state.race) &&
        (!state.newOnly || row.update === "NEW")
      );
    })
    .sort((a, b) => {
      if (state.sort === "horse") return a.horse.localeCompare(b.horse, "ja");
      if (state.sort === "prize") {
        const difference = (prizeFor(b)?.yen ?? -1) - (prizeFor(a)?.yen ?? -1);
        return difference || a.horse.localeCompare(b.horse, "ja");
      }
      return a.next_race.localeCompare(b.next_race, "ja") || a.horse.localeCompare(b.horse, "ja");
    });
}

function prizeCell(row) {
  const prize = prizeFor(row);
  if (!prize) return '<span class="unverified">未取得</span>';
  const label = prize.sourceLabel || "JRA公式";
  const title = `${label}・${prize.verifiedAt || "取得日不明"}取得`;
  if (prize.jraUrl) {
    return `<a href="${escapeHtml(prize.jraUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(title)}">${formatPrizeMoney(prize.yen)}<span aria-hidden="true">↗</span></a>`;
  }
  return `<span class="dataLabValue" title="${escapeHtml(`${title}（${prize.sourceFile || "UMレコード"}）`)}">${formatPrizeMoney(prize.yen)}</span>`;
}

function render() {
  if (!state.data) return;
  const filtered = filteredRows();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.page = Math.min(state.page, totalPages);
  const displayed = filtered.slice((state.page - 1) * pageSize, state.page * pageSize);

  elements.resultCount.textContent = filtered.length;
  elements.clearButton.hidden = !(state.query || state.race !== "すべて" || state.newOnly);
  elements.rows.innerHTML = displayed.length
    ? displayed.map((row) => `
      <tr>
        <td>${row.update === "NEW" ? '<span class="newBadge">NEW</span>' : ""}</td>
        <td><a href="${escapeHtml(row.horse_url)}" target="_blank" rel="noreferrer">${escapeHtml(row.horse)}<span aria-hidden="true">↗</span></a></td>
        <td class="prizeCell">${prizeCell(row)}</td>
        <td>${row.race_url ? `<a href="${escapeHtml(row.race_url)}" target="_blank" rel="noreferrer">${escapeHtml(row.next_race)}<span aria-hidden="true">↗</span></a>` : escapeHtml(row.next_race)}</td>
      </tr>`).join("")
    : '<tr><td class="empty" colspan="4">条件に一致する馬が見つかりません。</td></tr>';

  elements.pagination.hidden = totalPages <= 1;
  elements.previousPage.disabled = state.page === 1;
  elements.nextPage.disabled = state.page === totalPages;
  elements.pageNumber.textContent = `${state.page} / ${totalPages}`;
}

async function loadData(showMessage = false) {
  elements.refreshButton.disabled = true;
  elements.message.textContent = showMessage ? "再読込中…" : "";
  try {
    const cacheBust = `?v=${Date.now()}`;
    const [raceResponse, dataLabResponse, jraResponse] = await Promise.all([
      fetch(`./app/next-races.json${cacheBust}`),
      fetch(`./app/data-lab-prize-money.json${cacheBust}`),
      fetch(`./app/jra-prize-money.json${cacheBust}`),
    ]);
    if (!raceResponse.ok || !dataLabResponse.ok || !jraResponse.ok) throw new Error("load failed");

    state.data = await raceResponse.json();
    const dataLab = await dataLabResponse.json();
    state.jra = await jraResponse.json();
    state.dataLab = new Map(dataLab.map((record) => [record.KettoNum, {
      yen: record.PrizeYen,
      verifiedAt: "2026-07-27",
      sourceLabel: "JRA-VAN Data Lab.",
      sourceFile: record.SourceFile,
    }]));

    const races = [...new Set(state.data.rows.map((row) => row.next_race))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ja"));
    elements.raceFilter.innerHTML = '<option value="すべて">すべて</option>' + races.map((race) => `<option value="${escapeHtml(race)}">${escapeHtml(race)}</option>`).join("");
    elements.raceFilter.value = state.race;
    elements.sourceLink.href = state.data.source_url;
    elements.pageUpdated.textContent = state.data.page_updated;
    elements.horseCount.textContent = state.data.rows.length;
    elements.raceCount.textContent = new Set(state.data.rows.map((row) => row.next_race)).size;
    elements.newCount.textContent = state.data.rows.filter((row) => row.update === "NEW").length;
    elements.verifiedCount.textContent = state.data.rows.filter((row) => prizeFor(row)).length;
    elements.totalCount.textContent = state.data.rows.length;
    state.page = 1;
    render();
    elements.message.textContent = showMessage ? `${state.data.rows.length}頭の登録データを再読込しました` : "";
  } catch {
    elements.message.textContent = "表示データを読み込めませんでした。";
    elements.rows.innerHTML = '<tr><td class="empty" colspan="4">データを読み込めませんでした。</td></tr>';
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.query.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.page = 1;
  render();
});
elements.raceFilter.addEventListener("change", (event) => {
  state.race = event.target.value;
  state.page = 1;
  render();
});
elements.sortOrder.addEventListener("change", (event) => {
  state.sort = event.target.value;
  state.page = 1;
  render();
});
elements.newOnly.addEventListener("change", (event) => {
  state.newOnly = event.target.checked;
  state.page = 1;
  render();
});
elements.clearButton.addEventListener("click", () => {
  state.query = "";
  state.race = "すべて";
  state.newOnly = false;
  state.page = 1;
  elements.query.value = "";
  elements.raceFilter.value = "すべて";
  elements.newOnly.checked = false;
  render();
});
elements.previousPage.addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  render();
});
elements.nextPage.addEventListener("click", () => {
  state.page += 1;
  render();
});
elements.refreshButton.addEventListener("click", () => loadData(true));

loadData();
