#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sjis = new TextDecoder("shift_jis");

export const DEFAULT_TARGET_ROOT = "D:\\TFJV";
export const RECORD_SIZES = Object.freeze({ RA: 1272, SE: 555, UM: 1609 });

const VENUES = Object.freeze({
  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉",
});

const GRADE_LABELS = Object.freeze({
  A: "GI",
  B: "GII",
  C: "GIII",
  D: "重賞",
  E: "特別",
  F: "J・GI",
  G: "J・GII",
  H: "J・GIII",
  L: "L",
});

const JRA_GRADED_CODES = new Set(["A", "B", "C", "D", "F", "G", "H"]);
const G1_CODES = new Set(["A", "F"]);

function decode(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) return "";
  return sjis.decode(bytes.subarray(offset, offset + length)).replace(/[\0\r\n]+$/g, "").trim();
}

function parseInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  return Number(normalized);
}

function parseHundredYen(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return null;
  return Number(normalized) * 100;
}

function dataDate(bytes) {
  return decode(bytes, 3, 8);
}

function raceDate(bytes) {
  return `${decode(bytes, 11, 4)}${decode(bytes, 15, 4)}`;
}

function raceId(bytes) {
  return decode(bytes, 11, 16);
}

function normalizeDate(value) {
  const normalized = String(value ?? "").replaceAll("-", "").trim();
  if (!/^\d{8}$/.test(normalized)) return null;
  const candidate = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  return validDateString(candidate) ? candidate : null;
}

function validDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function subtractCalendarYears(date, years) {
  if (!validDateString(date)) throw new Error(`Invalid race date: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  const targetYear = year - years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function addUniqueWarning(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function listFiles(root, predicate = () => true) {
  const files = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) return files;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && predicate(fullPath, entry.name)) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function yearsBetween(startDate, endDateExclusive) {
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDateExclusive.slice(0, 4));
  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => String(firstYear + index));
}

function latestRegistrationFiles(root) {
  const files = listFiles(path.join(root, "DE_DATA"), (_, name) => /^TK\d{8}\.DAT$/i.test(name))
    .map((filePath) => ({ filePath, date: path.basename(filePath).slice(2, 10) }))
    .filter((item) => validDateString(`${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`));
  if (!files.length) return [];
  const latestDate = files.reduce((latest, item) => (item.date > latest ? item.date : latest), "");
  return files.filter((item) => item.date === latestDate).map((item) => item.filePath);
}

function historyFiles(root, type, startDate, endDateExclusive) {
  const directory = path.join(root, "SE_DATA");
  const pattern = type === "RA" ? /^SR\d{6}\.DAT$/i : /^SU\d{6}\.DAT$/i;
  return yearsBetween(startDate, endDateExclusive).flatMap((year) =>
    listFiles(path.join(directory, year), (_, name) => pattern.test(name)),
  );
}

function horseMasterFiles(root, horseIds) {
  const years = new Set(
    [...horseIds]
      .map((kettoNum) => String(kettoNum).slice(0, 4))
      .filter((year) => /^\d{4}$/.test(year)),
  );
  return [...years].flatMap((year) =>
    listFiles(path.join(root, "UM_DATA", year), (_, name) => /^UM.*\.DAT$/i.test(name)),
  );
}

function discoverRecordFiles(root, { raceDate = null, horseIds = new Set() } = {}) {
  const files = { TK: latestRegistrationFiles(root), RA: [], SE: [], UM: [] };
  if (!raceDate) return files;
  const startDate = subtractCalendarYears(raceDate, 2);
  files.RA = historyFiles(root, "RA", startDate, raceDate);
  files.SE = historyFiles(root, "SE", startDate, raceDate);
  files.UM = horseMasterFiles(root, horseIds);
  return files;
}

function parseFixedRecords(filePath, type, recordSize) {
  const bytes = readFileSync(filePath);
  const records = [];
  for (let offset = 0; offset + recordSize <= bytes.length; offset += recordSize) {
    const record = bytes.subarray(offset, offset + recordSize);
    if (record.toString("ascii", 0, 2) !== type) continue;
    records.push(Buffer.from(record));
  }
  return records;
}

function parseTkRecords(filePath) {
  const bytes = readFileSync(filePath);
  const records = [];
  for (let offset = 0; offset + 657 <= bytes.length; ) {
    if (bytes.toString("ascii", offset, offset + 2) !== "TK") {
      offset += 1;
      continue;
    }
    const count = parseInteger(decode(bytes, offset + 652, 3));
    if (count === null || count < 0 || count > 300) {
      offset += 1;
      continue;
    }
    const recordSize = 657 + count * 70;
    if (offset + recordSize > bytes.length) break;
    records.push(Buffer.from(bytes.subarray(offset, offset + recordSize)));
    offset += recordSize;
  }
  return records;
}

function latestRecord(map, key, record, createdAt, filePath = null) {
  if (!key) return;
  const dataKubun = decode(record, 2, 1);
  if (dataKubun === "0") {
    map.delete(key);
    return;
  }
  const previous = map.get(key);
  if (!previous || createdAt >= previous.createdAt) {
    map.set(key, { record, createdAt, filePath });
  }
}

function ageFromDate(birthDate, eventDate) {
  const birth = String(birthDate ?? "").trim();
  const event = String(eventDate ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(birth) || !/^\d{8}$/.test(event)) return null;
  return Number(event.slice(0, 4)) - Number(birth.slice(0, 4));
}

export function parseTkRecord(record) {
  const registeredCount = parseInteger(decode(record, 652, 3));
  if (registeredCount === null) throw new Error("TK registered count is invalid");
  const date = normalizeDate(raceDate(record));
  const id = raceId(record);
  const entries = [];
  for (let index = 0; index < registeredCount; index += 1) {
    const offset = 655 + index * 70;
    const kettoNum = decode(record, offset + 3, 10);
    const horse = decode(record, offset + 13, 36);
    const rawWeight = decode(record, offset + 66, 3);
    const weightValue = parseInteger(rawWeight);
    entries.push({
      sequence: index + 1,
      ketto_num: kettoNum || null,
      horse: horse || null,
      weight_kg: weightValue && weightValue > 0 ? weightValue / 10 : null,
    });
  }
  return {
    race_id: id,
    race_date: date,
    venue_code: decode(record, 19, 2),
    venue: VENUES[decode(record, 19, 2)] ?? decode(record, 19, 2),
    meeting_number: decode(record, 21, 2),
    meeting_day: decode(record, 23, 2),
    race_number: decode(record, 25, 2),
    name: decode(record, 32, 60),
    grade_code: decode(record, 614, 1),
    grade: GRADE_LABELS[decode(record, 614, 1)] ?? "",
    race_type_code: decode(record, 615, 2),
    symbol_code: decode(record, 617, 3),
    weight_type_code: decode(record, 620, 1),
    conditions: {
      age2: decode(record, 621, 3),
      age3: decode(record, 624, 3),
      age4: decode(record, 627, 3),
      age5Plus: decode(record, 630, 3),
      youngest: decode(record, 633, 3),
    },
    distance_m: parseInteger(decode(record, 636, 4)),
    track_code: decode(record, 640, 2),
    handicap_date: normalizeDate(decode(record, 644, 8)),
    registration_count: registeredCount,
    entries,
    data_created_at: dataDate(record),
  };
}

export function parseRaRecord(record) {
  const date = normalizeDate(raceDate(record));
  const gradeCode = decode(record, 614, 1);
  const conditions = {
    age2: decode(record, 622, 3),
    age3: decode(record, 625, 3),
    age4: decode(record, 628, 3),
    age5Plus: decode(record, 631, 3),
    youngest: decode(record, 634, 3),
  };
  return {
    race_id: raceId(record),
    race_date: date,
    venue_code: decode(record, 19, 2),
    venue: VENUES[decode(record, 19, 2)] ?? decode(record, 19, 2),
    race_number: decode(record, 25, 2),
    name: decode(record, 32, 60),
    grade_code: gradeCode,
    grade: GRADE_LABELS[gradeCode] ?? "",
    data_kubun: decode(record, 2, 1),
    race_type_code: decode(record, 616, 2),
    symbol_code: decode(record, 618, 3),
    weight_type_code: decode(record, 621, 1),
    conditions,
    distance_m: parseInteger(decode(record, 698, 4)),
    track_code: decode(record, 706, 2),
    first_prize_yen: parseHundredYen(decode(record, 713, 8)),
    prize_yen_by_finish: [1, 2, 3, 4, 5].map((finish) =>
      parseHundredYen(decode(record, 713 + (finish - 1) * 8, 8)),
    ),
    registration_count: parseInteger(decode(record, 881, 2)),
    data_created_at: dataDate(record),
  };
}

export function parseSeRecord(record) {
  return {
    race_id: raceId(record),
    race_date: normalizeDate(raceDate(record)),
    data_kubun: decode(record, 2, 1),
    ketto_num: decode(record, 30, 10),
    horse: decode(record, 40, 36),
    age: parseInteger(decode(record, 82, 2)),
    finish: parseInteger(decode(record, 334, 2)),
    earned_main_prize_yen: parseHundredYen(decode(record, 365, 8)),
    data_created_at: dataDate(record),
  };
}

export function parseUmRecord(record) {
  const key = decode(record, 11, 10);
  const birthDate = decode(record, 21, 8);
  return {
    ketto_num: key,
    horse: decode(record, 46, 36),
    birth_date: birthDate,
    current_acquisition_money_yen: parseHundredYen(decode(record, 1088, 9)),
    source_field: "UM 平地収得賞金累計 (offset 1088, length 9, unit 100 yen)",
    data_kubun: decode(record, 2, 1),
    data_created_at: dataDate(record),
  };
}

function parseRecordsFromFiles(files, type, { startDate = null, endDateExclusive = null, kettoNums = null, raceIds = null } = {}) {
  const records = [];
  const size = RECORD_SIZES[type];
  const parse = type === "RA" ? parseRaRecord : type === "SE" ? parseSeRecord : parseUmRecord;
  for (const filePath of files) {
    const parsed = parseFixedRecords(filePath, type, size);
    for (const record of parsed) {
      const value = parse(record);
      if (startDate && (!value.race_date || value.race_date < startDate || value.race_date >= endDateExclusive)) continue;
      if (kettoNums && type === "SE" && !kettoNums.has(value.ketto_num)) continue;
      if (raceIds && type === "RA" && !raceIds.has(value.race_id)) continue;
      records.push({ record, filePath });
    }
  }
  return records;
}

function parseTkFromFiles(files) {
  const records = [];
  for (const filePath of files) {
    for (const record of parseTkRecords(filePath)) records.push({ record, filePath });
  }
  return records;
}

function chooseLatestTk(records) {
  const map = new Map();
  for (const item of records) {
    const parsed = parseTkRecord(item.record);
    const previous = map.get(parsed.race_id);
    if (decode(item.record, 2, 1) === "0") {
      map.delete(parsed.race_id);
    } else if (!previous || parsed.data_created_at >= previous.data_created_at) {
      map.set(parsed.race_id, { ...parsed, source_file: item.filePath });
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.race_date ?? ""}${a.name}`.localeCompare(`${b.race_date ?? ""}${b.name}`, "ja"),
  );
}

function chooseLatestHorses(records) {
  const map = new Map();
  for (const item of records) {
    const parsed = parseUmRecord(item.record);
    if (!parsed.ketto_num) continue;
    const previous = map.get(parsed.ketto_num);
    if (parsed.data_kubun === "0") map.delete(parsed.ketto_num);
    else if (!previous || parsed.data_created_at >= previous.data_created_at) {
      map.set(parsed.ketto_num, parsed);
    }
  }
  return map;
}

function chooseLatestRaces(records) {
  const map = new Map();
  for (const item of records) {
    const parsed = parseRaRecord(item.record);
    if (!parsed.race_id) continue;
    latestRecord(map, parsed.race_id, item.record, parsed.data_created_at, item.filePath);
  }
  return new Map(
    [...map].map(([key, value]) => [key, { ...parseRaRecord(value.record), source_file: value.filePath }]),
  );
}

function chooseLatestResults(records) {
  const map = new Map();
  for (const item of records) {
    const parsed = parseSeRecord(item.record);
    if (!parsed.race_id || !parsed.ketto_num) continue;
    latestRecord(
      map,
      `${parsed.race_id}\0${parsed.ketto_num}`,
      item.record,
      parsed.data_created_at,
      item.filePath,
    );
  }
  return new Map(
    [...map].map(([key, value]) => [key, parseSeRecord(value.record)]),
  );
}

function maxFileMtime(files) {
  let latest = 0;
  for (const filePath of files) {
    try {
      latest = Math.max(latest, statSync(filePath).mtimeMs);
    } catch {
      // A file can disappear between discovery and reading; the read step reports it.
    }
  }
  return latest ? new Date(latest).toISOString() : null;
}

function formatConditions(race) {
  const typeLabels = {
    "11": "2歳",
    "12": "3歳",
    "13": "3歳以上",
    "14": "4歳以上",
    "18": "障害3歳以上",
    "19": "障害4歳以上",
  };
  const weightLabels = { "1": "ハンデ", "2": "別定", "3": "馬齢", "4": "定量" };
  const conditionValues = Object.values(race.conditions).filter(Boolean);
  const condition = conditionValues.includes("999")
    ? "OPEN"
    : conditionValues.find((value) => value !== "000") ?? "未設定";
  return [typeLabels[race.race_type_code] ?? race.race_type_code, condition, weightLabels[race.weight_type_code] ?? ""]
    .filter(Boolean)
    .join("・");
}

export function resolveTargetRoot(value = process.env.TARGET_DATA_ROOT || DEFAULT_TARGET_ROOT) {
  const root = path.resolve(value);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`TARGETデータルートが見つかりません: ${root}`);
  }
  const dataFolders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /_DATA$/i.test(entry.name))
    .map((entry) => entry.name);
  if (!dataFolders.length) {
    throw new Error(`TARGETの *_DATA フォルダが見つかりません: ${root}`);
  }
  return { root, dataFolders };
}

export function readTargetSnapshot({ targetRoot = DEFAULT_TARGET_ROOT, raceDate = null, raceId = null, horseIds = null } = {}) {
  const resolved = resolveTargetRoot(targetRoot);
  const date = raceDate ? normalizeDate(raceDate) : null;
  const historyStart = date ? subtractCalendarYears(date, 2) : null;
  const historyEnd = date;
  const registrationFiles = discoverRecordFiles(resolved.root);
  const registrationTkFiles = registrationFiles.TK;
  const allRaces = chooseLatestTk(parseTkFromFiles(registrationTkFiles));
  const latestRegistrationDate = allRaces.reduce(
    (latest, race) => (race.data_created_at > latest ? race.data_created_at : latest),
    "",
  );
  const races = latestRegistrationDate
    ? allRaces.filter((race) => race.data_created_at === latestRegistrationDate)
    : allRaces;
  const selectedRace = raceId ? races.find((race) => race.race_id === raceId) : null;
  const targetHorseIds = new Set(
    horseIds ?? selectedRace?.entries.map((entry) => entry.ketto_num).filter(Boolean) ?? [],
  );
  const discoveredFiles = date
    ? discoverRecordFiles(resolved.root, { raceDate: date, horseIds: targetHorseIds })
    : registrationFiles;
  const tkFiles = discoveredFiles.TK;
  const umFiles = discoveredFiles.UM;
  const raFiles = discoveredFiles.RA;
  const seFiles = discoveredFiles.SE;
  const allUsedFiles = [...tkFiles, ...umFiles, ...raFiles, ...seFiles];

  const horses = chooseLatestHorses(parseRecordsFromFiles(umFiles, "UM"));
  const resultItems = parseRecordsFromFiles(seFiles, "SE", {
    startDate: historyStart,
    endDateExclusive: historyEnd,
    kettoNums: targetHorseIds,
  });
  const resultRecords = chooseLatestResults(resultItems);
  const historyRaceIds = new Set([...resultRecords.values()].map((result) => result.race_id));
  const raceRecords = chooseLatestRaces(parseRecordsFromFiles(raFiles, "RA", {
    startDate: historyStart,
    endDateExclusive: historyEnd,
    raceIds: historyRaceIds,
  }));
  const history = [];
  for (const [key, result] of resultRecords) {
    const race = raceRecords.get(result.race_id);
    if (!race || !result.race_date) continue;
    if (date && (result.race_date < historyStart || result.race_date >= historyEnd)) continue;
    history.push({ race, result, key });
  }

  const warnings = [];
  if (!tkFiles.length) addUniqueWarning(warnings, "TK特別登録レコードが見つかりません。");
  if (date && !raFiles.length) addUniqueWarning(warnings, "対象期間のRAレースレコードが見つかりません。");
  if (date && !seFiles.length) addUniqueWarning(warnings, "対象期間のSE馬毎レースレコードが見つかりません。");
  if (date && !umFiles.length) addUniqueWarning(warnings, "UM競走馬マスタレコードが見つかりません。");

  return {
    target_root: resolved.root,
    data_folders: resolved.dataFolders,
    races,
    horses,
    race_records: raceRecords,
    history,
    target_data_updated_at: maxFileMtime(allUsedFiles),
    diagnostics: {
      tk_file_count: tkFiles.length,
      um_file_count: umFiles.length,
      ra_file_count: raFiles.length,
      se_file_count: seFiles.length,
      registration_race_count: races.length,
      horse_master_count: horses.size,
      history_result_count: history.length,
    },
    warnings,
  };
}

function conditionCodeForAge(race, age) {
  if (age === 2) return race.conditions.age2;
  if (age === 3) return race.conditions.age3;
  if (age === 4) return race.conditions.age4;
  if (age >= 5) return race.conditions.age5Plus;
  return race.conditions.youngest;
}

export function classLabelForRace(race, age) {
  const code = conditionCodeForAge(race, age);
  return {
    "005": "ONE_WIN",
    "010": "TWO_WIN",
    "016": "THREE_WIN",
    "701": "NEW",
    "702": "UNRACED",
    "703": "MAIDEN",
    "999": "OPEN",
  }[code] ?? (code || null);
}

function localForeignAcquisition(mainPrizeYen, finish) {
  if (mainPrizeYen === null) return null;
  const thresholds = finish === 1
    ? [[12_000_000, 0.5], [4_000_000, null], [0, 1]]
    : [[4_800_000, 0.5], [1_600_000, null], [0, 1]];
  for (const [threshold, ratio] of thresholds) {
    if (mainPrizeYen >= threshold) {
      if (ratio === 0.5) return Math.round(mainPrizeYen * ratio);
      if (ratio === null) return finish === 1 ? 4_000_000 : 1_600_000;
      return mainPrizeYen;
    }
  }
  return null;
}

export function calculateEarnedMoney({ race, result, horse }) {
  const finish = result.finish;
  if (finish === null || finish === undefined) {
    return {
      yen: null,
      method: null,
      warning: "着順が未取得のため収得賞金を算定できません。",
    };
  }
  if (finish !== 1 && finish !== 2) {
    return { yen: 0, method: "no acquisition for this placing", warning: null };
  }

  const mainPrizeYen = result.earned_main_prize_yen;
  if (race.data_kubun === "A" || race.data_kubun === "B") {
    const yen = localForeignAcquisition(mainPrizeYen, finish);
    return yen === null
      ? { yen: null, method: null, warning: "地方・海外レースの本賞金が未取得のため収得賞金を算定できません。" }
      : { yen, method: "JRA地方・海外レース算入規則", warning: null };
  }

  const birthAge = horse?.birth_date ? ageFromDate(horse.birth_date, race.race_date) : null;
  const age = result.age ?? birthAge;
  if (age === null) {
    return { yen: null, method: null, warning: "出走時年齢が未取得のためJRA収得賞金規則を適用できません。" };
  }

  if (JRA_GRADED_CODES.has(race.grade_code)) {
    if (race.grade_code === "C" && age === 2) {
      return {
        yen: finish === 1 ? 16_000_000 : 6_000_000,
        method: "JRA 2歳GIII収得賞金規則",
        warning: null,
      };
    }
    if (mainPrizeYen === null) {
      return { yen: null, method: null, warning: "重賞の本賞金が未取得のため収得賞金を算定できません。" };
    }
    return {
      yen: Math.round(mainPrizeYen / 2),
      method: "JRA重賞の該当着順本賞金の2分の1",
      warning: null,
    };
  }

  const code = conditionCodeForAge(race, age);
  if (["701", "702", "703"].includes(code)) {
    return { yen: 4_000_000, method: "JRA新馬・未勝利競走の収得賞金規則", warning: null };
  }
  if (code === "005") return { yen: 5_000_000, method: "JRA 1勝クラスの収得賞金規則", warning: null };
  if (code === "010") return { yen: 6_000_000, method: "JRA 2勝クラスの収得賞金規則", warning: null };
  if (code === "016") return { yen: 9_000_000, method: "JRA 3勝クラスの収得賞金規則", warning: null };
  if (code === "999") {
    if (race.grade_code === "L") {
      return {
        yen: age === 2 ? 8_000_000 : age === 3 ? 12_000_000 : 14_000_000,
        method: "JRAリステッド競走の収得賞金規則",
        warning: null,
      };
    }
    return {
      yen: age === 2 ? 6_000_000 : age === 3 ? 10_000_000 : 12_000_000,
      method: "JRA重賞以外のオープン競走の収得賞金規則",
      warning: null,
    };
  }
  return {
    yen: null,
    method: null,
    warning: `競走条件コード ${code || "未設定"} の収得賞金規則が特定できません。`,
  };
}

function buildPeriods(raceDate) {
  return {
    period1_start: subtractCalendarYears(raceDate, 1),
    period2_start: subtractCalendarYears(raceDate, 2),
    period_end_exclusive: raceDate,
  };
}

function resultForHorse(history, kettoNum) {
  return history.filter((item) => item.result.ketto_num === kettoNum);
}

function calculateHorseAmounts({ horse, performances, periods, historyAvailable }) {
  let period1Yen = 0;
  let period2G1Yen = 0;
  let period1Missing = false;
  let period2Missing = false;
  const warnings = [];
  const methods = [];

  for (const performance of performances) {
    const date = performance.result.race_date;
    const inPeriod1 = date >= periods.period1_start && date < periods.period_end_exclusive;
    const inPeriod2 = date >= periods.period2_start && date < periods.period_end_exclusive;
    const isG1 = G1_CODES.has(performance.race.grade_code);
    if (!inPeriod1 && !(inPeriod2 && isG1)) continue;
    const calculated = calculateEarnedMoney({ race: performance.race, result: performance.result, horse });
    if (calculated.warning) addUniqueWarning(warnings, calculated.warning);
    if (calculated.method) methods.push(calculated.method);
    if (inPeriod1) {
      if (calculated.yen === null) period1Missing = true;
      else period1Yen += calculated.yen;
    }
    if (inPeriod2 && isG1) {
      if (calculated.yen === null) period2Missing = true;
      else period2G1Yen += calculated.yen;
    }
  }

  if (!historyAvailable) {
    period1Missing = true;
    period2Missing = true;
    addUniqueWarning(warnings, "対象期間のRA/SE履歴を確認できないため、期間賞金は未取得です。");
  }

  return {
    period1_yen: period1Missing ? null : period1Yen,
    period2_g1_yen: period2Missing ? null : period2G1Yen,
    warnings,
    methods: [...new Set(methods)],
  };
}

function calculateRaceRow({ entry, snapshot, periods }) {
  const horse = entry.ketto_num ? snapshot.horses.get(entry.ketto_num) : null;
  const performances = entry.ketto_num ? resultForHorse(snapshot.history, entry.ketto_num) : [];
  const amounts = calculateHorseAmounts({
    horse,
    performances,
    periods,
    historyAvailable: snapshot.diagnostics.ra_file_count > 0 && snapshot.diagnostics.se_file_count > 0,
  });
  const warnings = [...amounts.warnings];
  const currentYen = horse?.current_acquisition_money_yen ?? null;
  if (currentYen === null) addUniqueWarning(warnings, "UM競走馬マスタから現在の収得賞金を取得できません。");
  const decisionYen = currentYen !== null && amounts.period1_yen !== null && amounts.period2_g1_yen !== null
    ? currentYen + amounts.period1_yen + amounts.period2_g1_yen
    : null;
  if (decisionYen === null) addUniqueWarning(warnings, "賞金未取得のため順位計算対象外です。");
  return {
    ketto_num: entry.ketto_num,
    horse: entry.horse ?? horse?.horse ?? "",
    horse_class: performances.length
      ? classLabelForRace(performances[0].race, performances[0].result.age)
      : null,
    jockey: "",
    current_yen: currentYen,
    period1_yen: amounts.period1_yen,
    period2_g1_yen: amounts.period2_g1_yen,
    decision_yen: decisionYen,
    rank: null,
    ranking_status: decisionYen === null ? "unavailable" : "calculated",
    weight_kg: entry.weight_kg,
    warnings,
    calculation_methods: amounts.methods,
  };
}

function applyRanking(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (a.decision_yen === null && b.decision_yen !== null) return 1;
    if (a.decision_yen !== null && b.decision_yen === null) return -1;
    if (a.decision_yen !== null && b.decision_yen !== null && a.decision_yen !== b.decision_yen) {
      return b.decision_yen - a.decision_yen;
    }
    return (a.horse ?? "").localeCompare(b.horse ?? "", "ja");
  });
  let previous = null;
  let rank = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index];
    if (row.decision_yen === null) {
      row.rank = null;
      continue;
    }
    if (row.decision_yen !== previous) rank = index + 1;
    row.rank = rank;
    previous = row.decision_yen;
  }
  return sorted;
}

export function calculateRanking({ snapshot, raceId, generatedAt = new Date().toISOString() }) {
  const race = snapshot.races.find((item) => item.race_id === raceId);
  if (!race) throw new Error(`TARGET特別登録レースが見つかりません: ${raceId}`);
  if (!race.race_date) throw new Error(`TARGET特別登録レースの開催日が未取得です: ${raceId}`);
  if (!race.entries.length) throw new Error(`TARGET特別登録馬が0頭です: ${race.name}`);

  const periods = buildPeriods(race.race_date);
  const rankingRace = snapshot.race_records.get(race.race_id) ?? race;
  const rows = applyRanking(
    race.entries.map((entry) => calculateRaceRow({ entry, snapshot, periods })),
  );
  const warnings = [...snapshot.warnings];
  if (rows.some((row) => row.current_yen === null)) addUniqueWarning(warnings, "現在の収得賞金を取得できない登録馬があります。");
  if (rows.some((row) => row.period1_yen === null || row.period2_g1_yen === null)) {
    addUniqueWarning(warnings, "期間収得賞金を取得できない登録馬があります。");
  }
  if (rankingRace.full_gate === null || rankingRace.full_gate === undefined) {
    addUniqueWarning(warnings, "フルゲート数をTARGETローカルレコードから取得できないため未取得です。");
  }

  const fullGate = Number.isInteger(rankingRace.full_gate) ? rankingRace.full_gate : null;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    source: "TARGET local data",
    period_basis: "approximate",
    target_data_updated_at: snapshot.target_data_updated_at,
    race: {
      race_id: race.race_id,
      name: race.name,
      race_date: race.race_date,
      venue: race.venue,
      grade: race.grade,
      conditions: formatConditions(race),
      full_gate: fullGate,
      registration_count: race.registration_count,
      period1_start: periods.period1_start,
      period2_start: periods.period2_start,
    },
    rows,
    warnings,
    calculation_note: "TARGETのUM平地収得賞金累計とRA/SE履歴を使用し、期間は開催日からの暦年概算です。SEの獲得本賞金を収得賞金として直接加算していません。",
    diagnostics: snapshot.diagnostics,
  };
}

function slugRaceName(value) {
  const slug = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\s　]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "race";
}

export function raceFileName(payload) {
  return `${payload.race.race_date}-${slugRaceName(payload.race.name)}-${slugRaceName(payload.race.race_id)}.json`;
}

function writeJsonAtomically(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function readJsonIfPresent(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function saveRankingJson({ payload, repoRoot }) {
  if (!payload?.race?.race_id || !payload?.race?.race_date) throw new Error("保存対象のレース情報が不足しています。");
  const directory = path.join(repoRoot, "app", "race-rankings");
  mkdirSync(directory, { recursive: true });
  const fileName = raceFileName(payload);
  const filePath = path.join(directory, fileName);
  writeJsonAtomically(filePath, payload);

  const indexPath = path.join(directory, "index.json");
  const current = readJsonIfPresent(indexPath, { schema_version: 1, generated_at: null, races: [] });
  const entry = { ...payload, file: fileName };
  const races = Array.isArray(current.races) ? current.races : [];
  const sameRace = (item) =>
    item?.race?.race_id === payload.race.race_id ||
    (item?.race?.race_date === payload.race.race_date &&
      item?.race?.name === payload.race.name &&
      item?.race?.venue === payload.race.venue);
  const nextRaces = races.filter((item) => !sameRace(item));
  nextRaces.push(entry);
  nextRaces.sort((a, b) =>
    `${a.race?.race_date ?? ""}${a.race?.name ?? ""}`.localeCompare(`${b.race?.race_date ?? ""}${b.race?.name ?? ""}`, "ja"),
  );
  writeJsonAtomically(indexPath, {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    races: nextRaces,
  });
  return { filePath, indexPath, fileName };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2).replaceAll("-", "_");
    if (key === "list" || key === "preview" || key === "save") args[key] = true;
    else args[key] = argv[++index];
  }
  return args;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const registrationSnapshot = readTargetSnapshot({ targetRoot: args.data_root });
    if (args.list) {
      console.log(JSON.stringify({
        races: registrationSnapshot.races,
        diagnostics: registrationSnapshot.diagnostics,
        warnings: registrationSnapshot.warnings,
      }, null, 2));
    } else {
      if (!args.race_id) throw new Error("--race-id is required unless --list is used.");
      const registration = registrationSnapshot.races.find((race) => race.race_id === args.race_id);
      if (!registration) throw new Error(`TARGET特別登録レースが見つかりません: ${args.race_id}`);
      const snapshot = readTargetSnapshot({
        targetRoot: args.data_root,
        raceDate: args.race_date || registration.race_date,
        raceId: args.race_id,
        horseIds: registration.entries.map((entry) => entry.ketto_num).filter(Boolean),
      });
      const payload = calculateRanking({ snapshot, raceId: args.race_id });
      if (args.save) {
        const result = saveRankingJson({ payload, repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") });
        console.error(`Saved ${result.filePath}`);
      }
      console.log(JSON.stringify(payload, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
