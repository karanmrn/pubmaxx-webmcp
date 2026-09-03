#!/usr/bin/env python3
"""Export a compact app JSON file from the app-ready CSV."""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


SOURCE = Path("data/pint_prices_app_dataset.csv")
DESTINATION = Path("public/data/pint_prices_app_dataset.json")

# The freshness registry is the SINGLE SOURCE OF TRUTH for the pint dataset's
# collection date (data/freshness_registry.json → `pint_prices` stamp). The TS
# constant lib/dataFreshness.ts PINT_DATASET_OBSERVED_AT is derived from it at
# build time; a drift test pins them together. So the honest collection stamp is
# updated HERE, by the pipeline, when the dataset is re-collected — never by
# hand-editing the TS constant. Pass --collected-at <ISO instant> (the real
# scrape time) whenever the prices are re-collected.
REGISTRY = Path("data/freshness_registry.json")
REGISTRY_PINT_ID = "pint_prices"
# Scopes a value rewrite to the pint_prices literal stamp only, leaving every
# other entry (and the file's hand-authored formatting) untouched.
_PINT_STAMP_RE = re.compile(
    r'("id":\s*"pint_prices"[\s\S]*?"stamp":\s*\{\s*"kind":\s*"literal",\s*"value":\s*")'
    r'[^"]*(")'
)


def normalize_collected_at(raw: str) -> str:
    """Anchor a collection instant at NOON UTC on its own UTC calendar day.

    The visible "collected" stamp (en-GB, Europe/London) and the JSON-LD ISO
    date must name the SAME day; noon UTC renders as that day in London in both
    BST and GMT and slices to the same ISO date. See lib/dataFreshness.ts.
    """
    instant = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    day = instant.astimezone(timezone.utc).date()
    return f"{day.isoformat()}T12:00:00Z"


def read_registry_pint_stamp() -> str | None:
    if not REGISTRY.exists():
        return None
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for dataset in registry.get("datasets", []):
        if dataset.get("id") == REGISTRY_PINT_ID:
            stamp = dataset.get("stamp") or {}
            return stamp.get("value")
    return None


def update_registry_pint_stamp(value: str) -> bool:
    """Rewrite the pint_prices literal stamp in place. Returns True if changed."""
    text = REGISTRY.read_text(encoding="utf-8")
    new_text, count = _PINT_STAMP_RE.subn(rf"\g<1>{value}\g<2>", text)
    if count != 1:
        raise RuntimeError(
            f"Expected exactly one pint_prices literal stamp in {REGISTRY}, found {count}"
        )
    if new_text == text:
        return False
    REGISTRY.write_text(new_text, encoding="utf-8")
    return True

# The scrape's borough labels are untrustworthy — not just for the F7 site
# anomaly (hundreds of pubs mass-tagged under Havering/Hillingdon/Redbridge,
# which put Prospect of Whitby, Wapping, in "Havering") but systematically:
# #308's coverage report found the stored label disagrees with the pin's own
# geometry for hundreds of core pubs (Camden 89, City of London 77 at the venue
# level), e.g. Upper Street N1 pubs tagged "Camden" though they are the spine of
# Islington, or Bankside/Butlers Wharf pubs tagged "City of London" though they
# sit south of the river in Southwark. Geometry is the single source of truth:
# `primary_borough` is assigned by point-in-polygon against real Greater London
# borough boundaries (see data/london_boroughs_simplified.json provenance)
# whenever the pin falls inside a borough polygon. Only points OUTSIDE every
# polygon fall back to the scraped label — nearest-vertex snapping is not
# evidence. ANOMALY_BOROUGHS is retained for documentation/lockstep with
# scripts/build_app_dataset.py; geometry now overrides every borough, anomaly or
# not. The same repair is applied to the committed dataset (which carries
# post-export gazetteer rows) by scripts/repair_borough_labels.mjs.
ANOMALY_BOROUGHS = {"Havering", "Hillingdon", "Redbridge"}

# Greater London bounding box. Rows with coordinates outside this box are a
# data-quality bug (a mis-geocoded pub, a lat/lng swap) — they scatter pins far
# off the map. Drop them at export and report the count. Kept in lockstep with
# scripts/validate-data.mjs and scripts/build_slim_index.mjs.
LAT_MIN, LAT_MAX = 51.26, 51.72
LON_MIN, LON_MAX = -0.55, 0.30


def in_london(lat: float, lng: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lng <= LON_MAX

FIELDS = [
    "app_price_id",
    "pub_name",
    "pint_name",
    "price_gbp",
    "price_text",
    "address",
    "latitude",
    "longitude",
    "boroughs_visible",
    "boroughs_raw_embedded_non_anomaly",
    "boroughs_raw_embedded_site_anomaly",
    "primary_borough",
    "rank_visible_borough",
    "estimated_average_price_text",
    "pub_url",
    "constructed_pub_url",
    "borough_urls",
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
    "source_datasets",
    "source_row_count",
    "has_visible_borough_row",
    "has_raw_embedded_map_row",
    "has_individual_pub_page_row",
    "is_clean_canonical_app_row",
    "data_quality_notes",
]


def parse_bool(value: str) -> bool:
    return value.strip().lower() == "true"


def parse_float(value: str) -> float | None:
    try:
        return round(float(value), 2)
    except ValueError:
        return None


def resolve_primary_borough(
    geometric_borough: str, record: dict[str, object]
) -> str:
    """Geometry is authoritative; the scraped label is only a last resort.

    Point-in-polygon against real borough boundaries wins whenever the pin lands
    inside a borough (the scraped source labels are systematically wrong — see
    the ANOMALY_BOROUGHS note above). Only when the classifier returns "" (the
    point is outside every polygon, so there is no geometric evidence) do we keep
    the scraped `primary_borough` rather than blank it out.
    """
    if geometric_borough:
        return geometric_borough
    return str(record["primary_borough"]).strip()


def classify_boroughs(records: list[dict[str, object]]) -> list[str]:
    points = [[record["latitude"], record["longitude"]] for record in records]
    result = subprocess.run(
        ["node", "scripts/classify_borough_points.mjs"],
        input=json.dumps(points),
        text=True,
        capture_output=True,
        check=True,
    )
    names = json.loads(result.stdout)
    if not isinstance(names, list) or len(names) != len(records):
        raise RuntimeError("Canonical borough classifier returned an invalid result")
    return [str(name) for name in names]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collected-at",
        metavar="ISO",
        help=(
            "Real collection instant of this dataset (e.g. 2026-07-03T23:10:47Z). "
            "When passed, the freshness registry's pint_prices stamp is updated to "
            "this date anchored at noon UTC — the single source of truth the app "
            "reads. Pass whenever the prices are re-collected."
        ),
    )
    args = parser.parse_args()

    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    previous_output = (
        DESTINATION.read_text(encoding="utf-8") if DESTINATION.exists() else None
    )
    rows = []
    dropped_oob = 0
    reassigned = 0
    with SOURCE.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            record = {field: row.get(field, "") for field in FIELDS}
            record["price_gbp"] = parse_float(record["price_gbp"])
            record["latitude"] = float(record["latitude"])
            record["longitude"] = float(record["longitude"])
            # Bounds filter: drop rows with coordinates outside Greater London.
            if not in_london(record["latitude"], record["longitude"]):
                dropped_oob += 1
                continue
            record["source_row_count"] = int(float(record["source_row_count"] or 0))
            for field in [
                "has_visible_borough_row",
                "has_raw_embedded_map_row",
                "has_individual_pub_page_row",
                "is_clean_canonical_app_row",
            ]:
                record[field] = parse_bool(str(record[field]))
            rows.append(record)

    for record, geometric_borough in zip(rows, classify_boroughs(rows)):
        resolved = resolve_primary_borough(geometric_borough, record)
        if resolved != record["primary_borough"]:
            reassigned += 1
            record["primary_borough"] = resolved

    new_output = json.dumps(rows, ensure_ascii=False)
    DESTINATION.write_text(new_output, encoding="utf-8")
    print(f"Exported {len(rows)} rows to {DESTINATION}")
    print(f"Dropped {dropped_oob} row(s) outside Greater London bounds")
    print(f"Reassigned {reassigned} anomaly-borough row(s) via point-in-polygon")

    dataset_changed = previous_output is not None and previous_output != new_output

    # Stamp the registry (the single source of truth) with the real collection
    # date when the operator supplies one; otherwise leave the existing stamp
    # untouched but warn loudly if the dataset actually changed — a re-collection
    # without a fresh stamp would leave the site advertising a stale date.
    if args.collected_at:
        normalized = normalize_collected_at(args.collected_at)
        current = read_registry_pint_stamp()
        if update_registry_pint_stamp(normalized):
            print(
                f"Updated {REGISTRY} pint_prices stamp: {current} -> {normalized} "
                "(single source of truth; lib/dataFreshness.ts derives from it)"
            )
        else:
            print(f"Registry pint_prices stamp already {normalized}; no change")
    elif dataset_changed:
        print(
            "WARNING: the exported dataset changed but no --collected-at was given. "
            f"The registry pint_prices stamp ({read_registry_pint_stamp()}) may now be "
            "stale. Re-run with --collected-at <ISO collection instant> to update the "
            "single source of truth."
        )


if __name__ == "__main__":
    main()
