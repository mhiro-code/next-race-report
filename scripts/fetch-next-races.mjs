#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = "https://dir.netkeiba.com/keibamatome/detail.html?no=5557";
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

export function findPartsNumber(mainHtml) {
  return (
    mainHtml.match(/id=["']prev_parts-(\d+)["'][\s\S]{0,500}?['"]no['"]:\s*['"](\d+)['"]/i)?.[2] ||
    mainHtml.match(/['"]no['"]:\s*['"](\d+)['"][\s\S]{0,300}?ajax_parts_view/i)?.[1] ||
    ""
  );
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NextRaceDirectory/1.0)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function main() {
  const mainHtml = await fetchText(sourceUrl);
  const partsNumber = findPartsNumber(mainHtml);
  if (!partsNumber) throw new Error("parts id unavailable");

  const partsHtml = await fetchText(
    `https://dir.netkeiba.com/keibamatome/ajax_parts_view.html?no=${partsNumber}`,
  );
  const rows = parseRows(partsHtml);
  if (rows.length < 10) throw new Error(`unexpected source format: ${rows.length} rows`);

  const payload = {
    source_url: sourceUrl,
    page_updated: text(mainHtml.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ""),
    retrieved_at: new Date().toISOString(),
    rows,
  };
  await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Updated ${fileURLToPath(outputUrl)} with ${rows.length} horses`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
