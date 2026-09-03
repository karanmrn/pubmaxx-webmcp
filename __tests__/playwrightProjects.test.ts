import { afterEach, describe, expect, it, vi } from "vitest";

const FIREFOX_PROJECT = "firefox-desktop-map-chrome-fit";
const FIREFOX_OPT_IN = "PW_FIREFOX_DESKTOP_MAP_CHROME_FIT";

async function loadProjectNames(): Promise<string[]> {
  vi.resetModules();
  const config = (await import("../playwright.config")).default;
  return (config.projects ?? []).map((project) => project.name ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Playwright project registration", () => {
  it("keeps targeted Firefox coverage outside the default Chromium suite", async () => {
    vi.stubEnv(FIREFOX_OPT_IN, "");
    expect(await loadProjectNames()).not.toContain(FIREFOX_PROJECT);

    vi.stubEnv(FIREFOX_OPT_IN, "1");
    expect(await loadProjectNames()).toContain(FIREFOX_PROJECT);
  });
});
