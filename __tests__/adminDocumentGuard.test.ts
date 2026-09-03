import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION_COOKIE,
  canOpenAdminDocument,
  hashAdminSession,
  isModerator,
} from "@/lib/adminAuth";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
const navigation = vi.hoisted(() => ({
  unauthorized: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;401");
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => incoming.headers,
}));

vi.mock("next/navigation", () => ({
  unauthorized: navigation.unauthorized,
  usePathname: () => "/admin",
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/app/admin/AdminClient", () => ({
  default: () => createElement("div", null, "moderator console"),
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "site nav"),
}));

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

beforeEach(() => {
  navigation.unauthorized.mockClear();
  incoming.headers = new Headers();
});

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function moderatorCookie(token: string): string {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(hashAdminSession(token))}`;
}

/** Next hands the page a sealed adapter, so the gate may only ever call `get`. */
function sealedHeaders(init: Record<string, string>): Pick<Headers, "get"> {
  const headers = new Headers(init);
  return {
    get(name: string) {
      return headers.get(name);
    },
  };
}

describe("canOpenAdminDocument", () => {
  it("refuses a header list with no cookie when ADMIN_TOKEN is set", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    expect(canOpenAdminDocument(new Headers())).toBe(false);
  });

  it("admits a header list whose cookie is the hashed token", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    expect(
      canOpenAdminDocument(
        new Headers({ cookie: moderatorCookie("test-admin-secret") }),
      ),
    ).toBe(true);
  });

  it("reads a sealed header adapter through get alone", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    expect(
      canOpenAdminDocument(
        sealedHeaders({ cookie: moderatorCookie("test-admin-secret") }),
      ),
    ).toBe(true);
    expect(canOpenAdminDocument(sealedHeaders({}))).toBe(false);
  });

  it("shares one credential with the API gate", () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    const cookie = moderatorCookie("test-admin-secret");
    expect(
      isModerator(new Request("http://localhost/api/admin", { headers: { cookie } })),
    ).toBe(true);
    expect(canOpenAdminDocument(new Headers({ cookie }))).toBe(true);
    expect(isModerator(new Request("http://localhost/api/admin"))).toBe(false);
  });
});

describe("the admin document", () => {
  it("refuses an anonymous request before the console mounts", async () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    const { default: AdminPage } = await import("@/app/admin/page");
    await expect(AdminPage()).rejects.toThrow(/401/);
    expect(navigation.unauthorized).toHaveBeenCalledTimes(1);
  });

  it("renders the console for a moderator session cookie", async () => {
    process.env.ADMIN_TOKEN = "test-admin-secret";
    incoming.headers = new Headers({
      cookie: moderatorCookie("test-admin-secret"),
    });
    const { default: AdminPage } = await import("@/app/admin/page");
    const html = renderToStaticMarkup(await AdminPage());
    expect(navigation.unauthorized).not.toHaveBeenCalled();
    expect(html).toContain("moderator console");
  });

  it("keeps the token form on the 401 body, not the console", async () => {
    const { default: AdminUnauthorized } = await import(
      "@/app/admin/unauthorized"
    );
    const html = renderToStaticMarkup(createElement(AdminUnauthorized));
    expect(html).toContain("Moderator sign-in");
    expect(html).toContain('aria-label="Admin token"');
    expect(html).not.toContain("moderator console");
  });

  // A refusal is not a dead end. The root layout's only nav is the phone tab
  // bar, hidden above 640px, so the desktop way out has to be on this page.
  it("leaves a way out of the 401 body", async () => {
    const { default: AdminUnauthorized } = await import(
      "@/app/admin/unauthorized"
    );
    const html = renderToStaticMarkup(createElement(AdminUnauthorized));
    expect(html).toContain("Back to the map");
    expect(html).toContain('href="/map"');
  });
});
