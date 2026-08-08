const JRA_BASE_URL = "https://jra.jp";

const VENUES = Object.freeze({
  "札幌": "01",
  "函館": "02",
  "福島": "03",
  "新潟": "04",
  "東京": "05",
  "中山": "06",
  "中京": "07",
  "京都": "08",
  "阪神": "09",
  "小倉": "10",
});

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

function text(value) {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function classValue(html, className) {
  const pattern = new RegExp(
    `<[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i",
  );
  return text(html.match(pattern)?.[1] ?? "");
}

function normalizeGrade(value) {
  const match = value.match(/((?:J・)?G[ⅠⅡⅢI]+)/);
  if (!match) return null;
  return match[1]
    .replace("Ⅰ", "I")
    .replace("Ⅱ", "II")
    .replace("Ⅲ", "III");
}

function normalizeRaceName(value) {
  const withoutGrade = value
    .replace(/[（(]\s*(?:J・)?G[ⅠⅡⅢI]+\s*[）)]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const ordinal = withoutGrade.match(/第\s*\d+\s*回\s+(.+)$/);
  return (ordinal?.[1] ?? withoutGrade).trim();
}

export function normalizeDate(value) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`日付はYYYY-MM-DD形式で指定してください: ${value}`);
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`存在しない日付です: ${value}`);
  }
  return normalized;
}

export function jraProgramUrl(value) {
  const date = normalizeDate(value);
  const [year, month, day] = date.split("-");
  return `${JRA_BASE_URL}/keiba/calendar${year}/${year}/${Number(month)}/${month}${day}.html`;
}

function parseRaceCell(cellHtml, { date, venueDay, venue, venueCode, sourceUrl }) {
  const rows = [];
  for (const match of cellHtml.matchAll(
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const rowHtml = match[1];
    if (!/class=["'][^"']*\bstakes\b[^"']*["']/i.test(rowHtml)) continue;
    const number = Number(text(rowHtml.match(/<th[^>]*class=["'][^"']*\bnum\b[^"']*["'][^>]*>([\s\S]*?)<\/th>/i)?.[1]).replace(/\D/g, ""));
    const nameBlock = rowHtml.match(/<td[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    const rawName = classValue(nameBlock, "stakes");
    const raceName = normalizeRaceName(rawName);
    if (!Number.isInteger(number) || !raceName) continue;
    const raceClass = classValue(nameBlock, "race_class");
    const raceCondition = classValue(nameBlock, "race_cond");
    const distance = classValue(nameBlock, "dist").replace(/,/g, "");
    const surfaceAndWeight = classValue(nameBlock, "type");
    const time = classValue(rowHtml, "time");
    rows.push({
      race_id: `jra-${date}-${venueCode}-${String(number).padStart(2, "0")}`,
      race_date: date,
      venue,
      venue_code: venueCode,
      venue_day: venueDay,
      race_number: number,
      name: raceName,
      grade: normalizeGrade(rawName),
      conditions: [raceClass, distance ? `${distance}m` : "", surfaceAndWeight]
        .filter(Boolean)
        .join(" ") || raceCondition,
      distance: distance ? `${distance}m` : "",
      full_gate: null,
      registration_count: null,
      entries: [],
      source_url: sourceUrl,
      source: "JRA official program",
      status: "program_only",
      start_time: time,
    });
  }
  return rows;
}

export function parseJraProgramHtml(html, { date, sourceUrl = "" } = {}) {
  const normalizedDate = normalizeDate(date);
  const cells = [...String(html).matchAll(
    /<div[^>]*class=["'][^"']*\bcell\b[^"']*["'][^>]*id=["']rc[^"']*["'][^>]*>([\s\S]*?<\/table>)/gi,
  )];
  const races = [];
  for (const cell of cells) {
    const cellHtml = cell[1];
    const venueDay = classValue(cellHtml, "main");
    const venue = Object.keys(VENUES).find((candidate) => venueDay.includes(candidate));
    if (!venue) continue;
    races.push(...parseRaceCell(cellHtml, {
      date: normalizedDate,
      venueDay,
      venue,
      venueCode: VENUES[venue],
      sourceUrl,
    }));
  }
  if (!races.length) throw new Error(`JRA公式番組から重賞・特別レースを取得できませんでした: ${normalizedDate}`);
  return {
    date: normalizedDate,
    source_url: sourceUrl,
    source: "JRA official program",
    races,
  };
}

export async function fetchJraProgram({ date, fetchImpl = fetch } = {}) {
  const normalizedDate = normalizeDate(date);
  const sourceUrl = jraProgramUrl(normalizedDate);
  const response = await fetchImpl(sourceUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NextRaceReport/1.0)" },
  });
  if (!response.ok) throw new Error(`JRA公式番組の取得に失敗しました: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const html = new TextDecoder("shift_jis").decode(bytes);
  return {
    ...parseJraProgramHtml(html, { date: normalizedDate, sourceUrl }),
    fetched_at: new Date().toISOString(),
  };
}
