import dataLabPrizeMoney from "./data-lab-prize-money.json";

export type NextRaceRow = {
  update: string;
  horse: string;
  next_race: string;
  horse_url: string;
  race_url: string;
};

export type PrizeMoneyRecord = {
  yen: number;
  jraUrl?: string;
  verifiedAt: string;
  jraHorseId: string;
  sourceLabel?: string;
  sourceFile?: string;
};

const clusterCupRaceUrl =
  "https://db.netkeiba.com/?pid=race_list&word=%A5%AF%A5%E9%A5%B9%A5%BF%A1%BC%A3%C3";

const verifiedAt = "2026-07-27";

type DataLabPrizeRecord = {
  KettoNum: string;
  HorseName: string;
  PrizeYen: number;
  SourceFile: string;
};

const horses = dataLabPrizeMoney as DataLabPrizeRecord[];

export const clusterCupRows: NextRaceRow[] = horses.map((record) => ({
  update: "",
  horse: record.HorseName,
  next_race: "クラスターC",
  horse_url: `https://db.netkeiba.com/horse/${record.KettoNum}/?rf=kmatome`,
  race_url: clusterCupRaceUrl,
}));

export const clusterCupPrizeMoney: Record<string, PrizeMoneyRecord> =
  Object.fromEntries(
    horses.map((record) => [
      record.HorseName,
      {
        yen: record.PrizeYen,
        verifiedAt,
        jraHorseId: record.KettoNum,
        sourceLabel: "JRA-VAN Data Lab.",
        sourceFile: record.SourceFile,
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
