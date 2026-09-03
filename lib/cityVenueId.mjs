const CITY_VENUE_ID_PREFIX = {
  manchester: "mcr",
  liverpool: "liv",
  oxford: "oxf",
  durham: "dur",
  glasgow: "glw",
  bristol: "bri",
  cambridge: "cam",
  bath: "bat",
  llandudno: "lla",
};

function normalise(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stableCityVenueId(shortPrefix, key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${shortPrefix}-${(hash >>> 0).toString(36)}`;
}

export function cityVenueIdForPub(cityId, pub) {
  const prefix = CITY_VENUE_ID_PREFIX[cityId];
  if (!prefix) return null;
  const key = [
    cityId,
    normalise(pub?.name),
    normalise(pub?.address),
    Number(pub?.lat).toFixed(5),
    Number(pub?.lng).toFixed(5),
  ].join("|");
  return stableCityVenueId(prefix, key);
}
