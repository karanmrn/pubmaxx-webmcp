// Pure builder for the chooser's UK place index. Source rows are the locality
// tags already attached to the committed OSM pub snapshots. A result therefore
// means "the base-pub source names this place", never "we checked its prices".

import {
  displayUkPlaceName,
  isPublishableUkPlaceName,
} from "../../lib/ukPlaceName.mjs";
import { haversineKm as scalarHaversineKm } from "./geo.mjs";

const LOCALITY_TAGS = [
  ["addr:city", "city"],
  ["addr:town", "town"],
  ["addr:village", "village"],
  ["addr:place", "place"],
  ["addr:suburb", "suburb"],
];

const KIND_RANK = new Map([
  ["city", 0],
  ["town", 1],
  ["village", 2],
  ["place", 3],
  ["suburb", 4],
]);

const CLUSTER_DISTANCE_KM = 30;

function normalizeName(value) {
  return displayUkPlaceName(value);
}

function searchKey(value) {
  return normalizeName(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-GB");
}

function coordinates(element) {
  const lat = element?.lat ?? element?.center?.lat;
  const lng = element?.lon ?? element?.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function postcodeArea(value) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return compact.match(/^([A-Z]{1,2})\d/)?.[1] ?? "";
}

function haversineKm(a, b) {
  return scalarHaversineKm(a.lat, a.lng, b.lat, b.lng);
}

function clustersFor(observations) {
  const parents = observations.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]];
      current = parents[current];
    }
    return current;
  };
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < observations.length; left += 1) {
    for (let right = left + 1; right < observations.length; right += 1) {
      if (haversineKm(observations[left], observations[right]) <= CLUSTER_DISTANCE_KM) {
        join(left, right);
      }
    }
  }

  const clusters = new Map();
  for (let index = 0; index < observations.length; index += 1) {
    const root = find(index);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(observations[index]);
    else clusters.set(root, [observations[index]]);
  }
  return [...clusters.values()];
}

function lowerMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function mostFrequent(values) {
  const frequencies = new Map();
  for (const value of values.filter(Boolean)) {
    frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  }
  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en-GB"))[0]?.[0] ?? "";
}

function clusterRow(cluster) {
  const median = {
    lat: lowerMedian(cluster.map((row) => row.lat)),
    lng: lowerMedian(cluster.map((row) => row.lng)),
  };
  const point = [...cluster].sort(
    (left, right) =>
      haversineKm(left, median) - haversineKm(right, median) ||
      left.lat - right.lat ||
      left.lng - right.lng,
  )[0];
  const name = mostFrequent(cluster.map((row) => row.name));
  const kind = [...cluster]
    .map((row) => row.kind)
    .sort((left, right) => KIND_RANK.get(left) - KIND_RANK.get(right))[0];
  const context = mostFrequent(cluster.map((row) => row.context));
  return context
    ? [name, point.lat, point.lng, kind, context]
    : [name, point.lat, point.lng, kind];
}

export function buildUkPlaceIndex(elements, options = {}) {
  const observationsByName = new Map();
  const seen = new Set();

  for (const element of elements) {
    const point = coordinates(element);
    if (!point || !element?.tags || typeof element.tags !== "object") continue;
    const elementKey = `${element.type ?? ""}/${element.id ?? ""}`;
    for (const [tag, kind] of LOCALITY_TAGS) {
      const name = normalizeName(element.tags[tag]);
      if (!isPublishableUkPlaceName(name)) continue;
      const key = searchKey(name);
      const observationKey = `${elementKey}\0${tag}\0${key}`;
      if (seen.has(observationKey)) continue;
      seen.add(observationKey);
      const observation = {
        name,
        lat: point.lat,
        lng: point.lng,
        kind,
        context: postcodeArea(element.tags["addr:postcode"]),
      };
      const rows = observationsByName.get(key);
      if (rows) rows.push(observation);
      else observationsByName.set(key, [observation]);
    }
  }

  const places = [];
  for (const observations of observationsByName.values()) {
    for (const cluster of clustersFor(observations)) {
      places.push(clusterRow(cluster));
    }
  }
  places.sort(
    (left, right) =>
      String(left[0]).localeCompare(String(right[0]), "en-GB") ||
      String(left[4] ?? "").localeCompare(String(right[4] ?? ""), "en-GB") ||
      Number(left[1]) - Number(right[1]) ||
      Number(left[2]) - Number(right[2]),
  );

  return {
    source: "OpenStreetMap via Overpass API",
    license: "ODbL 1.0",
    attribution:
      "© OpenStreetMap contributors, data licensed under the Open Database Licence (ODbL) 1.0, https://www.openstreetmap.org/copyright",
    basis: "Locality names and navigation points derived from UK pub address locality tags",
    generator: "scripts/build_uk_place_index.mjs",
    generatedAt: options.generatedAt ?? null,
    places,
  };
}
