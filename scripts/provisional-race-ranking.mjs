import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { readCandidateEnrichmentState } from "./local-admin-data.mjs";
import { calculateRanking, findTargetHorseByName, readTargetSnapshot } from "./target-local-ranking.mjs";

function readJson(repoRoot, fileName, fallback) {
  const filePath = path.join(repoRoot, "app", fileName);
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readNextRacesJson(repoRoot) {
  const committed = readJson(repoRoot, "next-races.json", null);
  if (Array.isArray(committed?.rows)) return committed;
  const localPath = path.join(repoRoot, ".target-local", "next-races-cache.json");
  if (existsSync(localPath)) {
    try {
      return JSON.parse(readFileSync(localPath, "utf8"));
    } catch {
      // Use the committed snapshot when the local cache is incomplete.
    }
  }
  return { rows: [] };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .trim();
}

function horseIdFromUrl(value) {
  return String(value ?? "").match(/\/horse\/(\d{10})/)?.[1] ?? "";
}

function nextRaceGroupId(name, raceUrl) {
  const key = `${normalizeText(name)}\0${String(raceUrl ?? "").trim()}`;
  return `next-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

export function nextRaceCatalog({ repoRoot }) {
  const payload = readNextRacesJson(repoRoot);
  const groups = new Map();
  for (const row of Array.isArray(payload.rows) ? payload.rows : []) {
    const name = String(row?.next_race ?? "").trim();
    const raceUrl = String(row?.race_url ?? "").trim();
    if (!name || !/^https?:\/\//i.test(raceUrl)) continue;
    const key = `${normalizeText(name)}\0${raceUrl}`;
    const group = groups.get(key) ?? {
      race_id: nextRaceGroupId(name, raceUrl),
      name,
      race_date: null,
      venue: "",
      grade: "",
      conditions: "",
      full_gate: null,
      registration_count: 0,
      registration_count_status: "candidate_count",
      target_registration_count: null,
      status: "next",
      source_kind: "netkeiba",
      source_url: raceUrl,
      next_race_url: raceUrl,
    };
    group.registration_count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    normalizeText(left.name).localeCompare(normalizeText(right.name), "ja"),
  );
}

function sourcePrizeMoney(repoRoot) {
  const jra = readJson(repoRoot, "jra-prize-money.json", {});
  const dataLab = readJson(repoRoot, "data-lab-prize-money.json", []);
  const byName = new Map(
    Object.entries(jra).map(([horse, record]) => [horse, record?.yen ?? null]),
  );
  const byId = new Map(
    (Array.isArray(dataLab) ? dataLab : [])
      .filter((record) => record?.KettoNum && Number.isFinite(record?.PrizeYen))
      .map((record) => [record.KettoNum, record.PrizeYen]),
  );
  return { byName, byId };
}

function currentMoney({ horse, horseUrl, prizeMoney }) {
  const id = horseIdFromUrl(horseUrl);
  return prizeMoney.byId.get(id) ?? prizeMoney.byName.get(horse) ?? null;
}

function provisionalStatus(currentYen) {
  return currentYen === null
    ? "TARGET未登録・賞金未取得"
    : "TARGET未登録・期間未取得";
}

function enrichmentStatus(enrichment) {
  if (!enrichment) return "管理者確認・TARGET未確認";
  if (enrichment.current_yen !== null && enrichment.current_yen !== undefined) {
    return `管理者確認・${enrichment.current_metric ?? "収得賞金"}確認済み・期間未取得`;
  }
  return "管理者確認・賞金未取得";
}

function candidateRow({ horse, horseUrl = "", raceUrl = "", update = "", sourceKind, affiliation = "JRA", statusLabel, prizeMoney, currentOverride, currentMetric = null, warning = null, enrichment = null, kettoNum = null }) {
  const currentYen = currentOverride === undefined
    ? currentMoney({ horse, horseUrl, prizeMoney })
    : currentOverride;
  return {
    ketto_num: kettoNum || horseIdFromUrl(horseUrl) || null,
    horse,
    affiliation,
    jockey: "",
    current_yen: currentYen,
    period1_yen: null,
    period2_g1_yen: null,
    decision_yen: null,
    rank: null,
    ranking_status: "unavailable",
    status: "provisional",
    status_label: statusLabel ?? provisionalStatus(currentYen),
    current_metric: currentMetric,
    birth_date: enrichment?.birth_date ?? null,
    trainer: enrichment?.trainer ?? null,
    local_acquisition_yen: enrichment?.local_acquisition_yen ?? null,
    central_acquisition_yen: enrichment?.central_acquisition_yen ?? null,
    additional_acquisition_yen: enrichment?.additional_acquisition_yen ?? null,
    source_kind: sourceKind,
    weight_kg: null,
    horse_url: horseUrl,
    race_url: raceUrl,
    update,
    warnings: [
      "TARGET特別登録前のため期間収得賞金と順位を計算できません。",
      ...(warning ? [warning] : []),
    ],
    calculation_methods: [],
  };
}

export function nextRaceCandidates({ repoRoot, raceName, raceUrl = "" }) {
  const payload = readNextRacesJson(repoRoot);
  const targetName = normalizeText(raceName);
  const targetUrl = String(raceUrl ?? "").trim();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const unique = new Map();
  for (const row of rows) {
    if (normalizeText(row?.next_race) !== targetName) continue;
    if (targetUrl && String(row?.race_url ?? "").trim() !== targetUrl) continue;
    const horse = String(row?.horse ?? "").trim();
    if (!horse) continue;
    const key = horseIdFromUrl(row?.horse_url) || normalizeText(horse);
    unique.set(key, row);
  }
  return [...unique.values()];
}

function manualHorseKey(candidate) {
  return normalizeText(candidate?.horse);
}

export function buildProvisionalRanking({
  repoRoot,
  race,
  manualCandidates = [],
  targetRoot = null,
  generatedAt = new Date().toISOString(),
}) {
  if (!race?.race_date || !race?.name) throw new Error("暫定順位のレース情報が不足しています。");
  const prizeMoney = sourcePrizeMoney(repoRoot);
  const enrichmentById = new Map(
    readCandidateEnrichmentState({ repoRoot }).records.map((record) => [record.candidate_id, record]),
  );
  const rows = [];
  const knownHorses = new Set();
  for (const candidate of nextRaceCandidates({
    repoRoot,
    raceName: race.name,
    raceUrl: race.next_race_url,
  })) {
    const horse = String(candidate.horse ?? "").trim();
    const key = normalizeText(horse);
    if (!key || knownHorses.has(key)) continue;
    knownHorses.add(key);
    rows.push(candidateRow({
      horse,
      horseUrl: candidate.horse_url,
      raceUrl: candidate.race_url,
      update: candidate.update,
      sourceKind: "netkeiba",
      affiliation: "JRA",
      prizeMoney,
    }));
  }
  for (const candidate of manualCandidates) {
    const horse = String(candidate?.horse ?? "").trim();
    const key = manualHorseKey(candidate);
    if (!key || knownHorses.has(key)) continue;
    knownHorses.add(key);
    const enrichment = enrichmentById.get(candidate.candidate_id);
    const currentOverride = enrichment ? enrichment.current_yen : undefined;
    rows.push(candidateRow({
      horse,
      horseUrl: enrichment?.horse_url ?? candidate.horse_url ?? enrichment?.source_url ?? "",
      sourceKind: "admin_candidate",
      affiliation: candidate.affiliation ?? "地方",
      statusLabel: enrichmentStatus(enrichment),
      prizeMoney,
      currentOverride,
      currentMetric: enrichment?.current_metric ?? null,
      warning: enrichment?.warning ?? null,
      enrichment,
      kettoNum: candidate.ketto_num,
    }));
  }

  let targetSnapshot = null;
  let targetEstimate = false;
  let targetEntries = rows
    .filter((row) => row.ketto_num)
    .map((row) => ({ ketto_num: row.ketto_num, horse: row.horse, weight_kg: null }));
  if (targetRoot && rows.length) {
    try {
      targetSnapshot = readTargetSnapshot({
        targetRoot,
        raceDate: race.race_date,
        horseIds: targetEntries.map((entry) => entry.ketto_num),
        horseNames: rows.map((row) => row.horse),
      });
      for (const row of rows) {
        if (row.ketto_num) continue;
        const targetHorse = findTargetHorseByName(targetSnapshot, row.horse);
        if (targetHorse) row.ketto_num = targetHorse.ketto_num;
      }
      targetEntries = rows
        .filter((row) => row.ketto_num)
        .map((row) => ({ ketto_num: row.ketto_num, horse: row.horse, weight_kg: null }));
      if (!targetEntries.length) throw new Error("TARGET馬マスタで対象馬を特定できません。");
      const targetRace = {
        ...race,
        entries: targetEntries,
        conditions: typeof race.conditions === "object" && race.conditions
          ? race.conditions
          : { age2: "000", age3: "000", age4: "999", age5Plus: "999", youngest: "999" },
        grade_code: race.grade_code ?? null,
      };
      const calculated = calculateRanking({
        snapshot: { ...targetSnapshot, races: [targetRace] },
        raceId: race.race_id,
        raceOverride: targetRace,
      });
      const byKetto = new Map(calculated.rows.map((row) => [row.ketto_num, row]));
      for (const row of rows) {
        const targetRow = byKetto.get(row.ketto_num);
        if (!targetRow) continue;
        row.current_yen = targetRow.current_yen;
        row.current_metric = targetRow.current_yen === null ? row.current_metric : "TARGET UM収得賞金";
        row.period1_yen = targetRow.period1_yen;
        row.period2_g1_yen = targetRow.period2_g1_yen;
        row.decision_yen = targetRow.decision_yen;
        row.rank = targetRow.rank;
        row.ranking_status = targetRow.ranking_status;
        row.status_label = targetRow.status_label;
        row.warnings = targetRow.warnings;
        row.calculation_methods = targetRow.calculation_methods;
      }
      targetEstimate = true;
      rows.sort((a, b) => {
        if (a.rank === null && b.rank !== null) return 1;
        if (a.rank !== null && b.rank === null) return -1;
        if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
        return a.horse.localeCompare(b.horse, "ja");
      });
    } catch (error) {
      rows.forEach((row) => {
        if (row.source_kind === "netkeiba") {
          row.current_yen = null;
          row.period1_yen = null;
          row.period2_g1_yen = null;
          row.decision_yen = null;
          row.rank = null;
          row.ranking_status = "unavailable";
          row.status_label = "管理者確認・TARGET取得失敗";
          row.warnings = [...row.warnings, error instanceof Error ? error.message : String(error)];
        }
      });
    }
  }

  const warnings = [
    "TARGET特別登録前の暫定候補です。JRA公式番組をレース情報の正本として表示しています。",
    targetEstimate
      ? "選択したレースに限り、TARGETのUM・RA・SEから賞金を試算しています。"
      : "netkeiba候補と管理者確認候補を統合しています。正式な登録馬はTARGET特別登録データ取得後に確認してください。",
  ];
  if (!rows.length) warnings.push("候補馬が見つかりません。管理者確認候補を追加してください。");
  return {
    schema_version: 1,
    generated_at: generatedAt,
    stage: "next",
    source: "JRA official program + netkeiba next-race pages + admin candidates",
    source_url: race.source_url ?? "",
    period_basis: targetEstimate ? "approximate" : "not_available_before_target_registration",
    target_data_updated_at: targetSnapshot?.target_data_updated_at ?? null,
    race: {
      race_id: race.race_id,
      name: race.name,
      race_date: race.race_date,
      venue: race.venue,
      grade: race.grade ?? "",
      conditions: race.conditions ?? "",
      full_gate: race.full_gate ?? null,
      registration_count: rows.length,
      registration_count_status: "candidate_count",
      target_registration_count: null,
      period1_start: null,
      period2_start: null,
    },
    rows,
    warnings,
    calculation_note: targetEstimate
      ? "TARGET特別登録前の選択レース限定試算です。データ未取得は未取得のまま扱い、対象期間に出走がないことを確認できる場合だけ0円とします。"
      : "TARGET特別登録前の暫定一覧です。現在の収得賞金は既存の検証済みデータがある場合だけ表示し、データ未取得を0円にはしません。",
    diagnostics: {
      netkeiba_candidate_count: rows.filter((row) => row.source_kind === "netkeiba").length,
      admin_candidate_count: rows.filter((row) => row.source_kind === "admin_candidate").length,
      target_estimate: targetEstimate,
    },
  };
}

export function mergeManualCandidates({ payload, manualCandidates = [], repoRoot = null }) {
  if (!payload?.race) throw new Error("候補統合対象のレース情報が不足しています。");
  const rows = Array.isArray(payload.rows) ? [...payload.rows] : [];
  const knownHorses = new Set(rows.map((row) => normalizeText(row?.horse)));
  const prizeMoney = { byName: new Map(), byId: new Map() };
  const enrichmentById = repoRoot
    ? new Map(readCandidateEnrichmentState({ repoRoot }).records.map((record) => [record.candidate_id, record]))
    : new Map();
  for (const candidate of manualCandidates) {
    const horse = String(candidate?.horse ?? "").trim();
    const key = manualHorseKey(candidate);
    if (!key) continue;
    const existing = rows.find((row) => normalizeText(row?.horse) === key);
    if (existing) {
      existing.status_label = "TARGET確認済み";
      existing.source_kind = "target_registration";
      continue;
    }
    if (knownHorses.has(key)) continue;
    knownHorses.add(key);
    const enrichment = enrichmentById.get(candidate.candidate_id);
    const currentOverride = enrichment ? enrichment.current_yen : undefined;
    rows.push(candidateRow({
      horse,
      horseUrl: candidate.horse_url,
      sourceKind: "admin_candidate",
      affiliation: candidate.affiliation ?? "地方",
      statusLabel: enrichmentStatus(enrichment),
      prizeMoney,
      currentOverride,
      currentMetric: enrichment?.current_metric ?? null,
      warning: enrichment?.warning ?? null,
      enrichment,
      kettoNum: candidate.ketto_num,
    }));
  }
  return {
    ...payload,
    race: {
      ...payload.race,
      target_registration_count: payload.race.registration_count,
      registration_count: rows.length,
      registration_count_status: rows.length === payload.race.registration_count
        ? payload.race.registration_count_status ?? "target_registration"
        : "target_plus_admin_candidates",
    },
    rows,
  };
}
