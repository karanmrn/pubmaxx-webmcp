import { authedActionFetch } from "@/lib/authedFetch";
import { markCheapPintPingQualified } from "@/lib/cheapPintPingPrompt";
import { discardBody } from "@/lib/responseBody";

/** Fire-and-forget qualify after a pint drop or saved favourite pint. */
export function notifyCheapPintPingQualified(): void {
  void authedActionFetch("/api/cheap-pint-ping", {
    method: "POST",
    body: JSON.stringify({ action: "qualify" }),
  })
    .then(async (response) => {
      if (!response.ok) {
        discardBody(response);
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        canPrompt?: boolean;
      } | null;
      if (body?.canPrompt) markCheapPintPingQualified();
    })
    .catch(() => undefined);
}
