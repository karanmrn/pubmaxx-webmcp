import { describe, expect, it } from "vitest";

import { downloadIcs } from "@/lib/routePanelIcs";

describe("downloadIcs", () => {
  it("no-ops safely when window/document are undefined (SSR)", () => {
    // In the vitest node environment there is no DOM, so this must not throw.
    expect(() => downloadIcs("crawl.ics", "BEGIN:VCALENDAR")).not.toThrow();
  });
});
