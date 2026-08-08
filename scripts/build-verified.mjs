#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vinext = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const timeoutMs = Number(process.env.SITES_BUILD_TIMEOUT_MS || 180_000);

if (!existsSync(vinext)) {
  console.error("vinextが見つかりません。依存関係をインストールしてからビルドしてください。");
  process.exit(69);
}

const runtimeRoot = path.join(projectRoot, ".sites-runtime");
mkdirSync(path.join(runtimeRoot, "wrangler", "logs"), { recursive: true });
const result = spawnSync(process.execPath, [vinext, "build"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: path.join(runtimeRoot, "wrangler", "logs"),
  },
  encoding: "utf8",
  shell: false,
  timeout: timeoutMs,
  maxBuffer: 20 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error("vinext buildの実行に失敗しました: " + result.error.message);
  process.exit(result.error.code === "ETIMEDOUT" ? 124 : 1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const workerPath = path.join(projectRoot, "dist", "server", "index.js");
const hostingPath = path.join(projectRoot, "dist", ".openai", "hosting.json");
if (!existsSync(workerPath) || !existsSync(hostingPath)) {
  console.error("ビルド成果物が不足しています: dist/server/index.js または dist/.openai/hosting.json");
  process.exit(66);
}

JSON.parse(readFileSync(hostingPath, "utf8"));
const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", String(process.pid) + "-" + Date.now());
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js に default.fetch がありません。");
}
console.log("ビルド成果物を検証しました。");
