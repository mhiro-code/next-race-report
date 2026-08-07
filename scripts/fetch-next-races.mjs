#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const sourcePages = [
  {
    label: "古馬",
    url: "https://dir.netkeiba.com/keibamatome/detail.html?no=5557",
  },
  {
    label: "2・3歳",
    url: "https://dir.netkeiba.com/keibamatome/detail.html?no=5556",
  },
];
const outputUrl = new URL("../app/next-races.json", import.meta.url);

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function text(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function href(value) {
  const match = value.match(/<a[^>]+href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return decodeEntities(match?.[1] || match?.[2] || match?.[3] || "");
}

export function findPartsNumbers(mainHtml) {
  const numbers = [
    ...mainHtml.matchAll(
      /id=["']prev_parts-(\d+)["'][\s\S]{0,500}?['"]no['"]:\s*['"](\d+)['"]/gi,
    ),
  ].map((match) => match[2]);

  return [...new Set(numbers)];
}

export function findPartsNumber(mainHtml) {
  return findPartsNumbers(mainHtml)[0] || "";
}

export function parseRows(partsHtml) {
  return [...partsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .slice(1)
    .map((match) => {
      const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1]);
      if (cells.length < 3) return null;
      return {
        update: text(cells[0]),
        horse: text(cells[1]),
        next_race: text(cells[2]),
        horse_url: href(cells[1]),
        race_url: href(cells[2]),
      };
    })
    .filter(Boolean);
}

export function combineRows(results) {
  const byHorse = new Map();
  for (const result of results) {
    for (const row of result.rows) {
      const key = row.horse_url || row.horse;
      byHorse.set(key, {
        ...row,
        source_label: result.label,
        source_page_url: result.url,
      });
    }
  }
  return [...byHorse.values()];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NextRaceDirectory/1.0)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchSource(source) {
  const mainHtml = await fetchText(source.url);
  const partsNumbers = findPartsNumbers(mainHtml);
  if (partsNumbers.length === 0) throw new Error(`${source.label}: parts id unavailable`);

  const partsHtml = await Promise.all(
    partsNumbers.map((partsNumber) =>
      fetchText(`https://dir.netkeiba.com/keibamatome/ajax_parts_view.html?no=${partsNumber}`),
    ),
  );
  const rows = partsHtml.flatMap(parseRows);
  if (rows.length < 10) {
    throw new Error(`${source.label}: unexpected source format: ${rows.length} rows`);
  }

  return {
    ...source,
    page_updated: text(mainHtml.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ""),
    rows,
  };
}

async function main() {
  const results = await Promise.all(sourcePages.map(fetchSource));
  const rows = combineRows(results);
  const payload = {
    source_url: sourcePages[0].url,
    source_pages: results.map(({ label, url, page_updated, rows: sourceRows }) => ({
      label,
      url,
      page_updated,
      row_count: sourceRows.length,
    })),
    page_updated: results
      .map((result) => `${result.label} ${result.page_updated}`)
      .join("／"),
    retrieved_at: new Date().toISOString(),
    rows,
  };
  await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Updated ${fileURLToPath(outputUrl)} with ${rows.length} horses (` +
      results.map((result) => `${result.label}: ${result.rows.length}`).join(", ") +
      ")",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
