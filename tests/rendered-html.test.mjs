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
