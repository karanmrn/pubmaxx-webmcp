import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileTflPanel from "@/components/mobile/MobileTflPanel";

const source = readFileSync(
  join(process.cwd(), "components/mobile/MobileTflPanel.tsx"),
  "utf8",
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MobileTflPanel resilience", () => {
  it("uses the shared public read layer and reconnect recovery", () => {
    expect(source).toContain('from "@/lib/surfaceDataCache"');
    expect(source).toContain('from "@/lib/useReconnectRecovery"');
    expect(source).toContain("maxAgeMs: TFL_STATUS_MAX_AGE_MS");
    expect(source).toContain("useReconnectRecovery(failed, retry)");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("cachedTfl");
    expect(source).not.toContain("inflightTfl");
  });

  it("keeps online fault copy for an unavailable live status", () => {
    const html = renderToStaticMarkup(
      createElement(MobileTflPanel, {
        status: { payload: null, failed: true, issueCount: 0 },
      }),
    );
    expect(html).toContain("TfL updates are unavailable.");
    expect(html).not.toContain("You look offline.");
  });

  it("uses honest offline copy for an unavailable live status", () => {
    vi.stubGlobal("window", { navigator: { onLine: false } });
    const html = renderToStaticMarkup(
      createElement(MobileTflPanel, {
        status: { payload: null, failed: true, issueCount: 0 },
      }),
    );
    expect(html).toContain("You look offline. We will retry when you are back.");
    expect(html).not.toContain("TfL updates are unavailable.");
  });
});
