export type PrizeMoneyRecord = {
  yen: number;
  jraUrl: string;
  verifiedAt: string;
};

export const prizeMoneyByHorse: Record<string, PrizeMoneyRecord> = {
  アイサンサン: {
    yen: 43_000_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102022103875%2FC1",
    verifiedAt: "2026-07-27",
  },
  アクアヴァーナル: {
    yen: 40_500_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102021105433%2F29",
    verifiedAt: "2026-07-27",
  },
  アクートゥス: {
    yen: 24_000_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102020102625%2F08",
    verifiedAt: "2026-07-27",
  },
  アクションプラン: {
    yen: 43_500_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102020100116%2F98",
    verifiedAt: "2026-07-27",
  },
  アスクデビューモア: {
    yen: 24_000_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102021104824%2F61",
    verifiedAt: "2026-07-27",
  },
  アスクナイスショー: {
    yen: 45_500_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102021106954%2FA0",
    verifiedAt: "2026-07-27",
  },
  アスティスプマンテ: {
    yen: 24_000_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102021105358%2F57",
    verifiedAt: "2026-07-27",
  },
  アッチャゴーラ: {
    yen: 24_000_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102020102843%2FA4",
    verifiedAt: "2026-07-27",
  },
  アドマイヤズーム: {
    yen: 79_500_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102022105396%2F3D",
    verifiedAt: "2026-07-27",
  },
  アドマイヤテラ: {
    yen: 89_000_000,
    jraUrl:
      "https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud102021105369%2FDA",
    verifiedAt: "2026-07-27",
  },
};

export function formatPrizeMoney(yen: number) {
  const manYen = yen / 10_000;
  if (manYen >= 10_000) {
    const oku = Math.floor(manYen / 10_000);
    const remainder = manYen % 10_000;
    return remainder
      ? `${oku}億${remainder.toLocaleString("ja-JP")}万円`
      : `${oku}億円`;
  }
  return `${manYen.toLocaleString("ja-JP")}万円`;
}
