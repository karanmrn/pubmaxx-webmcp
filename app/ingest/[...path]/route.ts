const POSTHOG_EU_INGEST_ORIGIN = "https://eu.i.posthog.com";
const POSTHOG_EU_ASSET_ORIGIN = "https://eu-assets.i.posthog.com";
const MAX_REQUEST_BYTES = 1024 * 1024;
const SAFE_REQUEST_CONTENT_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "application/x-www-form-urlencoded",
  "text/plain",
]);
const SAFE_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
] as const;

type Context = { params: Promise<{ path: string[] }> };

function ingestOrigin(): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  return configuredOrigin === POSTHOG_EU_INGEST_ORIGIN
    ? configuredOrigin
    : POSTHOG_EU_INGEST_ORIGIN;
}

function upstreamUrl(request: Request, path: string[]): URL | null {
  if (path.length === 0 || path.some((segment) => segment.length === 0)) return null;

  const origin = path[0] === "static" || path[0] === "array"
    ? POSTHOG_EU_ASSET_ORIGIN
    : ingestOrigin();
  const requestUrl = new URL(request.url);
  const trailingSlash = requestUrl.pathname.endsWith("/") ? "/" : "";
  const url = new URL(`${path.map(encodeURIComponent).join("/")}${trailingSlash}`, `${origin}/`);
  url.search = requestUrl.search;
  return url;
}

function upstreamRequestHeaders(request: Request): Headers | null {
  const headers = new Headers({ accept: "*/*" });
  const rawContentType = request.headers.get("content-type");
  if (!rawContentType) return headers;

  const contentType = rawContentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !SAFE_REQUEST_CONTENT_TYPES.has(contentType)) return null;
  headers.set("content-type", contentType);
  return headers;
}

function downstreamResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

async function boundedBody(request: Request): Promise<ArrayBuffer | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_REQUEST_BYTES) {
      return null;
    }
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function forward(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  const url = upstreamUrl(request, path);
  if (!url) return new Response(null, { status: 404 });

  const headers = upstreamRequestHeaders(request);
  if (!headers) return new Response(null, { status: 415 });

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    const bounded = await boundedBody(request);
    if (!bounded) return new Response(null, { status: 413 });
    body = bounded;
  }

  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: downstreamResponseHeaders(upstream),
    });
  } catch {
    return new Response(null, {
      status: 502,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return forward(request, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return forward(request, context);
}
