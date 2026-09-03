const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_TAVILY_CALLS_PER_RUN = 200;

export const CITY_DEFINITIONS = Object.freeze({
  // London is the city the product is about and was the one city the rotation
  // never held, so no London pub had ever been through this seam. The bbox is
  // Greater London and it is used only to SELECT candidates out of the UK OSM
  // pack; it makes no claim about which borough a pub is in.
  london: {
    id: "london",
    displayName: "London",
    bbox: [51.28, -0.53, 51.7, 0.34],
  },
  manchester: {
    id: "manchester",
    displayName: "Manchester",
    bbox: [53.38, -2.35, 53.55, -2.1],
  },
  birmingham: {
    id: "birmingham",
    displayName: "Birmingham",
    bbox: [52.38, -2.03, 52.57, -1.73],
  },
  edinburgh: {
    id: "edinburgh",
    displayName: "Edinburgh",
    bbox: [55.88, -3.35, 56.0, -3.05],
  },
  glasgow: {
    id: "glasgow",
    displayName: "Glasgow",
    bbox: [55.82, -4.35, 55.9, -4.15],
  },
  leeds: {
    id: "leeds",
    displayName: "Leeds",
    bbox: [53.72, -1.68, 53.9, -1.38],
  },
  bristol: {
    id: "bristol",
    displayName: "Bristol",
    bbox: [51.42, -2.65, 51.5, -2.52],
  },
});

const CHAIN_DOMAINS = [
  {
    chain: "wetherspoons",
    harvester: "scripts/fetch_wetherspoons_pubs.mjs",
    domains: ["jdwetherspoon.com"],
    operator: /\b(?:j\s*d\s*wetherspoon|wetherspoons?)\b/i,
  },
  {
    chain: "greene-king",
    harvester: "scripts/firecrawl_greene_king_prices.mjs",
    domains: ["greeneking.co.uk"],
    operator: /\bgreene king\b/i,
  },
  {
    chain: "mitchells-and-butlers",
    harvester: "scripts/firecrawl_mbplc_prices.mjs",
    domains: [
      "allbarone.co.uk",
      "browns-restaurants.co.uk",
      "emberinns.co.uk",
      "harvester.co.uk",
      "mbplc.com",
      "millerandcarter.co.uk",
      "nicholsonspubs.co.uk",
      "oaksmiths.co.uk",
      "sizzlingpubs.co.uk",
      "stonehouserestaurants.co.uk",
      "vintageinn.co.uk",
    ],
    operator: /\b(?:mitchells?\s*(?:&|and)\s*butlers|m&b)\b/i,
  },
];

const FORBIDDEN_DISCOVERY_DOMAINS = [
  "beerintheevening.com",
  "camra.org.uk",
  "designmynight.com",
  "facebook.com",
  "foursquare.com",
  "google.com",
  "instagram.com",
  "opentable.co.uk",
  "restaurantguru.com",
  "squaremeal.co.uk",
  "thefork.co.uk",
  "tripadvisor.co.uk",
  "tripadvisor.com",
  "untappd.com",
  "useyourlocal.com",
  "whatpub.com",
  "yell.com",
];

export const OFFICIAL_SITE_SOURCE_LICENCE =
  "All rights reserved - first-party publisher of its own pub menu; read-only, attributed price fact.";

function hostnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function pathnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value).pathname.toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function normaliseVenueKeyPart(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function venueKeyForOsmPub(pub) {
  return [
    normaliseVenueKeyPart(pub.name),
    normaliseVenueKeyPart(pub.address),
    Number(pub.lat).toFixed(5),
    Number(pub.lng).toFixed(5),
  ].join("|");
}

export function classifyChainPub(pub) {
  const websiteHost = hostnameOf(pub?.website);
  const ownership = `${pub?.operator ?? ""} ${pub?.brewery ?? ""} ${pub?.name ?? ""}`;
  for (const definition of CHAIN_DOMAINS) {
    if (
      (websiteHost && definition.domains.some((domain) => hostMatches(websiteHost, domain))) ||
      definition.operator.test(ownership)
    ) {
      return { chain: definition.chain, harvester: definition.harvester };
    }
  }
  return null;
}

export function selectCityPubs(cityId, allPubs) {
  const city = CITY_DEFINITIONS[cityId];
  if (!city) throw new Error(`Unsupported enrichment city "${cityId}".`);
  const [south, west, north, east] = city.bbox;
  return allPubs
    .filter(
      (pub) =>
        Number(pub.lat) >= south &&
        Number(pub.lat) <= north &&
        Number(pub.lng) >= west &&
        Number(pub.lng) <= east,
    )
    .sort((a, b) => {
      const aWebsite = a.website ? 0 : 1;
      const bWebsite = b.website ? 0 : 1;
      const aChain = classifyChainPub(a) ? 1 : 0;
      const bChain = classifyChainPub(b) ? 1 : 0;
      // A pub the curated layer already owns is already covered by the London
      // pipeline, so it goes behind one nobody has looked at. `curatedRef` is
      // written by the UK OSM pack itself; a pack without it simply sorts by
      // the keys below, exactly as before.
      const aCovered = a.curatedRef ? 1 : 0;
      const bCovered = b.curatedRef ? 1 : 0;
      return (
        aWebsite - bWebsite ||
        aChain - bChain ||
        aCovered - bCovered ||
        String(a.name).localeCompare(String(b.name)) ||
        String(a.osmId).localeCompare(String(b.osmId))
      );
    });
}

function isForbiddenHost(host) {
  return FORBIDDEN_DISCOVERY_DOMAINS.some((domain) => hostMatches(host, domain));
}

/** OSM-declared website ownership is the only first-party proof we accept. */
export function isOfficialResult(pub, result) {
  const resultHost = hostnameOf(result?.url);
  if (!resultHost || isForbiddenHost(resultHost)) return false;
  if (CHAIN_DOMAINS.some((chain) => chain.domains.some((domain) => hostMatches(resultHost, domain)))) {
    return false;
  }

  const declaredHost = hostnameOf(pub?.website);
  return Boolean(
    declaredHost &&
    (hostMatches(resultHost, declaredHost) || hostMatches(declaredHost, resultHost)),
  );
}

function cleanDrinkName(line, sizeMatch, priceMatch) {
  const cutoff = Math.min(sizeMatch.index ?? line.length, priceMatch.index ?? line.length);
  return line
    .slice(0, cutoff)
    .replace(/^[-*#|>\s]+/, "")
    .replace(/\b(?:draught|draft)\b\s*[:|-]?\s*/gi, "")
    .replace(/^(?:(?:beer|boards|cider|drinks|flight|menu)\s+){2,}/i, "")
    .replace(/\s+\d{1,2}(?:\.\d+)?%(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:|()[\]\u2013\u2014-]+$/, "")
    .trim();
}

export function extractPintPrices(markdown) {
  const prices = [];
  const seen = new Set();
  const addPrice = (drinkName, priceGbp, servingSize = "pint") => {
    if (!Number.isFinite(priceGbp) || priceGbp < 1.5 || priceGbp > 15) return;
    if (drinkName.length < 2 || drinkName.length > 100) return;
    if (
      /["“”]/.test(drinkName) ||
      /\b(?:all beers?|beer is priced|lunchtime)\b/i.test(drinkName) ||
      /\b(?:at|for|from|only)\s*$/i.test(drinkName)
    ) {
      return;
    }
    const key = `${drinkName.toLowerCase()}|${priceGbp}|${servingSize}`;
    if (seen.has(key)) return;
    seen.add(key);
    prices.push({ drinkName, priceGbp, servingSize });
  };
  const lines = String(markdown ?? "").split(/\r?\n/);
  for (const sourceLine of lines) {
    const line = sourceLine.replace(/\\£/g, "£").trim();
    const sizeMatch = /\b(pint|568\s*ml)\b/i.exec(line);
    const priceMatch = /£\s*(\d{1,2}(?:\.\d{1,2})?)\b/i.exec(line);
    if (!sizeMatch || !priceMatch) continue;
    if (/(?:\bhalf\b|½)/i.test(line.slice(0, Math.max(sizeMatch.index, priceMatch.index)))) continue;
    if (/\b(?:and|includes?|plus|served with|with)\s+(?:an?\s+)?pint\b/i.test(line)) continue;
    const priceGbp = Number(priceMatch[1]);
    const drinkName = cleanDrinkName(line, sizeMatch, priceMatch);
    const servingSize = sizeMatch[1].toLowerCase().startsWith("568") ? "568ml" : "pint";
    addPrice(drinkName, priceGbp, servingSize);
  }

  const compact = lines
    .map((line) => line.replace(/\\£/g, "£").replace(/^[_*]+|[_*]+$/g, "").trim())
    .filter(Boolean);
  let hasPintColumn = false;
  for (let index = 0; index < compact.length; index += 1) {
    const line = compact[index];
    if (/\bhalf\s+pint\b.*\bpint\b/i.test(line) && !/£/.test(line)) {
      hasPintColumn = true;
      continue;
    }
    const matches = [...line.matchAll(/£\s*(\d{1,2}(?:\.\d{1,2})?)/g)];
    if (!matches.length || index === 0) continue;
    if (!/^(?:£\s*\d{1,2}(?:\.\d{1,2})?\s*(?:[|/]\s*)?)+$/.test(line)) continue;
    const rawName = compact[index - 1];
    const namedPint = /\b(?:pint|draught|draft)\b/i.test(rawName);
    if (!namedPint && !(hasPintColumn && matches.length >= 2)) {
      if (hasPintColumn) hasPintColumn = false;
      continue;
    }
    const selected = matches[matches.length - 1];
    const drinkName = rawName
      .replace(/\b(?:pint|568\s*ml)\b/gi, "")
      .replace(/^[-*#|>\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    addPrice(drinkName, Number(selected[1]));
  }
  return prices;
}

function canonicalPriceKey(row) {
  return `${row.venueKey}|${String(row.drinkName).toLowerCase()}|${row.category}`;
}

export function mergeCanonicalPrices(existing, incoming) {
  const incomingKeys = new Set(incoming.map(canonicalPriceKey));
  return [
    ...existing.filter((row) => !incomingKeys.has(canonicalPriceKey(row))),
    ...incoming,
  ];
}

function searchQuery(pub) {
  const host = hostnameOf(pub.website);
  return `site:${host} "${pub.name}" drinks menu "pint" "£"`;
}

async function searchTavily({ pub, apiKey, fetchImpl, signal }) {
  const declaredHost = hostnameOf(pub.website);
  const response = await fetchImpl(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal,
    body: JSON.stringify({
      query: searchQuery(pub),
      topic: "general",
      search_depth: "advanced",
      chunks_per_source: 3,
      max_results: 10,
      include_answer: false,
      include_images: false,
      include_raw_content: "markdown",
      include_usage: true,
      ...(declaredHost ? { include_domains: [declaredHost] } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status}) for ${pub.name}.`);
  }
  return response.json();
}

function sourceLabel(pub) {
  return `${String(pub.name).trim()} - official site`;
}

function resultContent(result) {
  return typeof result?.raw_content === "string"
    ? result.raw_content
    : typeof result?.content === "string"
      ? result.content
      : "";
}

function resultMatchesDeclaredVenuePage(pub, result) {
  const declaredPath = pathnameOf(pub.website);
  const resultPath = pathnameOf(result?.url);
  return Boolean(
    declaredPath &&
    declaredPath !== "/" &&
    resultPath &&
    (resultPath === declaredPath || resultPath.startsWith(`${declaredPath}/`)),
  );
}

function isExplicitlyStaleResult(result, observedAt) {
  const observedYear = new Date(observedAt).getUTCFullYear();
  if (!Number.isInteger(observedYear)) return false;
  const years = [...String(result?.url ?? "").matchAll(/(?:^|[/-])(20\d{2})(?=$|[/-])/g)]
    .map((match) => Number(match[1]));
  return years.length > 0 && Math.max(...years) < observedYear - 1;
}

function explicitUrlDateRank(result) {
  const dates = [
    ...String(result?.url ?? "").matchAll(
      /(?:^|[/-])(20\d{2})(?:[/-](0?[1-9]|1[0-2]))?(?=$|[/-])/g,
    ),
  ].map((match) => Number(match[1]) * 100 + Number(match[2] ?? 0));
  return dates.length > 0 ? Math.max(...dates) : null;
}

function countPubsByHost(pubs) {
  const counts = new Map();
  for (const pub of pubs) {
    const host = hostnameOf(pub.website);
    if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return counts;
}

function acceptedOfficialResults(pub, payload, hostCounts, observedAt) {
  const declaredHost = hostnameOf(pub.website);
  return (Array.isArray(payload?.results) ? payload.results : []).filter(
    (result) =>
      isOfficialResult(pub, result) &&
      !isExplicitlyStaleResult(result, observedAt) &&
      ((hostCounts.get(declaredHost) ?? 0) <= 1 || resultMatchesDeclaredVenuePage(pub, result)),
  );
}

function selectBestOfficialPage(results) {
  let matchedPage = null;
  for (const result of results) {
    const extracted = extractPintPrices(resultContent(result));
    const dateRank = explicitUrlDateRank(result);
    const existingDateRank = matchedPage?.dateRank ?? null;
    const isNewerDatedPage =
      dateRank !== null &&
      existingDateRank !== null &&
      dateRank > existingDateRank;
    const datesDoNotDecide =
      dateRank === existingDateRank ||
      dateRank === null ||
      existingDateRank === null;
    if (
      !matchedPage ||
      isNewerDatedPage ||
      (datesDoNotDecide && extracted.length > matchedPage.extracted.length)
    ) {
      matchedPage = { result, extracted, dateRank };
    }
  }
  return matchedPage;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("City enrichment aborted.");
    error.name = "AbortError";
    throw error;
  }
}

const SEARCH_REQUEST_WALL_MS = 12_000;

async function withRequestDeadline(parentSignal, operation) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener("abort", relayAbort, { once: true });
  let timer;
  // AbortSignal is advisory. Race the dependency so an ignored signal cannot
  // keep the next pub query waiting past its request budget.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `City enrichment request timed out after ${SEARCH_REQUEST_WALL_MS}ms.`,
      );
      controller.abort(error);
      reject(error);
    }, SEARCH_REQUEST_WALL_MS);
  });
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([operationPromise, timeout]);
  } finally {
    clearTimeout(timer);
    void operationPromise.catch(() => {});
    parentSignal?.removeEventListener("abort", relayAbort);
  }
}

export async function runCityEnrichment({
  city: cityId,
  pubs,
  apiKey,
  searchProvider,
  maxQueries = 200,
  startIndex = 0,
  observedAt = new Date().toISOString(),
  fetchImpl = fetch,
  onProgress,
  signal,
}) {
  const city = CITY_DEFINITIONS[cityId];
  if (!city) throw new Error(`Unsupported enrichment city "${cityId}".`);
  if (!searchProvider && !apiKey?.trim()) throw new Error("TAVILY_API_KEY is required.");
  if (!Array.isArray(pubs)) throw new Error("Expected pubs to be an array.");

  const queryCap = Math.min(
    MAX_TAVILY_CALLS_PER_RUN,
    Math.max(0, Math.floor(Number(maxQueries) || 0)),
  );
  const prices = [];
  const pages = [];
  const delegatedChains = [];
  const hostCounts = countPubsByHost(pubs);
  let queriesSpent = 0;
  let creditsSpent = 0;
  let index = Math.max(0, Math.floor(Number(startIndex) || 0));

  while (index < pubs.length) {
    throwIfAborted(signal);
    const pub = pubs[index];
    const chain = classifyChainPub(pub);
    if (chain) {
      delegatedChains.push({ pub, ...chain });
      index += 1;
      await onProgress?.({ nextIndex: index, queriesSpent, creditsSpent, prices, pages, delegatedChains });
      continue;
    }
    if (!hostnameOf(pub.website)) {
      index += 1;
      await onProgress?.({ nextIndex: index, queriesSpent, creditsSpent, prices, pages, delegatedChains });
      continue;
    }
    if (queriesSpent >= queryCap) break;

    queriesSpent += 1;
    let payload;
    try {
      payload = searchProvider
        ? await searchProvider.search({
            query: searchQuery(pub),
            maxResults: 10,
            ...(hostnameOf(pub.website) ? { includeDomains: [hostnameOf(pub.website)] } : {}),
            endPublishedDate: observedAt,
            signal,
            timeoutMs: SEARCH_REQUEST_WALL_MS,
          })
        : await withRequestDeadline(signal, (requestSignal) =>
            searchTavily({ pub, apiKey, fetchImpl, signal: requestSignal }),
          );
    } catch (error) {
      await onProgress?.({ nextIndex: index, queriesSpent, creditsSpent, prices, pages, delegatedChains });
      throw error;
    }
    await onProgress?.({ nextIndex: index, queriesSpent, creditsSpent, prices, pages, delegatedChains });
    throwIfAborted(signal);
    creditsSpent += Number(payload?.creditsSpent ?? payload?.usage?.credits) || 0;
    const officialResults = acceptedOfficialResults(pub, payload, hostCounts, observedAt);
    const matchedPage = selectBestOfficialPage(officialResults);

    if (matchedPage) {
      const venueKey = venueKeyForOsmPub(pub);
      pages.push({
        osmId: pub.osmId,
        venueKey,
        pubName: pub.name,
        address: pub.address,
        officialUrl: matchedPage.result.url,
        matchBasis: "osm-website-domain",
        priceCount: matchedPage.extracted.length,
        observedAt,
      });
      for (const price of matchedPage.extracted) {
        prices.push({
          venueKey,
          drinkName: price.drinkName,
          category: "beer",
          priceGbp: price.priceGbp,
          servingSize: price.servingSize,
          source: {
            label: sourceLabel(pub),
            url: matchedPage.result.url,
            licence: OFFICIAL_SITE_SOURCE_LICENCE,
          },
          observedAt,
        });
      }
    }

    index += 1;
    await onProgress?.({ nextIndex: index, queriesSpent, creditsSpent, prices, pages, delegatedChains });
  }

  return {
    city: cityId,
    totalPubs: pubs.length,
    startIndex,
    nextIndex: index,
    queriesSpent,
    creditsSpent,
    matchedPubs: pages.length,
    prices,
    pages,
    delegatedChains,
    complete: index >= pubs.length,
  };
}
