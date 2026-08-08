import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchOfficialHorseEnrichment,
  parseNarSearchResults,
  parseOfficialHorsePage,
} from "../scripts/official-horse-enrichment.mjs";

test("finds one exact horse from the NAR official search result", () => {
  const result = parseNarSearchResults(
    '<a href="/KeibaWeb/DataRoom/S_RaceHorseInfo?k_lineageLoginCode=30065408696">ケイズレーヴ</a><a href="/KeibaWeb/DataRoom/S_RaceHorseInfo?k_lineageLoginCode=2">別馬</a>',
    { horse: "ケイズレーヴ" },
  );
  assert.equal(result.horse, "ケイズレーヴ");
  assert.match(result.source_url, /k_lineageLoginCode=30065408696/);
});

test("reads only the explicit NAR acquisition-money field", () => {
  const enrichment = parseOfficialHorsePage(
    "<h1>ケイズレーヴ</h1><table><tr><th>地方収得賞金</th><td>107,150,000</td></tr><tr><th>中央収得賞金</th><td>0</td></tr><tr><th>賞金</th><td>999,999,999</td></tr></table>",
    { sourceUrl: "https://www.keiba.go.jp/KeibaWeb/DataRoom/RaceHorseInfo?k_activeCode=1", horse: "ケイズレーヴ" },
  );
  assert.equal(enrichment.current_yen, 107_150_000);
  assert.equal(enrichment.current_metric, "地方収得賞金");
  assert.equal(enrichment.period1_yen, null);
  assert.equal(enrichment.period2_g1_yen, null);
});

test("does not convert JBIS total prize money into acquisition money", () => {
  const enrichment = parseOfficialHorsePage(
    "<h1>ケイズレーヴ</h1><dt>総賞金</dt><dd>10715.0万円</dd>",
    { sourceUrl: "https://www.jbis.or.jp/horse/0001359897/", horse: "ケイズレーヴ" },
  );
  assert.equal(enrichment.current_yen, null);
  assert.match(enrichment.warning, /総賞金/);
});

test("fetches one administrator-provided official URL without retries", async () => {
  let calls = 0;
  const enrichment = await fetchOfficialHorseEnrichment({
    candidate: { candidate_id: "candidate-1", horse: "ケイズレーヴ", source_url: "https://www.keiba.go.jp/horse" },
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("<meta charset=\"utf-8\"><h1>ケイズレーヴ</h1><p>地方収得賞金 107,150,000</p>").buffer,
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(enrichment.current_yen, 107_150_000);
});

test("searches NAR by name and reads the official profile without a manual URL", async () => {
  const calls = [];
  const responses = [
    '<meta charset="utf-8"><a href="/KeibaWeb/DataRoom/S_RaceHorseInfo?k_lineageLoginCode=1">ケイズレーヴ</a>',
    '<meta charset="utf-8"><h1>ケイズレーヴ</h1><p>生年月日 2022年3月21日</p><p>調教師 榎屋充（愛知） 馬主 伊藤健</p><p>収得賞金 地方 77,150,000 中央 0 付加 0</p>',
  ];
  const enrichment = await fetchOfficialHorseEnrichment({
    candidate: { candidate_id: "candidate-nar", horse: "ケイズレーヴ" },
    fetchImpl: async (url) => {
      calls.push(url);
      const body = responses.shift();
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(enrichment.current_yen, 77_150_000);
  assert.equal(enrichment.affiliation, "地方");
  assert.equal(enrichment.birth_date, "2022-03-21");
  assert.match(enrichment.horse_url, /k_lineageLoginCode=1/);
});
