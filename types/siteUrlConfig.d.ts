declare module "@/lib/siteUrlConfig.mjs" {
  export const PRODUCTION_SITE_ORIGIN: "https://pubmaxxing.com";

  export function productionSiteUrlError(
    configuredSiteUrl: string | undefined,
  ): string | null;
}
