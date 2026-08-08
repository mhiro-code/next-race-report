import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateEarnedMoney,
  calculateRanking,
  parseRaRecord,
  parseSeRecord,
  parseTkRecord,
  parseUmRecord,
  parseDuRecord,
  readTargetConfirmedSnapshot,
  readTargetHorseByName,
  readTargetSnapshot,
  resolveTargetRoot,
  raceFileName,
  saveRankingJson,
} from "../scripts/target-local-ranking.mjs";

function field(bytes, offset, length, value) {
  Buffer.from(String(value), "ascii").subarray(0, length).copy(bytes, offset);
}

function makeTkRecord() {
  const record = Buffer.alloc(657 + 2 * 70, 0x20);
  field(record, 0, 2, "TK");
  field(record, 2, 1, "1");
  field(record, 3, 8, "20260803");
  field(record, 11, 16, "2026080907010607");
  field(record, 19, 2, "07");
  field(record, 21, 2, "01");
  field(record, 23, 2, "06");
  field(record, 25, 2, "07");
  field(record, 32, 60, "TEST G3");
  field(record, 614, 1, "C");
  field(record, 615, 2, "11");
  field(record, 617, 3, "000");
  field(record, 620, 1, "1");
  field(record, 621, 3, "003");
  field(record, 624, 3, "000");
  field(record, 627, 3, "000");
  field(record, 630, 3, "000");
  field(record, 636, 4, "1600");
  field(record, 640, 2, "11");
  field(record, 652, 3, "002");
  field(record, 655 + 3, 10, "H000000001");
  field(record, 655 + 13, 36, "TEST HORSE 1");
  field(record, 655 + 66, 3, "055");
  field(record, 725 + 3, 10, "H000000002");
  field(record, 725 + 13, 36, "TEST HORSE 2");
  field(record, 725 + 66, 3, "060");
  return record;
}

function makeFixedRecord(type, raceId = "2025081005010101") {
  const sizes = { RA: 1272, SE: 555, UM: 1609 };
  const record = Buffer.alloc(sizes[type], 0x20);
  field(record, 0, 2, type);
  field(record, 2, 1, "1");
  field(record, 3, 8, "20250811");
  field(record, 11, 16, raceId);
  return record;
}

function makeDuRecord() {
  const record = Buffer.alloc(159, 0x20);
  field(record, 0, 2, "SE");
  field(record, 2, 1, "2");
  field(record, 3, 8, "20260813");
  field(record, 11, 16, "2026081607010807");
  field(record, 27, 3, "101");
  field(record, 30, 10, "2022100001");
  field(record, 40, 36, "FINAL HORSE");
  return record;
}

async function writeTargetFixture(root) {
  const tkDirectory = path.join(root, "DE_DATA", "2026");
  const raDirectory = path.join(root, "SE_DATA", "2025");
  const umDirectory = path.join(root, "UM_DATA", "2021");
  await mkdir(tkDirectory, { recursive: true });
  await mkdir(raDirectory, { recursive: true });
  await mkdir(umDirectory, { recursive: true });

  const tk = makeTkRecord();
  field(tk, 655 + 3, 10, "2021000001");
  field(tk, 725 + 3, 10, "2021000002");
  await writeFile(path.join(tkDirectory, "TK20260808.DAT"), tk);

  const ra = makeFixedRecord("RA");
  const se = makeFixedRecord("SE");
  field(se, 30, 10, "2021000001");
  field(se, 40, 36, "TEST HORSE 1");
  field(se, 82, 2, "04");
  field(se, 334, 2, "01");
  field(se, 365, 8, "00080000");
  await writeFile(path.join(raDirectory, "SR202524.DAT"), ra);
  await writeFile(path.join(raDirectory, "SU202524.DAT"), se);

  const um = makeFixedRecord("UM", "0000000000000000");
  field(um, 11, 10, "2021000001");
  field(um, 21, 8, "20210101");
  field(um, 46, 36, "TEST HORSE 1");
  field(um, 1088, 9, "000565000");
  await writeFile(path.join(umDirectory, "UM20211.DAT"), um);
}

test("reads only TK for the initial list and narrows detail reads to the selected horses", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-scope-"));
  try {
    await writeTargetFixture(targetRoot);

    const listSnapshot = readTargetSnapshot({ targetRoot });
    assert.equal(listSnapshot.diagnostics.tk_file_count, 1);
    assert.equal(listSnapshot.diagnostics.ra_file_count, 0);
    assert.equal(listSnapshot.diagnostics.se_file_count, 0);
    assert.equal(listSnapshot.diagnostics.um_file_count, 0);

    const detailSnapshot = readTargetSnapshot({
      targetRoot,
      raceDate: "2026-08-09",
      raceId: "2026080907010607",
      horseIds: ["2021000001"],
    });
    assert.equal(detailSnapshot.diagnostics.ra_file_count, 1);
    assert.equal(detailSnapshot.diagnostics.se_file_count, 1);
    assert.equal(detailSnapshot.diagnostics.um_file_count, 1);
    assert.equal(detailSnapshot.horses.get("2021000001").current_acquisition_money_yen, 56_500_000);
    assert.equal(detailSnapshot.history.length, 1);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("parses TARGET TK, RA, SE, and UM fields from their local record offsets", () => {
  const tk = parseTkRecord(makeTkRecord());
  assert.equal(tk.race_id, "2026080907010607");
  assert.equal(tk.race_date, "2026-08-09");
  assert.equal(tk.registration_count, 2);
  assert.deepEqual(
    tk.entries.map((entry) => [entry.ketto_num, entry.horse, entry.weight_kg]),
    [
      ["H000000001", "TEST HORSE 1", 5.5],
      ["H000000002", "TEST HORSE 2", 6],
    ],
  );

  const ra = makeFixedRecord("RA");
  field(ra, 614, 1, "B");
  field(ra, 622, 3, "000");
  field(ra, 625, 3, "000");
  field(ra, 628, 3, "999");
  field(ra, 631, 3, "000");
  field(ra, 713, 8, "00080000");
  assert.equal(parseRaRecord(ra).prize_yen_by_finish[0], 8_000_000);

  const se = makeFixedRecord("SE");
  field(se, 30, 10, "H000000001");
  field(se, 40, 36, "TEST HORSE 1");
  field(se, 82, 2, "04");
  field(se, 334, 2, "01");
  field(se, 365, 8, "00080000");
  assert.equal(parseSeRecord(se).finish, 1);
  assert.equal(parseSeRecord(se).earned_main_prize_yen, 8_000_000);

  const um = makeFixedRecord("UM", "0000000000000000");
  field(um, 11, 10, "H000000001");
  field(um, 21, 8, "20220101");
  field(um, 46, 36, "TEST HORSE 1");
  field(um, 1088, 9, "000565000");
  assert.equal(parseUmRecord(um).current_acquisition_money_yen, 56_500_000);
});

test("resolves a horse by name and reads TARGET local ES_DATA history before fallback sources", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-es-history-"));
  try {
    await Promise.all([
      mkdir(path.join(targetRoot, "DE_DATA"), { recursive: true }),
      mkdir(path.join(targetRoot, "ES_DATA", "2026"), { recursive: true }),
      mkdir(path.join(targetRoot, "UM_DATA", "2021"), { recursive: true }),
    ]);
    const horseId = "2021000001";
    const raceId = "2026052847040212";
    const um = makeFixedRecord("UM", "0000000000000000");
    field(um, 11, 10, horseId);
    field(um, 21, 8, "20210101");
    field(um, 46, 36, "TARGET LOCAL HORSE");
    field(um, 1088, 9, "000512000");
    const localRace = makeFixedRecord("RA", raceId);
    field(localRace, 2, 1, "A");
    field(localRace, 32, 60, "LOCAL RACE");
    const localResult = makeFixedRecord("SE", raceId);
    field(localResult, 2, 1, "A");
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

    const snapshot = readTargetSnapshot({
      targetRoot,
      raceDate: "2026-08-09",
      horseNames: ["TARGET LOCAL HORSE"],
    });
    assert.equal(readTargetHorseByName({ targetRoot, horseName: "TARGET LOCAL HORSE" }).ketto_num, horseId);
    assert.equal(snapshot.horses.get(horseId).current_acquisition_money_yen, 51_200_000);
    assert.equal(snapshot.diagnostics.es_ra_file_count, 1);
    assert.equal(snapshot.diagnostics.es_se_file_count, 1);
    assert.equal(snapshot.history.length, 1);
    assert.equal(snapshot.history[0].result.ketto_num, horseId);
    assert.equal(snapshot.history[0].result.earned_main_prize_yen, 30_000_000);
    assert.equal(snapshot.history[0].race.data_kubun, "A");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("parses the compact DU record used for confirmed runners", () => {
  const parsed = parseDuRecord(makeDuRecord());
  assert.deepEqual(parsed, {
    race_id: "2026081607010807",
    race_date: "2026-08-16",
    ketto_num: "2022100001",
    horse: "FINAL HORSE",
    affiliation: "JRA",
    status: "confirmed",
    data_created_at: "20260813",
  });
});

test("reads confirmed runners from DU without needing JV-Link", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "target-confirmed-"));
  try {
    const directory = path.join(targetRoot, "DE_DATA", "2026");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "DU20260816.DAT"), makeDuRecord());
    const snapshot = readTargetConfirmedSnapshot({ targetRoot });
    assert.equal(snapshot.races.length, 1);
    assert.equal(snapshot.races[0].race_id, "2026081607010807");
    assert.deepEqual(snapshot.races[0].entries.map((entry) => entry.horse), ["FINAL HORSE"]);
    assert.equal(snapshot.diagnostics.du_file_count, 1);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("resolves TARGET record folders by known names or record files", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "target-folders-"));
  try {
    await Promise.all([
      mkdir(path.join(targetRoot, "REGISTRATION_DATA"), { recursive: true }),
      mkdir(path.join(targetRoot, "HISTORY_DATA"), { recursive: true }),
      mkdir(path.join(targetRoot, "HORSE_DATA"), { recursive: true }),
      mkdir(path.join(targetRoot, "CONFIRMED_DATA"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(targetRoot, "REGISTRATION_DATA", "TK20260808.DAT"), "TK"),
      writeFile(path.join(targetRoot, "HISTORY_DATA", "SR260808.DAT"), "RA"),
      writeFile(path.join(targetRoot, "HORSE_DATA", "UM2022.DAT"), "UM"),
      writeFile(path.join(targetRoot, "CONFIRMED_DATA", "DU20260808.DAT"), "SE"),
    ]);
    const resolved = resolveTargetRoot(targetRoot);
    assert.equal(path.basename(resolved.recordFolders.registration), "REGISTRATION_DATA");
    assert.equal(path.basename(resolved.recordFolders.history), "HISTORY_DATA");
    assert.equal(path.basename(resolved.recordFolders.horses), "HORSE_DATA");
    assert.equal(path.basename(resolved.recordFolders.confirmed), "CONFIRMED_DATA");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("does not treat the SE main prize as acquisition money", () => {
  const graded = {
    data_kubun: "1",
    grade_code: "B",
    race_date: "2025-10-01",
    conditions: { age2: "000", age3: "000", age4: "999", age5Plus: "999", youngest: "000" },
  };
  const result = { finish: 1, age: 4, earned_main_prize_yen: 80_000_000 };
  assert.equal(calculateEarnedMoney({ race: graded, result, horse: null }).yen, 40_000_000);
  assert.equal(
    calculateEarnedMoney({
      race: graded,
      result: { finish: null, age: 4, earned_main_prize_yen: 80_000_000 },
      horse: null,
    }).yen,
    null,
  );

  const twoYearG3 = { ...graded, grade_code: "C", race_date: "2025-08-01" };
  assert.equal(
    calculateEarnedMoney({
      race: twoYearG3,
      result: { finish: 1, age: 2, earned_main_prize_yen: 80_000_000 },
      horse: null,
    }).yen,
    16_000_000,
  );
});

test("keeps every registered horse and leaves unavailable amounts out of ranking", () => {
  const targetRace = {
    race_id: "2026080907010607",
    race_date: "2026-08-09",
    venue: "中京",
    name: "TEST G3",
    grade: "GIII",
    grade_code: "C",
    conditions: { age2: "000", age3: "000", age4: "999", age5Plus: "999", youngest: "000" },
    race_type_code: "11",
    weight_type_code: "1",
    registration_count: 3,
    entries: [
      { ketto_num: "H1", horse: "HORSE A", weight_kg: null },
      { ketto_num: "H2", horse: "HORSE B", weight_kg: null },
      { ketto_num: "H3", horse: "HORSE C", weight_kg: null },
    ],
  };
  const historyRace = (raceId, date, gradeCode) => ({
    race_id: raceId,
    race_date: date,
    grade_code: gradeCode,
    data_kubun: "1",
    conditions: { age2: "000", age3: "000", age4: "999", age5Plus: "999", youngest: "000" },
  });
  const snapshot = {
    races: [targetRace],
    race_records: new Map(),
    horses: new Map([
      ["H1", { ketto_num: "H1", horse: "HORSE A", birth_date: "20210101", current_acquisition_money_yen: 50_000_000 }],
      ["H2", { ketto_num: "H2", horse: "HORSE B", birth_date: "20210101", current_acquisition_money_yen: 40_000_000 }],
      ["H3", { ketto_num: "H3", horse: "HORSE C", birth_date: "20210101", current_acquisition_money_yen: null }],
    ]),
    history: [
      {
        race: historyRace("R1", "2025-08-10", "B"),
        result: { race_id: "R1", race_date: "2025-08-10", ketto_num: "H1", finish: 1, age: 4, earned_main_prize_yen: 20_000_000 },
      },
      {
        race: historyRace("R2", "2024-09-01", "A"),
        result: { race_id: "R2", race_date: "2024-09-01", ketto_num: "H1", finish: 2, age: 5, earned_main_prize_yen: 12_000_000 },
      },
      {
        race: historyRace("R3", "2025-09-01", "D"),
        result: { race_id: "R3", race_date: "2025-09-01", ketto_num: "H2", finish: 1, age: 4, earned_main_prize_yen: 16_000_000 },
      },
      {
        race: historyRace("R4", "2025-09-01", "D"),
        result: { race_id: "R4", race_date: "2025-09-01", ketto_num: "H3", finish: 1, age: 4, earned_main_prize_yen: null },
      },
    ],
    target_data_updated_at: "2026-08-03T00:00:00.000Z",
    diagnostics: { ra_file_count: 1, se_file_count: 1 },
    warnings: [],
  };

  const payload = calculateRanking({
    snapshot,
    raceId: targetRace.race_id,
    generatedAt: "2026-08-08T00:00:00.000Z",
  });
  assert.equal(payload.rows.length, 3);
  assert.deepEqual(payload.rows.map((row) => row.horse), ["HORSE A", "HORSE B", "HORSE C"]);
  assert.equal(payload.rows[0].current_yen, 50_000_000);
  assert.equal(payload.rows[0].period1_yen, 10_000_000);
  assert.equal(payload.rows[0].period2_g1_yen, 6_000_000);
  assert.equal(payload.rows[0].decision_yen, 66_000_000);
  assert.equal(payload.rows[0].rank, 1);
  assert.equal(payload.rows[1].decision_yen, 48_000_000);
  assert.equal(payload.rows[1].rank, 2);
  assert.equal(payload.rows[2].period1_yen, null);
  assert.equal(payload.rows[2].decision_yen, null);
  assert.equal(payload.rows[2].rank, null);
});

test("treats a verified empty history as zero period money", () => {
  const race = {
    race_id: "R-empty-history",
    race_date: "2026-08-09",
    venue: "中京",
    name: "EMPTY HISTORY G3",
    grade: "GIII",
    grade_code: "C",
    conditions: { age2: "000", age3: "000", age4: "999", age5Plus: "999", youngest: "000" },
    race_type_code: "11",
    weight_type_code: "1",
    registration_count: 1,
    entries: [{ ketto_num: "EMPTY", horse: "EMPTY HORSE", weight_kg: null }],
  };
  const payload = calculateRanking({
    snapshot: {
      races: [race],
      race_records: new Map(),
      horses: new Map([["EMPTY", { ketto_num: "EMPTY", horse: "EMPTY HORSE", current_acquisition_money_yen: 30_000_000 }]]),
      history: [],
      target_data_updated_at: "2026-08-08T00:00:00.000Z",
      diagnostics: { ra_file_count: 1, se_file_count: 1 },
      warnings: [],
    },
    raceId: race.race_id,
  });
  assert.equal(payload.rows[0].period1_yen, 0);
  assert.equal(payload.rows[0].period2_g1_yen, 0);
  assert.equal(payload.rows[0].decision_yen, 30_000_000);
  assert.equal(payload.rows[0].ranking_status, "calculated");
  assert.equal(payload.rows[0].rank, 1);
});

test("saves one race at a time without deleting older race rankings", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-ranking-"));
  try {
    const first = {
      schema_version: 1,
      generated_at: "2026-08-08T00:00:00.000Z",
      stage: "special",
      race: { race_id: "R1", race_date: "2026-08-08", name: "RACE ONE" },
      rows: [],
    };
    const second = {
      ...first,
      race: { race_id: "R2", race_date: "2026-08-09", name: "RACE TWO" },
    };
    const firstSaved = saveRankingJson({ payload: first, repoRoot });
    saveRankingJson({ payload: second, repoRoot });
    const index = JSON.parse(await readFile(firstSaved.indexPath, "utf8"));
    assert.deepEqual(index.races.map((entry) => entry.race.race_id), ["R1", "R2"]);
    assert.equal(raceFileName(first), "2026-08-08-RACE-ONE-R1.json");
    assert.equal(JSON.parse(await readFile(firstSaved.filePath, "utf8")).race.race_id, "R1");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("replaces a provisional JRA race snapshot when TARGET supplies the same race", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-ranking-replace-"));
  try {
    const provisional = {
      schema_version: 1,
      generated_at: "2026-08-08T00:00:00.000Z",
      stage: "next",
      race: { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念" },
      rows: [],
    };
    const target = {
      ...provisional,
      stage: "special",
      race: { ...provisional.race, race_id: "2026081607010807" },
    };
    saveRankingJson({ payload: provisional, repoRoot });
    const saved = saveRankingJson({ payload: target, repoRoot });
    const index = JSON.parse(await readFile(saved.indexPath, "utf8"));
    assert.equal(index.races.length, 1);
    assert.equal(index.races[0].race.race_id, "2026081607010807");
    await assert.rejects(readFile(path.join(repoRoot, "app", "race-rankings", raceFileName(provisional))));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
