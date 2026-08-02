export type NextRaceRow = {
  update: string;
  horse: string;
  next_race: string;
  horse_url: string;
  race_url: string;
};

export type PrizeMoneyRecord = {
  yen: number;
  jraUrl: string;
  verifiedAt: string;
  jraHorseId: string;
};

const clusterCupRaceUrl =
  "https://db.netkeiba.com/?pid=race_list&word=%A5%AF%A5%E9%A5%B9%A5%BF%A1%BC%A3%C3";

const verifiedAt = "2026-07-27";

const horses = [
  ["サンライズアムール", "2019101633", 89_000_000, "pw01dud002019101633/DD"],
  ["クロジシジョー", "2019102238", 84_900_000, "pw01dud002019102238/47"],
  ["ドラゴンウェルズ", "2022110137", 51_000_000, "pw01dud102022110137/11"],
  ["サウンドモリアーナ", "2022102057", 36_000_000, "pw01dud102022102057/10"],
  ["アンズアメ", "2022106689", 36_000_000, "pw01dud002022106689/21"],
  ["ポッドベイダー", "2022105244", 46_000_000, "pw01dud102022105244/D6"],
  ["ブレーザー", "2021100114", 36_000_000, "pw01dud102021100114/3E"],
  ["ゲイルライダー", "2022103684", 24_000_000, "pw01dud002022103684/15"],
  ["プレゼンティーア", "2021102153", 24_000_000, "pw01dud102021102153/E9"],
  ["ベルギューン", "2022100098", 15_000_000, "pw01dud102022100098/E5"],
  ["ファムエレガンテ", "2022110142", 24_000_000, "pw01dud002022110142/FB"],
  ["ペプチドヤマト", "2019103605", 36_000_000, "pw01dud102019103605/58"],
  ["コンクイスタ", "2020106557", 44_800_000, "pw01dud002020106557/00"],
  ["ジョーローリット", "2021100768", 24_000_000, "pw01dud002021100768/99"],
  ["アメリカンステージ", "2022110105", 20_100_000, "pw01dud002022110105/14"],
  ["ケイアイドリー", "2017101560", 81_700_000, "pw01dud102017101560/52"],
  ["ヤマニンアルリフラ", "2021106601", 41_500_000, "pw01dud002021106601/7D"],
  ["ビッグシーザー", "2020100896", 85_000_000, "pw01dud102020100896/6F"],
] as const;

export const clusterCupRows: NextRaceRow[] = horses.map(([horse, id]) => ({
  update: "",
  horse,
  next_race: "クラスターC",
  horse_url: `https://db.netkeiba.com/horse/${id}/?rf=kmatome`,
  race_url: clusterCupRaceUrl,
}));

export const clusterCupPrizeMoney: Record<string, PrizeMoneyRecord> =
  Object.fromEntries(
    horses.map(([horse, id, yen, jraPath]) => [
      horse,
      {
        yen,
        jraUrl: `https://www.jra.go.jp/JRADB/accessU.html?CNAME=${jraPath}`,
        verifiedAt,
        jraHorseId: id,
      },
    ]),
  );

export function applyClusterCupRows(rows: NextRaceRow[]) {
  const targetNames = new Set(clusterCupRows.map((row) => row.horse));
  return [
    ...rows.filter((row) => !targetNames.has(row.horse)),
    ...clusterCupRows,
  ];
}
