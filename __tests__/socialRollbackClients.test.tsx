// @vitest-environment jsdom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: fetchMock,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ handle: "ken" }),
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => false,
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));
vi.mock("@/components/profile/NextBadgeChips", () => ({
  default: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));

import ActivityClient from "@/app/activity/ActivityClient";
import NotificationBell from "@/components/nav/NotificationBell";

afterEach(() => {
  fetchMock.mockReset();
  document.body.innerHTML = "";
});

async function mount(element: ReactElement): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
  return host;
}

describe("Social rollback notification clients", () => {
  it("renders Activity preview without fetching or marking notifications", async () => {
    const host = await mount(createElement(ActivityClient));

    expect(host.textContent).toContain("Social preview");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels NotificationBell as preview without polling", async () => {
    const host = await mount(createElement(NotificationBell));

    expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Social preview");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
