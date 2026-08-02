#!/usr/bin/env python3
"""Import JV-Link prizes required by the Site's current horse list."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "app" / "data-lab-prize-money.json"
REQUIRED_COLUMNS = {"KettoNum", "HorseName", "PrizeYen", "SourceFile"}
NEXT_RACES_PATH = ROOT / "app" / "next-races.json"
CLUSTER_CUP_PATH = ROOT / "app" / "cluster-cup-horses.json"


def get_target_ids() -> set[str]:
    next_races = json.loads(NEXT_RACES_PATH.read_text(encoding="utf-8"))
    cluster_cup = json.loads(CLUSTER_CUP_PATH.read_text(encoding="utf-8"))
    target_ids = {
        row["horse_url"].split("/horse/", 1)[1].split("/", 1)[0]
        for row in next_races["rows"]
        if "/horse/" in row.get("horse_url", "")
    }
    target_ids.update(row["KettoNum"] for row in cluster_cup)
    return target_ids


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: import-data-lab-prizes.py <all-horse-prize-money.csv>")
        return 2

    input_path = Path(sys.argv[1]).resolve()
    target_ids = get_target_ids()
    with input_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing_columns = REQUIRED_COLUMNS.difference(reader.fieldnames or [])
        if missing_columns:
            raise ValueError(
                f"CSV is missing columns: {', '.join(sorted(missing_columns))}"
            )

        records = []
        seen_ids: set[str] = set()
        for row in reader:
            ketto_num = row["KettoNum"].strip()
            horse_name = row["HorseName"].strip()
            prize_yen = int(row["PrizeYen"])
            source_file = row["SourceFile"].strip()

            if len(ketto_num) != 10 or not ketto_num.isdigit():
                raise ValueError(f"Invalid KettoNum: {ketto_num!r}")
            if ketto_num in seen_ids:
                raise ValueError(f"Duplicate KettoNum: {ketto_num}")
            if not horse_name or prize_yen < 0 or not source_file:
                raise ValueError(f"Invalid record: {row!r}")

            seen_ids.add(ketto_num)
            if ketto_num not in target_ids:
                continue
            records.append(
                {
                    "KettoNum": ketto_num,
                    "HorseName": horse_name,
                    "PrizeYen": prize_yen,
                    "SourceFile": source_file,
                }
            )

    records.sort(key=lambda item: item["KettoNum"])
    imported_ids = {record["KettoNum"] for record in records}
    missing_ids = sorted(target_ids.difference(imported_ids))
    if missing_ids:
        raise ValueError(
            f"Data Lab CSV is missing {len(missing_ids)} target horses: "
            + ", ".join(missing_ids)
        )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Imported {len(records)} current Site horses "
        f"from {len(seen_ids)} Data Lab records"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
