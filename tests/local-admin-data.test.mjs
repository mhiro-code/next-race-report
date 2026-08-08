import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findManualCandidates,
  readFreshCandidateEnrichment,
  readFreshJraCache,
  saveCandidateEnrichment,
  saveJraCache,
  saveManualCandidate,
} from "../scripts/local-admin-data.mjs";

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
