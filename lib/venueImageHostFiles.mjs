// Data files that define which remote image hosts /api/image-proxy may fetch.
// Plain ESM lets request-time reader and Next tracing config consume one list.

// Every https URL in these files is trusted app-served image content.
export const VENUE_IMAGE_HOST_WHOLE_FILE_SCAN_FILES = [
  "public/data/venue_menu_enrichment.json",
  "public/data/pubmaxxing_seed_snapshot.json",
];

export const VENUE_IMAGE_HOST_PHOTO_FIELD_FILE =
  "public/data/pint_prices_app_dataset.json";

export const VENUE_IMAGE_HOST_TRACING_INCLUDES = [
  ...VENUE_IMAGE_HOST_WHOLE_FILE_SCAN_FILES,
  VENUE_IMAGE_HOST_PHOTO_FIELD_FILE,
].map(file => `./${file}`);
