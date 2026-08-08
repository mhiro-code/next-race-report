const ALLOWED_HOSTS = new Set([
  "jra.go.jp",
  "www.jra.go.jp",
  "keiba.go.jp",
  "www.keiba.go.jp",
  "sp.keiba.go.jp",
  "www2.keiba.go.jp",
  "jbis.or.jp",
  "www.jbis.or.jp",
]);
export const NAR_HORSE_SEARCH_URL = "https://www.keiba.go.jp/KeibaWeb/DataRoom/RaceHorseList";

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

function isNarHorseProfileUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return url.hostname.toLowerCase().endsWith("keiba.go.jp") &&
      url.pathname.toLowerCase().endsWith("/keibaweb/dataroom/racehorseinfo");
  } catch {
    return false;
  }
}

function normalizeHorseName(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s\u3000]+/g, "").trim();
}

function moneyAfterLabel(text, label) {
  const match = text.match(new RegExp(`${label}\\s*([\\d,]+)\\s*(?:円|万円)?`));
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return null;
  return /万円/.test(match[0]) ? amount * 10_000 : amount;
}

function amount(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  return Number(normalized);
}

export function parseNarSearchResults(html, { horse } = {}) {
  const target = normalizeHorseName(horse);
  if (!target) throw new Error("NAR検索対象の馬名がありません。");
  const candidates = [...String(html ?? "").matchAll(
    /<a\b[^>]*href=["']([^"']*RaceHorseInfo[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )]
    .map((match) => ({
      horse: plainText(match[2]),
      source_url: new URL(decodeEntities(match[1]), NAR_HORSE_SEARCH_URL).href,
    }))
    .filter((candidate) => candidate.horse);
  const exact = candidates.filter((candidate) => normalizeHorseName(candidate.horse) === target);
  if (!exact.length) throw new Error("NARで馬名を確認できません（管理者確認）。");
  if (exact.length > 1) throw new Error("NARで同名馬を一意に確認できません（管理者確認）。");
  return exact[0];
}

function parseNarProfile(text) {
  const structured = text.match(/収得賞金\s+地方\s+([\d,]+)\s+中央\s+([\d,]+)\s+付加\s+([\d,]+)/);
  const local = structured ? amount(structured[1]) : moneyAfterLabel(text, "地方収得賞金");
  const central = structured ? amount(structured[2]) : moneyAfterLabel(text, "中央収得賞金");
  const additional = structured ? amount(structured[3]) : moneyAfterLabel(text, "中央付加賞金");
  const hasCompleteParts = local !== null && central !== null && additional !== null;
  const currentYen = local === null ? null : hasCompleteParts ? local + central + additional : local;
  const birthMatch = text.match(/生年月日\s+(\d{4})(?:[./年])(\d{1,2})(?:[./月])(\d{1,2})(?:日|生)?/);
  const trainerMatch = text.match(/調教師\s+(.+?)(?=\s+(?:地方収得賞金|中央収得賞金|中央付加賞金|毛色|馬主))/);
  return {
    current_yen: currentYen,
    current_metric: structured || hasCompleteParts
      ? "NAR収得賞金（地方・中央・付加）暫定合算"
      : (local === null ? null : "地方収得賞金"),
    local_acquisition_yen: local,
    central_acquisition_yen: central,
    additional_acquisition_yen: additional,
    birth_date: birthMatch
      ? `${birthMatch[1]}-${String(birthMatch[2]).padStart(2, "0")}-${String(birthMatch[3]).padStart(2, "0")}`
      : null,
    trainer: trainerMatch?.[1]?.trim() ?? null,
  };
}

export function parseOfficialHorsePage(html, { sourceUrl, horse } = {}) {
  const kind = sourceKind(sourceUrl);
  const text = plainText(html);
  if (horse && !text.includes(horse)) throw new Error("公式情報ページに対象馬名が見つかりません。");

  let currentYen = null;
  let currentMetric = null;
  let profile = {};
  if (kind === "NAR") {
    profile = parseNarProfile(text);
    currentYen = profile.current_yen;
    currentMetric = profile.current_metric;
  } else if (kind === "JRA") {
    currentYen = moneyAfterLabel(text, "収得賞金（平地）") ?? moneyAfterLabel(text, "収得賞金\\(平地\\)");
    if (currentYen !== null) currentMetric = "収得賞金（平地）";
  }

  return {
    source_kind: kind,
    source_url: sourceUrl,
    affiliation: kind === "NAR" ? "地方" : kind === "JRA" ? "JRA" : null,
    current_yen: currentYen,
    current_metric: currentMetric,
    period1_yen: null,
    period2_g1_yen: null,
    decision_yen: null,
    status: currentYen === null ? "unavailable" : "current_only",
    ...profile,
    warning: currentYen === null
      ? kind === "JBIS"
        ? "JBISの総賞金は収得賞金と同一視せず、現在の収得賞金は未取得です。"
        : "公式ページに明示された収得賞金欄が見つかりません。"
      : "期間収得賞金はTARGET特別登録後のRA/SE履歴から計算します。",
  };
}

export async function fetchOfficialHorseEnrichment({ candidate, fetchImpl = fetch } = {}) {
  const horse = String(candidate?.horse ?? "").trim();
  let sourceUrl = String(candidate?.source_url ?? "").trim();
  let searchUrl = null;
  let profileBytes = null;
  if (!sourceUrl) {
    if (!horse) throw new Error("NAR検索対象の馬名がありません。");
    const search = new URL(NAR_HORSE_SEARCH_URL);
    search.searchParams.set("k_activeCode", "1");
    search.searchParams.set("k_birthYear", "*");
    search.searchParams.set("k_dataKind", "1");
    search.searchParams.set("k_horseNameCondition", "start");
    search.searchParams.set("k_fatherHorse", "");
    search.searchParams.set("k_fatherHorseCondition", "start");
    search.searchParams.set("k_horseName", horse);
    search.searchParams.set("k_horsebelong", "*");
    search.searchParams.set("k_motherHorse", "");
    search.searchParams.set("k_motherHorseCondition", "start");
    searchUrl = search.href;
    const searchResponse = await fetchImpl(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NextRaceReport/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!searchResponse.ok) {
      const stop = [403, 429, 503].includes(searchResponse.status) ? "（アクセス制限の可能性があるため再試行しません）" : "";
      throw new Error(`NAR馬名検索の取得に失敗しました: ${searchResponse.status}${stop}`);
    }
    const searchBytes = await searchResponse.arrayBuffer();
    const resolvedSearchUrl = String(searchResponse.url || searchUrl);
    if (isNarHorseProfileUrl(resolvedSearchUrl)) {
      sourceUrl = resolvedSearchUrl;
      profileBytes = new Uint8Array(searchBytes);
    } else {
      sourceUrl = parseNarSearchResults(decodePage(new Uint8Array(searchBytes)), { horse }).source_url;
    }
  }
  const kind = sourceKind(sourceUrl);
  if (!profileBytes) {
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
    profileBytes = new Uint8Array(await response.arrayBuffer());
  }
  return {
    candidate_id: candidate.candidate_id,
    fetched_at: new Date().toISOString(),
    search_url: searchUrl,
    horse_url: sourceUrl,
    ...parseOfficialHorsePage(decodePage(profileBytes), { sourceUrl, horse }),
  };
}
