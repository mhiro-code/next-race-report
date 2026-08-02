const sourceUrl = "https://dir.netkeiba.com/keibamatome/detail.html?no=5557";

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

export async function GET() {
  try {
    const headers = { "User-Agent": "Mozilla/5.0 (compatible; NextRaceDirectory/1.0)" };
    const mainResponse = await fetch(sourceUrl, { headers });
    if (!mainResponse.ok) throw new Error("source page unavailable");
    const mainHtml = await mainResponse.text();

    const partsNo =
      mainHtml.match(/id=["']prev_parts-(\d+)["'][\s\S]{0,500}?['"]no['"]:\s*['"](\d+)['"]/i)?.[2] ||
      mainHtml.match(/['"]no['"]:\s*['"](\d+)['"][\s\S]{0,300}?ajax_parts_view/i)?.[1];
    if (!partsNo) throw new Error("parts id unavailable");

    const partsResponse = await fetch(
      `https://dir.netkeiba.com/keibamatome/ajax_parts_view.html?no=${partsNo}`,
      { headers },
    );
    if (!partsResponse.ok) throw new Error("table unavailable");
    const partsHtml = await partsResponse.text();

    const rowMatches = [...partsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
    const rows = rowMatches
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
      .filter(Boolean);

    if (rows.length < 10) throw new Error("unexpected source format");

    const pageUpdated = text(mainHtml.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || "");
    return Response.json({
      source_url: sourceUrl,
      page_updated: pageUpdated,
      retrieved_at: new Date().toISOString(),
      rows,
    });
  } catch {
    return Response.json({ error: "最新データを取得できませんでした" }, { status: 502 });
  }
}
