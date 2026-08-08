import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findManualCandidates,
  readFreshCandidateEnrichment,
  readFreshJraCache,
  readNextRacesCache,
  removeManualCandidatesForRace,
  removeNextRacesCacheForRace,
  saveCandidateEnrichment,
  saveJraCache,
  saveManualCandidate,
  saveNextRacesCache,
} from "../scripts/local-admin-data.mjs";

test("accepts only a horse name and removes obsolete candidate data after promotion", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-admin-name-only-"));
  try {
    const race = { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念" };
    const saved = saveManualCandidate({ repoRoot, race, horse: "ケイズレーヴ" });
    saveCandidateEnrichment({ repoRoot, enrichment: { candidate_id: saved.candidate.candidate_id, source_url: "https://www.keiba.go.jp/horse", fetched_at: "2026-08-08T00:00:00.000Z", current_yen: 1, status: "current_only" } });
    assert.equal(removeManualCandidatesForRace({ repoRoot, race }).removed, 1);
    assert.deepEqual(findManualCandidates({ repoRoot, race }), []);
    assert.equal(readFreshCandidateEnrichment({ repoRoot, candidate: saved.candidate, now: Date.parse("2026-08-08T12:00:00.000Z") }), null);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("saves manager-confirmed candidates privately and upserts by race and horse", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-admin-data-"));
  try {
    const race = { race_id: "jra-2026-08-16-07-07", race_date: "2026-08-16", venue: "中京", name: "中京記念" };
    saveManualCandidate({ repoRoot, race, horse: "ケイズレーヴ", sourceNote: "管理者確認", sourceUrl: "https://example.test/source" });
    saveManualCandidate({ repoRoot, race, horse: "ケイズレーヴ", sourceNote: "更新確認", sourceUrl: "https://example.test/updated" });
    const candidates = findManualCandidates({ repoRoot, race });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].source_note, "更新確認");
    assert.equal(candidates[0].affiliation, "地方");
    const saved = JSON.parse(await readFile(path.join(repoRoot, ".target-local", "manual-candidates.json"), "utf8"));
    assert.equal(saved.candidates[0].source_url, "https://example.test/updated");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("uses a JRA program cache for at most 24 hours", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-jra-cache-"));
  try {
    const fetchedAt = "2026-08-08T00:00:00.000Z";
    saveJraCache({ repoRoot, date: "2026-08-16", payload: { date: "2026-08-16", fetched_at: fetchedAt, races: [] } });
    assert.ok(readFreshJraCache({ repoRoot, date: "2026-08-16", now: Date.parse("2026-08-08T12:00:00.000Z") }));
    assert.equal(readFreshJraCache({ repoRoot, date: "2026-08-16", now: Date.parse("2026-08-09T00:00:01.000Z") }), null);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("removes only the promoted race from the local next-race cache", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-next-cache-cleanup-"));
  try {
    const race = { race_date: "2026-08-16", venue: "中京", name: "中京記念" };
    const other = { race_date: "2026-08-16", venue: "札幌", name: "別レース" };
    saveNextRacesCache({ repoRoot, payload: { rows: [{ horse: "A", next_race: "中京記念" }, { horse: "B", next_race: "別レース" }] }, race });
    assert.equal(removeNextRacesCacheForRace({ repoRoot, race }).removed, 1);
    assert.deepEqual(readNextRacesCache({ repoRoot }).rows.map((row) => row.horse), ["B"]);
    saveNextRacesCache({ repoRoot, payload: { rows: [{ horse: "B", next_race: "別レース" }] }, race: other });
    assert.equal(removeNextRacesCacheForRace({ repoRoot, race: other }).removed, 1);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("reuses official horse enrichment for 24 hours when the source URL is unchanged", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "target-local-enrichment-cache-"));
  try {
    const candidate = { candidate_id: "candidate-1", source_url: "https://www.keiba.go.jp/horse" };
    saveCandidateEnrichment({ repoRoot, enrichment: { ...candidate, fetched_at: "2026-08-08T00:00:00.000Z", current_yen: 100, status: "current_only" } });
    assert.ok(readFreshCandidateEnrichment({ repoRoot, candidate, now: Date.parse("2026-08-08T12:00:00.000Z") }));
    assert.equal(readFreshCandidateEnrichment({ repoRoot, candidate: { ...candidate, source_url: "https://www.keiba.go.jp/other" }, now: Date.parse("2026-08-08T12:00:00.000Z") }), null);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
