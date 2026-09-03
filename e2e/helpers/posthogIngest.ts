import type { Request } from "@playwright/test";
import { gunzipSync } from "node:zlib";

// One decoder for the PostHog capture wire format, shared by every spec that
// reads /ingest. The SDK posts a gzipped `{ api_key, batch: [event] }` envelope,
// and a spec that reads `event` off the envelope silently sees nothing rather
// than failing loudly, so the shape lives here rather than in each spec.

export type IngestEvent = {
  event: string | null;
  properties: Record<string, unknown>;
};

function decodeIngestBody(body: Buffer): string {
  if (body[0] === 0x1f && body[1] === 0x8b) return gunzipSync(body).toString("utf8");
  const text = body.toString("utf8");
  if (text.startsWith("{") || text.startsWith("[")) return text;
  const data = new URLSearchParams(text).get("data");
  if (!data) return text;
  const raw = Buffer.from(data, "base64");
  return raw[0] === 0x1f && raw[1] === 0x8b
    ? gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
}

/** Every event carried by one capture request, newest wire format or older. */
export function parsePosthogIngest(request: Request): IngestEvent[] {
  try {
    const body = request.postDataBuffer();
    if (!body) return [];
    const parsed = JSON.parse(decodeIngestBody(body)) as unknown;
    const envelope = parsed as { batch?: unknown };
    const batch = Array.isArray(parsed)
      ? parsed
      : Array.isArray(envelope?.batch)
        ? envelope.batch
        : [parsed];
    return batch.map((entry) => {
      const record = entry as { event?: unknown; properties?: unknown };
      return {
        event: typeof record.event === "string" ? record.event : null,
        properties: (record.properties ?? {}) as Record<string, unknown>,
      };
    });
  } catch {
    return [];
  }
}
