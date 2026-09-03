import { describe, expect, it } from "vitest";

import { boundedBody, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";

describe("bounded Social request body", () => {
  it("stops a chunked body before buffering past the cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); controller.close(); },
    });
    const request = new Request("http://localhost/api/social/posts", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(boundedBody(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
