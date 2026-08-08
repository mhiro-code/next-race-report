import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchOfficialHorseEnrichment,
  parseOfficialHorsePage,
} from "../scripts/official-horse-enrichment.mjs";

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
