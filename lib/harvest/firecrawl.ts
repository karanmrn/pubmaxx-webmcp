// Server-side Firecrawl client for the London harvest (chain deals, first-party
// venue events, operator-page pub facts).
//
// THREE PROPERTIES THIS MODULE OWNS, and nothing else does:
//
//  1. FAIL CLOSED WITHOUT A KEY. `createFirecrawlClient` returns `null` when
//     FIRECRAWL_API_KEY is absent, so a keyless caller SKIPS its source and says
//     so in the run report. It never falls back to a bare fetch, a cached copy,
//     or an invented row — the same posture eventsRefresh.mjs takes for an
//     absent provider key.
//
//  2. A PER-RUN REQUEST BUDGET, so a cron cannot burn the account. The budget
//     counts EVERY request the client sends, retries included: a retry storm
//     spends the run's budget and stops, rather than spending the account. Once
//     the budget is gone every later `scrape` resolves `budget-exhausted`
//     WITHOUT sending anything, which is a reportable skip rather than a
//     failure — a run that ran out of budget covered less, it did not break.
//     The caps live here (HARVEST_CRON_REQUEST_BUDGET /
//     HARVEST_CLI_REQUEST_BUDGET) so the ceiling is one number to read.
//
//  3. BOUNDED RETRIES. At most HARVEST_MAX_ATTEMPTS attempts per URL, and only
//     for failures that are plausibly transient (429, 5xx, network, timeout).
//     A 4xx that is not 429 is the source's answer, not a hiccup: it is
//     returned immediately so the caller records an honest failure.
//
// The client returns markdown and never interprets it. What a page means is the
// parsers' job (lib/harvest/chainDeals.ts and friends), because a page that does
// not state a thing must yield no row.

export const FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v2";

/** One request may take this long before it is abandoned as a timeout. */
export const HARVEST_REQUEST_TIMEOUT_MS = 60_000;

/** Total attempts per URL: one try plus at most two retries. */
export const HARVEST_MAX_ATTEMPTS = 3;

/**
 * Backoff between retries, multiplied by the attempt number (so 2s then 4s).
 * Sized for a rate limit rather than a blip: the first harvest lost twenty
 * operator lookups to 429s that a one-second pause did not outlast.
 */
export const HARVEST_RETRY_BASE_DELAY_MS = 2_000;

/**
 * Requests a single SCHEDULED run may spend. Deliberately small: the cron's job
 * is to rotate one bounded batch through the same parsers the CLI uses, not to
 * cover the estate. Twelve requests a week is the ceiling this cron can put on
 * the account even if every source retries to exhaustion.
 */
export const HARVEST_CRON_REQUEST_BUDGET = 12;

/**
 * Requests a MANUAL `npm run harvest:run` may spend. An operator watching the
 * output can afford a full pass; this is still a hard ceiling, not a target.
 */
export const HARVEST_CLI_REQUEST_BUDGET = 120;

/** How stale a reused Firecrawl index copy may be for a harvest read (12h). */
export const HARVEST_DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type HarvestBudget = {
  /** Requests this run may send in total. */
  readonly limit: number;
  spent(): number;
  remaining(): number;
  /**
   * Reserve one request. Returns false when the run's cap is reached, in which
   * case the caller must NOT send anything.
   */
  take(): boolean;
};

export function createHarvestBudget(limit: number): HarvestBudget {
  const ceiling = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  let spent = 0;
  return {
    limit: ceiling,
    spent: () => spent,
    remaining: () => Math.max(0, ceiling - spent),
    take: () => {
      if (spent >= ceiling) return false;
      spent += 1;
      return true;
    },
  };
}

export type FirecrawlPage = {
  /** The URL asked for (provenance is the asked-for URL, not a redirect guess). */
  url: string;
  markdown: string;
  statusCode: number | null;
  /** Firecrawl's own report of whether this body came from its index. */
  cacheState: string | null;
  cachedAt: string | null;
};

export type FirecrawlFailureReason =
  | "budget-exhausted"
  | "http-error"
  | "empty-body"
  | "network"
  | "timeout";

export type FirecrawlFailure = {
  url: string;
  reason: FirecrawlFailureReason;
  detail: string;
  status?: number;
  attempts: number;
};

export type FirecrawlScrapeOutcome =
  | { ok: true; page: FirecrawlPage }
  | { ok: false; failure: FirecrawlFailure };

export type FirecrawlScrapeOptions = {
  /** Reuse of a Firecrawl index copy no older than this. 0 forces a live read. */
  maxAgeMs?: number;
  /** Strip nav/chrome. On by default: harvest parsers read article-like copy. */
  onlyMainContent?: boolean;
};

export type FirecrawlSearchHit = { url: string; title?: string; description?: string };

export type FirecrawlSearchOutcome =
  | { ok: true; results: FirecrawlSearchHit[] }
  | { ok: false; failure: FirecrawlFailure };

export type FirecrawlClient = {
  readonly budget: HarvestBudget;
  scrape(url: string, options?: FirecrawlScrapeOptions): Promise<FirecrawlScrapeOutcome>;
  /**
   * Find candidate pages for a query. Used only to LOCATE an operator's own
   * page; what the harvest may believe still comes from scraping that page.
   */
  search(query: string, options?: { limit?: number }): Promise<FirecrawlSearchOutcome>;
};

export type CreateFirecrawlClientOptions = {
  /** Explicit key. Omit to read FIRECRAWL_API_KEY from `env`. */
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  budget?: HarvestBudget;
  /** Injectable so tests do not wait out the real backoff. */
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  apiBase?: string;
};

export function firecrawlApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.FIRECRAWL_API_KEY?.trim();
  return key ? key : null;
}

export function isFirecrawlConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return firecrawlApiKey(env) !== null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient failures earn a retry. A source's own 4xx answer does not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

type Attempt<T> =
  | { kind: "value"; value: T }
  | { kind: "fail"; reason: FirecrawlFailureReason; detail: string; status?: number; retry: boolean };

type Envelope = { success?: boolean; error?: unknown; data?: Record<string, unknown> } | null;

function readPage(url: string, body: unknown): Attempt<FirecrawlPage> {
  const envelope = body as Envelope;
  if (!envelope || envelope.success !== true) {
    const detail = typeof envelope?.error === "string" ? envelope.error : "Firecrawl reported no success.";
    return { kind: "fail", reason: "empty-body", detail, retry: false };
  }
  const markdown = envelope.data?.markdown;
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return { kind: "fail", reason: "empty-body", detail: "Scrape returned no markdown.", retry: false };
  }
  const metadata = (envelope.data?.metadata ?? {}) as Record<string, unknown>;
  const statusCode = typeof metadata.statusCode === "number" ? metadata.statusCode : null;
  const cacheState = typeof metadata.cacheState === "string" ? metadata.cacheState : null;
  const cachedAt = typeof metadata.cachedAt === "string" ? metadata.cachedAt : null;
  return { kind: "value", value: { url, markdown, statusCode, cacheState, cachedAt } };
}

function readSearch(body: unknown): Attempt<FirecrawlSearchHit[]> {
  const envelope = body as Envelope;
  if (!envelope || envelope.success !== true) {
    const detail = typeof envelope?.error === "string" ? envelope.error : "Firecrawl reported no success.";
    return { kind: "fail", reason: "empty-body", detail, retry: false };
  }
  const web = envelope.data?.web;
  if (!Array.isArray(web)) {
    return { kind: "fail", reason: "empty-body", detail: "Search returned no web results.", retry: false };
  }
  const results: FirecrawlSearchHit[] = [];
  for (const hit of web) {
    const url = (hit as { url?: unknown })?.url;
    if (typeof url !== "string" || url.trim().length === 0) continue;
    const title = (hit as { title?: unknown }).title;
    const description = (hit as { description?: unknown }).description;
    results.push({
      url: url.trim(),
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof description === "string" ? { description } : {}),
    });
  }
  return { kind: "value", value: results };
}

/**
 * Build a harvest Firecrawl client, or `null` when no key is configured. A null
 * client is the fail-closed path: the caller reports every source as skipped
 * for `no-firecrawl-key` and emits nothing.
 */
export function createFirecrawlClient(
  options: CreateFirecrawlClientOptions = {},
): FirecrawlClient | null {
  const apiKey = options.apiKey?.trim() || firecrawlApiKey(options.env ?? process.env);
  if (!apiKey) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const budget = options.budget ?? createHarvestBudget(HARVEST_CLI_REQUEST_BUDGET);
  const maxAttempts = Math.max(1, options.maxAttempts ?? HARVEST_MAX_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? HARVEST_REQUEST_TIMEOUT_MS;
  const apiBase = options.apiBase ?? FIRECRAWL_API_BASE;

  async function sendOnce<T>(
    path: string,
    payload: Record<string, unknown>,
    read: (body: unknown) => Attempt<T>,
  ): Promise<Attempt<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          kind: "fail",
          reason: "http-error",
          detail: `Firecrawl returned ${response.status}.`,
          status: response.status,
          retry: isRetryableStatus(response.status),
        };
      }
      return read(await response.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      return {
        kind: "fail",
        reason: aborted ? "timeout" : "network",
        detail: message,
        retry: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function withBudgetedRetries<T>(
    subject: string,
    attemptOnce: () => Promise<Attempt<T>>,
  ): Promise<{ ok: true; value: T } | { ok: false; failure: FirecrawlFailure }> {
    let last: Extract<Attempt<T>, { kind: "fail" }> | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Reserve BEFORE sending, and count retries: the budget is a ceiling on
      // what this run can put on the account, not on how many URLs it covers.
      if (!budget.take()) {
        return {
          ok: false,
          failure: {
            url: subject,
            reason: "budget-exhausted",
            detail: `Run budget of ${budget.limit} Firecrawl requests is spent.`,
            attempts: attempt - 1,
          },
        };
      }
      const result = await attemptOnce();
      if (result.kind === "value") return { ok: true, value: result.value };
      last = result;
      if (!result.retry || attempt === maxAttempts) break;
      await sleepImpl(HARVEST_RETRY_BASE_DELAY_MS * attempt);
    }
    const failure = last ?? {
      reason: "network" as const,
      detail: "No attempt was made.",
      status: undefined,
    };
    return {
      ok: false,
      failure: {
        url: subject,
        reason: failure.reason,
        detail: failure.detail,
        ...(failure.status !== undefined ? { status: failure.status } : {}),
        attempts: maxAttempts,
      },
    };
  }

  return {
    budget,
    async scrape(url, scrapeOptions = {}) {
      const result = await withBudgetedRetries(url, () =>
        sendOnce(
          "/scrape",
          {
            url,
            formats: ["markdown"],
            onlyMainContent: scrapeOptions.onlyMainContent ?? true,
            maxAge: Math.max(0, scrapeOptions.maxAgeMs ?? HARVEST_DEFAULT_MAX_AGE_MS),
          },
          (body) => readPage(url, body),
        ),
      );
      return result.ok ? { ok: true, page: result.value } : { ok: false, failure: result.failure };
    },
    async search(query, searchOptions = {}) {
      const result = await withBudgetedRetries(`search:${query}`, () =>
        sendOnce("/search", { query, limit: searchOptions.limit ?? 5 }, readSearch),
      );
      return result.ok ? { ok: true, results: result.value } : { ok: false, failure: result.failure };
    },
  };
}
