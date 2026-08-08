import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildProvisionalRanking,
  mergeManualCandidates,
} from "../scripts/provisional-race-ranking.mjs";

function field(bytes, offset, length, value) {
  Buffer.from(String(value), "ascii").subarray(0, length).copy(bytes, offset);
}

function fixedRecord(type, size, raceId = "2026052847040212") {
  const record = Buffer.alloc(size, 0x20);
  field(record, 0, 2, type);
  field(record, 2, 1, "A");
  field(record, 3, 8, "20260529");
  field(record, 11, 16, raceId);
  return record;
}

test("combines public candidates and manager-confirmed candidates without zero-filling money", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-provisional-ranking-"));
  try {
    await mkdir(path.join(repoRoot, "app"), { recursive: true });
    await writeFile(path.join(repoRoot, "app", "next-races.json"), JSON.stringify({ rows: [
      { horse: "中央候補1", next_race: "中京記念", horse_url: "https://db.netkeiba.com/horse/2020100001/", race_url: "" },
      { horse: "中央候補2", next_race: "中京記念", horse_url: "https://db.netkeiba.com/horse/2020100002/", race_url: "" },
    ] }));
    await writeFile(path.join(repoRoot, "app", "jra-prize-money.json"), JSON.stringify({ 中央候補1: { yen: 12300000 } }));
    await writeFile(path.join(repoRoot, "app", "data-lab-prize-money.json"), "[]");
    const payload = buildProvisionalRanking({
      repoRoot,
      race: { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念", grade: "GIII", source_url: "https://jra.jp/" },
      manualCandidates: [{ horse: "地方候補", affiliation: "地方" }],
    });
    assert.equal(payload.rows.length, 3);
    assert.equal(payload.race.registration_count, 3);
    assert.equal(payload.rows[0].current_yen, 12300000);
    assert.equal(payload.rows[1].decision_yen, null);
    assert.equal(payload.rows[2].status_label, "管理者確認・TARGET未確認");
    assert.ok(payload.rows.every((row) => row.period1_yen === null && row.period2_g1_yen === null));
    assert.equal(Object.hasOwn(payload.rows[2], "source_note"), false);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("keeps manager-confirmed candidates when TARGET later has fewer entries", () => {
  const payload = {
    race: { race_id: "TARGET", race_date: "2026-08-16", venue: "中京", name: "中京記念", registration_count: 14 },
    rows: [{ horse: "TARGET確認馬", current_yen: 100, decision_yen: 100, ranking_status: "calculated" }],
  };
  const merged = mergeManualCandidates({ payload, manualCandidates: [{ horse: "ケイズレーヴ" }] });
  assert.equal(merged.rows.length, 2);
  assert.equal(merged.race.target_registration_count, 14);
  assert.equal(merged.race.registration_count, 2);
  assert.equal(merged.rows[1].status_label, "管理者確認・TARGET未確認");
  assert.equal(merged.rows[1].decision_yen, null);
});

test("uses a saved official enrichment amount without inventing period amounts", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-provisional-enrichment-"));
  try {
    await mkdir(path.join(repoRoot, "app"), { recursive: true });
    await mkdir(path.join(repoRoot, ".target-local"), { recursive: true });
    await writeFile(path.join(repoRoot, "app", "next-races.json"), JSON.stringify({ rows: [] }));
    await writeFile(path.join(repoRoot, "app", "jra-prize-money.json"), "{}");
    await writeFile(path.join(repoRoot, "app", "data-lab-prize-money.json"), "[]");
    await writeFile(path.join(repoRoot, ".target-local", "candidate-enrichment.json"), JSON.stringify({ records: [{ candidate_id: "manual-1", current_yen: 107150000, current_metric: "地方収得賞金", warning: "期間未取得" }] }));
    const payload = buildProvisionalRanking({
      repoRoot,
      race: { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念" },
      manualCandidates: [{ candidate_id: "manual-1", horse: "ケイズレーヴ" }],
    });
    assert.equal(payload.rows[0].current_yen, 107150000);
    assert.equal(payload.rows[0].period1_yen, null);
    assert.match(payload.rows[0].status_label, /地方収得賞金/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("uses TARGET only for the selected pre-registration race and leaves missing money null", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-provisional-target-estimate-"));
  const targetRoot = path.join(repoRoot, "TFJV");
  try {
    await mkdir(path.join(repoRoot, "app"), { recursive: true });
    await mkdir(path.join(targetRoot, "DE_DATA"), { recursive: true });
    await writeFile(path.join(repoRoot, "app", "next-races.json"), JSON.stringify({ rows: [
      { horse: "中央候補", next_race: "中京記念", horse_url: "https://db.netkeiba.com/horse/2020100001/" },
    ] }));
    await writeFile(path.join(repoRoot, "app", "jra-prize-money.json"), JSON.stringify({ 中央候補: { yen: 12300000 } }));
    await writeFile(path.join(repoRoot, "app", "data-lab-prize-money.json"), "[]");
    const payload = buildProvisionalRanking({
      repoRoot,
      targetRoot,
      race: { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念", grade: "GIII" },
    });
    assert.equal(payload.diagnostics.target_estimate, true);
    assert.equal(payload.rows[0].current_yen, null);
    assert.equal(payload.rows[0].decision_yen, null);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("uses TARGET horse and local history for a manually added horse before NAR fallback", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-provisional-local-horse-"));
  const targetRoot = path.join(repoRoot, "TFJV");
  try {
    await mkdir(path.join(repoRoot, "app"), { recursive: true });
    await mkdir(path.join(targetRoot, "ES_DATA", "2026"), { recursive: true });
    await mkdir(path.join(targetRoot, "UM_DATA", "2021"), { recursive: true });
    await writeFile(path.join(repoRoot, "app", "next-races.json"), JSON.stringify({ rows: [] }));
    await writeFile(path.join(repoRoot, "app", "jra-prize-money.json"), "{}");
    await writeFile(path.join(repoRoot, "app", "data-lab-prize-money.json"), "[]");

    const horseId = "2021000001";
    const um = fixedRecord("UM", 1609, "0000000000000000");
    field(um, 11, 10, horseId);
    field(um, 21, 8, "20210101");
    field(um, 46, 36, "TARGET LOCAL HORSE");
    field(um, 1088, 9, "000512000");
    const localRace = fixedRecord("RA", 1272);
    field(localRace, 32, 60, "LOCAL RACE");
    const localResult = fixedRecord("SE", 555);
    field(localResult, 30, 10, horseId);
    field(localResult, 40, 36, "TARGET LOCAL HORSE");
    field(localResult, 82, 2, "04");
    field(localResult, 334, 2, "01");
    field(localResult, 365, 8, "00300000");
    await Promise.all([
      writeFile(path.join(targetRoot, "UM_DATA", "2021", "UM20211.DAT"), um),
      writeFile(path.join(targetRoot, "ES_DATA", "2026", "LR20260547.DAT"), localRace),
      writeFile(path.join(targetRoot, "ES_DATA", "2026", "LU20260547.DAT"), localResult),
    ]);

    const payload = buildProvisionalRanking({
      repoRoot,
      targetRoot,
      race: { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念", grade: "GIII" },
      manualCandidates: [{ candidate_id: "manual-local", horse: "TARGET LOCAL HORSE", affiliation: "地方" }],
    });
    const row = payload.rows[0];
    assert.equal(row.ketto_num, horseId);
    assert.equal(row.current_yen, 51_200_000);
    assert.equal(row.period1_yen, 15_000_000);
    assert.equal(row.period2_g1_yen, 0);
    assert.equal(row.decision_yen, 66_200_000);
    assert.equal(row.current_metric, "TARGET UM収得賞金");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
