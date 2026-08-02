import jraPrizeMoney from "./jra-prize-money.json";
import dataLabPrizeMoney from "./data-lab-prize-money.json";

export type PrizeMoneyRecord = {
  yen: number;
  jraUrl?: string;
  verifiedAt: string;
  jraHorseId: string;
  sourceLabel?: string;
  sourceFile?: string;
};

type DataLabPrizeRecord = {
  KettoNum: string;
  HorseName: string;
  PrizeYen: number;
  SourceFile: string;
};

const dataLabPrizeMoneyByHorseId: Record<string, PrizeMoneyRecord> =
  Object.fromEntries(
    (dataLabPrizeMoney as DataLabPrizeRecord[]).map((record) => [
      record.KettoNum,
      {
        yen: record.PrizeYen,
        verifiedAt: "2026-07-27",
        jraHorseId: record.KettoNum,
        sourceLabel: "JRA-VAN Data Lab.",
        sourceFile: record.SourceFile,
      },
    ]),
  );

const jraPrizeMoneyByHorse =
  jraPrizeMoney as Record<string, PrizeMoneyRecord>;

export function getHorseId(horseUrl: string) {
  return horseUrl.match(/\/horse\/(\d{10})/)?.[1];
}

export function getPrizeMoney(horseUrl: string, horseName: string) {
  const horseId = getHorseId(horseUrl);
  return (
    (horseId ? dataLabPrizeMoneyByHorseId[horseId] : undefined) ??
    jraPrizeMoneyByHorse[horseName]
  );
}

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
