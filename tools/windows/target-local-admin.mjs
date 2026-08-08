#!/usr/bin/env node

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateRanking,
  DEFAULT_TARGET_ROOT,
  readTargetSnapshot,
  saveRankingJson,
} from "../../scripts/target-local-ranking.mjs";
import { fetchJraProgram } from "../../scripts/jra-race-program.mjs";
import { fetchOfficialHorseEnrichment } from "../../scripts/official-horse-enrichment.mjs";
import {
  findManualCandidates,
  readFreshCandidateEnrichment,
  readFreshJraCache,
  saveJraCache,
  saveCandidateEnrichment,
  saveManualCandidate,
} from "../../scripts/local-admin-data.mjs";
import {
  buildProvisionalRanking,
  mergeManualCandidates,
} from "../../scripts/provisional-race-ranking.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2).replaceAll("-", "_");
    args[key] = ["open"].includes(key) ? true : argv[++index];
  }
  return args;
}

function html() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TARGETローカル管理</title>
  <style>
    :root { color-scheme: light; font-family: "Yu Gothic", Meiryo, sans-serif; color: #17211b; background: #f4f1e8; }
    body { max-width: 1180px; margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 8px; color: #084b34; font-size: 28px; }
    p { line-height: 1.6; }
    .card { margin-top: 20px; padding: 20px; background: white; border: 1px solid #dfe6e1; border-radius: 12px; }
    .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
    label { display: grid; gap: 6px; color: #66736b; font-size: 12px; font-weight: 700; }
    select, button { min-height: 40px; border: 1px solid #bdcbc1; border-radius: 8px; background: white; padding: 0 14px; font: inherit; }
    select { min-width: 330px; }
    button { cursor: pointer; color: white; background: #0f6b48; border-color: #0f6b48; font-weight: 700; }
    button:disabled { cursor: wait; opacity: .55; }
    .secondary { color: #0f6b48; background: #eaf4ee; border-color: #bed6c8; }
    .status { min-height: 24px; color: #66736b; }
    .warning { color: #9b4f25; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 10px; }
    .summary div { padding: 12px; background: #f0f4f1; border-radius: 8px; }
    .summary strong, .summary span { display: block; }
    .summary strong { margin-top: 4px; color: #0f6b48; font-size: 20px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 800px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #edf0ee; text-align: left; white-space: nowrap; }
    th { color: #66736b; background: #f0f4f1; font-size: 12px; }
    .numeric { text-align: right; }
    .muted { color: #9aa59f; }
    .notices { padding-left: 20px; }
    @media (max-width: 680px) { body { padding: 16px; } select { min-width: 0; width: 100%; } .summary { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <h1>TARGETローカル管理</h1>
  <p>D:\\TFJVの保存済みデータだけを読み取ります。JRA-VANへの通信、データダウンロード、JV-Linkは使用しません。</p>
  <section class="card">
    <div class="controls">
      <label>開催日（JRA公式）<input id="program-date" type="date"></label>
      <button id="program" class="secondary" type="button">JRA公式番組を取得</button>
      <label>対象レース<select id="race"></select></label>
      <button id="preview" type="button" disabled>TARGETローカルデータから更新</button>
      <button id="manual" class="secondary" type="button" disabled>管理者確認候補を追加</button>
      <button id="enrich" class="secondary" type="button" disabled>賞金・成績を再取得</button>
      <button id="save" class="secondary" type="button" disabled>保存して公開データへ反映</button>
    </div>
    <div id="manual-form" hidden>
      <div class="controls">
        <label>馬名<input id="manual-horse" type="text" maxlength="40" placeholder="例：地方所属馬"></label>
        <label>情報源メモ<input id="manual-note" type="text" maxlength="200" placeholder="管理者が確認した情報の要点" required></label>
        <label>情報源URL（任意）<input id="manual-url" type="url" placeholder="https://..."></label>
        <button id="manual-save" type="button">候補を保存</button>
        <button id="manual-cancel" class="secondary" type="button">閉じる</button>
      </div>
      <p class="muted">この画面はオーナーPC上のローカル管理画面です。情報源メモは公開データに含めません。</p>
    </div>
    <p id="status" class="status">TARGET登録レースを読み込んでいます。</p>
    <p id="target-updated" class="muted"></p>
  </section>
  <section id="result" class="card" hidden>
    <h2 id="title"></h2>
    <p id="meta"></p>
    <div id="summary" class="summary"></div>
    <ul id="notices" class="notices"></ul>
    <div class="table-wrap"><table><thead><tr><th>順位目安</th><th>馬名</th><th class="numeric">現在</th><th class="numeric">1年加算</th><th class="numeric">2年GI加算</th><th class="numeric">合計</th><th>状態</th></tr></thead><tbody id="rows"></tbody></table></div>
  </section>
  <script>
    const state = { raceId: "", payload: null, races: [] };
    const raceSelect = document.getElementById("race");
    const programDate = document.getElementById("program-date");
    const programButton = document.getElementById("program");
    const previewButton = document.getElementById("preview");
    const manualButton = document.getElementById("manual");
    const enrichButton = document.getElementById("enrich");
    const saveButton = document.getElementById("save");
    const manualForm = document.getElementById("manual-form");
    const manualHorse = document.getElementById("manual-horse");
    const manualNote = document.getElementById("manual-note");
    const manualUrl = document.getElementById("manual-url");
    const manualSave = document.getElementById("manual-save");
    const manualCancel = document.getElementById("manual-cancel");
    const status = document.getElementById("status");
    const result = document.getElementById("result");
    const targetUpdated = document.getElementById("target-updated");
    const yen = (value) => value === null || value === undefined ? "未取得" : Math.round(value / 10000).toLocaleString("ja-JP") + "万円";
    const text = (value) => String(value ?? "");
    const htmlText = (value) => text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    const setBusy = (busy) => {
      previewButton.disabled = busy || !state.raceId;
      manualButton.disabled = busy || !state.raceId;
      enrichButton.disabled = busy || !state.raceId;
      saveButton.disabled = busy || !state.payload;
      programButton.disabled = busy;
      manualSave.disabled = busy;
    };
    const showError = (error) => { status.textContent = error; status.className = "status warning"; };

    function render(payload) {
      const race = payload.race;
      document.getElementById("title").textContent = text(race.name) + " " + text(race.grade);
      const countLabel = race.registration_count_status === "candidate_count" ? "候補頭数" : "表示頭数";
      const targetCount = race.target_registration_count === null || race.target_registration_count === undefined ? "" : "・TARGET登録 " + race.target_registration_count + "頭";
      document.getElementById("meta").textContent = text(race.race_date).replaceAll("-", "/") + "・" + text(race.venue) + "・" + countLabel + " " + (race.registration_count ?? "未取得") + "・フルゲート " + (race.full_gate ?? "未取得") + targetCount + "・TARGET更新 " + (payload.target_data_updated_at ?? "未取得") + "・計算 " + payload.generated_at;
      const missing = payload.rows.filter((row) => row.current_yen === null || row.period1_yen === null || row.period2_g1_yen === null).length;
      document.getElementById("summary").innerHTML = [
        ["登録頭数", payload.race.registration_count],
        ["賞金取得済み", payload.rows.length - missing],
        ["賞金未取得", missing],
        ["警告", payload.warnings.length],
      ].map(([label, value]) => "<div><span>" + htmlText(label) + "</span><strong>" + htmlText(value) + "</strong></div>").join("");
      document.getElementById("notices").innerHTML = (payload.warnings.length ? payload.warnings : ["警告はありません。"]).map((warning) => "<li class=\"" + (payload.warnings.length ? "warning" : "muted") + "\">" + htmlText(warning) + "</li>").join("");
      document.getElementById("rows").innerHTML = payload.rows.map((row) => "<tr><td>" + htmlText(row.rank ?? "—") + "</td><td>" + htmlText(row.horse) + "</td><td class=\"numeric\">" + htmlText(yen(row.current_yen)) + "</td><td class=\"numeric\">" + htmlText(yen(row.period1_yen)) + "</td><td class=\"numeric\">" + htmlText(yen(row.period2_g1_yen)) + "</td><td class=\"numeric\">" + htmlText(yen(row.decision_yen)) + "</td><td class=\"" + (row.ranking_status === "calculated" ? "" : "warning") + "\">" + htmlText(row.status_label || row.ranking_status) + "</td></tr>").join("");
      result.hidden = false;
    }

    function raceKey(race) { return [race.race_date, race.venue, race.name].join("\\0"); }
    function renderRaceOptions(races) {
      state.races = races;
      raceSelect.innerHTML = races.map((race) => "<option value=\"" + htmlText(race.race_id) + "\">" + htmlText(race.race_date) + "・" + htmlText(race.venue) + "・" + htmlText(race.name) + " [" + htmlText(race.grade || "") + "]" + (race.status === "program_only" ? " [JRA未登録]" : "") + "</option>").join("");
      state.raceId = raceSelect.value || "";
      setBusy(false);
    }

    async function loadRaces() {
      try {
        const response = await fetch("/api/races");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "TARGETデータを確認できませんでした。");
        renderRaceOptions(data.races);
        targetUpdated.textContent = "TARGETデータ更新日時: " + (data.target_data_updated_at || "未取得") + "／登録レース: " + data.races.length + "件";
        previewButton.disabled = !state.raceId;
        status.textContent = data.races.length ? "レースを選択して更新結果を確認してください。JRA未登録レースは開催日から取得できます。" : "TARGET登録レースがありません。開催日を指定してJRA公式番組を取得してください。";
      } catch (error) { showError(error.message || String(error)); }
    }

    programButton.addEventListener("click", async () => {
      const date = programDate.value;
      if (!date) { showError("JRA公式番組を取得する開催日を指定してください。"); return; }
      setBusy(true); status.className = "status"; status.textContent = "JRA公式番組を1ページ取得しています。";
      try {
        const response = await fetch("/api/jra/program?date=" + encodeURIComponent(date));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "JRA公式番組を取得できませんでした。");
        const targetKeys = new Set(state.races.filter((race) => race.status !== "program_only").map(raceKey));
        const programs = data.races.filter((race) => !targetKeys.has(raceKey(race)));
        renderRaceOptions([...state.races, ...programs]);
        targetUpdated.textContent = "JRA公式番組: " + data.date + "・" + (data.cached ? "24時間以内のキャッシュ" : "今回取得") + "／対象レース: " + programs.length + "件";
        status.textContent = "JRA公式番組を反映しました。レースを選択して候補を確認してください。";
      } catch (error) { showError(error.message || String(error)); } finally { setBusy(false); }
    });

    raceSelect.addEventListener("change", () => { state.raceId = raceSelect.value; state.payload = null; result.hidden = true; manualForm.hidden = true; setBusy(false); });
    previewButton.addEventListener("click", async () => {
      setBusy(true); status.className = "status"; status.textContent = "レース検索・登録馬読取・賞金集計・順位計算中…";
      try { const response = await fetch("/api/target/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ race_id: state.raceId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "計算できませんでした。"); state.payload = data.payload; render(state.payload); status.textContent = "計算結果を確認してください。確認後に保存できます。"; } catch (error) { state.payload = null; showError(error.message || String(error)); } finally { setBusy(false); }
    });
    manualButton.addEventListener("click", () => { manualForm.hidden = !manualForm.hidden; if (!manualForm.hidden) manualHorse.focus(); });
    manualCancel.addEventListener("click", () => { manualForm.hidden = true; });
    manualSave.addEventListener("click", async () => {
      if (!state.raceId) return;
      setBusy(true); status.className = "status"; status.textContent = "管理者確認候補を保存しています。";
      try {
        const response = await fetch("/api/manual-candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ race_id: state.raceId, horse: manualHorse.value, source_note: manualNote.value, source_url: manualUrl.value }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "候補を保存できませんでした。");
        manualForm.hidden = true; manualHorse.value = ""; manualNote.value = ""; manualUrl.value = "";
        state.payload = null; result.hidden = true;
        status.textContent = "管理者確認候補を保存しました。更新結果を再確認してください。";
      } catch (error) { showError(error.message || String(error)); } finally { setBusy(false); }
    });
    enrichButton.addEventListener("click", async () => {
      if (!state.raceId) return;
      setBusy(true); status.className = "status"; status.textContent = "登録済み公式情報を1件ずつ確認しています。";
      try {
        const response = await fetch("/api/manual-candidates/enrich", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ race_id: state.raceId }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "公式情報を再取得できませんでした。");
        state.payload = null; result.hidden = true;
        status.textContent = "賞金・成績の再取得結果を保存しました。更新結果を再確認してください。" + (data.results?.length ? " 対象 " + data.results.length + "件。" : "");
      } catch (error) { showError(error.message || String(error)); } finally { setBusy(false); }
    });
    saveButton.addEventListener("click", async () => {
      if (!state.payload) return;
      setBusy(true); status.className = "status"; status.textContent = "レース別JSONを保存中…";
      try { const response = await fetch("/api/target/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ race_id: state.raceId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存できませんでした。"); status.textContent = "保存しました。GitHubへのpushやマージは自動実行していません。"; } catch (error) { showError(error.message || String(error)); } finally { setBusy(false); }
    });
    loadRaces();
  </script>
</body>
</html>`;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("request body too large");
  }
  return body ? JSON.parse(body) : {};
}

export function createAdminServer({ targetRoot = process.env.TARGET_DATA_ROOT || DEFAULT_TARGET_ROOT, port = Number(process.env.TARGET_ADMIN_PORT || 3210) } = {}) {
  const snapshots = new Map();
  const previews = new Map();
  const jraPrograms = new Map();
  const getSnapshot = (raceDate = "list") => {
    if (!snapshots.has(raceDate)) snapshots.set(raceDate, readTargetSnapshot({ targetRoot, raceDate: raceDate === "list" ? null : raceDate }));
    return snapshots.get(raceDate);
  };
  const readFreshSnapshot = ({ raceDate = null, raceId = null, horseIds = null } = {}) =>
    readTargetSnapshot({ targetRoot, raceDate, raceId, horseIds });
  const rememberJraProgram = (program) => {
    for (const race of program?.races ?? []) jraPrograms.set(race.race_id, race);
    return program;
  };
  const cachedJraRace = (raceId) => {
    const date = String(raceId).match(/^jra-(\d{4}-\d{2}-\d{2})-/)?.[1];
    if (!date) return null;
    const cached = readFreshJraCache({ repoRoot, date });
    if (!cached) return null;
    rememberJraProgram(cached);
    return jraPrograms.get(raceId) ?? null;
  };
  const findSelectedRace = (raceId) => {
    const snapshot = readFreshSnapshot();
    const targetRace = snapshot.races.find((race) => race.race_id === raceId);
    if (targetRace) return { race: targetRace, kind: "target" };
    const programRace = jraPrograms.get(raceId) ?? cachedJraRace(raceId);
    if (programRace) return { race: programRace, kind: "program" };
    throw new Error(`対象レースが見つかりません: ${raceId}`);
  };
  const buildPayload = ({ raceId, selected }) => {
    const manualCandidates = findManualCandidates({ repoRoot, race: selected.race });
    if (selected.kind === "target") {
      const targetPayload = calculateRanking({
        snapshot: readFreshSnapshot({
          raceDate: selected.race.race_date,
          raceId,
          horseIds: selected.race.entries.map((entry) => entry.ketto_num).filter(Boolean),
        }),
        raceId,
      });
      return mergeManualCandidates({ payload: targetPayload, manualCandidates, repoRoot });
    }
    return buildProvisionalRanking({ repoRoot, race: selected.race, manualCandidates });
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/races") {
        const snapshot = getSnapshot();
        sendJson(response, 200, {
          target_data_updated_at: snapshot.target_data_updated_at,
          races: snapshot.races.map((race) => {
            const publicRace = { ...race };
            delete publicRace.source_file;
            return publicRace;
          }),
          diagnostics: snapshot.diagnostics,
          warnings: snapshot.warnings,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/jra/program") {
        const date = url.searchParams.get("date") || "";
        const cached = readFreshJraCache({ repoRoot, date });
        const program = cached ?? saveJraCache({ repoRoot, date, payload: await fetchJraProgram({ date }) });
        rememberJraProgram(program);
        sendJson(response, 200, {
          date: program.date,
          source: program.source,
          source_url: program.source_url,
          fetched_at: program.fetched_at,
          cached: Boolean(cached),
          races: program.races,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/manual-candidates") {
        const body = await readJson(request);
        const raceId = String(body.race_id || "");
        if (!raceId) throw new Error("race_id is required");
        const selected = findSelectedRace(raceId);
        const saved = saveManualCandidate({
          repoRoot,
          race: selected.race,
          horse: body.horse,
          sourceNote: body.source_note,
          sourceUrl: body.source_url,
        });
        previews.clear();
        sendJson(response, 200, {
          candidate: {
            candidate_id: saved.candidate.candidate_id,
            horse: saved.candidate.horse,
            affiliation: saved.candidate.affiliation,
            status: saved.candidate.status,
            race: saved.candidate.race,
          },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/manual-candidates/enrich") {
        const body = await readJson(request);
        const raceId = String(body.race_id || "");
        if (!raceId) throw new Error("race_id is required");
        const selected = findSelectedRace(raceId);
        const candidates = findManualCandidates({ repoRoot, race: selected.race });
        const results = [];
        let stopped = false;
        for (const candidate of candidates) {
          if (!candidate.source_url) {
            results.push({ horse: candidate.horse, status: "source_url_missing", current_yen: null });
            continue;
          }
          const cached = readFreshCandidateEnrichment({ repoRoot, candidate });
          if (cached) {
            results.push({
              horse: candidate.horse,
              status: cached.status,
              current_yen: cached.current_yen,
              current_metric: cached.current_metric,
              warning: cached.warning,
              cached: true,
            });
            continue;
          }
          try {
            const enrichment = await fetchOfficialHorseEnrichment({ candidate });
            saveCandidateEnrichment({ repoRoot, enrichment });
            results.push({
              horse: candidate.horse,
              status: enrichment.status,
              current_yen: enrichment.current_yen,
              current_metric: enrichment.current_metric,
              warning: enrichment.warning,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ horse: candidate.horse, status: "error", current_yen: null, warning: message });
            if (/アクセス制限|403|429|503/.test(message)) {
              stopped = true;
              break;
            }
          }
        }
        previews.clear();
        sendJson(response, 200, { results, stopped });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/api/target/preview" || url.pathname === "/api/target/save")) {
        const body = await readJson(request);
        const raceId = String(body.race_id || "");
        if (!raceId) throw new Error("race_id is required");
        let payload = previews.get(raceId);
        if (!payload || url.pathname.endsWith("/preview")) {
          const selected = findSelectedRace(raceId);
          payload = buildPayload({ raceId, selected });
          previews.set(raceId, payload);
        }
        if (url.pathname.endsWith("/preview")) {
          sendJson(response, 200, { payload });
          return;
        }
        const saved = saveRankingJson({ payload, repoRoot });
        sendJson(response, 200, { saved: { file: path.relative(repoRoot, saved.filePath), index: path.relative(repoRoot, saved.indexPath) } });
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, port, targetRoot };
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  const { server, port, targetRoot } = createAdminServer({ targetRoot: args.data_root, port: Number(args.port || undefined) || undefined });
  server.listen(port, "127.0.0.1", () => {
    console.log(`TARGET local admin: http://127.0.0.1:${port}/`);
    console.log(`TARGET data root: ${targetRoot}`);
    console.log("停止: Ctrl+C");
  });
}
