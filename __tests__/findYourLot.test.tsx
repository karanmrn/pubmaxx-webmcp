import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ accountRevision: 0, user: null }),
}));

vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));

import FindYourLot from "@/components/social/FindYourLot";

describe("FindYourLot signed-out invite action", () => {
  it("renders one sign-in invite link", () => {
    const html = renderToStaticMarkup(createElement(FindYourLot));

    expect(html.match(/Sign in to invite/g)).toHaveLength(1);
    expect(html).toContain('href="/login"');
  });
});
