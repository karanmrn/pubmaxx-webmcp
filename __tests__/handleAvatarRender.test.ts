import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// WHO OWNS THE BOX. `size` is the IMAGE's width and height. The initials
// fallback wears the consumer's class and nothing else, because an inline width
// on the shared component beats every consumer stylesheet at once - the profile
// hero's responsive clamp (88-156px, narrowed to 92px and 78px on a phone) and
// the 36px feed row included. The add-link circle is `.confirmFollowAvatar` in
// app/add/[handle]/add.css, and its rendered 56px is measured in the browser by
// e2e/add-link-account.spec.ts.

vi.mock("next/image", () => ({
  default: ({
    src,
    width,
    height,
    className,
  }: {
    src: string;
    width?: number;
    height?: number;
    className?: string;
  }) => createElement("img", { src, width, height, className, alt: "" }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  identityResolved: true,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import HandleAvatar from "@/components/profile/HandleAvatar";
import ConfirmFollow from "@/components/social/ConfirmFollow";

describe("HandleAvatar", () => {
  it("sizes the image from the size prop", () => {
    const html = renderToStaticMarkup(
      createElement(HandleAvatar, {
        handle: "karan",
        avatarUrl: "https://example.test/a.jpg",
        className: "profileAvatar",
        size: 176,
      }),
    );

    expect(html).toContain('width="176"');
    expect(html).toContain('height="176"');
  });

  it("leaves the initials fallback to the consumer stylesheet", () => {
    const html = renderToStaticMarkup(
      createElement(HandleAvatar, {
        handle: "karan",
        className: "profileAvatar",
        size: 176,
      }),
    );

    expect(html).toContain('class="profileAvatar"');
    expect(html).toContain(">K<");
    // The regression: an inline box here painted a 176px circle over the
    // profile hero's own clamp at every viewport.
    expect(html).not.toContain("style=");
    expect(html).not.toContain("176");
  });
});

describe("the add-link card", () => {
  it("hands the initials circle to .confirmFollowAvatar", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmFollow, { targetHandle: "karan" }),
    );

    expect(html).toContain('<span class="confirmFollowAvatar" aria-hidden="true">K</span>');
  });
});
