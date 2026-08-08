import test from "node:test";
import assert from "node:assert/strict";
import { jraProgramUrl, parseJraProgramHtml } from "../scripts/jra-race-program.mjs";

const fixture = `
<div class="cell" id="rcB">
  <table>
    <caption class="simple"><div class="inner"><div class="main">2回中京8日</div></div></caption>
    <tbody>
      <tr class="stakes">
        <th scope="row" class="num">7<span>レース</span></th>
        <td class="name">
          <p class="stakes"><strong>サマーマイルシリーズ<br />第74回 中京記念（GⅢ）</strong></p>
          <p class="race_class">3歳以上オープン</p>
          <p class="race_cond"><span class="dist">1,600</span><span class="type">（芝）別定</span></p>
        </td>
        <td class="time">15時35分</td>
      </tr>
    </tbody>
  </table>
</div>`;

test("builds a generic JRA program URL from a date", () => {
  assert.equal(
    jraProgramUrl("2026-08-16"),
    "https://jra.jp/keiba/calendar2026/2026/8/0816.html",
  );
});

test("parses graded and special races without fixing a race name or date", () => {
  const payload = parseJraProgramHtml(fixture, {
    date: "2026-08-16",
    sourceUrl: "https://example.test/jra-program",
  });
  assert.equal(payload.races.length, 1);
  assert.deepEqual(payload.races[0], {
    race_id: "jra-2026-08-16-07-07",
    race_date: "2026-08-16",
    venue: "中京",
    venue_code: "07",
    venue_day: "2回中京8日",
    race_number: 7,
    name: "中京記念",
    grade: "GIII",
    conditions: "3歳以上オープン 1600m （芝）別定",
    distance: "1600m",
    full_gate: null,
    registration_count: null,
    entries: [],
    source_url: "https://example.test/jra-program",
    source: "JRA official program",
    status: "program_only",
    start_time: "15時35分",
  });
});
