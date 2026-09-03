import {
  CULTURE_CRAWL_CHIP_QUERIES,
  cultureCrawlChipQuery,
  isCultureCrawlChipId,
  type CultureCrawlChipId,
} from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { cleanText } from "@/lib/textClean";

/** Closed occasion ids for soft-social plan deep links. */
export const SOFT_PLAN_OCCASION_IDS = ["quiet", "af", "coffee", "chill"] as const;
export type SoftPlanOccasionId = (typeof SOFT_PLAN_OCCASION_IDS)[number];

/**
 * Each id maps to a shipped describe-first chip so the composer prefills a
 * query that already generates keyless and parses honestly.
 */
export const SOFT_PLAN_OCCASIONS: Record<SoftPlanOccasionId, string> = {
  quiet: "Quiet in Clapham for 4, not pricey",
  af: "alcohol-free drinks in Camden for 3",
  coffee: "coffee and a catch-up in Clapham for 2",
  chill: "chill Wetherspoons in Clapham for 3",
};

/** Extra soft outings on Tonight that are not one of the seven vibe chips. */
export const TONIGHT_SOFT_PLAN_CHIPS: ReadonlyArray<{
  id: Exclude<SoftPlanOccasionId, "quiet">;
  label: string;
}> = [
  { id: "coffee", label: "Coffee catch-up" },
  { id: "af", label: "Alcohol-free outing" },
  { id: "chill", label: "Chill afternoon" },
];

export const PLAN_DESCRIBE_PARAM = "describe";
export const PLAN_OCCASION_PARAM = "occasion";
/** Pub Pal route handoff: any grounded ask text, not only shipped chips. */
export const PLAN_QUERY_PARAM = "query";

export function isSoftPlanOccasionId(value: unknown): value is SoftPlanOccasionId {
  return typeof value === "string" && (SOFT_PLAN_OCCASION_IDS as readonly string[]).includes(value);
}

export function resolveSoftPlanOccasionQuery(id: SoftPlanOccasionId): string {
  return SOFT_PLAN_OCCASIONS[id];
}

function isShippedDescribeChip(value: string): boolean {
  return (
    (DESCRIBE_FIRST_CHIPS as readonly string[]).includes(value)
    || CULTURE_CRAWL_CHIP_QUERIES.includes(value)
  );
}

/**
 * Read a describe string from a plan URL search string.
 *
 * THREE params, narrowest first. `occasion` wins and takes closed ids only;
 * `describe` takes shipped chip text only; `query` is the Pub Pal route handoff
 * and takes ARBITRARY ask text, so it is deliberately the widest and the last
 * one asked. That text only ever prefills the describe field, and `cleanText`
 * bounds it at 500 characters and strips angle brackets, so nothing here is a
 * trust boundary: a caller may put any words in the field a drinker could type.
 * Culture Crawl ids share the `occasion` param with the soft occasions, so the
 * two id sets must never collide (pinned in __tests__/cultureCrawlChips.test.ts).
 */
export function parsePlanDescribeFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  const occasion = params.get(PLAN_OCCASION_PARAM);
  if (isSoftPlanOccasionId(occasion)) {
    return resolveSoftPlanOccasionQuery(occasion);
  }
  if (isCultureCrawlChipId(occasion)) {
    return cultureCrawlChipQuery(occasion);
  }

  const describe = params.get(PLAN_DESCRIBE_PARAM);
  if (describe) {
    const trimmedDescribe = cleanText(describe, 500);
    if (trimmedDescribe && isShippedDescribeChip(trimmedDescribe)) {
      return trimmedDescribe;
    }
  }

  const query = params.get(PLAN_QUERY_PARAM);
  if (!query) return null;
  const trimmedQuery = cleanText(query, 500);
  return trimmedQuery || null;
}

/**
 * The Pub Pal handoff ask ALONE, ignoring `occasion` and `describe`.
 *
 * `parsePlanDescribeFromSearch` answers for all three params, so a caller that
 * needs to know specifically whether the ADDRESS carries a handoff ask - rather
 * than any prefill at all - has to ask this narrower question. The composer
 * uses it to decide whether a saved wizard draft is overridden, which is a rule
 * about the handoff and not about the chip links.
 */
export function parsePlanHandoffQueryFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const query = params.get(PLAN_QUERY_PARAM);
  if (!query) return null;
  return cleanText(query, 500) || null;
}

/**
 * Pub Pal `?query=` arrivals auto-generate once on /plan. Chip links (`occasion`,
 * `describe`) only prefill the describe field and still need a tap on Make a plan.
 */
export function shouldAutoGeneratePalHandoffPlan(handoffAsk: string | null): boolean {
  return Boolean(handoffAsk?.trim());
}

/** After a Pub Pal three-stop route answer, open Plan with the same ask prefilled. */
export function planPalRouteHandoffHref(query: string): string {
  const trimmed = cleanText(query, 500);
  if (!trimmed) return "/plan";
  const params = new URLSearchParams();
  params.set(PLAN_QUERY_PARAM, trimmed);
  return `/plan?${params.toString()}`;
}

/** Deep link into /plan with a soft occasion, a Culture Crawl id or chip text. */
export function planOccasionHref(
  target: SoftPlanOccasionId | CultureCrawlChipId | (typeof DESCRIBE_FIRST_CHIPS)[number],
  options?: { src?: string },
): string {
  const params = new URLSearchParams();
  if (isSoftPlanOccasionId(target) || isCultureCrawlChipId(target)) {
    params.set(PLAN_OCCASION_PARAM, target);
  } else {
    params.set(PLAN_DESCRIBE_PARAM, target);
  }
  if (options?.src) params.set("src", options.src);
  const qs = params.toString();
  return qs ? `/plan?${qs}` : "/plan";
}
