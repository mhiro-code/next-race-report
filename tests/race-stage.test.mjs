import assert from "node:assert/strict";
import test from "node:test";
import {
  isManagedTargetRace,
  racesMatch,
  RACE_STAGES,
  selectRaceStage,
} from "../scripts/race-stage.mjs";

test("limits TARGET batch processing to graded and open special races", () => {
  assert.equal(isManagedTargetRace({ grade_code: "C" }), true);
  assert.equal(isManagedTargetRace({ grade_code: "E", conditions: { age4: "999" } }), true);
  assert.equal(isManagedTargetRace({ grade_code: "E", conditions: { age4: "016" } }), false);
});

test("matches TARGET race ids with the same JRA program race", () => {
  assert.equal(
    racesMatch(
      { race_id: "2026081607010807", name: "中京記念" },
      { race_id: "jra-2026-08-16-07-07", venue_code: "07", race_number: 7 },
    ),
    true,
  );
});

test("selects confirmed before special registration and next-race data", () => {
  const selected = selectRaceStage({
    confirmedRace: { entries: [{ horse: "確定馬" }] },
    targetRace: { entries: [{ horse: "登録馬" }] },
    provisionalRace: { name: "中京記念" },
  });
  assert.equal(selected.stage, RACE_STAGES.CONFIRMED);
});
