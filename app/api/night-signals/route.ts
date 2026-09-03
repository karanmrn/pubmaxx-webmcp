import snapshot from "@/public/data/night_signals/latest.json";
import { jsonCached } from "@/lib/apiResponses";
import { activeNightSignalClaims } from "@/lib/nightSignalClaims";
import { fireAndForgetPush, maybeBroadcastNightSignalLive } from "@/lib/pushSender";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId")?.trim() ?? "";
  const active = activeNightSignalClaims(snapshot);
  // "Signal went live" moment: the night-signal snapshot is a static import
  // that only changes on deploy, so the first request after a new snapshot is
  // its go-live edge. Fire-and-forget a broadcast to ALL registered devices,
  // deduped durably per snapshot version (lib/pushSender.ts) so later reads
  // are no-ops. Edge caching below composes safely: a cached response never
  // needs to re-fire, and a new snapshot ships via redeploy, which purges the
  // edge — so the go-live request always reaches the function once.
  fireAndForgetPush(() => maybeBroadcastNightSignalLive(
    snapshot.generatedAt,
    active.map((claim) => ({
      id: claim.id,
      title: claim.entity.id,
      body: claim.claim,
      entityId: claim.entity.id,
    })),
  ));
  const claims = active.filter((claim) => !entityId || claim.entity.id === entityId);
  return jsonCached({ version: 1, asOf: snapshot.generatedAt, claims }, { sMaxAge: 300, staleWhileRevalidate: 600 });
}
