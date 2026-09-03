// GET /api/cron/enrich-city-pubs - bounded official-page discovery for UK city pubs.
//
// Local CLI runs own durable, reviewable repository output. Vercel functions
// cannot commit static files, so cron rotates one bounded batch through same
// tested enrichment core and emits structured observations to function logs.
// SEARCH_PROVIDER selects Exa or Tavily. CRON_SECRET protects invocation.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { createSearchProvider } from "@/lib/searchProvider.server";
import {
  runScheduledCityEnrichment,
  SEARCH_CRON_QUERY_CAP,
  type ScheduledEnrichmentProgress,
} from "@/lib/tavilyPubEnrichment.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const searchProvider = createSearchProvider();
  if (!searchProvider.configured) {
    console.warn(
      `[cron:enrich-city-pubs] ${searchProvider.name === "tavily" ? "TAVILY_API_KEY" : "AI Gateway API key or Vercel OIDC credentials, and TAVILY_API_KEY"} absent - enrichment skipped.`,
    );
    return jsonNoStore({
      ok: true,
      skipped: searchProvider.name === "tavily" ? "no-tavily-key" : "no-search-provider",
      queriesSpent: 0,
      creditsSpent: 0,
    });
  }

  let lastProgress: ScheduledEnrichmentProgress | null = null;
  let loggedPrices = 0;
  let loggedPages = 0;

  try {
    const result = await runScheduledCityEnrichment({
      searchProvider,
      onProgress: (progress) => {
        lastProgress = progress;
        const newPrices = progress.prices.slice(loggedPrices);
        const newPages = progress.pages.slice(loggedPages);
        loggedPrices = progress.prices.length;
        loggedPages = progress.pages.length;
        console.log(
          "[cron:enrich-city-pubs][city-enrichment][progress]",
          JSON.stringify({
            city: progress.city,
            nextIndex: progress.nextIndex,
            queriesSpent: progress.queriesSpent,
            creditsSpent: progress.creditsSpent,
            prices: newPrices,
            pages: newPages,
          }),
        );
      },
    });
    const providerStats = searchProvider.stats();
    console.log(
      "[cron:enrich-city-pubs][city-enrichment]",
      JSON.stringify({
        city: result.city,
        primaryCity: result.primaryCity,
        cityRuns: result.cityRuns,
        startIndex: result.startIndex,
        nextIndex: result.nextIndex,
        queriesSpent: result.queriesSpent,
        creditsSpent: result.creditsSpent,
        provider: providerStats.selectedProvider,
        gatewayCalls: providerStats.gatewayCalls,
        gatewayMaxCalls: providerStats.gatewayMaxCalls,
        gatewayModel: providerStats.model ?? null,
        estimatedTokens: providerStats.estimatedTokens,
        tavilyCalls: providerStats.tavilyCalls,
        matchedPubs: result.matchedPubs,
        prices: result.prices,
        pages: result.pages,
        delegatedChains: result.delegatedChains.map(({ pub, chain, harvester }) => ({
          osmId: pub.osmId,
          pubName: pub.name,
          chain,
          harvester,
        })),
      }),
    );
    return jsonNoStore({
      ok: true,
      city: result.city,
      primaryCity: result.primaryCity,
      cityRuns: result.cityRuns,
      startIndex: result.startIndex,
      nextIndex: result.nextIndex,
      queryCap: SEARCH_CRON_QUERY_CAP,
      provider: providerStats.selectedProvider,
      queriesSpent: result.queriesSpent,
      creditsSpent: result.creditsSpent,
      gatewayCalls: providerStats.gatewayCalls,
      gatewayMaxCalls: providerStats.gatewayMaxCalls,
      gatewayModel: providerStats.model ?? null,
      estimatedTokens: providerStats.estimatedTokens,
      tavilyCalls: providerStats.tavilyCalls,
      matchedPubs: result.matchedPubs,
      pricesExtracted: result.prices.length,
      chainPubsDelegated: result.delegatedChains.length,
    });
  } catch (error) {
    const providerStats = searchProvider.stats();
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][ALERT] search enrichment failed:",
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][spend]",
      JSON.stringify({
        provider: providerStats.selectedProvider,
        gatewayCalls: providerStats.gatewayCalls,
        gatewayMaxCalls: providerStats.gatewayMaxCalls,
        gatewayModel: providerStats.model ?? null,
        estimatedTokens: providerStats.estimatedTokens,
        tavilyCalls: providerStats.tavilyCalls,
      }),
    );
    const partial = lastProgress as ScheduledEnrichmentProgress | null;
    if (partial) {
      console.error(
        "[cron:enrich-city-pubs][city-enrichment][partial]",
        JSON.stringify({
          city: partial.city,
          nextIndex: partial.nextIndex,
          queriesSpent: partial.queriesSpent,
          creditsSpent: partial.creditsSpent,
          matchedPubs: partial.pages.length,
          pricesExtracted: partial.prices.length,
        }),
      );
    }
    return publicApiError("City enrichment provider unavailable.", "PROVIDER_UNAVAILABLE", 502, {
      retryable: true,
    });
  }
}
