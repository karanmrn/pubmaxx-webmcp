#!/usr/bin/env python3
"""Build one deduped, app-ready CSV from the extracted Pint Prices files."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable
from urllib.parse import quote


DATA = Path("data")
ANOMALY_BOROUGHS = {"Havering", "Hillingdon", "Redbridge"}
LONDON_LAT_MIN, LONDON_LAT_MAX = 51.26, 51.72
LONDON_LON_MIN, LONDON_LON_MAX = -0.55, 0.30
DECISION_SCRIPT = Path(__file__).resolve().with_name(
    "resolve_postcode_coordinate_decisions.mjs"
)
DECISION_INPUT_FILES = [
    DATA / "pint_prices_canonical_enriched.csv",
    DATA / "borough_embedded_pint_prices.csv",
    DATA / "pub_page_pint_prices.csv",
    DATA / "osm" / "uk" / "uk_osm_pubs.json",
    DATA / "postcode_coordinate_corrections.json",
    DATA / "postcode_coordinate_quarantine.json",
    DATA / "postcode_coordinate_exceptions.json",
]
DECISION_REPORT = DATA / "postcode_coordinate_build_report.json"
EXPECTED_COLUMNS = [
    "borough",
    "rank",
    "pub_key",
    "pub_name",
    "name",
    "address",
    "pint_name",
    "price_text",
    "price_gbp",
    "pint_position_for_pub",
    "pub_url",
    "constructed_pub_url",
    "borough_url",
    "estimated_average_price_text",
    "latitude",
    "longitude",
    "distance",
    "phone_number",
    "email",
    "website",
    "booking_link",
    "image_url",
    "description",
    "comment",
    "food",
    "cocktails",
    "beer_garden",
    "live_sports",
    "live_music",
    "pub_quiz",
    "darts",
    "pool",
    "happy_hour",
    "karaoke",
    "cool",
    "locality",
    "scraped_at",
]
CSV_MISSING_VALUES = {
    "",
    "#N/A",
    "#N/A N/A",
    "#NA",
    "-1.#IND",
    "-1.#QNAN",
    "-NaN",
    "-nan",
    "1.#IND",
    "1.#QNAN",
    "<NA>",
    "N/A",
    "NA",
    "NULL",
    "NaN",
    "None",
    "n/a",
    "nan",
    "null",
}


def clean(value: object) -> str:
    if value is None or (
        isinstance(value, float) and math.isnan(value)
    ):
        return ""
    return " ".join(str(value).split()).strip()


def first_nonblank(values: Iterable[object]) -> object:
    for value in values:
        text = clean(value)
        if text:
            return value if isinstance(value, (int, float)) else text
    return ""


def join_unique(values: Iterable[object]) -> str:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean(value)
        if not text or text.lower() == "nan" or text in seen:
            continue
        seen.add(text)
        output.append(text)
    return "|".join(output)


def price_num(value: object) -> float | None:
    try:
        parsed = float(str(value).replace("£", "").strip())
        return round(parsed, 2) if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def pub_url_from_fields(address: str, pub_name: str) -> str:
    if not address or not pub_name:
        return ""
    return (
        f"https://www.pint-prices.com/pub/"
        f"{quote(address, safe='')}/{quote(pub_name, safe='')}"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv(
    path: Path,
    *,
    numeric_fields: set[str] | None = None,
) -> list[dict[str, object]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows: list[dict[str, object]] = [dict(row) for row in csv.DictReader(handle)]
    for row in rows:
        for field, raw_value in row.items():
            if clean(raw_value) in CSV_MISSING_VALUES:
                row[field] = None
        for field in numeric_fields or set():
            value = clean(row.get(field))
            try:
                row[field] = float(value) if value else None
            except ValueError:
                row[field] = value
    return rows


def prep(
    rows: Iterable[dict[str, object]],
    source: str,
) -> list[dict[str, object]]:
    prepared: list[dict[str, object]] = []
    for original in rows:
        row = dict(original)
        for column in EXPECTED_COLUMNS:
            row.setdefault(column, "")

        row["source_dataset"] = source
        row["price_gbp_num"] = price_num(row["price_gbp"])
        row["pub_name_clean"] = clean(row["pub_name"]) or clean(row["name"])
        row["address_clean"] = clean(row["address"])
        row["pint_name_clean"] = clean(row["pint_name"])
        row["latitude_clean"] = clean(row["latitude"])
        row["longitude_clean"] = clean(row["longitude"])
        row["dedupe_key"] = (
            str(row["pub_name_clean"]).lower(),
            str(row["address_clean"]).lower(),
            row["latitude_clean"],
            row["longitude_clean"],
            str(row["pint_name_clean"]).lower(),
            row["price_gbp_num"],
        )
        prepared.append(row)
    return prepared


def values(rows: Iterable[dict[str, object]], field: str) -> list[object]:
    return [row.get(field, "") for row in rows]


def assemble_records(
    prepared_rows: Iterable[dict[str, object]],
) -> list[dict[str, object]]:
    groups: dict[tuple[object, ...], list[dict[str, object]]] = defaultdict(list)
    for row in prepared_rows:
        groups[row["dedupe_key"]].append(row)

    records: list[dict[str, object]] = []
    for group in groups.values():
        visible = [
            row
            for row in group
            if row["source_dataset"]
            == "canonical_borough_leaderboard_enriched"
        ]
        raw = [
            row
            for row in group
            if row["source_dataset"] == "borough_embedded_map_data_raw"
        ]
        pub = [
            row
            for row in group
            if row["source_dataset"] == "individual_pub_page"
        ]
        preferred = [*visible, *raw, *pub]

        boroughs_visible = join_unique(values(visible, "borough"))
        raw_boroughs = {
            clean(value)
            for value in values(raw, "borough")
            if clean(value)
        }
        anomaly_hits = sorted(raw_boroughs & ANOMALY_BOROUGHS)
        non_anomaly_raw = [
            row for row in raw if row["borough"] not in ANOMALY_BOROUGHS
        ]
        quality_notes: list[str] = []
        if anomaly_hits:
            quality_notes.append("raw_embedded_includes_site_anomaly_borough")
        if not visible:
            quality_notes.append("not_visible_in_borough_leaderboard")
        if not pub:
            quality_notes.append("not_found_on_individual_pub_page_extract")
        if not first_nonblank(
            values(preferred, "latitude_clean")
        ) or not first_nonblank(values(preferred, "longitude_clean")):
            quality_notes.append("missing_coordinates")

        pub_name = clean(first_nonblank(values(preferred, "pub_name_clean")))
        address = clean(first_nonblank(values(preferred, "address_clean")))
        constructed_pub_url = clean(
            first_nonblank(values(preferred, "constructed_pub_url"))
        ) or pub_url_from_fields(address, pub_name)
        trusted_group_boroughs = [
            row["borough"]
            for row in group
            if row["borough"] not in ANOMALY_BOROUGHS
        ]

        records.append(
            {
                "app_price_id": f"app_price_{len(records) + 1:06d}",
                "pub_name": pub_name,
                "pint_name": first_nonblank(
                    values(preferred, "pint_name_clean")
                ),
                "price_gbp": first_nonblank(
                    values(preferred, "price_gbp_num")
                ),
                "price_text": first_nonblank(
                    values(preferred, "price_text")
                ),
                "address": address,
                "latitude": first_nonblank(
                    values(preferred, "latitude_clean")
                ),
                "longitude": first_nonblank(
                    values(preferred, "longitude_clean")
                ),
                "boroughs_visible": boroughs_visible,
                "boroughs_raw_embedded": join_unique(
                    values(raw, "borough")
                ),
                "boroughs_raw_embedded_non_anomaly": join_unique(
                    values(non_anomaly_raw, "borough")
                ),
                "boroughs_raw_embedded_site_anomaly": "|".join(
                    anomaly_hits
                ),
                "boroughs_all_sources": join_unique(
                    values(group, "borough")
                ),
                # Embedded source glitches stamped hundreds of unrelated pubs
                # with anomaly boroughs. Leave the field blank when no trusted
                # source exists; geometric export assigns the true borough.
                "primary_borough": first_nonblank(
                    values(visible, "borough")
                )
                or first_nonblank(values(non_anomaly_raw, "borough"))
                or first_nonblank(trusted_group_boroughs),
                "rank_visible_borough": first_nonblank(
                    values(visible, "rank")
                ),
                "estimated_average_price_text": first_nonblank(
                    values(visible, "estimated_average_price_text")
                ),
                "pub_url": first_nonblank(
                    values(preferred, "pub_url")
                )
                or constructed_pub_url,
                "constructed_pub_url": constructed_pub_url,
                "borough_urls": join_unique(
                    values(preferred, "borough_url")
                ),
                "pub_key": first_nonblank(values(preferred, "pub_key")),
                "pint_position_for_pub": first_nonblank(
                    values(preferred, "pint_position_for_pub")
                ),
                "phone_number": first_nonblank(
                    values(preferred, "phone_number")
                ),
                "email": first_nonblank(values(preferred, "email")),
                "website": first_nonblank(values(preferred, "website")),
                "booking_link": first_nonblank(
                    values(preferred, "booking_link")
                ),
                "image_url": first_nonblank(
                    values(preferred, "image_url")
                ),
                "description": first_nonblank(
                    values(preferred, "description")
                ),
                "comment": first_nonblank(values(preferred, "comment")),
                "food": first_nonblank(values(preferred, "food")),
                "cocktails": first_nonblank(
                    values(preferred, "cocktails")
                ),
                "beer_garden": first_nonblank(
                    values(preferred, "beer_garden")
                ),
                "live_sports": first_nonblank(
                    values(preferred, "live_sports")
                ),
                "live_music": first_nonblank(
                    values(preferred, "live_music")
                ),
                "pub_quiz": first_nonblank(
                    values(preferred, "pub_quiz")
                ),
                "darts": first_nonblank(values(preferred, "darts")),
                "pool": first_nonblank(values(preferred, "pool")),
                "happy_hour": first_nonblank(
                    values(preferred, "happy_hour")
                ),
                "karaoke": first_nonblank(values(preferred, "karaoke")),
                "cool": first_nonblank(values(preferred, "cool")),
                "locality": first_nonblank(values(preferred, "locality")),
                "source_datasets": join_unique(
                    values(group, "source_dataset")
                ),
                "source_row_count": len(group),
                "visible_borough_source_row_count": len(visible),
                "raw_embedded_source_row_count": len(raw),
                "individual_pub_page_source_row_count": len(pub),
                "has_visible_borough_row": bool(visible),
                "has_raw_embedded_map_row": bool(raw),
                "has_individual_pub_page_row": bool(pub),
                "is_clean_canonical_app_row": bool(visible)
                and bool(first_nonblank(values(preferred, "latitude_clean")))
                and bool(
                    first_nonblank(values(preferred, "longitude_clean"))
                ),
                "data_quality_notes": "|".join(quality_notes),
                "scraped_at_values": join_unique(
                    values(preferred, "scraped_at")
                ),
            }
        )
    return records


def record_sort_key(record: dict[str, object]) -> tuple[object, ...]:
    price = record["price_gbp"]
    return (
        not bool(record["is_clean_canonical_app_row"]),
        str(record["primary_borough"]),
        str(record["pub_name"]),
        str(record["pint_name"]),
        price is None or price == "",
        0 if price is None or price == "" else float(price),
    )


def in_london_bounds(row: dict[str, object]) -> bool:
    try:
        latitude = float(str(row["latitude"]))
        longitude = float(str(row["longitude"]))
    except (TypeError, ValueError):
        return False
    return (
        LONDON_LAT_MIN <= latitude <= LONDON_LAT_MAX
        and LONDON_LON_MIN <= longitude <= LONDON_LON_MAX
    )


def apply_postcode_coordinate_decisions(
    app: list[dict[str, object]],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    product_candidates = [row for row in app if in_london_bounds(row)]
    result = subprocess.run(
        ["node", str(DECISION_SCRIPT)],
        input=json.dumps(product_candidates, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip(), file=sys.stderr)
        raise SystemExit(result.returncode)

    decisions = json.loads(result.stdout)
    rows_by_id = {
        str(row["app_price_id"]): row
        for row in app
    }
    for correction in decisions["appliedCorrections"]:
        app_price_id = correction["appPriceId"]
        row = rows_by_id.get(app_price_id)
        if row is None:
            raise RuntimeError(
                f"validated correction {app_price_id} no longer matches one row"
            )
        for field, value in correction["changes"].items():
            row[field] = str(value) if field in {"latitude", "longitude"} else value
        notes = [
            note
            for note in clean(row["data_quality_notes"]).split("|")
            if note
        ]
        if correction["dataQualityNote"] not in notes:
            notes.append(correction["dataQualityNote"])
        row["data_quality_notes"] = "|".join(notes)

    quarantined_ids: set[str] = set()
    for quarantine in decisions["appliedQuarantines"]:
        app_price_id = quarantine["appPriceId"]
        quarantined_ids.add(app_price_id)
        print(
            "[postcode-coordinate quarantine] "
            f"{app_price_id} {quarantine['pubName']} {quarantine['postcode']} "
            f"@ {quarantine['latitude']},{quarantine['longitude']}: "
            f"{quarantine['reason']}"
        )

    report = {
        "inputs": {
            str(path): {"sha256": sha256_file(path)}
            for path in DECISION_INPUT_FILES
        },
        "checkedRows": decisions["checkedRows"],
        "outwardCodeReferences": decisions["referenceCount"],
        "corrections": decisions["appliedCorrections"],
        "quarantines": decisions["appliedQuarantines"],
    }
    return (
        [
            row
            for row in app
            if str(row["app_price_id"]) not in quarantined_ids
        ],
        report,
    )


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        raise RuntimeError("app dataset cannot be empty")
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(rows[0]),
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    all_rows = [
        *prep(
            read_csv(
                DATA / "pint_prices_canonical_enriched.csv",
                numeric_fields={"latitude", "longitude"},
            ),
            "canonical_borough_leaderboard_enriched",
        ),
        *prep(
            read_csv(
                DATA / "borough_embedded_pint_prices.csv",
                numeric_fields={"latitude", "longitude", "price_text"},
            ),
            "borough_embedded_map_data_raw",
        ),
        *prep(
            read_csv(
                DATA / "pub_page_pint_prices.csv",
                numeric_fields={"latitude", "longitude"},
            ),
            "individual_pub_page",
        ),
    ]
    app = sorted(assemble_records(all_rows), key=record_sort_key)
    for index, row in enumerate(app, start=1):
        row["app_price_id"] = f"app_price_{index:06d}"

    app, decision_report = apply_postcode_coordinate_decisions(app)
    output_path = DATA / "pint_prices_app_dataset.csv"
    write_csv(output_path, app)
    decision_report["output"] = {
        "path": str(output_path),
        "sha256": sha256_file(output_path),
        "rows": len(app),
    }
    DECISION_REPORT.write_text(
        json.dumps(decision_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    summary_path = DATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary.update(
        {
            "pint_prices_app_dataset_rows": len(app),
            "pint_prices_app_dataset_columns": len(app[0]),
            "app_dataset_rows_with_coordinates": sum(
                bool(clean(row["latitude"])) and bool(clean(row["longitude"]))
                for row in app
            ),
            "app_dataset_clean_canonical_rows": sum(
                bool(row["is_clean_canonical_app_row"]) for row in app
            ),
            "app_dataset_rows_with_visible_borough": sum(
                bool(row["has_visible_borough_row"]) for row in app
            ),
            "app_dataset_rows_with_pub_page": sum(
                bool(row["has_individual_pub_page_row"]) for row in app
            ),
            "app_dataset_visible_borough_source_rows_represented": sum(
                int(row["visible_borough_source_row_count"]) for row in app
            ),
            "app_dataset_raw_embedded_source_rows_represented": sum(
                int(row["raw_embedded_source_row_count"]) for row in app
            ),
            "app_dataset_individual_pub_page_source_rows_represented": sum(
                int(row["individual_pub_page_source_row_count"]) for row in app
            ),
            "app_dataset_rows_raw_only": sum(
                not bool(row["has_visible_borough_row"])
                and bool(row["has_raw_embedded_map_row"])
                and not bool(row["has_individual_pub_page_row"])
                for row in app
            ),
        }
    )
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"wrote {output_path}")
    print(f"rows={len(app)} columns={len(app[0])}")


if __name__ == "__main__":
    main()
