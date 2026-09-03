import type { ConciergeContext } from "@/lib/concierge/rank";

export function contextFrom(value: unknown, now = new Date()): ConciergeContext {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 12);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const weather = ["rainy", "cold", "warm-dry", "mild"].includes(String(record.weather))
    ? record.weather as ConciergeContext["weather"]
    : undefined;
  return {
    ...(weather ? { weather } : {}),
    dayType: record.dayType === "weekday" || record.dayType === "weekend"
      ? record.dayType
      : weekday === "Sat" || weekday === "Sun" ? "weekend" : "weekday",
    timeOfDay: record.timeOfDay === "afternoon" || record.timeOfDay === "evening" || record.timeOfDay === "late"
      ? record.timeOfDay
      : hour >= 22 || hour < 5 ? "late" : hour < 17 ? "afternoon" : "evening",
  };
}
