// @vitest-environment jsdom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {} as {
    user: { id: string } | null;
    handle: string | null;
    accountRevision: number;
  },
}));
const viewerState = vi.hoisted(() => ({
  current: {} as {
    phase: "unresolved" | "signed-in" | "signed-out";
    signedIn: boolean;
    signedOut: boolean;
    unresolved: boolean;
  },
}));
const fetchState = vi.hoisted(() => ({
  pending: false,
  requests: [] as Array<{
    url: string;
    resolve: (response: Response) => void;
  }>,
  response: null as (() => Response) | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => viewerState.current,
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Continue with email"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (input: string) => {
    if (fetchState.pending) {
      return new Promise<Response>((resolve) => {
        fetchState.requests.push({ url: String(input), resolve });
      });
    }
    return Promise.resolve(
      fetchState.response?.() ?? Response.json({ conversations: [], messages: [] }),
    );
  },
}));
vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: () => () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));

import MessagesInboxClient from "@/app/messages/MessagesInboxClient";
import MessageThread from "@/components/messages/MessageThread";

let host: HTMLDivElement;
let root: Root;

function signedOut(): void {
  authState.current = { user: null, handle: null, accountRevision: 0 };
  viewerState.current = {
    phase: "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  };
}

function signedIn(
  userId = "user-1",
  handle = "alice",
  accountRevision = 1,
): void {
  authState.current = { user: { id: userId }, handle, accountRevision };
  viewerState.current = {
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  };
}

async function render(element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function releaseFetch(
  response?: Response,
  urlPart?: string,
  latest = false,
): Promise<void> {
  const candidates = fetchState.requests
    .map((request, index) => ({ request, index }))
    .filter(({ request }) => !urlPart || request.url.includes(urlPart));
  const candidate = latest
    ? candidates[candidates.length - 1]
    : candidates[0];
  if (!candidate) return;
  fetchState.requests.splice(candidate.index, 1);
  if (fetchState.requests.length === 0) fetchState.pending = false;
  await act(async () => {
    candidate.request.resolve(
      response ?? Response.json({ conversations: [], messages: [] }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  signedOut();
  fetchState.pending = false;
  fetchState.requests = [];
  fetchState.response = null;
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  while (fetchState.requests.length > 0) await releaseFetch();
  await act(async () => root.unmount());
  host.remove();
});

describe("message sign-in doors", () => {
  it("ignores an old anonymous inbox result once the session is signed in", async () => {
    await render(createElement(MessagesInboxClient));
    expect(host.textContent).toContain("Sign in to message");

    fetchState.pending = true;
    signedIn();
    await render(createElement(MessagesInboxClient));

    expect(host.textContent).not.toContain("Sign in to message");
    await releaseFetch();
  });

  it("keeps a stale thread result neutral until a new session read returns", async () => {
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));
    expect(host.textContent).toContain("Sign in to read and send messages");

    fetchState.pending = true;
    signedIn();
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));

    expect(host.textContent).not.toContain("Sign in to read and send messages");
    expect(host.textContent).toContain("With you in a sec.");
  });

  it("hides account A inbox content while account B is still loading", async () => {
    signedIn("account-a", "alice", 1);
    fetchState.response = () =>
      Response.json({
        conversations: [
          {
            id: "conversation-a",
            otherHandle: "bridget",
            lastBody: "Account A private note",
            lastAt: "2026-09-01T10:00:00.000Z",
            lastFromMe: false,
            unread: 0,
          },
        ],
      });
    await render(createElement(MessagesInboxClient));
    expect(host.textContent).toContain("Account A private note");

    fetchState.pending = true;
    signedIn("account-b", "bob", 2);
    await render(createElement(MessagesInboxClient));

    expect(host.textContent).not.toContain("Account A private note");
    expect(host.textContent).not.toContain("@bridget");
    expect(host.textContent).toContain("With you in a sec.");
    await releaseFetch(Response.json({ conversations: [] }));
  });

  it("hides account A thread content while account B is still loading", async () => {
    signedIn("account-a", "alice", 1);
    fetchState.response = () =>
      Response.json({
        messages: [
          {
            id: "message-a",
            conversationId: "conversation-1",
            senderHandle: "bridget",
            body: "Account A private note",
            createdAt: "2026-09-01T10:00:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      });
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));
    expect(host.textContent).toContain("Account A private note");

    fetchState.pending = true;
    signedIn("account-b", "bob", 2);
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));

    expect(host.textContent).not.toContain("Account A private note");
    expect(host.textContent).toContain("With you in a sec.");
    await releaseFetch(Response.json({ messages: [] }));
  });

  it("keeps the newest conversation read after A to B to A responses race", async () => {
    signedIn("account-a", "alice", 1);
    fetchState.response = () =>
      Response.json({
        messages: [
          {
            id: "message-initial-a",
            conversationId: "conversation-a",
            senderHandle: "bridget",
            body: "Initial A",
            createdAt: "2026-09-01T10:00:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      });
    await render(createElement(MessageThread, { conversationId: "conversation-a" }));
    expect(host.textContent).toContain("Initial A");

    fetchState.pending = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await render(createElement(MessageThread, { conversationId: "conversation-b" }));
    await render(createElement(MessageThread, { conversationId: "conversation-a" }));

    await releaseFetch(
      Response.json({
        messages: [
          {
            id: "message-new-a",
            conversationId: "conversation-a",
            senderHandle: "bridget",
            body: "Newest A",
            createdAt: "2026-09-01T10:02:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      }),
      "conversation-a",
      true,
    );
    expect(host.textContent).toContain("Newest A");

    await releaseFetch(
      Response.json({
        messages: [
          {
            id: "message-b",
            conversationId: "conversation-b",
            senderHandle: "charlie",
            body: "B content",
            createdAt: "2026-09-01T10:01:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      }),
      "conversation-b",
    );
    await releaseFetch(
      Response.json({
        messages: [
          {
            id: "message-old-a",
            conversationId: "conversation-a",
            senderHandle: "bridget",
            body: "Old A",
            createdAt: "2026-09-01T09:59:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      }),
      "conversation-a",
    );

    expect(host.textContent).toContain("Newest A");
    expect(host.textContent).not.toContain("Old A");
    expect(host.textContent).not.toContain("B content");
  });
});
