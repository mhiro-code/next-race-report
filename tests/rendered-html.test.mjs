import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  const [html, script, nextRaces, dataLabPrizes] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../pages.js", import.meta.url), "utf8"),
    readFile(new URL("../app/next-races.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data-lab-prize-money.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<script src="\.\/pages\.js" defer><\/script>/);
  assert.match(html, /<tbody id="race-rows">/);
  assert.doesNotThrow(() => new Function(script));

  const races = JSON.parse(nextRaces);
  const prizes = JSON.parse(dataLabPrizes);
  assert.ok(races.rows.length > 0);
  assert.ok(prizes.length > 0);
});

test("GitHub Pages does not show a misleading refresh button", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../pages.js", import.meta.url), "utf8");

  assert.doesNotMatch(html, /id=["']refresh-button["']/);
  assert.doesNotMatch(script, /refreshButton|#refresh-button/);
  assert.match(html, /GitHub Actionsから更新します/);
});

test("next-race updater parses the netkeiba table format", async () => {
  const { findPartsNumber, parseRows } = await import("../scripts/fetch-next-races.mjs");
  const mainHtml = `<div id="prev_parts-999"><script>const params = { 'no': '12345' };</script></div>`;
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
  assert.deepEqual(parseRows(tableHtml), [
    {
      update: "NEW",
      horse: "テストホース",
      next_race: "テストS",
      horse_url: "https://db.netkeiba.com/horse/2022100001/",
      race_url: "https://race.netkeiba.com/special/index.html?id=1",
    },
  ]);
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
