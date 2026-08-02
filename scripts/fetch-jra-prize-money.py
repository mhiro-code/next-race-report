#!/usr/bin/env python3
"""Fetch verified flat-race acquisition prize money from JRA horse pages."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "app" / "next-races.json"
OUTPUT_PATH = ROOT / "app" / "jra-prize-money.json"
SOURCE_DATE = json.loads(DATA_PATH.read_text(encoding="utf-8"))["retrieved_at"][:10]
VERIFIED_AT = max(
    dt.datetime.now(dt.timezone.utc).date().isoformat(),
    SOURCE_DATE,
)
SEARCH_URL = "https://www.jra.go.jp/JRADB/accessR.html"
HORSE_URL = "https://www.jra.go.jp"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
)
SEARCH_LINK_RE = re.compile(
    rb'href="(?P<url>/JRADB/accessU\.html\?CNAME='
    rb'pw01dud00(?P<id>\d{10})/(?P<suffix>[0-9A-F]{2}))"'
)
NAME_RE = re.compile(
    r'<span class="txt"><span class="opt">競走馬情報</span>'
    r'(?P<name>.*?)<span class="name_en">',
    re.S,
)
PRIZE_RE = re.compile(
    r"<dt>収得賞金（平地）</dt>\s*<dd>(?P<yen>[\d,]+)<span>円</span>",
    re.S,
)
PRINT_LOCK = threading.Lock()


def request(
    url: str, data: bytes | None = None, attempts: int = 4
) -> bytes:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    }
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def extract_horse_id(horse_url: str) -> str:
    match = re.search(r"/horse/(\d{10})", horse_url)
    if not match:
        raise ValueError(f"netkeiba horse ID not found: {horse_url}")
    return match.group(1)


def search_official_url(name: str, horse_id: str) -> str:
    cname = f"pw02uliD10000{name}".encode("cp932")
    payload = urllib.parse.urlencode(
        {"cname": cname.decode("latin1")}, encoding="latin1"
    ).encode("ascii")
    body = request(SEARCH_URL, data=payload)
    for match in SEARCH_LINK_RE.finditer(body):
        if match.group("id").decode("ascii") == horse_id:
            relative = match.group("url").decode("ascii")
            return f"{HORSE_URL}{relative}"
    raise LookupError("matching JRA registration number not found")


def fetch_record(row: dict[str, str]) -> tuple[str, dict[str, object]]:
    name = row["horse"]
    horse_id = extract_horse_id(row["horse_url"])
    official_url = search_official_url(name, horse_id)
    body = request(official_url)
    page = body.decode("cp932", errors="replace")
    page_name_match = NAME_RE.search(page)
    prize_match = PRIZE_RE.search(page)
    if not page_name_match or not prize_match:
        raise ValueError("horse name or flat prize field missing")
    page_name = html.unescape(re.sub(r"<[^>]+>", "", page_name_match.group("name")))
    if page_name.strip() != name:
        raise ValueError(f"horse name mismatch: {page_name.strip()}")
    return name, {
        "yen": int(prize_match.group("yen").replace(",", "")),
        "jraUrl": official_url,
        "verifiedAt": VERIFIED_AT,
        "jraHorseId": horse_id,
    }


def load_existing() -> dict[str, dict[str, object]]:
    if not OUTPUT_PATH.exists():
        return {}
    return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))


def save(records: dict[str, dict[str, object]]) -> None:
    ordered = dict(sorted(records.items(), key=lambda item: item[0]))
    OUTPUT_PATH.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()

    rows = json.loads(DATA_PATH.read_text(encoding="utf-8"))["rows"]
    records = load_existing()
    pending = [row for row in rows if row["horse"] not in records]
    if args.limit:
        pending = pending[: args.limit]
    total = len(pending)
    failures: dict[str, str] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_record, row): row for row in pending}
        for index, future in enumerate(
            concurrent.futures.as_completed(futures), start=1
        ):
            row = futures[future]
            name = row["horse"]
            try:
                record_name, record = future.result()
                records[record_name] = record
                status = f"{int(record['yen']):,}円"
            except Exception as exc:  # continue and report unresolved horses
                failures[name] = f"{type(exc).__name__}: {exc}"
                status = failures[name]
            save(records)
            with PRINT_LOCK:
                print(f"[{index}/{total}] {name}: {status}", flush=True)

    print(
        json.dumps(
            {
                "verified": len(records),
                "failed": len(failures),
                "failures": failures,
                "output": str(OUTPUT_PATH),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
