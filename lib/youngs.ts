// Young's (youngs.co.uk) helpers — garden-pub URL/name identity and conservative
// venue matching against our London dataset. PURE: no network. First-party
// menus/prices are permissible; this module only shapes identity + match.
// Eating Europe / third-party guides must NEVER feed prices through here.

export type YoungsDatasetVenue = {
  venueKey: string;
  venueId: string;
  name: string;
  address: string;
  website?: string;
};

export type YoungsGardenPub = {
  name: string;
  url: string;
  region?: string;
  sourcePage?: string;
};

export type YoungsVenueMatch = {
  venueKey: string;
  venueId: string;
  score: number;
  matchedName: string;
  method: "website" | "fuzzy-name";
};

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|pub|bar|tavern|inn|hotel|arms)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalise(value).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Hostname without leading www. for website matching. */
export function youngsHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Guess a pub display name from a Young's pub microsite hostname
 * (e.g. foundersarms.co.uk → Founders Arms). Prefer markdown-derived names
 * when available; this is a fallback only.
 */
export function youngsNameFromHostname(hostname: string): string {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  const base = host.split(".")[0] ?? host;
  const spaced = base
    .replace(/arms$/, " arms")
    .replace(/tavern$/, " tavern")
    .replace(/inn$/, " inn")
    .replace(/house$/, " house")
    .replace(/man$/, " man")
    .replace(/boat$/, " boat")
    .replace(/pack$/, " pack")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  // Insert soft spaces before known locality suffixes glued into the host.
  const soft = spaced
    .replace(
      /(ealing|isleworth|hammersmith|dulwich|greenwich|woolwich|camden|islington|hampstead|shoreditch|bow|clapton|borough|southbank|spitalfields|bloomsbury|mayfair|victoria|bermondsey|richmond|barnes|wandsworth|balham|putney|kew|croydon)$/i,
      " $1",
    )
    .replace(/\s+/g, " ")
    .trim();
  return soft
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Parse "The Founder's Arms, Southbank" style lines + Explore the pub links
 * from a Young's garden-guide markdown scrape.
 */
export function parseYoungsGardenMarkdown(markdown: string, sourcePage?: string): YoungsGardenPub[] {
  const lines = markdown.split(/\r?\n/);
  const out: YoungsGardenPub[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const link = lines[i].match(
      /\[Explore the pub\]\((https?:\/\/[^)\s]+)\)/i,
    );
    if (!link) continue;
    const url = link[1].replace(/\/garden\/?$/i, "/").replace(/\/+$/, "") || link[1];
    let name = "";
    for (let back = 1; back <= 6; back += 1) {
      const prev = (lines[i - back] ?? "").trim();
      if (!prev || prev.startsWith("!") || prev.startsWith("[") || prev.startsWith("#")) {
        continue;
      }
      if (/^scroll for more$/i.test(prev)) continue;
      // Prefer "Name, Locality" lines.
      if (/^[A-ZÀ-ÖØ-Ý]/.test(prev) && prev.length < 80) {
        name = prev.replace(/,+\s*$/, "").trim();
        break;
      }
    }
    if (!name) {
      const host = youngsHostname(url);
      name = host ? youngsNameFromHostname(host) : url;
    }
    const key = `${normalise(name)}|${youngsHostname(url) ?? url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url, sourcePage });
  }
  return out;
}

/**
 * Match a Young's garden pub to one dataset venue, or null.
 * Prefer website hostname match; else fuzzy name + London address.
 */
export function matchYoungsVenue(
  pub: YoungsGardenPub,
  dataset: YoungsDatasetVenue[],
  minScore = 0.75,
): YoungsVenueMatch | null {
  const host = youngsHostname(pub.url);
  if (host) {
    const byWeb: YoungsVenueMatch[] = [];
    for (const venue of dataset) {
      const web = (venue.website ?? "").toLowerCase();
      if (!web) continue;
      try {
        const venueHost = new URL(
          web.startsWith("http") ? web : `https://${web}`,
        ).hostname.replace(/^www\./, "");
        if (venueHost === host || web.includes(host)) {
          byWeb.push({
            venueKey: venue.venueKey,
            venueId: venue.venueId,
            score: 1,
            matchedName: venue.name,
            method: "website",
          });
        }
      } catch {
        if (web.includes(host)) {
          byWeb.push({
            venueKey: venue.venueKey,
            venueId: venue.venueId,
            score: 1,
            matchedName: venue.name,
            method: "website",
          });
        }
      }
    }
    if (byWeb.length === 1) return byWeb[0];
    if (byWeb.length > 1) {
      const keys = new Set(byWeb.map((m) => m.venueKey));
      if (keys.size === 1) return byWeb[0];
      return null;
    }
  }

  const nameTokens = tokens(pub.name);
  if (nameTokens.size === 0) return null;
  const scored: YoungsVenueMatch[] = [];
  for (const venue of dataset) {
    const score = jaccard(nameTokens, tokens(venue.name));
    if (score < minScore) continue;
    if (!/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)) {
      continue;
    }
    scored.push({
      venueKey: venue.venueKey,
      venueId: venue.venueId,
      score,
      matchedName: venue.name,
      method: "fuzzy-name",
    });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) {
    return null;
  }
  return top;
}
