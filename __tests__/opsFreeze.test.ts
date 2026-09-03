import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// Route modules run assertServerEnv() at import scope (the house pattern). On
// Vercel vitest reads as production without test-scoped Supabase vars, so the
// import would throw — mock it to a no-op, exactly like every sibling route
// test. The supabase seam is pinned so the pint-drops `report` path (the
// reporting-stays-open case) selects the memory store instead of 503-ing.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import {
  readSocialFreeze,
  socialFreezeResponse,
  SOCIAL_FREEZE_ENV,
  SOCIAL_FROZEN_CODE,
} from "@/lib/opsFreeze";

import { POST as checkInsPost } from "@/app/api/check-ins/route";
import { POST as pintDropPost } from "@/app/api/pint-drops/route";
import { POST as commentsPost } from "@/app/api/pint-drops/comments/route";
import { POST as reactionsPost } from "@/app/api/pint-drops/reactions/route";
import { POST as messagesPost } from "@/app/api/messages/route";
import { POST as messageThreadPost } from "@/app/api/messages/[id]/route";
import { POST as followPost } from "@/app/api/profiles/[handle]/follow/route";
import { POST as storyCreatePost } from "@/app/api/night-stories/route";
import { POST as storyMomentPost } from "@/app/api/night-stories/[id]/moments/route";
import { POST as memoryMomentPost } from "@/app/api/night-memories/[id]/moments/route";
import { POST as publishProposalPost } from "@/app/api/night-stories/[id]/publish-proposals/route";
import { POST as publishConfirmPost } from "@/app/api/night-stories/[id]/publish-confirmations/route";

const ROOT = process.cwd();

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function freezeOn(): void {
  vi.stubEnv(SOCIAL_FREEZE_ENV, "social");
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The pure seam
// ─────────────────────────────────────────────────────────────────────────────
describe("readSocialFreeze (pure seam)", () => {
  it("is off when the var is unset", () => {
    expect(readSocialFreeze({})).toEqual({ frozen: false, scope: "off" });
  });

  it("freezes only on the exact `social` value", () => {
    expect(readSocialFreeze({ [SOCIAL_FREEZE_ENV]: "social" })).toEqual({
      frozen: true,
      scope: "social",
    });
  });

  it("is case- and whitespace-insensitive", () => {
    expect(readSocialFreeze({ [SOCIAL_FREEZE_ENV]: "  SOCIAL  " }).frozen).toBe(true);
  });

  it("fails safe to off on `off`, empty, or an unknown value", () => {
    for (const value of ["off", "", "   ", "everything", "true", "1"]) {
      expect(readSocialFreeze({ [SOCIAL_FREEZE_ENV]: value }).frozen).toBe(false);
    }
  });

  it("reads the live process env when no env is passed", () => {
    freezeOn();
    expect(readSocialFreeze().frozen).toBe(true);
  });
});

describe("socialFreezeResponse (guard)", () => {
  it("returns null when not frozen so writes proceed", () => {
    expect(socialFreezeResponse({})).toBeNull();
  });

  it("returns a 503, retryable, house-voice error when frozen", async () => {
    const res = socialFreezeResponse({ [SOCIAL_FREEZE_ENV]: "social" });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await json(res!);
    expect(body.code).toBe(SOCIAL_FROZEN_CODE);
    expect(body.retryable).toBe(true);
    expect(typeof body.error).toBe("string");
    // Taste doctrine: value first (reading), no em dash, no fake counts.
    expect(body.error as string).toMatch(/reading stays open/i);
    expect(body.error as string).not.toContain("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. One frozen POST per guarded family
// ─────────────────────────────────────────────────────────────────────────────
async function expectFrozen(res: Response): Promise<void> {
  expect(res.status).toBe(503);
  const body = await json(res);
  expect(body.code).toBe(SOCIAL_FROZEN_CODE);
  expect(body.retryable).toBe(true);
}

describe("frozen social writes return 503 (one per guarded family)", () => {
  it("check-ins", async () => {
    freezeOn();
    await expectFrozen(await checkInsPost(post("http://localhost/api/check-ins", { handle: "karan", areaSlug: "soho" })));
  });

  it("pint-drops create", async () => {
    freezeOn();
    await expectFrozen(await pintDropPost(post("http://localhost/api/pint-drops", { handle: "karan", venueId: "v" })));
  });

  it("pint-drops comment", async () => {
    freezeOn();
    await expectFrozen(await commentsPost(post("http://localhost/api/pint-drops/comments", { dropId: "d1", handle: "karan", body: "hi" })));
  });

  it("pint-drops reaction", async () => {
    freezeOn();
    await expectFrozen(await reactionsPost(post("http://localhost/api/pint-drops/reactions", { id: "d1", actor: "a", reaction: "cheers" })));
  });

  it("messages send", async () => {
    freezeOn();
    await expectFrozen(await messagesPost(post("http://localhost/api/messages", { action: "send", handle: "karan", other: "sam", body: "yo" })));
  });

  it("profile follows", async () => {
    freezeOn();
    await expectFrozen(await followPost(
      post("http://localhost/api/profiles/sam/follow", { follower: "karan" }),
      { params: Promise.resolve({ handle: "sam" }) },
    ));
  });

  it("night story create", async () => {
    freezeOn();
    await expectFrozen(await storyCreatePost(post("http://localhost/api/night-stories", { memoryId: "m1", title: "Big one" })));
  });

  it("night story moment (contribute)", async () => {
    freezeOn();
    await expectFrozen(await storyMomentPost(
      post("http://localhost/api/night-stories/s1/moments", { kind: "text", body: "hi" }),
      { params: Promise.resolve({ id: "s1" }) },
    ));
  });

  it("night memory moment (post)", async () => {
    freezeOn();
    await expectFrozen(await memoryMomentPost(
      post("http://localhost/api/night-memories/m1/moments", { kind: "text", caption: "hi" }),
      { params: Promise.resolve({ id: "m1" }) },
    ));
  });

  it("night story publish proposal", async () => {
    freezeOn();
    await expectFrozen(await publishProposalPost(
      post("http://localhost/api/night-stories/s1/publish-proposals", { momentIds: ["x"] }),
      { params: Promise.resolve({ id: "s1" }) },
    ));
  });

  it("night story publish confirmation", async () => {
    freezeOn();
    await expectFrozen(await publishConfirmPost(
      post("http://localhost/api/night-stories/s1/publish-confirmations", { token: "t" }),
      { params: Promise.resolve({ id: "s1" }) },
    ));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Safety and legal floors stay OPEN under a freeze
// ─────────────────────────────────────────────────────────────────────────────
describe("freeze never intercepts the safety floors", () => {
  it("reporting a pint drop is not frozen", async () => {
    freezeOn();
    const res = await pintDropPost(post("http://localhost/api/pint-drops", { action: "report", id: "unknown-drop", actor: "a" }));
    const body = await json(res);
    // It may 404 (unknown id) or otherwise, but it must NOT be the freeze wall.
    expect(body.code).not.toBe(SOCIAL_FROZEN_CODE);
    expect(res.status).not.toBe(503);
  });

  it("reporting a message is not frozen (send branch only carries the guard)", async () => {
    freezeOn();
    const res = await messageThreadPost(
      post("http://localhost/api/messages/c1", { action: "report", handle: "karan", messageId: "m1" }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    const body = await json(res);
    expect(body.code).not.toBe(SOCIAL_FROZEN_CODE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Source-reading fence: every guarded family calls the seam
//    (grep-based, like fontPartyContainment; scoped to app/api).
// ─────────────────────────────────────────────────────────────────────────────
describe("guard containment fence (source-reading)", () => {
  // The complete set of social MUTATING route files the freeze must cover.
  // Adding a social write surface without wiring the seam fails this fence.
  const GUARDED_ROUTES = [
    "app/api/check-ins/route.ts",
    "app/api/pint-drops/route.ts",
    "app/api/pint-drops/comments/route.ts",
    "app/api/pint-drops/reactions/route.ts",
    "app/api/messages/route.ts",
    "app/api/messages/[id]/route.ts",
    "app/api/profiles/[handle]/follow/route.ts",
    "app/api/night-stories/route.ts",
    "app/api/night-stories/[id]/moments/route.ts",
    "app/api/night-stories/[id]/publish-proposals/route.ts",
    "app/api/night-stories/[id]/publish-confirmations/route.ts",
    "app/api/night-memories/[id]/moments/route.ts",
  ];

  it("every guarded route imports and calls the freeze seam", () => {
    for (const route of GUARDED_ROUTES) {
      const source = readFileSync(join(ROOT, route), "utf8");
      expect(source, `${route} must import the freeze seam`).toMatch(
        /from "@\/lib\/opsFreeze"/,
      );
      expect(source, `${route} must call socialFreezeResponse()`).toMatch(
        /socialFreezeResponse\(\)/,
      );
    }
  });
});
