#!/usr/bin/env python3
"""Convert a JV-Link prize CSV into the Site's Data Lab JSON."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "app" / "data-lab-prize-money.json"
REQUIRED_COLUMNS = {"KettoNum", "HorseName", "PrizeYen", "SourceFile"}


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: import-data-lab-prizes.py <cluster-cup-prize-money.csv>")
        return 2

    input_path = Path(sys.argv[1]).resolve()
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
            records.append(
                {
                    "KettoNum": ketto_num,
                    "HorseName": horse_name,
                    "PrizeYen": prize_yen,
                    "SourceFile": source_file,
                }
            )

    records.sort(key=lambda item: item["KettoNum"])
    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Imported {len(records)} records to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
