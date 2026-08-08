const sourcePages = [
  {
    label: "古馬",
    url: "https://dir.netkeiba.com/keibamatome/detail.html?no=5557",
  },
  {
    label: "2・3歳",
    url: "https://dir.netkeiba.com/keibamatome/detail.html?no=5556",
  },
];

type RaceRow = {
  update: string;
  horse: string;
  next_race: string;
  horse_url: string;
  race_url: string;
};

type SourceResult = {
  label: string;
  url: string;
  page_updated: string;
  rows: RaceRow[];
};

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function text(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function href(value: string) {
  const match = value.match(/<a[^>]+href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return decodeEntities(match?.[1] || match?.[2] || match?.[3] || "");
}

function findPartsNumbers(mainHtml: string) {
  const numbers: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !numbers.includes(value)) numbers.push(value);
  };

  for (const match of mainHtml.matchAll(
    /id=["']prev_parts-\d+["'][\s\S]{0,700}?['"]no['"]:\s*['"](\d+)['"]/gi,
  )) {
    add(match[1]);
  }
  for (const match of mainHtml.matchAll(
    /['"]no['"]:\s*['"](\d+)['"][\s\S]{0,400}?ajax_parts_view/gi,
  )) {
    add(match[1]);
  }
  return numbers;
}

function parseRows(partsHtml: string): RaceRow[] {
  return [...partsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .slice(1)
    .map((match) => {
      const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1]);
      if (cells.length < 3) return null;
      return {
        update: text(cells[0]),
        horse: text(cells[1]),
        next_race: text(cells[2]),
        horse_url: href(cells[1]),
        race_url: href(cells[2]),
      };
    })
    .filter((row): row is RaceRow => row !== null);
}

function combineRows(results: SourceResult[]) {
  const byHorse = new Map<string, RaceRow & { source_label: string; source_page_url: string }>();
  for (const result of results) {
    for (const row of result.rows) {
      const key = row.horse_url || row.horse;
      byHorse.set(key, {
        ...row,
        source_label: result.label,
        source_page_url: result.url,
      });
    }
  }
  return [...byHorse.values()];
}

export async function GET() {
  try {
    const headers = { "User-Agent": "Mozilla/5.0 (compatible; NextRaceDirectory/1.0)" };
    const results: SourceResult[] = await Promise.all(
      sourcePages.map(async (source) => {
        const mainResponse = await fetch(source.url, { headers });
        if (!mainResponse.ok) throw new Error("source page unavailable");
        const mainHtml = await mainResponse.text();
        const partsNumbers = findPartsNumbers(mainHtml);
        if (!partsNumbers.length) throw new Error("parts id unavailable");

        const parts = await Promise.all(
          partsNumbers.map(async (partsNumber) => {
            const partsResponse = await fetch(
              "https://dir.netkeiba.com/keibamatome/ajax_parts_view.html?no=" + partsNumber,
              { headers },
            );
            if (!partsResponse.ok) throw new Error("table unavailable");
            return parseRows(await partsResponse.text());
          }),
        );
        const rows = parts.flat();
        if (rows.length < 10) throw new Error("unexpected source format");
        return {
          ...source,
          page_updated: text(mainHtml.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ""),
          rows,
        };
      }),
    );

    const rows = combineRows(results);
    return Response.json({
      source_url: sourcePages[0].url,
      source_pages: results.map(({ label, url, page_updated, rows: sourceRows }) => ({
        label,
        url,
        page_updated,
        row_count: sourceRows.length,
      })),
      page_updated: results
        .map((result) => result.label + " " + result.page_updated)
        .join("／"),
      retrieved_at: new Date().toISOString(),
      rows,
    });
  } catch {
    return Response.json({ error: "最新データを取得できませんでした" }, { status: 502 });
  }
}
