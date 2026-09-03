/**
 * The Europe/London wall clock — pub presence follows London evenings
 * regardless of where the server runs. Deterministic for a given Date.
 *
 * This is a LEAF module on purpose. The nav model reads it to decide the Now
 * tab href, and the nav model is mounted in the root layout, so it may not drag
 * a module graph behind it: reading the hour off lib/ambientPresence shipped the
 * demo Pint Drop rosters to every route for one Intl call.
 *
 * The formatter is built ONCE and held. `useSyncExternalStore` calls its
 * snapshot on every render and on every store notification, so a formatter
 * constructed per call is built on a hot path for an answer that moves twice a
 * day.
 */

export const LONDON_DAY_MS = 24 * 60 * 60 * 1000;

let clockFormatter: Intl.DateTimeFormat | null = null;

function londonClock(): Intl.DateTimeFormat {
  clockFormatter ??= new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
  return clockFormatter;
}

/**
 * Milliseconds since London midnight, 0 to 86_399_999.
 *
 * A single reading of the whole wall clock, so the hour and the offset into it
 * can never come from two different formatter calls straddling a second.
 */
export function londonMsSinceMidnight(date: Date): number {
  const parts = londonClock().formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value);
  // Intl renders midnight as "24" in some ICU builds — normalize to 0–23.
  const hour = part("hour") % 24;
  const minute = part("minute");
  const second = part("second");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return 0;
  }
  const millisecond = ((date.getTime() % 1000) + 1000) % 1000;
  return ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;
}

/** The hour-of-day, 0 to 23, in the Europe/London wall clock. */
export function londonHour(date: Date): number {
  return Math.floor(londonMsSinceMidnight(date) / (60 * 60 * 1000));
}
