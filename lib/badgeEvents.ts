import type { Badge, ProfileDrop } from "@/lib/profiles";

type DistinctDropField = "borough" | "venueId";

export type BadgeEventDropRule =
  | { field: "vibeTags"; includes: string }
  | { field: "createdAtWeekdayUtc"; equals: number };

export type BadgeEventCriteria =
  | {
      kind: "distinct-drop-field";
      field: DistinctDropField;
      target: number;
      progressLabel: string;
    }
  | {
      kind: "matching-drops";
      target: number;
      progressLabel: string;
      rules: readonly BadgeEventDropRule[];
    };

export type BadgeEventDefinition = {
  id: string;
  label: string;
  description: string;
  badgeLabel: string;
  startsAt: string;
  endsAt: string;
  criteria: BadgeEventCriteria;
};

export type BadgeEventProgress = {
  event: BadgeEventDefinition;
  badge: Badge;
  current: number;
  target: number;
  earned: boolean;
  label: string;
};

export type BadgeEventProgressOptions = {
  events?: readonly BadgeEventDefinition[];
  now: string | Date;
  optedInEventIds?: ReadonlySet<string> | readonly string[];
  optedInAtByEventId?:
    | ReadonlyMap<string, string | Date>
    | Readonly<Record<string, string | Date>>;
  legacyMode?: boolean;
};

export const BADGE_EVENTS: readonly BadgeEventDefinition[] = [
  {
    id: "borough-stamp-card-2026-07",
    label: "Borough Stamp Card",
    description: "Visit three different London boroughs during July.",
    badgeLabel: "Borough Explorer",
    startsAt: "2026-07-01T00:00:00.000Z",
    endsAt: "2026-08-01T00:00:00.000Z",
    criteria: {
      kind: "distinct-drop-field",
      field: "borough",
      target: 3,
      progressLabel: "boroughs",
    },
  },
  {
    id: "thames-side-thursday-2026",
    label: "Thames-side Thursday",
    description: "Log one riverside pint on a Thursday during the summer event.",
    badgeLabel: "Thames-side Thursday",
    startsAt: "2026-07-01T00:00:00.000Z",
    endsAt: "2026-10-01T00:00:00.000Z",
    criteria: {
      kind: "matching-drops",
      target: 1,
      progressLabel: "qualifying riverside Thursday drops",
      rules: [
        { field: "vibeTags", includes: "riverside" },
        { field: "createdAtWeekdayUtc", equals: 4 },
      ],
    },
  },
];

function parseTime(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isOptedIn(
  eventId: string,
  optedInEventIds: BadgeEventProgressOptions["optedInEventIds"],
): boolean {
  if (!optedInEventIds) return false;
  if (Array.isArray(optedInEventIds)) return (optedInEventIds as readonly string[]).includes(eventId);
  return (optedInEventIds as ReadonlySet<string>).has(eventId);
}

function optInStartFor(
  eventId: string,
  optedInAtByEventId: BadgeEventProgressOptions["optedInAtByEventId"],
): number | null {
  if (!optedInAtByEventId) return null;
  const mapLike = optedInAtByEventId as { get?: unknown };
  const value =
    typeof mapLike.get === "function"
      ? (optedInAtByEventId as ReadonlyMap<string, string | Date>).get(eventId)
      : (optedInAtByEventId as Readonly<Record<string, string | Date>>)[eventId];
  return parseTime(value);
}

function createdAtTime(drop: ProfileDrop): number | null {
  const createdAt = (drop as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "string" ? parseTime(createdAt) : null;
}

function dropsInWindow(
  drops: readonly ProfileDrop[],
  startsAt: number,
  endsAt: number,
): ProfileDrop[] {
  return drops.filter((drop) => {
    const createdAt = createdAtTime(drop);
    return createdAt != null && createdAt >= startsAt && createdAt < endsAt;
  });
}

function stringField(drop: ProfileDrop, field: DistinctDropField): string {
  const value = drop[field];
  return typeof value === "string" ? value.trim() : "";
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function matchesRule(drop: ProfileDrop, rule: BadgeEventDropRule): boolean {
  if (rule.field === "createdAtWeekdayUtc") {
    const createdAt = createdAtTime(drop);
    if (createdAt == null) return false;
    return new Date(createdAt).getUTCDay() === rule.equals;
  }

  const tags = (drop as { vibeTags?: unknown }).vibeTags;
  if (!Array.isArray(tags)) return false;
  const required = normalise(rule.includes);
  return tags.some((tag) => typeof tag === "string" && normalise(tag) === required);
}

function currentFor(criteria: BadgeEventCriteria, drops: readonly ProfileDrop[]): number {
  if (criteria.kind === "distinct-drop-field") {
    const seen = new Set<string>();
    for (const drop of drops) {
      const value = stringField(drop, criteria.field);
      if (value) seen.add(normalise(value));
    }
    return seen.size;
  }

  return drops.filter((drop) => criteria.rules.every((rule) => matchesRule(drop, rule))).length;
}

export function computeBadgeEventProgress(
  drops: readonly ProfileDrop[] | null | undefined,
  options: BadgeEventProgressOptions,
): BadgeEventProgress[] {
  if (options.legacyMode) return [];

  const now = parseTime(options.now);
  if (now == null) return [];

  const list = Array.isArray(drops) ? drops : [];
  const events = options.events ?? BADGE_EVENTS;

  return events.flatMap((event) => {
    if (!isOptedIn(event.id, options.optedInEventIds)) return [];

    const startsAt = parseTime(event.startsAt);
    const endsAt = parseTime(event.endsAt);
    if (startsAt == null || endsAt == null || startsAt >= endsAt) return [];
    if (now < startsAt || now >= endsAt) return [];

    const optedInAt = optInStartFor(event.id, options.optedInAtByEventId);
    const effectiveStart = optedInAt == null ? startsAt : Math.max(startsAt, optedInAt);
    const target =
      Number.isFinite(event.criteria.target) && event.criteria.target > 0
        ? Math.floor(event.criteria.target)
        : 1;
    // Cap the window's upper bound at `now` so a future-dated drop (clock skew
    // or a bad timestamp ahead of the current moment) never counts toward
    // progress before it has actually happened.
    const current = Math.min(
      currentFor(event.criteria, dropsInWindow(list, effectiveStart, Math.min(now, endsAt))),
      target,
    );
    const earned = current >= target;
    const badge: Badge = {
      id: `event-${event.id}`,
      label: event.badgeLabel,
      description: event.description,
      earned,
    };

    return [
      {
        event,
        badge,
        current,
        target,
        earned,
        label: `${current} of ${target} ${event.criteria.progressLabel}`,
      },
    ];
  });
}
