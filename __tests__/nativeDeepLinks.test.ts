import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNativeApp } from "@/lib/nativePlatform";
import { activateNativeDeepLinks, nativeDeepLinkPath } from "@/lib/nativeDeepLinks";

const appMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: vi.fn() }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appMocks.addListener,
    getLaunchUrl: appMocks.getLaunchUrl,
  },
}));

const native = vi.mocked(isNativeApp);

beforeEach(() => {
  vi.clearAllMocks();
  native.mockReturnValue(true);
  appMocks.getLaunchUrl.mockResolvedValue(undefined);
  appMocks.remove.mockResolvedValue(undefined);
});

describe("nativeDeepLinkPath", () => {
  it.each([
    ["https://pubmaxxing.com/plan/abc", "/plan/abc"],
    ["https://pubmaxxing.com/rounds/invite?from=push", "/rounds/invite?from=push"],
    ["https://pubmaxxing.com/p/pub-1#prices", "/p/pub-1#prices"],
    [
      "https://pubmaxxing.com/auth/callback?next=%2Fmap#access_token=token",
      "/auth/callback?next=%2Fmap#access_token=token",
    ],
  ])("accepts an allow-listed production link", (url, expected) => {
    expect(nativeDeepLinkPath(url)).toBe(expected);
  });

  it.each([
    "https://evil.example/plan/abc",
    "http://pubmaxxing.com/plan/abc",
    "https://www.pubmaxxing.com/plan/abc",
    "https://pubmaxxing.com/admin",
    "https://pubmaxxing.com/auth/callback/anything",
    "not a url",
  ])("rejects links outside the exact origin and route allow-list", (url) => {
    expect(nativeDeepLinkPath(url)).toBeNull();
  });
});

describe("activateNativeDeepLinks", () => {
  it("is a plugin-free no-op on the web", async () => {
    native.mockReturnValue(false);

    const cleanup = await activateNativeDeepLinks(vi.fn());
    cleanup();

    expect(appMocks.addListener).not.toHaveBeenCalled();
    expect(appMocks.getLaunchUrl).not.toHaveBeenCalled();
  });

  it("routes both cold-start and warm links, then removes the listener", async () => {
    let onOpen: ((event: { url: string }) => void) | undefined;
    appMocks.addListener.mockImplementation(async (_event, callback) => {
      onOpen = callback;
      return { remove: appMocks.remove };
    });
    appMocks.getLaunchUrl.mockResolvedValue({
      url: "https://pubmaxxing.com/plan/cold?invite=1#crew",
    });
    const navigate = vi.fn();

    const cleanup = await activateNativeDeepLinks(navigate);
    expect(navigate).toHaveBeenCalledWith("/plan/cold?invite=1#crew");

    onOpen?.({ url: "https://pubmaxxing.com/rounds/warm" });
    onOpen?.({ url: "https://evil.example/p/nope" });
    expect(navigate).toHaveBeenCalledWith("/rounds/warm");
    expect(navigate).toHaveBeenCalledTimes(2);

    cleanup();
    expect(appMocks.remove).toHaveBeenCalledOnce();
  });

  it("fails soft if the native plugin is unavailable", async () => {
    appMocks.addListener.mockRejectedValue(new Error("plugin unavailable"));

    await expect(activateNativeDeepLinks(vi.fn())).resolves.toEqual(expect.any(Function));
  });
});
