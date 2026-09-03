// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "site nav"),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(),
}));

import WeAreOutClient from "@/app/we-are-out/WeAreOutClient";
import { authedActionFetch } from "@/lib/authedFetch";

let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function completeCheckIn(socialFriendsLaunchEnabled?: boolean): Promise<void> {
  window.localStorage.setItem("pubmax_handle", "alice");
  vi.mocked(authedActionFetch).mockResolvedValue(jsonResponse({ ok: true }));
  await act(async () => {
    root.render(createElement(WeAreOutClient, { socialFriendsLaunchEnabled }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const select = host.querySelector<HTMLSelectElement>("select");
  expect(select).toBeTruthy();
  select!.value = select!.options[1]!.value;
  await act(async () => {
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const submit = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("I'm here"),
  );
  expect(submit).toBeTruthy();
  await act(async () => {
    submit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderRollback(): Promise<void> {
  await act(async () => {
    root.render(createElement(WeAreOutClient, { socialFriendsLaunchEnabled: false }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("we-are-out Social honesty", () => {
  it("defaults completed check-ins to Social", async () => {
    await completeCheckIn();
    expect(host.querySelector('a[href="/social"]')?.textContent).toContain("Open Social");
  });

  it("uses Memories for completed check-ins during rollback", async () => {
    await renderRollback();
    expect(host.querySelector('a[href="/u/you#night-memories"]')?.textContent).toContain("Open Memories");
  });
});
