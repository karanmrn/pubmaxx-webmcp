import "server-only";

import { getVercelOidcTokenSync } from "@vercel/oidc";
import { gateway, generateText } from "ai";

export const SEARCH_GATEWAY_MODEL = "openai/gpt-5-nano";
export const DEFAULT_SEARCH_GATEWAY_MAX_CALLS = 25;
const EXA_HIGHLIGHT_MAX_CHARACTERS = 1600;

export type SearchProviderName = "exa" | "tavily";

export type SearchRequest = {
  query: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
};

export type SearchResult = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
};

export type SearchResponse = {
  provider: SearchProviderName;
  results: SearchResult[];
  creditsSpent?: number;
};

export type SearchProviderStats = {
  selectedProvider: SearchProviderName;
  gatewayCalls: number;
  gatewayMaxCalls: number;
  estimatedTokens: number;
  model?: string;
  tavilyCalls: number;
};

export type SearchProvider = {
  readonly name: SearchProviderName;
  readonly configured: boolean;
  search(request: SearchRequest): Promise<SearchResponse>;
  stats(): SearchProviderStats;
};

export type SearchProviderDependencies = {
  generateText: (options: Record<string, unknown>) => Promise<unknown>;
  gateway: {
    tools: {
      exaSearch: (options: Record<string, unknown>) => unknown;
    };
  };
};

export type SearchProviderOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  dependencies?: SearchProviderDependencies;
  logger?: Pick<Console, "warn">;
};

export class SearchProviderBudgetError extends Error {
  readonly code = "SEARCH_GATEWAY_BUDGET_EXHAUSTED";

  constructor(maxCalls: number) {
    super(`AI Gateway search call cap reached (${maxCalls}).`);
    this.name = "SearchProviderBudgetError";
  }
}

export class SearchProviderUnavailableError extends Error {
  readonly code = "SEARCH_PROVIDER_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "SearchProviderUnavailableError";
  }
}

type MutableStats = SearchProviderStats;

const defaultDependencies: SearchProviderDependencies = {
  generateText: (options) => generateText(options as Parameters<typeof generateText>[0]),
  gateway: gateway as unknown as SearchProviderDependencies["gateway"],
};

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function withSearchDeadline<T>(
  request: SearchRequest,
  operation: (boundedRequest: SearchRequest) => Promise<T>,
): Promise<T> {
  if (!request.timeoutMs) return operation(request);
  const controller = new AbortController();
  const relayAbort = () => controller.abort(request.signal?.reason);
  if (request.signal?.aborted) relayAbort();
  else request.signal?.addEventListener("abort", relayAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // AbortSignal is advisory. Race the dependency so an ignored signal cannot
  // keep the caller waiting past its request budget.
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Search request timed out after ${request.timeoutMs}ms.`);
      controller.abort(error);
      reject(error);
    }, request.timeoutMs);
  });
  const operationPromise = Promise.resolve().then(() =>
    operation({ ...request, signal: controller.signal }),
  );
  try {
    return await Promise.race([operationPromise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void operationPromise.catch(() => {});
    request.signal?.removeEventListener("abort", relayAbort);
  }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function resultsFromToolOutput(value: unknown): unknown[] | null {
  const record = recordFrom(value);
  if (Array.isArray(value)) return value;
  if (Array.isArray(record?.results)) return record.results;
  if (Array.isArray(record?.value)) return record.value;
  return null;
}

function toolResultOutputs(value: unknown): unknown[] {
  const result = recordFrom(value);
  if (!result) return [];
  const topLevel = Array.isArray(result.toolResults) ? result.toolResults : [];
  if (topLevel.length > 0) return topLevel;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  return steps.flatMap((step) => {
    const stepRecord = recordFrom(step);
    return Array.isArray(stepRecord?.toolResults) ? stepRecord.toolResults : [];
  });
}

function normalisedExaResults(value: unknown): SearchResult[] | null {
  const outputs = toolResultOutputs(value);
  const rawResults: unknown[] = [];
  let foundResultOutput = false;
  for (const toolResult of outputs) {
    const record = recordFrom(toolResult);
    const results = resultsFromToolOutput(
      record?.output ?? record?.result ?? record?.value ?? toolResult,
    );
    if (results !== null) {
      foundResultOutput = true;
      rawResults.push(...results);
    }
  }
  if (!foundResultOutput) return null;

  const results = rawResults.flatMap((raw) => {
    const result = recordFrom(raw);
    const url = stringFrom(result?.url);
    if (!url) return [];
    const highlights = Array.isArray(result?.highlights)
      ? result.highlights.filter((item): item is string => typeof item === "string").join("\n")
      : stringFrom(result?.highlights);
    const content = highlights ?? stringFrom(result?.text) ?? stringFrom(result?.content) ?? "";
    return [{
      title: stringFrom(result?.title) ?? url,
      url,
      content,
      ...(stringFrom(result?.publishedDate) ? { publishedDate: stringFrom(result?.publishedDate) } : {}),
    }];
  });
  return rawResults.length > 0 && results.length === 0 ? null : results;
}

function estimatedResultTokens(results: SearchResult[]): number {
  return Math.ceil(JSON.stringify(results).length / 4);
}

function gatewayMaxCalls(env: Record<string, string | undefined>): number {
  const parsed = Number(env.SEARCH_GATEWAY_MAX_CALLS);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_SEARCH_GATEWAY_MAX_CALLS;
}

function hasGatewayCredentials(env: Record<string, string | undefined>): boolean {
  if (env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim()) return true;
  try {
    return Boolean(getVercelOidcTokenSync().trim());
  } catch {
    return false;
  }
}

function makeStats(
  selectedProvider: SearchProviderName,
  maxCalls: number,
  model?: string,
): MutableStats {
  return {
    selectedProvider,
    gatewayCalls: 0,
    gatewayMaxCalls: maxCalls,
    estimatedTokens: 0,
    ...(model ? { model } : {}),
    tavilyCalls: 0,
  };
}

class ExaGatewayProvider implements SearchProvider {
  readonly name = "exa" as const;
  readonly configured: boolean;
  private readonly statsValue: MutableStats;

  constructor(
    configured: boolean,
    private readonly maxCalls: number,
    private readonly dependencies: SearchProviderDependencies,
  ) {
    this.configured = configured;
    this.statsValue = makeStats("exa", maxCalls, SEARCH_GATEWAY_MODEL);
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    return withSearchDeadline(request, (boundedRequest) => this.searchAttempt(boundedRequest));
  }

  private async searchAttempt(request: SearchRequest): Promise<SearchResponse> {
    if (!this.configured) {
      throw new SearchProviderUnavailableError("AI Gateway credentials are absent.");
    }
    if (this.statsValue.gatewayCalls >= this.maxCalls) {
      throw new SearchProviderBudgetError(this.maxCalls);
    }
    this.statsValue.gatewayCalls += 1;

    const toolOptions: Record<string, unknown> = {
      type: "fast",
      numResults: Math.min(100, Math.max(1, Math.floor(request.maxResults ?? 10))),
      contents: {
        highlights: { query: request.query, maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS },
        maxAgeHours: 24,
      },
    };
    if (request.includeDomains?.length) toolOptions.includeDomains = request.includeDomains;
    if (request.excludeDomains?.length) toolOptions.excludeDomains = request.excludeDomains;
    if (request.startPublishedDate) toolOptions.startPublishedDate = request.startPublishedDate;
    if (request.endPublishedDate) toolOptions.endPublishedDate = request.endPublishedDate;

    const result = await this.dependencies.generateText({
      abortSignal: request.signal,
      maxRetries: 0,
      model: SEARCH_GATEWAY_MODEL,
      prompt: request.query,
      toolChoice: { type: "tool", toolName: "exa_search" },
      tools: {
        exa_search: this.dependencies.gateway.tools.exaSearch(toolOptions),
      },
    });
    const usage = recordFrom(recordFrom(result)?.usage);
    this.statsValue.estimatedTokens +=
      numberFrom(usage?.inputTokens) + numberFrom(usage?.outputTokens);
    const results = normalisedExaResults(result);
    if (results === null) {
      throw new SearchProviderUnavailableError("AI Gateway returned malformed Exa search output.");
    }
    this.statsValue.estimatedTokens += estimatedResultTokens(results);
    return { provider: "exa", results };
  }

  stats(): SearchProviderStats {
    return { ...this.statsValue };
  }
}

class TavilyProvider implements SearchProvider {
  readonly name = "tavily" as const;
  readonly configured: boolean;
  private readonly statsValue: MutableStats;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof fetch,
    maxCalls: number,
  ) {
    this.configured = Boolean(apiKey);
    this.statsValue = makeStats("tavily", maxCalls);
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    return withSearchDeadline(request, (boundedRequest) => this.searchAttempt(boundedRequest));
  }

  private async searchAttempt(request: SearchRequest): Promise<SearchResponse> {
    if (!this.configured) {
      throw new SearchProviderUnavailableError("TAVILY_API_KEY is absent.");
    }
    this.statsValue.tavilyCalls += 1;
    const response = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      signal: request.signal,
      body: JSON.stringify({
        query: request.query,
        topic: "general",
        search_depth: "advanced",
        chunks_per_source: 3,
        max_results: Math.min(10, Math.max(1, Math.floor(request.maxResults ?? 10))),
        include_answer: false,
        include_images: false,
        include_raw_content: "markdown",
        include_usage: true,
        ...(request.includeDomains?.length ? { include_domains: request.includeDomains } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed (${response.status}).`);
    }
    const payload = await response.json() as Record<string, unknown>;
    const rawResults = Array.isArray(payload.results) ? payload.results : [];
    return {
      provider: "tavily",
      results: rawResults.flatMap((raw) => {
        const result = recordFrom(raw);
        const url = stringFrom(result?.url);
        if (!url) return [];
        return [{
          title: stringFrom(result?.title) ?? url,
          url,
          content: stringFrom(result?.raw_content) ?? stringFrom(result?.content) ?? "",
          ...(stringFrom(result?.published_date) ? { publishedDate: stringFrom(result?.published_date) } : {}),
        }];
      }),
      creditsSpent: numberFrom(recordFrom(payload.usage)?.credits),
    };
  }

  stats(): SearchProviderStats {
    return { ...this.statsValue };
  }
}

class FallbackProvider implements SearchProvider {
  readonly name: SearchProviderName;
  readonly configured = true;
  // Primary attempts still count toward `gatewayCalls` even when they throw
  // and fall through, so stats() cannot infer "did the primary ever actually
  // serve a response" from the call counters alone — it has to be tracked.
  private primarySucceeded = false;
  private fallbackServed = false;

  constructor(
    private readonly primary: SearchProvider,
    private readonly fallback: SearchProvider,
    private readonly logger: Pick<Console, "warn">,
  ) {
    this.name = primary.name;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    try {
      const response = await this.primary.search(request);
      this.primarySucceeded = true;
      return response;
    } catch (error) {
      if (error instanceof SearchProviderBudgetError) throw error;
      this.logger.warn(
        `[search-provider] ${this.primary.name} failed; falling back to ${this.fallback.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const response = await this.fallback.search(request);
      this.fallbackServed = true;
      return response;
    }
  }

  stats(): SearchProviderStats {
    const primary = this.primary.stats();
    const fallback = this.fallback.stats();
    // `this.name` is fixed to the primary at construction, but every call
    // this run may have fallen through to the secondary provider (e.g. the
    // primary is unconfigured or erroring). Report which provider actually
    // served a response rather than always claiming the primary.
    const selectedProvider =
      !this.primarySucceeded && this.fallbackServed ? this.fallback.name : this.name;
    return {
      selectedProvider,
      gatewayCalls: primary.gatewayCalls,
      gatewayMaxCalls: primary.gatewayMaxCalls,
      estimatedTokens: primary.estimatedTokens,
      ...(primary.model ? { model: primary.model } : {}),
      tavilyCalls: fallback.tavilyCalls,
    };
  }
}

class UnavailableProvider implements SearchProvider {
  readonly configured = false;

  constructor(readonly name: SearchProviderName, private readonly maxCalls: number) {}

  async search(): Promise<SearchResponse> {
    throw new SearchProviderUnavailableError("No configured search provider credentials.");
  }

  stats(): SearchProviderStats {
    return makeStats(this.name, this.maxCalls, this.name === "exa" ? SEARCH_GATEWAY_MODEL : undefined);
  }
}

export function createSearchProvider(options: SearchProviderOptions = {}): SearchProvider {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const dependencies = options.dependencies ?? defaultDependencies;
  const maxCalls = gatewayMaxCalls(env);
  const tavily = new TavilyProvider(
    env.TAVILY_API_KEY?.trim(),
    options.fetchImpl ?? fetch,
    maxCalls,
  );
  const exa = new ExaGatewayProvider(
    hasGatewayCredentials(env),
    maxCalls,
    dependencies,
  );
  const configured = env.SEARCH_PROVIDER?.trim().toLowerCase();
  const selected: SearchProviderName = configured === "tavily" ? "tavily" : "exa";
  if (configured && configured !== "exa" && configured !== "tavily") {
    logger.warn(`[search-provider] unsupported SEARCH_PROVIDER=${configured}; using exa.`);
  }

  if (selected === "tavily") return tavily.configured ? tavily : new UnavailableProvider("tavily", maxCalls);
  if (exa.configured) return tavily.configured ? new FallbackProvider(exa, tavily, logger) : exa;
  if (tavily.configured) {
    logger.warn("[search-provider] AI Gateway credentials absent; falling back to Tavily.");
    return new FallbackProvider(exa, tavily, logger);
  }
  return new UnavailableProvider("exa", maxCalls);
}
