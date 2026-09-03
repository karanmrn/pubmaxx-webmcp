// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialPostDTO } from "@/lib/socialPosts";

const transport = vi.hoisted(() => ({
  authedActionJson: vi.fn(),
}));

vi.mock("@/lib/authedFetch", () => transport);

vi.mock("@/lib/socialComposerDrafts", () => ({
  readSocialDraftPhoto: vi.fn(async () => null),
  saveSocialDraftPhoto: vi.fn(async () => undefined),
}));

import SocialComposer from "@/app/social/SocialComposer";

const POST: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "friends",
  body: "Keep this draft",
  area: null,
  venueId: null,
  venueProjected: false,
  hashtags: [],
  commentPolicy: "open",
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 1,
  mutationVersion: 1,
  editedAt: null,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: true,
  venueName: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  transport.authedActionJson.mockReset();
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
});

describe("Social composer latest-post reload", () => {
  it("consumes an expected abort and still shows a later network failure", async () => {
    const conflictBody = { code: "EDIT_CONFLICT", error: "Post changed." };
    const conflictResponse = json(conflictBody, 409);
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const networkFailure = new TypeError("network failed");
    transport.authedActionJson
      .mockResolvedValueOnce({ response: conflictResponse, body: conflictBody })
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(networkFailure);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      await act(async () => {
        root?.render(createElement(SocialComposer, {
          post: POST,
          draftScope: "account-a",
          onSaved: vi.fn(),
        }));
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        button(host, "Edit post").click();
      });
      await act(async () => {
        button(host, "Save").click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.textContent).toContain("Post changed. Your draft is still here.");

      await act(async () => {
        button(host, "Load latest").click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(unhandled).toEqual([]);

      await act(async () => {
        button(host, "Load latest").click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.textContent).toContain("Latest post could not be loaded.");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("keeps an expected submit abort silent and reports a later network failure", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    transport.authedActionJson
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(new TypeError("network failed"));

    await act(async () => {
      root?.render(createElement(SocialComposer, {
        post: POST,
        draftScope: "account-a",
        onSaved: vi.fn(),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      button(host, "Edit post").click();
    });
    await act(async () => {
      button(host, "Save").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("The operation was aborted.");
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      button(host, "Save").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("network failed");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
