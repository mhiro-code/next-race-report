import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAdminServer } from "../tools/windows/target-local-admin.mjs";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("includes a self-contained GitHub Pages entry point", async () => {
  const [html, script, nextRaces, dataLabPrizes, rankingIndex] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../pages.js", import.meta.url), "utf8"),
    readFile(new URL("../app/next-races.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data-lab-prize-money.json", import.meta.url), "utf8"),
    readFile(new URL("../app/race-rankings/index.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<script src="\.\/pages\.js" defer><\/script>/);
  assert.match(html, /<tbody id="race-rows">/);
  assert.doesNotThrow(() => new Function(script));

  const races = JSON.parse(nextRaces);
  const prizes = JSON.parse(dataLabPrizes);
  const rankings = JSON.parse(rankingIndex);
  assert.ok(races.rows.length > 0);
  assert.ok(prizes.length > 0);
  assert.equal(rankings.schema_version, 1);
  assert.ok(Array.isArray(rankings.races));
});

test("GitHub Pages does not show a misleading refresh button", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../pages.js", import.meta.url), "utf8");

  assert.doesNotMatch(html, /id=["']refresh-button["']/);
  assert.doesNotMatch(script, /refreshButton|#refresh-button/);
  assert.match(html, /GitHub Actionsから更新します/);
});

test("next-race updater parses the netkeiba table format", async () => {
  const { combineRows, findPartsNumber, findPartsNumbers, parseRows, sourcePages } = await import("../scripts/fetch-next-races.mjs");
  const mainHtml = `<div id="prev_parts-999"><script>const params = { 'no': '12345' };</script></div>
    <div id="prev_parts-1000"><script>const params = { 'no': '67890' };</script></div>`;
  const tableHtml = `
    <table>
      <tr><th>更新</th><th>馬名</th><th>予定レース</th></tr>
      <tr>
        <td>NEW</td>
        <td><a href="https://db.netkeiba.com/horse/2022100001/">テストホース</a></td>
        <td><a href="https://race.netkeiba.com/special/index.html?id=1">テストS</a></td>
      </tr>
    </table>`;

  assert.equal(findPartsNumber(mainHtml), "12345");
  assert.deepEqual(findPartsNumbers(mainHtml), ["12345", "67890"]);
  assert.deepEqual(parseRows(tableHtml), [
    {
      update: "NEW",
      horse: "テストホース",
      next_race: "テストS",
      horse_url: "https://db.netkeiba.com/horse/2022100001/",
      race_url: "https://race.netkeiba.com/special/index.html?id=1",
    },
  ]);

  assert.deepEqual(
    sourcePages.map(({ label, url }) => [label, url]),
    [
      ["古馬", "https://dir.netkeiba.com/keibamatome/detail.html?no=5557"],
      ["2・3歳", "https://dir.netkeiba.com/keibamatome/detail.html?no=5556"],
    ],
  );

  const duplicateUrl = "https://db.netkeiba.com/horse/2023100001/";
  const combined = combineRows([
    { label: "古馬", url: "older", rows: [{ horse: "テスト", horse_url: duplicateUrl, next_race: "A" }] },
    { label: "2・3歳", url: "younger", rows: [{ horse: "テスト", horse_url: duplicateUrl, next_race: "B" }] },
  ]);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].next_race, "B");
  assert.equal(combined[0].source_label, "2・3歳");
});

test("manual update workflow runs the updater", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/update-next-races.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/fetch-next-races\.mjs/);
  assert.match(workflow, /git push/);
});

test("weekly graded-race data contains the three registered races", async () => {
  const payload = JSON.parse(
    await readFile(
      new URL("../app/weekly-graded-races-2026.json", import.meta.url),
      "utf8",
    ),
  );

  assert.deepEqual(
    payload.races.map((race) => [race.race, race.registration_count, race.full_gate]),
    [
      ["エルムステークス", 14, 14],
      ["CBC賞", 20, 18],
      ["レパードステークス", 13, 15],
    ],
  );
  assert.equal(
    payload.races.reduce((total, race) => total + race.rows.length, 0),
    47,
  );
  const cbc = payload.races.find((race) => race.race === "CBC賞");
  assert.equal(cbc.rows[0].horse, "フィオライア");
  assert.equal(cbc.rows[0].total_yen, 89_000_000);
  assert.ok(cbc.rows.every((row) => row.weight_kg === null));
});

test("GitHub Pages loads only saved rankings and preserves unpublished handicaps", async () => {
  const script = await readFile(new URL("../pages.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(script, /race-rankings\/index\.json/);
  assert.doesNotMatch(script, /weekly-graded-races-2026\.json/);
  assert.doesNotMatch(script, /chukyo-kinen-2026/);
  assert.doesNotMatch(page, /chukyo-kinen-2026/);
  assert.match(script, /未発表/);
  assert.match(script, /ハンデ未発表のため斤量による優先条件はまだ反映していません/);
});

test("TARGET updater uses only local data and has no JV-Link or fixed-race path", async () => {
  const script = await readFile(
    new URL("../tools/windows/target-weekly-graded-races.ps1", import.meta.url),
    "utf8",
  );

  assert.match(script, /target-local-ranking\.mjs/);
  assert.match(script, /DataRoot/);
  assert.doesNotMatch(script, /JVDTLab|JVInit|JVOpen|JVRead|JVStatus|JVClose|TOKU|SysWOW64|20260808|20260809|Count -ne 3/);
});

test("local TARGET admin provides preview and explicit save controls", async () => {
  const script = await readFile(
    new URL("../tools/windows/target-local-admin.mjs", import.meta.url),
    "utf8",
  );

  assert.match(script, /TARGETローカルデータから更新/);
  assert.match(script, /保存して公開データへ反映/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /\/api\/target\/preview/);
  assert.match(script, /\/api\/target\/save/);
  assert.match(script, /JRA公式番組を取得/);
  assert.match(script, /\/api\/jra\/program/);
  assert.match(script, /\/api\/manual-candidates/);
  assert.match(script, /賞金・成績を再取得/);
  assert.match(script, /\/api\/manual-candidates\/enrich/);
  assert.match(script, /管理者確認候補を追加/);
  assert.match(script, /local-admin-data\.mjs/);
  assert.match(await readFile(new URL("../scripts/local-admin-data.mjs", import.meta.url), "utf8"), /\.target-local/);
  const enrichment = await readFile(new URL("../scripts/official-horse-enrichment.mjs", import.meta.url), "utf8");
  assert.match(enrichment, /地方収得賞金/);
  assert.match(enrichment, /総賞金は収得賞金と同一視せず/);
  assert.doesNotMatch(script, /JVDTLab|JVInit|JVOpen|JVRead|JVStatus|JVClose|TOKU/);
});

test("local TARGET admin refuses save before a preview", async () => {
  const { server } = createAdminServer({ port: 0, targetRoot: "D:/target-does-not-need-to-be-read" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/target/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ race_id: "not-previewed" }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /先に計算結果を表示して確認/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("local TARGET admin serves a syntactically valid page script", async () => {
  const { server } = createAdminServer({ port: 0, targetRoot: "D:/TFJV" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const page = await response.text();
    const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1] ?? "";
    assert.equal(response.status, 200);
    assert.ok(script.length > 0);
    assert.doesNotThrow(() => new Function(script));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("enables administrator candidates for TARGET races", async () => {
  const script = await readFile(
    new URL("../tools/windows/target-local-admin.mjs", import.meta.url),
    "utf8",
  );

  assert.match(script, /manualButton\.disabled = busy \|\| !state\.raceId;/);
  assert.doesNotMatch(script, /selectedRace\(\)\?\.status !== "program_only"/);
});
