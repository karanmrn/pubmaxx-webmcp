// The ONE Context.dev wrapper for server-side web reads.
//
// Key is read at call time, never logged. Without CONTEXT_DEV_API_KEY every call
// answers { status: "not-configured" } and sends nothing. Retries honour
// Retry-After on 429 and bounded backoff on 408/5xx; validation answers (4xx
// except 429) are returned immediately.
//
// This module carries NO `server-only` marker, for the same reason
// lib/harvest/firecrawl.ts carries none: a plain-node CLI
// (scripts/whatson/eventsRefresh.mjs) imports the events lane that sits on top
// of it, and `server-only` resolves to a module that THROWS on import outside a
// React Server Component. `lib/contextDev.server.ts` re-exports this surface
// behind that marker for app code.

export const CONTEXT_DEV_API_BASE = "https://api.context.dev/v1";

export const CONTEXT_DEV_MAX_ATTEMPTS = 3;

export const CONTEXT_DEV_RETRY_BASE_DELAY_MS = 2_000;

export const CONTEXT_DEV_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The longest a provider-chosen `Retry-After` may park this run.
 *
 * The request timeout does not bound this wait, because the wait sits BETWEEN
 * requests. A 429 answering `Retry-After: 3600` is an ordinary shape for a rate
 * limited API, and honouring it verbatim would park a scheduled refresh for an
 * hour per retry. Past this ceiling the answer is that we are rate limited,
 * which the next scheduled run can act on, rather than a job that hangs.
 */
export const CONTEXT_DEV_MAX_RETRY_AFTER_MS = 30_000;

/**
 * Requests ONE run may send, counting retries, so a retry storm spends the run
 * rather than the account - the ceiling lib/harvest/firecrawl.ts puts on its own
 * lane, for the same reason. A request is the unit here because the two
 * endpoints do not cost the same: a markdown scrape is 1 credit and an extract
 * is 10, so twelve requests is at most 120 credits a run.
 */
export const CONTEXT_DEV_RUN_REQUEST_BUDGET = 12;

export type ContextDevBudget = {
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

export function createContextDevBudget(limit: number = CONTEXT_DEV_RUN_REQUEST_BUDGET): ContextDevBudget {
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

export type ContextDevFailure = {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
};

export type ContextDevNotConfigured = { status: "not-configured" };

export type ContextDevError = { status: "error"; error: ContextDevFailure };

export type ContextDevScrapeOk = {
  status: "ok";
  url: string;
  markdown: string;
};

export type ContextDevScrapeResult = ContextDevNotConfigured | ContextDevScrapeOk | ContextDevError;

export type ContextDevExtractOk<T> = {
  status: "ok";
  url: string;
  data: T;
  urlsAnalyzed: string[];
};

export type ContextDevExtractResult<T = Record<string, unknown>> =
  | ContextDevNotConfigured
  | ContextDevExtractOk<T>
  | ContextDevError;

export type ContextDevCallOptions = {
  maxAgeMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Shared per-run request ceiling. Absent means this call is uncapped. */
  budget?: ContextDevBudget;
};

export function contextDevApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.CONTEXT_DEV_API_KEY?.trim();
  return key ? key : null;
}

export function isContextDevConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return contextDevApiKey(env) !== null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.ceil(asSeconds * 1000);
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function failureFromResponse(status: number, body: unknown): ContextDevFailure {
  const envelope = body as { error?: unknown; error_code?: unknown; message?: unknown } | null;
  const message =
    (typeof envelope?.error === "string" && envelope.error) ||
    (typeof envelope?.message === "string" && envelope.message) ||
    `Context.dev returned ${status}.`;
  const code =
    (typeof envelope?.error_code === "string" && envelope.error_code) ||
    (status === 429 ? "RATE_LIMITED" : status >= 500 ? "PROVIDER_UNAVAILABLE" : "INVALID_REQUEST");
  return {
    code,
    message,
    retryable: isRetryableStatus(status),
    statusCode: status,
  };
}

type AttemptOk<T> = { kind: "value"; value: T };
type AttemptFail = {
  kind: "fail";
  failure: ContextDevFailure;
  retry: boolean;
  retryAfter?: string | null;
};
type Attempt<T> = AttemptOk<T> | AttemptFail;

async function withRetries<T extends ContextDevScrapeOk | ContextDevExtractOk<unknown>>(
  attemptOnce: () => Promise<Attempt<T>>,
  options: ContextDevCallOptions,
): Promise<T | ContextDevError> {
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? CONTEXT_DEV_MAX_ATTEMPTS);
  const budget = options.budget;
  let last: ContextDevFailure | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (budget && !budget.take()) {
      const spent = `Run budget of ${budget.limit} Context.dev requests is spent.`;
      // A ceiling reached BEFORE anything was sent is the whole finding. A
      // ceiling reached between retries is not: the upstream failure that
      // caused the retry is the actionable one, so it stays the answer and the
      // budget rides along as the reason no further attempt was made.
      if (last) {
        return {
          status: "error",
          error: { ...last, message: `${last.message} ${spent} No further attempt was made.` },
        };
      }
      return {
        status: "error",
        error: { code: "BUDGET_EXHAUSTED", message: spent, retryable: false },
      };
    }
    const result = await attemptOnce();
    if (result.kind === "value") {
      return result.value;
    }
    last = result.failure;
    if (!result.retry || attempt === maxAttempts) break;
    const retryAfter =
      result.failure.statusCode === 429 ? parseRetryAfterMs(result.retryAfter ?? null) : null;
    if (retryAfter !== null && retryAfter > CONTEXT_DEV_MAX_RETRY_AFTER_MS) {
      last = {
        ...result.failure,
        retryable: false,
        message:
          `${result.failure.message} Retry-After asks for ${Math.ceil(retryAfter / 1000)}s, ` +
          `past the ${Math.round(CONTEXT_DEV_MAX_RETRY_AFTER_MS / 1000)}s ceiling, so this run ` +
          "stopped instead of waiting.",
      };
      break;
    }
    await sleepImpl(retryAfter ?? CONTEXT_DEV_RETRY_BASE_DELAY_MS * attempt);
  }

  return {
    status: "error",
    error: last ?? {
      code: "PROVIDER_UNAVAILABLE",
      message: "Context.dev request failed.",
      retryable: false,
    },
  };
}

// The body is read ONCE, as text. `response.json()` consumes the body even when
// it throws, so a second read of the same response rejects with "Body is
// unusable" - which escaped this helper and made every non-JSON 4xx look like a
// network fault, so it was retried and its Retry-After header never read.
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function sendGet(
  path: string,
  params: URLSearchParams,
  apiKey: string,
  options: ContextDevCallOptions,
): Promise<Attempt<ContextDevScrapeOk>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CONTEXT_DEV_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${CONTEXT_DEV_API_BASE}${path}?${params.toString()}`;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await readJson(response);
      const failure = failureFromResponse(response.status, body);
      return {
        kind: "fail",
        failure,
        retry: failure.retryable,
        retryAfter: response.headers.get("retry-after"),
      };
    }
    const body = (await readJson(response)) as {
      success?: boolean;
      markdown?: unknown;
      url?: unknown;
    } | null;
    if (body?.success !== true || typeof body.markdown !== "string") {
      return {
        kind: "fail",
        failure: {
          code: "EMPTY_BODY",
          message: "Scrape returned no markdown.",
          retryable: false,
        },
        retry: false,
      };
    }
    const pageUrl =
      typeof body?.url === "string" && body.url.length > 0 ? body.url : params.get("url") ?? "";
    return {
      kind: "value",
      value: {
        status: "ok",
        url: pageUrl,
        markdown: body.markdown,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      kind: "fail",
      failure: {
        code: aborted ? "TIMEOUT" : "NETWORK",
        message,
        retryable: true,
      },
      retry: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendPost<T>(
  path: string,
  payload: Record<string, unknown>,
  apiKey: string,
  options: ContextDevCallOptions,
): Promise<Attempt<ContextDevExtractOk<T>>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CONTEXT_DEV_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${CONTEXT_DEV_API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await readJson(response);
      const failure = failureFromResponse(response.status, body);
      return {
        kind: "fail",
        failure,
        retry: failure.retryable,
        retryAfter: response.headers.get("retry-after"),
      };
    }
    const body = (await readJson(response)) as {
      status?: unknown;
      url?: unknown;
      data?: unknown;
      urls_analyzed?: unknown;
    } | null;
    if (body?.status !== "ok" || typeof body.data !== "object" || body.data === null) {
      return {
        kind: "fail",
        failure: {
          code: "EMPTY_BODY",
          message: "Extract returned no data.",
          retryable: false,
        },
        retry: false,
      };
    }
    const urlsAnalyzed = Array.isArray(body?.urls_analyzed)
      ? body.urls_analyzed.filter((entry): entry is string => typeof entry === "string")
      : [];
    const pageUrl = typeof body?.url === "string" ? body.url : String(payload.url ?? "");
    return {
      kind: "value",
      value: {
        status: "ok",
        url: pageUrl,
        data: body.data as T,
        urlsAnalyzed,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      kind: "fail",
      failure: {
        code: aborted ? "TIMEOUT" : "NETWORK",
        message,
        retryable: true,
      },
      retry: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeMarkdown(
  url: string,
  options: ContextDevCallOptions = {},
): Promise<ContextDevScrapeResult> {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" };

  const params = new URLSearchParams({ url });
  if (options.maxAgeMs !== undefined) params.set("maxAgeMs", String(Math.max(0, options.maxAgeMs)));

  return withRetries(() => sendGet("/web/scrape/markdown", params, apiKey, options), options);
}

export async function extract<T extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  schema: Record<string, unknown>,
  options: ContextDevCallOptions & { instructions?: string; factCheck?: boolean; maxPages?: number } = {},
): Promise<ContextDevExtractResult<T>> {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" };

  const payload: Record<string, unknown> = {
    url,
    schema,
    factCheck: options.factCheck ?? true,
    maxPages: options.maxPages ?? 1,
  };
  if (typeof options.instructions === "string" && options.instructions.trim().length > 0) {
    payload.instructions = options.instructions.trim();
  }
  if (options.maxAgeMs !== undefined) payload.maxAgeMs = Math.max(0, options.maxAgeMs);

  return withRetries(() => sendPost<T>("/web/extract", payload, apiKey, options), options);
}
