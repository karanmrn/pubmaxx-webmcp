/**
 * Captain decision 2026-08-17: PUBMAXX is the brand; PUBMAXXING is the app.
 * Metadata siteName and OG site_name use the brand; install titles and page
 * titles that name the product use the app.
 */
export const BRAND_NAME = "PUBMAXX";
export const APP_NAME = "PUBMAXXING";

/** Page title suffix for in-app surfaces (`About · PUBMAXXING`). */
export function appPageTitle(pageTitle: string): string {
  return `${pageTitle} · ${APP_NAME}`;
}

/** Open Graph / Twitter `siteName` — always the brand. */
export function metadataSiteName(): string {
  return BRAND_NAME;
}
