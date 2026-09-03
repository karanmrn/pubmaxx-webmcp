import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    element: unknown;

    constructor(element: unknown) {
      this.element = element;
    }
  },
}));

import { GET } from "@/app/api/crawl-card/route";

describe("OG card visual contract", () => {
  it("keeps a long untrusted crawl title inside its card typography budget", async () => {
    const title = "Friday pub crawl through Soho and Camden with friends after work tonight";
    const url = new URL("http://localhost/api/crawl-card");
    url.searchParams.set("title", `${title}\u0001`);

    const response = (await GET(new Request(url))) as unknown as { element: ReactNode };
    const markup = renderToStaticMarkup(response.element);
    const visualModel = {
      title: `${title.slice(0, 63)}…`,
      usesLongTitleSize: markup.includes("font-size:76px"),
      containsControlCharacter: markup.includes("\u0001"),
    };

    expect(visualModel).toMatchInlineSnapshot(`
      {
        "containsControlCharacter": false,
        "title": "Friday pub crawl through Soho and Camden with friends after wor…",
        "usesLongTitleSize": true,
      }
    `);
    expect(markup).toContain(visualModel.title);
  });
});
