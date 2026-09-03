// Asking a host's own robots.txt whether this harvest may read a page.
//
// WHY THE SOURCE TABLE IS NOT ENOUGH. lib/harvest/sourcePolicy.ts decides the
// handful of chain pages by hand, with the rule written down. The venue lanes
// have no such list: they follow whatever website the curated dataset holds, and
// there are hundreds. The first run walked straight onto two Mitchells & Butlers
// brand sites through their per-pub domains - an estate the source table
// refuses - because refusing `mbplc.com` says nothing about
// `edinborocastlepub.co.uk`. So the long tail is asked directly, per host, at
// harvest time.
//
// THE RULES THIS APPLIES, and why they are the strict reading:
//
//   * Our identity is PLURAL. The harvest reaches a page through a hosted
//     headless renderer, so it answers to the renderer class as well as to `*`.
//     A restriction on EITHER binds: several sites admit ordinary crawlers and
//     name `CloudflareBrowserRenderingCrawler` in a Disallow, and the narrower
//     rule is the one that counts.
//   * AN UNREADABLE robots.txt IS A REFUSAL, not a missing one. A challenge page
//     or a 403 means no permission can be read, and a page we cannot ask about
//     is a page we do not take. A genuine 404 is different: publishing no rules
//     is the long-standing way of permitting everything, and it is honoured.
//   * The check itself is a plain fetch, not a Firecrawl request, so it costs
//     the run's budget nothing and cannot be the thing that exhausts it.

export const HARVEST_ROBOTS_AGENTS = ["cloudflarebrowserrenderingcrawler", "firecrawlagent", "*"] as const;

/** robots.txt is small; anything larger is not a rules file we should trust. */
const MAX_ROBOTS_BYTES = 512 * 1024;
const ROBOTS_TIMEOUT_MS = 15_000;

export type RobotsRules = {
  /** Disallowed path prefixes, per lower-cased user-agent token. */
  groups: Map<string, { disallow: string[]; allow: string[] }>;
};

export type RobotsDecisionReason = "allowed" | "no-rules-published" | "robots-disallowed" | "robots-unreadable";

export type RobotsDecision = {
  allowed: boolean;
  reason: RobotsDecisionReason;
  evidence: string;
};

/**
 * Read a robots.txt body into per-agent rules. A group may name several agents
 * before its first rule, which is how `User-agent: A` / `User-agent: B` /
 * `Disallow: /` binds both.
 */
export function parseRobotsTxt(body: string): RobotsRules {
  const groups = new Map<string, { disallow: string[]; allow: string[] }>();
  let currentAgents: string[] = [];
  let sawRuleForGroup = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after a rule starts a NEW group.
      if (sawRuleForGroup) {
        currentAgents = [];
        sawRuleForGroup = false;
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), { disallow: [], allow: [] });
      continue;
    }
    if (field !== "disallow" && field !== "allow") continue;
    sawRuleForGroup = true;
    for (const agent of currentAgents) {
      const group = groups.get(agent);
      if (!group) continue;
      if (field === "disallow") {
        // An EMPTY Disallow is the conventional "nothing is disallowed".
        if (value.length > 0) group.disallow.push(value);
      } else if (value.length > 0) {
        group.allow.push(value);
      }
    }
  }

  return { groups };
}

function matchLength(pattern: string, path: string): number {
  // Longest-prefix matching, with `*` and `$` handled the ordinary way.
  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern) ? pattern.length : -1;
  }
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return regex.test(path) ? body.length : -1;
}

/**
 * Is `path` allowed for every identity this harvest answers to? A restriction
 * on any of them binds, because we are all of them at once.
 */
export function robotsAllows(rules: RobotsRules, path: string): { allowed: boolean; agent?: string; rule?: string } {
  for (const agent of HARVEST_ROBOTS_AGENTS) {
    const group = rules.groups.get(agent);
    if (!group) continue;
    let bestDisallow = -1;
    let bestRule = "";
    for (const pattern of group.disallow) {
      const length = matchLength(pattern, path);
      if (length > bestDisallow) {
        bestDisallow = length;
        bestRule = pattern;
      }
    }
    if (bestDisallow < 0) continue;
    let bestAllow = -1;
    for (const pattern of group.allow) {
      bestAllow = Math.max(bestAllow, matchLength(pattern, path));
    }
    // A tie goes to Allow, which is the usual reading of the more permissive rule.
    if (bestAllow >= bestDisallow) continue;
    return { allowed: false, agent, rule: bestRule };
  }
  return { allowed: true };
}

export type RobotsChecker = (url: string) => Promise<RobotsDecision>;

/**
 * Build a per-run robots checker. One fetch per HOST, remembered for the run, so
 * a lane that reads two pages on a site asks once.
 */
export function createRobotsChecker(options: { fetchImpl?: typeof fetch } = {}): RobotsChecker {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = new Map<string, Promise<RobotsDecision | RobotsRules>>();

  async function load(origin: string): Promise<RobotsDecision | RobotsRules> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${origin}/robots.txt`, {
        headers: { accept: "text/plain", "user-agent": "PUBMAXX-harvest/1" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (response.status === 404 || response.status === 410) {
        return {
          allowed: true,
          reason: "no-rules-published",
          evidence: `${origin}/robots.txt returns ${response.status}, which publishes no restriction.`,
        };
      }
      if (!response.ok) {
        return {
          allowed: false,
          reason: "robots-unreadable",
          evidence: `${origin}/robots.txt answered ${response.status}, so no permission can be read.`,
        };
      }
      const body = (await response.text()).slice(0, MAX_ROBOTS_BYTES);
      if (!/^\s*user-agent\s*:/im.test(body)) {
        return {
          allowed: false,
          reason: "robots-unreadable",
          evidence: `${origin}/robots.txt returned something that is not a rules file, so no permission can be read.`,
        };
      }
      return parseRobotsTxt(body);
    } catch (error) {
      return {
        allowed: false,
        reason: "robots-unreadable",
        evidence: `${origin}/robots.txt could not be fetched (${error instanceof Error ? error.message : String(error)}).`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return async (url: string): Promise<RobotsDecision> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: "robots-unreadable", evidence: `${url} is not an absolute URL.` };
    }
    const origin = parsed.origin;
    let pending = cache.get(origin);
    if (!pending) {
      pending = load(origin);
      cache.set(origin, pending);
    }
    const loaded = await pending;
    if ("reason" in loaded) return loaded;

    const path = `${parsed.pathname}${parsed.search}`;
    const verdict = robotsAllows(loaded, path);
    if (verdict.allowed) {
      return { allowed: true, reason: "allowed", evidence: `${origin}/robots.txt permits ${path}.` };
    }
    return {
      allowed: false,
      reason: "robots-disallowed",
      evidence: `${origin}/robots.txt disallows ${path} for \`${verdict.agent}\` (rule: ${verdict.rule}).`,
    };
  };
}
