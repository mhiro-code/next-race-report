import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { normalizeDate } from "./jra-race-program.mjs";

const LOCAL_DIRECTORY = ".target-local";
const MANUAL_CANDIDATES_FILE = "manual-candidates.json";
const ENRICHMENT_FILE = "candidate-enrichment.json";
const JRA_CACHE_DIRECTORY = "jra-program-cache";
export const JRA_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function localPath(repoRoot, ...parts) {
  return path.join(repoRoot, LOCAL_DIRECTORY, ...parts);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .trim();
}

export function raceSignature(race) {
  return [race?.race_date, race?.venue, race?.name]
    .map(normalizeText)
    .join("\0");
}

function horseSignature(value) {
  return normalizeText(value);
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

export function readManualCandidateState({ repoRoot }) {
  const filePath = localPath(repoRoot, MANUAL_CANDIDATES_FILE);
  const value = readJson(filePath, { schema_version: 1, candidates: [] });
  return {
    filePath,
    schema_version: 1,
    candidates: Array.isArray(value?.candidates) ? value.candidates : [],
  };
}

export function findManualCandidates({ repoRoot, race }) {
  const signature = raceSignature(race);
  return readManualCandidateState({ repoRoot }).candidates.filter(
    (candidate) => candidate?.race_signature === signature,
  );
}

export function readCandidateEnrichmentState({ repoRoot }) {
  const filePath = localPath(repoRoot, ENRICHMENT_FILE);
  const value = readJson(filePath, { schema_version: 1, records: [] });
  return {
    filePath,
    schema_version: 1,
    records: Array.isArray(value?.records) ? value.records : [],
  };
}

export function saveCandidateEnrichment({ repoRoot, enrichment }) {
  if (!enrichment?.candidate_id) throw new Error("候補識別子が不足しています。");
  const state = readCandidateEnrichmentState({ repoRoot });
  const records = state.records.filter((record) => record?.candidate_id !== enrichment.candidate_id);
  records.push(enrichment);
  const filePath = localPath(repoRoot, ENRICHMENT_FILE);
  writeJsonAtomically(filePath, { schema_version: 1, updated_at: new Date().toISOString(), records });
  return { enrichment, filePath };
}

export function readFreshCandidateEnrichment({ repoRoot, candidate, maxAgeMs = JRA_CACHE_MAX_AGE_MS, now = Date.now() }) {
  const record = readCandidateEnrichmentState({ repoRoot }).records.find(
    (item) => item?.candidate_id === candidate?.candidate_id && item?.source_url === candidate?.source_url,
  );
  if (!record?.fetched_at) return null;
  const fetchedAt = Date.parse(record.fetched_at);
  if (!Number.isFinite(fetchedAt) || now - fetchedAt < 0 || now - fetchedAt > maxAgeMs) return null;
  return record;
}

export function saveManualCandidate({
  repoRoot,
  race,
  horse,
  sourceNote,
  sourceUrl = "",
}) {
  const normalizedHorse = String(horse ?? "").trim();
  const normalizedNote = String(sourceNote ?? "").trim();
  if (!race?.race_date || !race?.name) throw new Error("候補を追加するレース情報が不足しています。");
  if (!normalizedHorse) throw new Error("馬名を入力してください。");
  if (!normalizedNote) throw new Error("情報源メモを入力してください。");
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    throw new Error("情報源URLはhttpまたはhttpsで指定してください。");
  }

  const state = readManualCandidateState({ repoRoot });
  const now = new Date().toISOString();
  const signature = raceSignature(race);
  const horseKey = horseSignature(normalizedHorse);
  const existing = state.candidates.find(
    (candidate) =>
      candidate?.race_signature === signature &&
      horseSignature(candidate?.horse) === horseKey,
  );
  const candidate = {
    candidate_id: existing?.candidate_id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    race_signature: signature,
    race: {
      race_id: race.race_id ?? null,
      name: race.name,
      race_date: race.race_date,
      venue: race.venue ?? "",
      race_number: race.race_number ?? null,
      source_url: race.source_url ?? "",
    },
    horse: normalizedHorse,
    ketto_num: existing?.ketto_num ?? null,
    horse_url: existing?.horse_url ?? "",
    affiliation: "地方",
    source_note: normalizedNote,
    source_url: sourceUrl.trim(),
    status: "admin_confirmed",
    added_at: existing?.added_at ?? now,
    updated_at: now,
  };
  const candidates = existing
    ? state.candidates.map((item) => item?.candidate_id === existing.candidate_id ? candidate : item)
    : [...state.candidates, candidate];
  const filePath = localPath(repoRoot, MANUAL_CANDIDATES_FILE);
  writeJsonAtomically(filePath, { schema_version: 1, updated_at: now, candidates });
  return { candidate, filePath };
}

function cacheFilePath(repoRoot, date) {
  return localPath(repoRoot, JRA_CACHE_DIRECTORY, `${date}.json`);
}

export function readFreshJraCache({ repoRoot, date, maxAgeMs = JRA_CACHE_MAX_AGE_MS, now = Date.now() }) {
  const filePath = cacheFilePath(repoRoot, normalizeDate(date));
  const payload = readJson(filePath, null);
  if (!payload?.date || !payload?.fetched_at) return null;
  const fetchedAt = Date.parse(payload.fetched_at);
  if (!Number.isFinite(fetchedAt) || now - fetchedAt < 0 || now - fetchedAt > maxAgeMs) return null;
  return { ...payload, cache_file: filePath };
}

export function saveJraCache({ repoRoot, date, payload }) {
  const normalizedDate = normalizeDate(date);
  const filePath = cacheFilePath(repoRoot, normalizedDate);
  const value = { ...payload, date: normalizedDate, cached_at: new Date().toISOString() };
  writeJsonAtomically(filePath, value);
  return { ...value, cache_file: filePath };
}
