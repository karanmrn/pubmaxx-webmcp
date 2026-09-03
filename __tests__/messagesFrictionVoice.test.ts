// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: { user: { id: "user-1" }, handle: "alice", accountRevision: 1 },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Continue with email"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: () => Promise.reject(new Error("network")),
}));
vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: () => () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));

import MessageThread from "@/components/messages/MessageThread";

// Messages friction fence. Both message surfaces are behind sign-in, so a
// keyless run can never paint the thread's loading or failure frame — this
// reads their SOURCE instead, the way the map's loading fence does.
//
// Three rules are pinned here:
//   1. The loading line is a dry aside and both panes carry the SAME one; the
//      inbox and thread sit side by side, so a split would read as a jump.
//   2. A thread that will not open is a failure the reader has to act on, so
//      it gets the plain sentence and two exits (docs/VOICE.md: no joke beside
//      an error), and it is a state of its own — never the loading line
//      standing in for a load that already stopped.
//   3. The inbox tells a failed load apart from a genuinely empty one. A
//      non-ok or thrown request never reaches the warm empty card: with
//      nothing loaded it shows the failure alone, and over a list that did
//      load it reports beside that list rather than erasing it. Both carry
//      the same retry, which stays focusable while it works.

const THREAD = "components/messages/MessageThread.tsx";
const INBOX = "app/messages/MessagesInboxClient.tsx";
const LOADING_LINE = "With you in a sec.";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

// The text nodes of the unreachable branch — what a reader actually reads,
// with attributes and the retry handler left out of it.
const failureCopy = (): string => {
  const source = read(THREAD);
  const block = source.slice(
    source.indexOf('state === "unreachable"'),
    source.indexOf('<div className="messageThread">'),
  );
  return (block.match(/>[^<>{}]+</g) ?? [])
    .map((node) => node.slice(1, -1).trim())
    .filter(Boolean)
    .join("\n");
};

describe("messages friction voice", () => {
  it("both panes carry the same loading line", () => {
    expect(read(INBOX)).toContain(LOADING_LINE);
    expect(read(THREAD)).toContain(LOADING_LINE);
  });

  it("renders an unreachable thread as its own state, not the loading line", async () => {
    await act(async () => {
      root.render(createElement(MessageThread, { conversationId: "conversation-1" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector(".threadFailure")).not.toBeNull();
    expect(host.textContent).toContain(
      "This conversation won’t open right now. Your messages are safe.",
    );
    expect(host.textContent).not.toContain(LOADING_LINE);
  });

  it("the failure frame states the fact and hands over two exits", () => {
    const visible = failureCopy();
    expect(visible).toContain(
      "This conversation won&rsquo;t open right now. Your messages are safe.",
    );
    expect(visible).toContain("Try again");
    expect(visible).toContain("Back to inbox");
    expect(read(THREAD)).toContain('<Link href="/messages">Back to inbox</Link>');
  });

  it("the failure frame leaks no plumbing and cracks no joke", () => {
    const visible = failureCopy();
    for (const leak of ["fetch", "status", "500", "AbortError", "network", "error", "—", "!"]) {
      expect(visible.includes(leak), `"${leak}" leaked into the failure frame`).toBe(false);
    }
  });

  it("a failed inbox request renders failure, never genuine emptiness", () => {
    const source = read(INBOX);
    const failedAt = source.indexOf("if (!res.ok)");
    const failedResponse = source.slice(failedAt, source.indexOf("return;", failedAt));
    expect(failedResponse).toContain("setNeedsSignIn(false)");
    expect(failedResponse).toContain("setFailed(true)");

    const catchAt = source.indexOf("} catch (err)");
    const thrownResponse = source.slice(catchAt, source.indexOf("} finally", catchAt));
    expect(thrownResponse).toContain("setNeedsSignIn(false)");
    expect(thrownResponse).toContain("setFailed(true)");

    // Nothing on screen and a failed request: the failure surface stands alone,
    // and it is checked BEFORE the warm empty card, which docs/VOICE.md keeps
    // out of sight of an error the reader has to act on.
    const failureCondition = "failed && conversations.length === 0 ? (";
    const failureAt = source.indexOf(failureCondition);
    const emptyAt = source.indexOf(
      "conversations.length === 0 ? (",
      failureAt + failureCondition.length,
    );
    const noticeAt = source.indexOf("{failed ? (");
    expect(failureAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failureAt);
    expect(noticeAt).toBeGreaterThan(emptyAt);

    const failureFrame = source.slice(failureAt, emptyAt);
    expect(failureFrame).toContain("Couldn&rsquo;t load your conversations.");
    expect(failureFrame).toContain("retryButton");
    expect(failureFrame).not.toContain("Nobody in here yet.");
    expect(source).toContain('className="threadRetryBtn"');
    expect(source).toContain("Try again");

    // The warm empty card only speaks for an inbox we know is empty.
    const emptyFrame = source.slice(emptyAt, noticeAt);
    expect(emptyFrame).toContain("Nobody in here yet.");
    expect(emptyFrame).not.toContain("failed");
  });

  it("a failed refresh over a loaded list keeps the list and reports beside it", () => {
    const source = read(INBOX);

    // The quiet notice sits above the list it describes, and only ever there:
    // it claims what loaded last, so it never renders where nothing loaded.
    const noticeAt = source.indexOf("{failed ? (");
    const notice = source.slice(noticeAt, source.indexOf('<ul className="conversationList">'));
    const visible = (notice.match(/>[^<>{}]+</g) ?? [])
      .map((node) => node.slice(1, -1).trim())
      .filter(Boolean)
      .join("\n");
    expect(visible).toContain("Couldn&rsquo;t refresh this list. It shows what loaded last.");
    expect(visible).not.toContain("Nobody in here yet.");
    const leaks = ["fetch", "status", "500", "AbortError", "network", "error", "sorry", "—", "!"];
    for (const leak of leaks) {
      expect(visible.includes(leak), `"${leak}" leaked into the stale notice`).toBe(false);
    }

    // A tap reads as doing something: the failure stands until the retried
    // request resolves, and the list underneath is never cleared.
    const retryAt = source.indexOf("const retry = useCallback(");
    const retry = source.slice(retryAt, source.indexOf("}, [refresh]);", retryAt));
    expect(retryAt).toBeGreaterThan(-1);
    expect(retry).toContain("setRetrying(true)");
    expect(retry).not.toContain("setFailed(false)");
    expect(retry).not.toContain("setLoaded(false)");
    expect(retry).not.toContain("setConversations(");
    expect(source).toContain('{retrying ? "Trying again" : "Try again"}');
  });

  it("the retry stays focusable while it works, and guards the double tap itself", () => {
    const source = read(INBOX);
    const buttonAt = source.indexOf("const retryButton = (");
    const button = source.slice(buttonAt, source.indexOf("</button>", buttonAt));
    expect(buttonAt).toBeGreaterThan(-1);
    // Disabling the control under the reader who just pressed it blurs it, so
    // busy is announced, never enforced by taking the element away.
    expect(button).not.toContain("disabled");
    expect(button).toContain("aria-busy={retrying || undefined}");

    // The double submit is stopped in the handler instead, on a ref so a second
    // tap in the same render cannot slip past a not-yet-committed state.
    const retryAt = source.indexOf("const retry = useCallback(");
    const retry = source.slice(retryAt, source.indexOf("}, [refresh]);", retryAt));
    expect(retry).toContain("if (retryingRef.current) return;");
    expect(retry).toContain("retryingRef.current = true;");
    expect(retry).toContain("retryingRef.current = false;");
  });

  it("both surfaces stay em-dash free in the copy they show", () => {
    for (const file of [THREAD, INBOX]) {
      const literals = read(file).match(/"[^"\n]*"/g) ?? [];
      for (const literal of literals) {
        expect(literal.includes("—"), `em dash in ${file} literal ${literal}`).toBe(false);
      }
    }
  });
});
