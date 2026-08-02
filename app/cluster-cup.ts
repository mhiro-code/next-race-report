import clusterCupHorses from "./cluster-cup-horses.json";

export type NextRaceRow = {
  update: string;
  horse: string;
  next_race: string;
  horse_url: string;
  race_url: string;
};

const clusterCupRaceUrl =
  "https://db.netkeiba.com/?pid=race_list&word=%A5%AF%A5%E9%A5%B9%A5%BF%A1%BC%A3%C3";

type ClusterCupHorse = {
  KettoNum: string;
  HorseName: string;
};

const horses = clusterCupHorses as ClusterCupHorse[];

export const clusterCupRows: NextRaceRow[] = horses.map((record) => ({
  update: "",
  horse: record.HorseName,
  next_race: "クラスターC",
  horse_url: `https://db.netkeiba.com/horse/${record.KettoNum}/?rf=kmatome`,
  race_url: clusterCupRaceUrl,
}));

export function applyClusterCupRows(rows: NextRaceRow[]) {
  const targetNames = new Set(clusterCupRows.map((row) => row.horse));
  return [
    ...rows.filter((row) => !targetNames.has(row.horse)),
    ...clusterCupRows,
  ];
}
