// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The console used to pick a notice's ARIA role by matching its own copy
// (`message.startsWith("Not authorised")`), so a refusal worded any other way
// rendered as a quiet `role="status"` a screen reader may never speak. These
// drive the real console through its real session route and read the role off
// the rendered node.

const session = vi.hoisted(() => ({
  answer: async (_input: string, _init?: RequestInit): Promise<Response> =>
    new Response(null, { status: 500 }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

vi.mock("next/image", () => ({ default: () => null }));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "site nav"),
}));

vi.mock("@/app/admin/VenuePhotoModeration", () => ({
  default: () => null,
}));

import AdminClient from "@/app/admin/AdminClient";

let host: HTMLDivElement;
let root: Root;
const realFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    session.answer(String(input), init)) as typeof fetch;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadWithSessionAnswer(
  answer: (input: string, init?: RequestInit) => Promise<Response>,
  storedToken = "",
): Promise<HTMLElement | null> {
  session.answer = answer;
  // The console seeds its token field from localStorage on first render, and a
  // held token is what makes it POST rather than only re-read the session.
  if (storedToken) window.localStorage.setItem("pubmax_admin_token", storedToken);
  await act(async () => {
    root.render(createElement(AdminClient));
  });
  const load = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Load reported drops"),
  );
  expect(load).toBeTruthy();
  await act(async () => {
    load?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return host.querySelector<HTMLElement>(".admin-msg");
}

describe("a moderator notice carries its own tone", () => {
  // The whole point: this refusal's copy matches no prefix the old predicate
  // looked for, and it still has to be announced.
  it("announces a session the browser refused to keep", async () => {
    const notice = await loadWithSessionAnswer(async (input, init) => {
      if (input.includes("/api/admin/session")) {
        return init?.method === "POST"
          ? jsonResponse({ ok: true })
          : jsonResponse({ authenticated: false });
      }
      return jsonResponse({}, 500);
    }, "held-token");

    expect(notice?.textContent).toContain("Sign-in did not stick");
    expect(notice?.getAttribute("role")).toBe("alert");
  });

  it("announces a refused token, and says what to do about it", async () => {
    const notice = await loadWithSessionAnswer(async (input, init) => {
      if (input.includes("/api/admin/session")) {
        return init?.method === "POST"
          ? jsonResponse({ error: "Not authorised." }, 403)
          : jsonResponse({ authenticated: false });
      }
      return jsonResponse({}, 500);
    }, "wrong-token");

    expect(notice?.textContent).toBe("Not authorised. Check the admin token.");
    expect(notice?.getAttribute("role")).toBe("alert");
  });

  it("leaves an ordinary receipt polite", async () => {
    const notice = await loadWithSessionAnswer(async (input) => {
      if (input.includes("/api/admin/session")) {
        return jsonResponse({ authenticated: true });
      }
      if (input.includes("/api/pint-drops")) {
        return jsonResponse({ drops: [] });
      }
      return jsonResponse([]);
    });

    expect(notice?.textContent).toBe("No reported drops in the queue.");
    expect(notice?.getAttribute("role")).toBe("status");
  });
});
