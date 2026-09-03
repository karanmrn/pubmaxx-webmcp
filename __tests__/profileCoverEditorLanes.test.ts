// @vitest-environment jsdom

// The cover editor's THREE remove lanes, mounted.
//
// `profileCoverRemoveLane` is pinned as a pure function in profileCovers.test.ts;
// what this file proves is that the editor asks it and then does what it says.
//
// 1. MIRROR. An owner holding a legacy `profiles.cover_*` cover with no
//    `profile_cover_photos` rows is the whole reason `heldCoverUrls` is threaded
//    down from ProfileEditor, and the single-slot DELETE is the only thing that
//    clears that owner's backdrop.
// 2. ROTATION. Rows exist, so each one is removed by id.
// 3. UNAVAILABLE. "The rotation is empty" and "we could not read the rotation"
//    are two findings. An owner holding a back-compat cover under a failed read
//    saw nothing at all: the mirror card is withheld (the read did not answer,
//    so the editor may not claim that one photo is the whole rotation), the list
//    is empty, and the empty sentence was suppressed by the held cover.
//
// Only a real mount reaches any of it, because each takes an effect and an
// answered read, which is why this file runs in jsdom while the rest of the
// cover coverage renders to a string.

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement("img", { src, alt }),
}));

// The editor reads and writes through `authedActionFetch`, which refuses
// outright with no live session and never reaches the network. Standing in for
// it here is what makes each case ONE deterministic answer, and recording every
// call is how a remove's own LANE is observed: which URL it went to.
const wire = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string }>,
  next: async (): Promise<Response> => new Response("{}"),
}));

vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: (url: string, init?: RequestInit) => {
    wire.calls.push({ url, method: String(init?.method ?? "GET").toUpperCase() });
    return wire.next();
  },
}));

import ProfileCoverPhotosEditor from "@/components/profile/ProfileCoverPhotosEditor";
import {
  PROFILE_COVER_REMOVE_ALL_LABEL,
  profileCoverEmptyLine,
} from "@/lib/profileCovers";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const DEGRADED_LINE = profileCoverEmptyLine("degraded");
const EMPTY_LINE = profileCoverEmptyLine("ready");
const HELD_COVER = "/api/cover/p1/g1";

let container: HTMLDivElement;
let root: Root | null = null;

/** Mount WITHOUT settling, so the rotation read is still in flight. */
async function mountUnsettled(heldCoverUrls: string[]): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(ProfileCoverPhotosEditor, {
        handle: "alice",
        heldCoverUrls,
        onProfileChanged: () => {},
      }),
    );
  });
}

async function mount(heldCoverUrls: string[]): Promise<void> {
  await mountUnsettled(heldCoverUrls);
  // The load effect awaits a microtask, then the read, then the reader's own
  // chain, and a transient answer would also wait out a 50ms backoff. Give it
  // real elapsed turns rather than a fixed count of microtasks.
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

beforeEach(() => {
  clearSurfaceCache();
  wire.calls.length = 0;
  wire.next = async () => new Response("{}");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
  clearSurfaceCache();
});

describe("a cover read that could not answer says so", () => {
  it("prints the degraded sentence even while the profile holds a cover", async () => {
    // 403 rather than 5xx: a refusal the reader treats as final.
    wire.next = async () => new Response("{}", { status: 403 });

    await mount([HELD_COVER]);

    // THE DEFECT: `hasCover` was true, so the only sentence in the section was
    // suppressed and the owner was shown an empty-looking field with no reason.
    expect(container.textContent).toContain(DEGRADED_LINE);
    expect(container.textContent).not.toContain(EMPTY_LINE);
  });

  it("still prints it for an owner holding nothing at all", async () => {
    wire.next = async () => new Response("{}", { status: 403 });

    await mount([]);

    expect(container.textContent).toContain(DEGRADED_LINE);
  });

  it("says the field is empty, not broken, once the read answers with no covers", async () => {
    wire.next = async () => Response.json({ status: "ready", covers: [] });

    await mount([]);

    expect(container.textContent).toContain(EMPTY_LINE);
    expect(container.textContent).not.toContain(DEGRADED_LINE);
  });

  it("says neither sentence once the read answers with a rotation", async () => {
    wire.next = async () =>
      Response.json({
        status: "ready",
        covers: [{ id: "c1", position: 1, url: "/api/cover/p1/g2" }],
      });

    await mount([]);

    expect(container.textContent).not.toContain(EMPTY_LINE);
    expect(container.textContent).not.toContain(DEGRADED_LINE);
  });
});

/** The field-level control, by its own label. */
function removeCoverButton(): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === PROFILE_COVER_REMOVE_ALL_LABEL,
    ) ?? null
  );
}

async function clickRemoveCover(): Promise<void> {
  const button = removeCoverButton();
  expect(button, `"${PROFILE_COVER_REMOVE_ALL_LABEL}" must be offered`).not.toBeNull();
  await act(async () => {
    button!.click();
  });
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("a remove goes to the lane the rotation is actually in", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows an owner's back-compat cover and clears it through the single-slot route", async () => {
    // The mirror lane: a legacy `profiles.cover_*` cover, no rotation rows. It is
    // the lane this whole editor change exists for, and the only route that can
    // clear that owner's backdrop.
    wire.next = async () => Response.json({ status: "ready", covers: [] });
    await mount([HELD_COVER]);

    const mirror = container.querySelector(".profileEditorCoverMirrorOnly");
    expect(mirror, "the held cover must be shown, not silently ignored").not.toBeNull();
    expect(mirror!.querySelector("img")?.getAttribute("src")).toBe(HELD_COVER);
    expect(container.textContent).not.toContain(EMPTY_LINE);

    wire.next = async () => Response.json({ profile: { handle: "alice" }, covers: [] });
    await clickRemoveCover();

    const writes = wire.calls.filter((call) => call.method === "DELETE");
    expect(writes).toEqual([{ url: "/api/profiles/alice/cover", method: "DELETE" }]);
    // A rotation DELETE here would clear nothing an owner can see.
    expect(writes[0]!.url).not.toContain("/covers");
  });

  it("removes every rotation row by id when the rotation is what is held", async () => {
    wire.next = async () =>
      Response.json({
        status: "ready",
        covers: [
          { id: "c1", position: 1, url: "/api/cover/p1/g1" },
          { id: "c2", position: 2, url: "/api/cover/p1/g2" },
        ],
      });
    await mount([]);

    wire.next = async () => Response.json({ profile: { handle: "alice" }, covers: [] });
    await clickRemoveCover();

    // ONE tap clears EVERY cover, so the whole DELETE set is the assertion. The
    // loop reads an `ids` SNAPSHOT rather than `covers`, which `applyReply`
    // empties on the first reply - an implementation reading the live state
    // would stop after c1 and leave the rest rotating under a receipt that said
    // they were gone.
    const writes = wire.calls.filter((call) => call.method === "DELETE").map((c) => c.url);
    expect(writes).toEqual([
      "/api/profiles/alice/covers/c1",
      "/api/profiles/alice/covers/c2",
    ]);
    expect(writes).not.toContain("/api/profiles/alice/cover");
    // Nothing is left to remove, so the control goes with the covers.
    expect(removeCoverButton()).toBeNull();
  });

  it("writes nothing at all after a read that FAILED", async () => {
    // A degraded read leaves `covers` empty, so an owner with rotation rows
    // would be classified mirror-only and the single-slot DELETE would clear
    // the mirror while every row survived - reported as a successful removal.
    wire.next = async () => new Response("{}", { status: 403 });
    await mount([HELD_COVER]);

    wire.calls.length = 0;
    await clickRemoveCover();

    expect(wire.calls.filter((call) => call.method === "DELETE")).toEqual([]);
    expect(container.textContent).toContain("nothing was removed");
  });

  it("offers no remove and no mirror card while the read is still IN FLIGHT", async () => {
    // THE DEFECT: `status` started at "ready", so the lane's guard never fired
    // during the GET. An owner with rotation rows and a mirrored cover_* saw the
    // mirror card immediately, and a tap before the read landed cleared the
    // mirror alone while all five backdrops kept rotating.
    let answer: (() => void) | null = null;
    wire.next = () =>
      new Promise<Response>((resolve) => {
        answer = () =>
          resolve(
            Response.json({
              status: "ready",
              covers: [{ id: "c1", position: 1, url: "/api/cover/p1/g9" }],
            }),
          );
      });

    await mountUnsettled([HELD_COVER]);

    expect(container.querySelector(".profileEditorCoverMirrorOnly")).toBeNull();
    expect(removeCoverButton(), "no lane is known yet, so none is offered").toBeNull();
    // And no premature claim about the rotation either way.
    expect(container.textContent).not.toContain(EMPTY_LINE);
    expect(container.textContent).not.toContain(DEGRADED_LINE);
    expect(wire.calls.filter((call) => call.method === "DELETE")).toEqual([]);

    // The read lands: it was a ROTATION all along, never a mirror.
    expect(answer, "the read must still be in flight").not.toBeNull();
    await act(async () => {
      answer!();
    });
    for (let turn = 0; turn < 6; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(container.querySelector(".profileEditorCoverMirrorOnly")).toBeNull();
    wire.next = async () => Response.json({ profile: { handle: "alice" }, covers: [] });
    await clickRemoveCover();
    expect(
      wire.calls.filter((call) => call.method === "DELETE").map((call) => call.url),
    ).toEqual(["/api/profiles/alice/covers/c1"]);
  });
});
