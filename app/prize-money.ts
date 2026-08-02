import jraPrizeMoney from "./jra-prize-money.json";

export type PrizeMoneyRecord = {
  yen: number;
  jraUrl: string;
  verifiedAt: string;
  jraHorseId: string;
};

export const prizeMoneyByHorse =
  jraPrizeMoney as Record<string, PrizeMoneyRecord>;

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
