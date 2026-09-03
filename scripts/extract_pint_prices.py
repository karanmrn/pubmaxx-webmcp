#!/usr/bin/env python3
"""Extract pint-price data from pint-prices.com into reusable local files."""

from __future__ import annotations

import csv
import json
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urljoin, urlparse
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://www.pint-prices.com"
SITEMAP_URL = f"{BASE_URL}/static/sitemap.xml"
OUT_DIR = Path("data")
SCRAPE_TS = datetime.now(timezone.utc).isoformat(timespec="seconds")

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (compatible; pubmax-pint-price-extractor/1.0; "
            "+https://www.pint-prices.com/)"
        )
    }
)


PUB_FIELDS = [
    "address",
    "beer_garden",
    "booking_link",
    "cocktails",
    "comment",
    "cool",
    "darts",
    "description",
    "distance",
    "email",
    "food",
    "happy_hour",
    "image_url",
    "karaoke",
    "latitude",
    "live_music",
    "live_sports",
    "locality",
    "longitude",
    "name",
    "phone_number",
    "pool",
    "pub_quiz",
    "website",
]


def fetch(url: str) -> str:
    response = SESSION.get(url, timeout=45)
    response.raise_for_status()
    return response.text


def price_to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).replace("£", "").replace(",", "").strip()
    match = re.search(r"\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def abs_url(value: str) -> str:
    return urljoin(BASE_URL, value)


def pub_url_from_fields(address: str, pub_name: str) -> str:
    return f"{BASE_URL}/pub/{quote(address, safe='')}/{quote(pub_name, safe='')}"


def decode_pub_url(url: str) -> tuple[str, str]:
    path = urlparse(url).path
    if not path.startswith("/pub/"):
        return "", ""
    parts = path.removeprefix("/pub/").split("/", 1)
    if len(parts) != 2:
        return unquote(parts[0]), ""
    return unquote(parts[0]), unquote(parts[1])


def parse_sitemap() -> tuple[list[str], list[str], list[str]]:
    root = ElementTree.fromstring(fetch(SITEMAP_URL))
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [node.text or "" for node in root.findall(".//sm:loc", namespace)]
    borough_urls = sorted({u for u in urls if "/borough-results/" in u})
    pub_urls = sorted({u for u in urls if "/pub/" in u})
    return urls, borough_urls, pub_urls


def extract_var_object(html: str, var_name: str) -> dict[str, Any]:
    marker = f"var {var_name} = "
    start = html.find(marker)
    if start == -1:
        return {}
    start += len(marker)
    brace_start = html.find("{", start)
    if brace_start == -1:
        return {}

    depth = 0
    in_string = False
    escape = False
    quote_char = ""
    for index in range(brace_start, len(html)):
        char = html[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote_char:
                in_string = False
            continue
        if char in ('"', "'"):
            in_string = True
            quote_char = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return json.loads(html[brace_start : index + 1])
    return {}


def parse_leaderboard(html: str, borough: str, borough_url: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict[str, Any]] = []
    average = ""
    heading = soup.find(string=re.compile(r"Est\. Average Price:"))
    if heading:
        average = clean_text(heading).replace("Est. Average Price:", "").strip()

    for anchor in soup.select(".leaderboard a[href]"):
        cells = [clean_text(cell.get_text(" ")) for cell in anchor.select(".row .cell")]
        if len(cells) != 4:
            continue
        rows.append(
            {
                "borough": borough,
                "rank": cells[0],
                "pub_name": cells[1],
                "pint_name": cells[2],
                "price_text": cells[3],
                "price_gbp": price_to_float(cells[3]),
                "pub_url": abs_url(anchor["href"]),
                "borough_url": borough_url,
                "estimated_average_price_text": average,
                "scraped_at": SCRAPE_TS,
            }
        )
    return rows


def parse_borough_page(url: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    html = fetch(url)
    borough = unquote(urlparse(url).path.rsplit("/", 1)[-1])
    pubs_data = extract_var_object(html, "pubsData")
    rows: list[dict[str, Any]] = []

    for pub_key, pub in pubs_data.items():
        if not isinstance(pub, dict):
            continue
        pints = pub.get("pints") or []
        pub_name = clean_text(pub.get("name"))
        address = clean_text(pub.get("address"))
        constructed_url = pub_url_from_fields(address, pub_name) if address and pub_name else ""
        for position, pint in enumerate(pints, start=1):
            if not isinstance(pint, (list, tuple)) or len(pint) < 2:
                continue
            pint_name = clean_text(pint[0])
            price_text = clean_text(pint[1])
            record = {
                "borough": borough,
                "pub_key": pub_key,
                "pub_name": pub_name,
                "pint_name": pint_name,
                "price_text": price_text,
                "price_gbp": price_to_float(price_text),
                "pint_position_for_pub": position,
                "constructed_pub_url": constructed_url,
                "borough_url": url,
                "scraped_at": SCRAPE_TS,
            }
            for field in PUB_FIELDS:
                record[field] = pub.get(field)
            rows.append(record)

    metadata = {
        "borough": borough,
        "borough_url": url,
        "pubs_in_embedded_data": len(pubs_data),
        "pint_rows_in_embedded_data": len(rows),
        "leaderboard_rows": len(parse_leaderboard(html, borough, url)),
    }
    return rows, parse_leaderboard(html, borough, url), metadata


def parse_pub_page(url: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    html = fetch(url)
    soup = BeautifulSoup(html, "html.parser")
    fallback_address, fallback_name = decode_pub_url(url)

    title = soup.select_one(".heading_container h1")
    pub_name = clean_text(title.get_text(" ")) if title else clean_text(fallback_name)
    detail_box = soup.select_one(".detail-box")
    detail_text = clean_text(detail_box.get_text("\n")) if detail_box else ""
    address = fallback_address
    phone = ""

    address_match = re.search(r"📍\s*(.*?)\s*(?:📞|Not quite right\?|$)", detail_text)
    if address_match:
        address = clean_text(address_match.group(1))
    phone_match = re.search(r"📞\s*(.*?)\s*(?:Not quite right\?|$)", detail_text)
    if phone_match:
        phone = clean_text(phone_match.group(1))
        if phone.lower() == "none":
            phone = ""

    lat_match = re.search(r'var lat = "([^"]+)"', html)
    lon_match = re.search(r'var lon = "([^"]+)"', html)
    rows: list[dict[str, Any]] = []

    for row in soup.select(".leaderboard .row"):
        if "header" in (row.get("class") or []):
            continue
        cells = [clean_text(cell.get_text(" ")) for cell in row.select(".cell")]
        if len(cells) < 3:
            continue
        rows.append(
            {
                "pub_name": pub_name,
                "address": address,
                "phone_number": phone,
                "latitude": lat_match.group(1) if lat_match else "",
                "longitude": lon_match.group(1) if lon_match else "",
                "pint_position_for_pub": cells[0],
                "pint_name": cells[1],
                "price_text": cells[2],
                "price_gbp": price_to_float(cells[2]),
                "pub_url": url,
                "scraped_at": SCRAPE_TS,
            }
        )

    metadata = {
        "pub_url": url,
        "pub_name": pub_name,
        "address": address,
        "pint_rows": len(rows),
    }
    return rows, metadata


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames: list[str] = []
    seen = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def normalized_key(row: dict[str, Any]) -> tuple[str, str, str, float | None]:
    price = price_to_float(row.get("price_gbp") or row.get("price_text"))
    return (
        clean_text(row.get("borough")).lower(),
        clean_text(row.get("pub_name")).lower(),
        clean_text(row.get("pint_name")).lower(),
        round(price, 2) if price is not None else None,
    )


def build_builder_outputs(
    borough_rows: list[dict[str, Any]],
    leaderboard_rows: list[dict[str, Any]],
    pub_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    embedded_by_key: dict[tuple[str, str, str, float | None], dict[str, Any]] = {}
    for row in borough_rows:
        embedded_by_key.setdefault(normalized_key(row), row)

    enriched_rows: list[dict[str, Any]] = []
    for row in leaderboard_rows:
        embedded = embedded_by_key.get(normalized_key(row), {})
        enriched = {
            "source_dataset": "canonical_borough_leaderboard_enriched",
            "is_canonical_borough_price": True,
            "is_visible_borough_row": True,
            "is_raw_embedded_map_row": False,
            "is_pub_page_row": False,
            **row,
        }
        for field in [
            "pub_key",
            "address",
            "beer_garden",
            "booking_link",
            "cocktails",
            "comment",
            "cool",
            "darts",
            "description",
            "distance",
            "email",
            "food",
            "happy_hour",
            "image_url",
            "karaoke",
            "latitude",
            "live_music",
            "live_sports",
            "locality",
            "longitude",
            "name",
            "phone_number",
            "pool",
            "pub_quiz",
            "website",
            "constructed_pub_url",
        ]:
            enriched[field] = embedded.get(field, "")
        enriched_rows.append(enriched)

    master_rows = [
        {
            "source_dataset": "canonical_borough_leaderboard_enriched",
            "is_canonical_borough_price": True,
            "is_visible_borough_row": True,
            "is_raw_embedded_map_row": False,
            "is_pub_page_row": False,
            **row,
        }
        for row in enriched_rows
    ]
    master_rows.extend(
        {
            "source_dataset": "borough_embedded_map_data_raw",
            "is_canonical_borough_price": False,
            "is_visible_borough_row": False,
            "is_raw_embedded_map_row": True,
            "is_pub_page_row": False,
            **row,
        }
        for row in borough_rows
    )
    master_rows.extend(
        {
            "source_dataset": "individual_pub_page",
            "is_canonical_borough_price": False,
            "is_visible_borough_row": False,
            "is_raw_embedded_map_row": False,
            "is_pub_page_row": True,
            **row,
        }
        for row in pub_rows
    )

    seen_locations: set[tuple[str, str, str, str]] = set()
    location_rows: list[dict[str, Any]] = []
    for source_name, rows in [
        ("borough_embedded_map_data_raw", borough_rows),
        ("individual_pub_page", pub_rows),
    ]:
        for row in rows:
            name = clean_text(row.get("pub_name") or row.get("name"))
            address = clean_text(row.get("address"))
            latitude = clean_text(row.get("latitude"))
            longitude = clean_text(row.get("longitude"))
            key = (name.lower(), address.lower(), latitude, longitude)
            if key in seen_locations:
                continue
            seen_locations.add(key)
            location_rows.append(
                {
                    "location_source_dataset": source_name,
                    "borough": row.get("borough", ""),
                    "pub_name": name,
                    "name": row.get("name", ""),
                    "address": address,
                    "latitude": latitude,
                    "longitude": longitude,
                    "phone_number": row.get("phone_number", ""),
                    "email": row.get("email", ""),
                    "website": row.get("website", ""),
                    "booking_link": row.get("booking_link", ""),
                    "image_url": row.get("image_url", ""),
                    "description": row.get("description", ""),
                    "food": row.get("food", ""),
                    "cocktails": row.get("cocktails", ""),
                    "beer_garden": row.get("beer_garden", ""),
                    "live_sports": row.get("live_sports", ""),
                    "live_music": row.get("live_music", ""),
                    "pub_quiz": row.get("pub_quiz", ""),
                    "darts": row.get("darts", ""),
                    "pool": row.get("pool", ""),
                    "happy_hour": row.get("happy_hour", ""),
                    "karaoke": row.get("karaoke", ""),
                    "cool": row.get("cool", ""),
                    "locality": row.get("locality", ""),
                    "constructed_pub_url": row.get("constructed_pub_url", ""),
                    "pub_url": row.get("pub_url", ""),
                    "borough_url": row.get("borough_url", ""),
                }
            )

    return enriched_rows, master_rows, location_rows


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    all_urls, borough_urls, pub_urls = parse_sitemap()

    borough_rows: list[dict[str, Any]] = []
    leaderboard_rows: list[dict[str, Any]] = []
    borough_metadata: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for index, url in enumerate(borough_urls, start=1):
        try:
            rows, leaderboard, metadata = parse_borough_page(url)
            borough_rows.extend(rows)
            leaderboard_rows.extend(leaderboard)
            borough_metadata.append(metadata)
        except Exception as exc:  # noqa: BLE001 - preserve URL-level failure.
            errors.append({"url": url, "stage": "borough", "error": repr(exc)})
        time.sleep(0.08)
        if index % 8 == 0:
            print(f"Parsed {index}/{len(borough_urls)} borough pages")

    pub_rows: list[dict[str, Any]] = []
    pub_metadata: list[dict[str, Any]] = []
    for index, url in enumerate(pub_urls, start=1):
        try:
            rows, metadata = parse_pub_page(url)
            pub_rows.extend(rows)
            pub_metadata.append(metadata)
        except Exception as exc:  # noqa: BLE001 - preserve URL-level failure.
            errors.append({"url": url, "stage": "pub", "error": repr(exc)})
        time.sleep(0.04)
        if index % 100 == 0:
            print(f"Parsed {index}/{len(pub_urls)} pub pages")

    write_csv(OUT_DIR / "borough_embedded_pint_prices.csv", borough_rows)
    write_csv(OUT_DIR / "borough_leaderboard_pint_prices.csv", leaderboard_rows)
    write_csv(OUT_DIR / "borough_pint_prices.csv", leaderboard_rows)
    write_csv(OUT_DIR / "pub_page_pint_prices.csv", pub_rows)
    enriched_rows, master_rows, location_rows = build_builder_outputs(
        borough_rows, leaderboard_rows, pub_rows
    )
    write_csv(OUT_DIR / "pint_prices_canonical_enriched.csv", enriched_rows)
    write_csv(OUT_DIR / "pint_prices_builder_master.csv", master_rows)
    write_csv(OUT_DIR / "pub_locations_map_data.csv", location_rows)
    combined_rows = [
        {"source_dataset": "borough_pint_prices", **row} for row in leaderboard_rows
    ] + [{"source_dataset": "pub_page_pint_prices", **row} for row in pub_rows]
    write_csv(OUT_DIR / "all_pint_prices_combined.csv", combined_rows)

    (OUT_DIR / "borough_embedded_pint_prices.json").write_text(
        json.dumps(borough_rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "pub_page_pint_prices.json").write_text(
        json.dumps(pub_rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    borough_counts = Counter(row["borough"] for row in borough_rows)
    leaderboard_borough_counts = Counter(row["borough"] for row in leaderboard_rows)
    pub_price_counts = Counter(row["pub_name"] for row in pub_rows)
    borough_pub_counts: dict[str, set[str]] = defaultdict(set)
    for row in borough_rows:
        borough_pub_counts[row["borough"]].add(f"{row.get('pub_name')}|{row.get('address')}")
    leaderboard_pub_counts: dict[str, set[str]] = defaultdict(set)
    for row in leaderboard_rows:
        leaderboard_pub_counts[row["borough"]].add(row.get("pub_url") or row.get("pub_name", ""))

    summary = {
        "source": BASE_URL,
        "sitemap_url": SITEMAP_URL,
        "scraped_at": SCRAPE_TS,
        "sitemap_url_count": len(all_urls),
        "borough_page_count": len(borough_urls),
        "pub_page_count": len(pub_urls),
        "borough_embedded_price_rows": len(borough_rows),
        "borough_embedded_unique_pub_keys": len({row["pub_key"] for row in borough_rows}),
        "borough_embedded_unique_pub_name_address": len(
            {f"{row.get('pub_name')}|{row.get('address')}" for row in borough_rows}
        ),
        "borough_leaderboard_price_rows": len(leaderboard_rows),
        "canonical_borough_price_rows": len(leaderboard_rows),
        "pub_page_price_rows": len(pub_rows),
        "all_pint_prices_combined_rows": len(combined_rows),
        "pint_prices_canonical_enriched_rows": len(enriched_rows),
        "pint_prices_builder_master_rows": len(master_rows),
        "pub_locations_map_rows": len(location_rows),
        "canonical_enriched_rows_missing_coordinates": sum(
            1
            for row in enriched_rows
            if not clean_text(row.get("latitude")) or not clean_text(row.get("longitude"))
        ),
        "pub_page_unique_pub_urls": len({row["pub_url"] for row in pub_rows}),
        "pub_page_unique_pub_name_address": len(
            {f"{row.get('pub_name')}|{row.get('address')}" for row in pub_rows}
        ),
        "boroughs": sorted(borough_counts),
        "price_rows_by_borough": dict(sorted(borough_counts.items())),
        "canonical_price_rows_by_borough": dict(sorted(leaderboard_borough_counts.items())),
        "unique_pubs_by_borough": {
            borough: len(pub_keys) for borough, pub_keys in sorted(borough_pub_counts.items())
        },
        "canonical_unique_pubs_by_borough": {
            borough: len(pub_keys) for borough, pub_keys in sorted(leaderboard_pub_counts.items())
        },
        "embedded_data_caveats": [
            "Use borough_pint_prices.csv as the canonical borough extract.",
            "borough_embedded_pint_prices.csv preserves the raw pubsData object from each borough page.",
            "Havering, Hillingdon, and Redbridge exposed a large embedded pubsData object but no visible leaderboard rows at scrape time.",
        ],
        "top_pub_page_price_counts": pub_price_counts.most_common(20),
        "borough_metadata": borough_metadata,
        "errors": errors,
    }
    (OUT_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_csv(OUT_DIR / "summary_by_borough.csv", [
        {
            "borough": borough,
            "price_rows": leaderboard_borough_counts[borough],
            "unique_pubs": len(leaderboard_pub_counts[borough]),
        }
        for borough in sorted(leaderboard_borough_counts)
    ])

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
