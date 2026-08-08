const ALLOWED_HOSTS = new Set([
  "jra.go.jp",
  "www.jra.go.jp",
  "keiba.go.jp",
  "www.keiba.go.jp",
  "jbis.or.jp",
  "www.jbis.or.jp",
]);

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function plainText(html) {
  return decodeEntities(String(html ?? ""))
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function decodePage(bytes) {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (/<meta[^>]+charset\s*=\s*["']?utf-?8/i.test(utf8.slice(0, 5000))) return utf8;
  return new TextDecoder("shift_jis").decode(bytes);
}

function sourceKind(sourceUrl) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new Error("公式情報URLはJRA・NAR・JBISのURLだけ指定できます。");
  if (host.endsWith("keiba.go.jp")) return "NAR";
  if (host.endsWith("jra.go.jp")) return "JRA";
  return "JBIS";
}

function moneyAfterLabel(text, label) {
  const match = text.match(new RegExp(`${label}\\s*([\\d,]+)\\s*(?:円|万円)?`));
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return null;
  return /万円/.test(match[0]) ? amount * 10_000 : amount;
}

export function parseOfficialHorsePage(html, { sourceUrl, horse } = {}) {
  const kind = sourceKind(sourceUrl);
  const text = plainText(html);
  if (horse && !text.includes(horse)) throw new Error("公式情報ページに対象馬名が見つかりません。");

  let currentYen = null;
  let currentMetric = null;
  if (kind === "NAR") {
    const local = moneyAfterLabel(text, "地方収得賞金");
    const central = moneyAfterLabel(text, "中央収得賞金");
    if (local !== null) {
      currentYen = local;
      currentMetric = "地方収得賞金";
    } else if (central !== null) {
      currentYen = central;
      currentMetric = "中央収得賞金";
    }
  } else if (kind === "JRA") {
    currentYen = moneyAfterLabel(text, "収得賞金（平地）") ?? moneyAfterLabel(text, "収得賞金\\(平地\\)");
    if (currentYen !== null) currentMetric = "収得賞金（平地）";
  }

  return {
    source_kind: kind,
    source_url: sourceUrl,
    current_yen: currentYen,
    current_metric: currentMetric,
    period1_yen: null,
    period2_g1_yen: null,
    decision_yen: null,
    status: currentYen === null ? "unavailable" : "current_only",
    warning: currentYen === null
      ? kind === "JBIS"
        ? "JBISの総賞金は収得賞金と同一視せず、現在の収得賞金は未取得です。"
        : "公式ページに明示された収得賞金欄が見つかりません。"
      : "期間収得賞金はTARGET特別登録後のRA/SE履歴から計算します。",
  };
}

export async function fetchOfficialHorseEnrichment({ candidate, fetchImpl = fetch } = {}) {
  const sourceUrl = String(candidate?.source_url ?? "").trim();
  if (!sourceUrl) throw new Error("公式情報URLが未登録です。");
  const kind = sourceKind(sourceUrl);
  const response = await fetchImpl(sourceUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NextRaceReport/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const stop = [403, 429, 503].includes(response.status) ? "（アクセス制限の可能性があるため再試行しません）" : "";
    throw new Error(`${kind}公式情報の取得に失敗しました: ${response.status}${stop}`);
  }
  const bytes = await response.arrayBuffer();
  return {
    candidate_id: candidate.candidate_id,
    fetched_at: new Date().toISOString(),
    ...parseOfficialHorsePage(decodePage(new Uint8Array(bytes)), { sourceUrl, horse: candidate.horse }),
  };
}
