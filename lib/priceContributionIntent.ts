const PRICE_CONTRIBUTION_INTENT_PARAM = "contribute";
const PRICE_CONTRIBUTION_INTENT_VALUE = "price";
const PRICE_CONTRIBUTION_STORAGE_KEY =
  "pubmax:price-contribution-intent:v1";
const PRICE_CONTRIBUTION_INTENT_TTL_MS = 60 * 60 * 1000;

type PriceContributionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type PriceContributionActions = {
  replaceUrl: (url: string) => void;
  showSignIn: () => void;
  openForm: () => void;
  abandon?: () => void;
};

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function withPriceContributionIntent(input: string): string {
  const url = parseUrl(input);
  if (!url) return input;
  url.searchParams.set(
    PRICE_CONTRIBUTION_INTENT_PARAM,
    PRICE_CONTRIBUTION_INTENT_VALUE,
  );
  return relativeUrl(url);
}

export function withoutPriceContributionIntent(input: string): string {
  const url = parseUrl(input);
  if (!url) return input;
  url.searchParams.delete(PRICE_CONTRIBUTION_INTENT_PARAM);
  return relativeUrl(url);
}

export function hasPriceContributionIntent(input: string): boolean {
  const url = parseUrl(input);
  return (
    url?.searchParams.get(PRICE_CONTRIBUTION_INTENT_PARAM) ===
    PRICE_CONTRIBUTION_INTENT_VALUE
  );
}

export function rememberPriceContribution(
  storage: PriceContributionStorage,
  venueId: string,
  now = Date.now(),
): void {
  storage.setItem(
    PRICE_CONTRIBUTION_STORAGE_KEY,
    JSON.stringify({
      venueId,
      expiresAt: now + PRICE_CONTRIBUTION_INTENT_TTL_MS,
    }),
  );
}

export function hasRememberedPriceContribution(
  storage: PriceContributionStorage,
  venueId: string,
  now = Date.now(),
): boolean {
  try {
    const raw = storage.getItem(PRICE_CONTRIBUTION_STORAGE_KEY);
    if (!raw) return false;
    const record = JSON.parse(raw) as {
      venueId?: unknown;
      expiresAt?: unknown;
    };
    return (
      record.venueId === venueId &&
      typeof record.expiresAt === "number" &&
      record.expiresAt >= now
    );
  } catch {
    return false;
  }
}

export function clearRememberedPriceContribution(
  storage: PriceContributionStorage,
): void {
  storage.removeItem(PRICE_CONTRIBUTION_STORAGE_KEY);
}

export function runPriceContributionRequest({
  authConfigured,
  userPresent,
  venueId,
  currentUrl,
  storage,
  actions,
}: {
  authConfigured: boolean;
  userPresent: boolean;
  venueId: string;
  currentUrl: string;
  storage: PriceContributionStorage | null;
  actions: PriceContributionActions;
}): void {
  if (!authConfigured || userPresent) {
    actions.openForm();
    return;
  }
  if (storage) {
    try {
      rememberPriceContribution(storage, venueId);
    } catch {
      // URL intent still carries the return path when storage is blocked.
    }
  }
  actions.replaceUrl(withPriceContributionIntent(currentUrl));
  actions.showSignIn();
}

export function runPriceContributionReturn({
  authConfigured,
  authLoading,
  userPresent,
  venueId,
  requestedVenueId,
  currentUrl,
  storage,
  actions,
}: {
  authConfigured: boolean;
  authLoading: boolean;
  userPresent: boolean;
  venueId: string;
  requestedVenueId: string | null;
  currentUrl: string;
  storage: PriceContributionStorage | null;
  actions: PriceContributionActions;
}): void {
  if (authLoading) return;

  if (requestedVenueId && requestedVenueId !== venueId) {
    actions.replaceUrl(withoutPriceContributionIntent(currentUrl));
    if (storage) {
      try {
        clearRememberedPriceContribution(storage);
      } catch {
        // URL intent is already consumed.
      }
    }
    actions.abandon?.();
    return;
  }

  let rememberedIntent = false;
  if (userPresent && storage) {
    try {
      rememberedIntent = hasRememberedPriceContribution(storage, venueId);
    } catch {
      rememberedIntent = false;
    }
  }
  if (!hasPriceContributionIntent(currentUrl) && !rememberedIntent) return;

  if (authConfigured && !userPresent) {
    if (requestedVenueId === venueId) return;
    actions.showSignIn();
    return;
  }

  actions.replaceUrl(withoutPriceContributionIntent(currentUrl));
  if (storage) {
    try {
      clearRememberedPriceContribution(storage);
    } catch {
      // URL intent is already consumed.
    }
  }
  actions.openForm();
}
