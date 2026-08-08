const GRADED_CODES = new Set(["A", "B", "C", "D", "F", "G", "H"]);

export const RACE_STAGES = Object.freeze({
  NEXT: "next",
  SPECIAL: "special",
  CONFIRMED: "confirmed",
});

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .trim();
}

function targetRaceParts(raceId) {
  const value = String(raceId ?? "");
  if (!/^\d{16}$/.test(value)) return null;
  return {
    race_date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
    venue_code: value.slice(8, 10),
    race_number: Number(value.slice(14, 16)),
  };
}

function programRaceParts(raceId) {
  const match = String(raceId ?? "").match(/^jra-(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    race_date: match[1],
    venue_code: match[2],
    race_number: Number(match[3]),
  };
}

export function isOpenSpecialRace(race) {
  if (race?.grade_code === "L") return true;
  if (race?.grade_code !== "E") return false;
  return Object.values(race?.conditions ?? {}).includes("999");
}

export function isManagedTargetRace(race) {
  return GRADED_CODES.has(String(race?.grade_code ?? "")) || isOpenSpecialRace(race);
}

export function racesMatch(left, right) {
  if (!left || !right) return false;
  if (left.race_id && right.race_id && left.race_id === right.race_id) return true;
  const leftParts = targetRaceParts(left.race_id) ?? programRaceParts(left.race_id);
  const rightParts = targetRaceParts(right.race_id) ?? programRaceParts(right.race_id);
  const leftDate = leftParts?.race_date ?? left.race_date;
  const rightDate = rightParts?.race_date ?? right.race_date;
  const leftVenue = leftParts?.venue_code ?? left.venue_code ?? normalizeText(left.venue);
  const rightVenue = rightParts?.venue_code ?? right.venue_code ?? normalizeText(right.venue);
  const leftNumber = leftParts?.race_number ?? Number(left.race_number);
  const rightNumber = rightParts?.race_number ?? Number(right.race_number);
  if (leftDate && rightDate && leftDate === rightDate && leftVenue && rightVenue && leftVenue === rightVenue &&
      Number.isInteger(leftNumber) && Number.isInteger(rightNumber) && leftNumber === rightNumber) {
    return true;
  }
  return Boolean(leftDate && rightDate && leftDate === rightDate &&
    normalizeText(left.name) && normalizeText(left.name) === normalizeText(right.name));
}

export function selectRaceStage({ confirmedRace = null, targetRace = null, provisionalRace = null } = {}) {
  if (confirmedRace?.entries?.length) {
    return { stage: RACE_STAGES.CONFIRMED, race: confirmedRace, source: "TARGET confirmed" };
  }
  if (targetRace?.entries?.length) {
    return { stage: RACE_STAGES.SPECIAL, race: targetRace, source: "TARGET special registration" };
  }
  if (provisionalRace) {
    return { stage: RACE_STAGES.NEXT, race: provisionalRace, source: "next-race candidates" };
  }
  return null;
}
