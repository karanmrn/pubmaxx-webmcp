import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyChainPub,
  runCityEnrichment,
  selectCityPubs,
  type OsmPub,
  type TavilyEnrichmentResult,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";
import { DAY_MS } from "@/lib/dayMs";
import type { SearchProvider } from "@/lib/searchProvider.server";

// London leads the rotation. It was absent from it entirely until 2026-08-16,
// so no London pub had ever reached this seam, while the site's whole price
// story is a London one.
const CITY_ROTATION = [
  "london",
  "manchester",
  "birmingham",
  "edinburgh",
  "glasgow",
  "leeds",
  "bristol",
] as const;
// Provider requests run sequentially. Ten requests keep the daily function
// below Vercel's 120-second ceiling while the rotating start index preserves
// eventual coverage across scheduled runs.
export const SEARCH_CRON_QUERY_CAP = 10;
/** Bristol nights 504 at the full cron cap; keep the city inside a smaller slice. */
export const BRISTOL_CRON_QUERY_CAP = 8;
/** Wall-clock bound so a slow Bristol lane cannot eat the whole function budget. */
export const BRISTOL_CRON_WALL_MS = 45_000;
/** Leave Vercel enough time to persist progress and return before 120 seconds. */
export const SEARCH_CRON_WALL_MS = 90_000;

type UkPack = { pubs?: OsmPub[] };

function loadUkPubs(): OsmPub[] {
  const filePath = path.join(process.cwd(), "data", "osm", "uk", "uk_osm_pubs.json");
  const pack = JSON.parse(readFileSync(filePath, "utf8")) as UkPack;
  return Array.isArray(pack.pubs) ? pack.pubs : [];
}

export type ScheduledCityEnrichment = TavilyEnrichmentResult & {
  startIndex: number;
  primaryCity: string;
  cityRuns?: ScheduledCityRunOutcome[];
};

export type ScheduledEnrichmentProgress = {
  city: string;
  nextIndex: number;
  queriesSpent: number;
  creditsSpent: number;
  prices: TavilyEnrichmentResult["prices"];
  pages: TavilyEnrichmentResult["pages"];
  delegatedChains: TavilyEnrichmentResult["delegatedChains"];
};

export type ScheduledCityRunOutcome = {
  city: string;
  ok: boolean;
  queriesSpent: number;
  creditsSpent: number;
  startIndex?: number;
  nextIndex?: number;
  matchedPubs?: number;
  pricesExtracted?: number;
  error?: string;
};

type RunScheduledOptions = {
  apiKey?: string;
  searchProvider?: SearchProvider;
  fetchImpl?: typeof fetch;
  now?: number;
  maxQueries?: number;
  onProgress?: (progress: ScheduledEnrichmentProgress) => void | Promise<void>;
};

type CityBatchResult = ScheduledCityEnrichment;

function eligibleCityPubs(city: string, allPubs: OsmPub[]): OsmPub[] {
  return selectCityPubs(city, allPubs).filter(
    (pub) => Boolean(pub.website) && !classifyChainPub(pub),
  );
}

function startIndexForCity(
  city: string,
  pubs: OsmPub[],
  epochDay: number,
  rotationStride: number,
): number {
  return pubs.length > 0 ? (Math.floor(epochDay / CITY_ROTATION.length) * rotationStride) % pubs.length : 0;
}

function withWallClock<T>(
  promise: Promise<T>,
  wallMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`City enrichment timed out after ${wallMs}ms.`));
    }, wallMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function outcomeFromResult(city: string, result: CityBatchResult): ScheduledCityRunOutcome {
  return {
    city,
    ok: true,
    queriesSpent: result.queriesSpent,
    creditsSpent: result.creditsSpent,
    startIndex: result.startIndex,
    nextIndex: result.nextIndex,
    matchedPubs: result.matchedPubs,
    pricesExtracted: result.prices.length,
  };
}

function resultFromPartial(
  partial: ScheduledEnrichmentProgress,
  city: string,
  allPubs: OsmPub[],
  epochDay: number,
  rotationStride: number,
): CityBatchResult {
  const pubs = eligibleCityPubs(city, allPubs);
  const startIndex = startIndexForCity(city, pubs, epochDay, rotationStride);
  return {
    city,
    primaryCity: city,
    totalPubs: pubs.length,
    startIndex,
    nextIndex: partial.nextIndex,
    queriesSpent: partial.queriesSpent,
    creditsSpent: partial.creditsSpent,
    matchedPubs: partial.pages.length,
    prices: partial.prices,
    pages: partial.pages,
    delegatedChains: partial.delegatedChains,
    complete: false,
  };
}

function outcomeFromPartial(
  city: string,
  partial: ScheduledEnrichmentProgress | null,
  error: unknown,
): ScheduledCityRunOutcome {
  return {
    city,
    ok: false,
    queriesSpent: partial?.queriesSpent ?? 0,
    creditsSpent: partial?.creditsSpent ?? 0,
    startIndex: partial ? partial.nextIndex - (partial.queriesSpent > 0 ? 1 : 0) : undefined,
    nextIndex: partial?.nextIndex,
    matchedPubs: partial?.pages.length,
    pricesExtracted: partial?.prices.length,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function runCityBatch(
  city: string,
  options: RunScheduledOptions,
  allPubs: OsmPub[],
  epochDay: number,
  rotationStride: number,
  maxQueries: number,
  wallMs?: number,
): Promise<CityBatchResult> {
  const pubs = eligibleCityPubs(city, allPubs);
  const startIndex = startIndexForCity(city, pubs, epochDay, rotationStride);
  let lastPartial: ScheduledEnrichmentProgress | null = null;
  const abortController = wallMs !== undefined ? new AbortController() : undefined;
  const enrichment = runCityEnrichment({
    city,
    pubs,
    apiKey: options.apiKey,
    searchProvider: options.searchProvider,
    fetchImpl: options.fetchImpl,
    maxQueries,
    startIndex,
    observedAt: new Date(options.now ?? Date.now()).toISOString(),
    signal: abortController?.signal,
    onProgress: async (state) => {
      if (abortController?.signal.aborted) return;
      const progress = {
        city,
        ...(state as Omit<ScheduledEnrichmentProgress, "city">),
      };
      if (abortController?.signal.aborted) return;
      lastPartial = progress;
      if (abortController?.signal.aborted) return;
      await options.onProgress?.(progress);
    },
  });
  try {
    const result = wallMs
      ? await withWallClock(enrichment, wallMs, () => abortController!.abort())
      : await enrichment;
    return { ...result, startIndex, primaryCity: city };
  } catch (error) {
    if (wallMs) {
      // A provider may ignore AbortSignal. Do not drain its promise here,
      // because that would turn our wall-clock bound into an unbounded wait.
      void enrichment.catch(() => {});
    }
    if (lastPartial) {
      (error as Error & { partial?: ScheduledEnrichmentProgress }).partial = lastPartial;
    }
    throw error;
  }
}

function mergeCityResults(primaryCity: string, runs: CityBatchResult[]): ScheduledCityEnrichment {
  const primary = runs.find((run) => run.city === primaryCity) ?? runs[0];
  const prices = runs.flatMap((run) => run.prices);
  const pages = runs.flatMap((run) => run.pages);
  const delegatedChains = runs.flatMap((run) => run.delegatedChains);
  const queriesSpent = runs.reduce((sum, run) => sum + run.queriesSpent, 0);
  const creditsSpent = runs.reduce((sum, run) => sum + run.creditsSpent, 0);
  const matchedPubs = runs.reduce((sum, run) => sum + run.matchedPubs, 0);

  return {
    ...primary,
    city: primaryCity,
    primaryCity,
    prices,
    pages,
    delegatedChains,
    queriesSpent,
    creditsSpent,
    matchedPubs,
    complete: runs.every((run) => run.complete),
  };
}

export async function runScheduledCityEnrichment(
  options: RunScheduledOptions,
): Promise<ScheduledCityEnrichment> {
  const now = options.now ?? Date.now();
  const maxQueries = options.maxQueries ?? SEARCH_CRON_QUERY_CAP;
  const epochDay = Math.floor(now / DAY_MS);
  const primaryCity = CITY_ROTATION[epochDay % CITY_ROTATION.length];
  const allPubs = loadUkPubs();
  const cityRuns: ScheduledCityRunOutcome[] = [];
  const mergeableRuns: CityBatchResult[] = [];
  const runDeadline = Date.now() + SEARCH_CRON_WALL_MS;

  const runTrackedCity = async (
    city: string,
    queryCap: number,
    cityWallMs = SEARCH_CRON_WALL_MS,
  ): Promise<CityBatchResult | null> => {
    const remainingWallMs = runDeadline - Date.now();
    if (remainingWallMs <= 0) {
      cityRuns.push({
        city,
        ok: false,
        queriesSpent: 0,
        creditsSpent: 0,
        error: `City enrichment run timed out after ${SEARCH_CRON_WALL_MS}ms.`,
      });
      return null;
    }
    try {
      const result = await runCityBatch(
        city,
        options,
        allPubs,
        epochDay,
        maxQueries,
        queryCap,
        Math.min(cityWallMs, remainingWallMs),
      );
      cityRuns.push(outcomeFromResult(city, result));
      mergeableRuns.push(result);
      return result;
    } catch (error) {
      const partial = (error as Error & { partial?: ScheduledEnrichmentProgress }).partial ?? null;
      cityRuns.push(outcomeFromPartial(city, partial, error));
      if (partial) {
        mergeableRuns.push(resultFromPartial(partial, city, allPubs, epochDay, maxQueries));
      }
      return null;
    }
  };

  const primaryCap =
    primaryCity === "bristol" ? Math.min(BRISTOL_CRON_QUERY_CAP, maxQueries) : maxQueries;
  const primaryWallMs =
    primaryCity === "bristol" ? BRISTOL_CRON_WALL_MS : SEARCH_CRON_WALL_MS;
  const primaryResult = await runTrackedCity(primaryCity, primaryCap, primaryWallMs);

  if (primaryCity === "bristol") {
    const spent = cityRuns.reduce((sum, run) => sum + run.queriesSpent, 0);
    let remainingBudget = maxQueries - spent;
    const spilloverCities = CITY_ROTATION.filter((city) => city !== "bristol");
    for (let index = 0; index < spilloverCities.length && remainingBudget > 0; index += 1) {
      const city = spilloverCities[index];
      const citiesLeft = spilloverCities.length - index;
      const slice = Math.max(1, Math.ceil(remainingBudget / citiesLeft));
      const cap = Math.min(slice, remainingBudget);
      const result = await runTrackedCity(city, cap);
      if (result) {
        remainingBudget -= result.queriesSpent;
      } else {
        const failed = cityRuns.find((run) => run.city === city);
        remainingBudget -= failed?.queriesSpent ?? 0;
      }
    }
  }

  if (!primaryResult && primaryCity !== "bristol") {
    const failed = cityRuns.find((run) => run.city === primaryCity);
    const message = failed?.error ?? "City enrichment provider unavailable.";
    const error = new Error(message);
    if (failed) {
      (error as Error & { partial?: ScheduledEnrichmentProgress }).partial = {
        city: primaryCity,
        nextIndex: failed.nextIndex ?? failed.startIndex ?? 0,
        queriesSpent: failed.queriesSpent,
        creditsSpent: failed.creditsSpent,
        prices: [],
        pages: [],
        delegatedChains: [],
      };
    }
    throw error;
  }

  const merged =
    mergeableRuns.length > 0
      ? mergeCityResults(primaryCity, mergeableRuns)
      : {
          city: primaryCity,
          primaryCity,
          totalPubs: eligibleCityPubs(primaryCity, allPubs).length,
          startIndex: 0,
          nextIndex: 0,
          queriesSpent: cityRuns.reduce((sum, run) => sum + run.queriesSpent, 0),
          creditsSpent: cityRuns.reduce((sum, run) => sum + run.creditsSpent, 0),
          matchedPubs: cityRuns.reduce((sum, run) => sum + (run.matchedPubs ?? 0), 0),
          prices: [],
          pages: [],
          delegatedChains: [],
          complete: false,
        };

  return {
    ...merged,
    cityRuns,
  };
}
