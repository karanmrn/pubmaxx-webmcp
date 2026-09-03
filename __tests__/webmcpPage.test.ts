import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import WebMcpNightBoard from "@/components/webmcp/WebMcpNightBoard";

describe("WebMCP Agent Night Board", () => {
  it("starts with a request that the grounded demo can draft", () => {
    const html = renderToStaticMarkup(createElement(WebMcpNightBoard));

    expect(html).toContain(">Three pubs in Victoria</textarea>");
    expect(html).toContain('id="webmcp-search" minLength="2" maxLength="80" value="Victoria"');
  });
});
