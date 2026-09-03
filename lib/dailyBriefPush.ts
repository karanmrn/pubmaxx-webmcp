import type { DailyBriefHighlight } from "@/lib/pushSender";
import type { TonightPickDto, WeatherBrief } from "@/lib/todayBrief";

/** Build the notification only when both required claims are current and
 * source-backed. A stale weather observation is fine on the full page where its
 * timestamp is visible, but too ambiguous for a compact notification. */
export function composeDailyBriefPush(
  weather: WeatherBrief | null,
  picks: readonly TonightPickDto[],
): DailyBriefHighlight | null {
  const topPick = picks[0];
  if (!weather || weather.stale || !topPick) return null;
  return {
    weatherLine: weather.verdictLine,
    topPickTitle: topPick.title,
    topPickPlace: topPick.placeName,
  };
}
