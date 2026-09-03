import "server-only";

export class RequestBodyTooLargeError extends Error {}

export async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new RequestBodyTooLargeError(); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function boundedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await boundedBody(request, maxBytes)));
}

export async function boundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("Content-Type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) throw new Error("multipart required");
  const body = await boundedBody(request, maxBytes);
  const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Request("http://local.invalid", { method: "POST", headers: { "Content-Type": contentType }, body: arrayBuffer }).formData();
}
