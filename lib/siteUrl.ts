import {
  PRODUCTION_SITE_ORIGIN,
  productionSiteUrlError,
} from "@/lib/siteUrlConfig.mjs";

function httpOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function reportProductionSiteUrlError(message: string): void {
  if (typeof window === "undefined") console.error(message);
}

/**
 * Production callbacks always return through the canonical public site.
 * Local and test environments stay on their current origin.
 */
export function siteOrigin(
  currentUrl: string,
  environment: string | undefined = process.env.NODE_ENV,
  configuredSiteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  reportConfigurationError: (message: string) => void =
    reportProductionSiteUrlError,
): string | null {
  const currentOrigin = httpOrigin(currentUrl);
  if (!currentOrigin) return null;
  if (environment !== "production") return currentOrigin;
  const configurationError = productionSiteUrlError(configuredSiteUrl);
  if (configurationError) {
    reportConfigurationError(
      `FATAL: ${configurationError}. Falling back to ${PRODUCTION_SITE_ORIGIN} for this request.`,
    );
  }
  return PRODUCTION_SITE_ORIGIN;
}

export function canonicalAuthStartUrl(
  currentUrl: string,
  environment: string | undefined = process.env.NODE_ENV,
): string | null {
  if (environment !== "production") return null;
  try {
    const current = new URL(currentUrl);
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      return null;
    }
    if (current.origin === PRODUCTION_SITE_ORIGIN) return null;
    return new URL(
      `${current.pathname}${current.search}${current.hash}`,
      PRODUCTION_SITE_ORIGIN,
    ).toString();
  } catch {
    return null;
  }
}
