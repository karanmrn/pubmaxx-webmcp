import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000011";
const basePost = {
  id: POST_ID, kind: "standard", visibility: "friends", body: "Original night",
  area: "camden", venueId: "venue-a", venueName: "The Proof Arms", venueProjected: true, hashtags: ["camden"],
  commentPolicy: "open", photo: { mediaId: "22222222-2222-4222-8222-222222222222", altText: "Friends outside" },
  moderationState: "approved", featureRequest: null, revision: 1, editedAt: null,
  mutationVersion: 1,
  createdAt: "2026-08-05T18:00:00.000Z", updatedAt: "2026-08-05T18:00:00.000Z",
  author: { handle: "old-alice" }, ownedByViewer: true,
};

async function seedSocialSession(page: Page): Promise<void> {
  await page.context().addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: `pubmaxx-e2e-access-token-${userId}`,
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "social-composer@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID });
  await page.context().route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ handle: "alice-renamed" }),
    });
  });
  await page.context().route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.context().route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        complete: true,
        handle: "alice-renamed",
        dateOfBirth: "1995-03-21",
      }),
    });
  });
}

async function mockVerified(page: Page) {
  await page.route("**/api/social/access", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: "verified", viewerHandle: "alice-renamed", draftScope: "a".repeat(43) }) }));
  await page.route("**/api/social/interactions?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }));
  await page.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [{ id: "held-1", moderationState: "needs_review", revision: 1, createdAt: "2026-08-05T19:00:00.000Z" }] }) }));
  await page.route("**/api/social/venues?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ venues: [{ id: "venue-a", name: "The Proof Arms", borough: "Camden" }] }) }));
  await page.route("**/api/social/media/**", (route) => route.fulfill({ status: 404, body: "" }));
}

test.beforeEach(async ({ page }) => {
  await seedSocialSession(page);
  await page.addInitScript(() => { localStorage.setItem("pubmax-tour-v1-done", "1"); sessionStorage.setItem("pubmax_onboarding_dismissed", "1"); });
});

test("verified composer preserves failed photo draft, records consent choices, and recovers stale edit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockVerified(page);
  let currentPost = { ...basePost };
  let createAttempts = 0;
  const createKeys: string[] = [];
  let editAttempts = 0;
  const editPayloads: Array<Record<string, unknown>> = [];
  const tagActions: Array<Record<string, unknown>> = [];
  await page.route("**/api/social/tags**", async (route) => {
    if (route.request().method() === "GET") {
      const approvedLane = new URL(route.request().url()).searchParams.get("lane") === "approved";
      const approved = tagActions.some((action) => action.action === "approve") && !tagActions.some((action) => action.action === "withdraw");
      const proposals = approvedLane === approved ? [{
        id: "tag-1", postId: POST_ID, mediaId: basePost.photo!.mediaId, authorHandle: "bob",
        state: approved ? "approved" : "proposed", visibility: "friends",
        body: "POST BODY MUST STAY PRIVATE",
        photoAltText: "Friends outside", reviewRevision: 4, audienceAtApproval: null,
        createdAt: "2026-08-05T19:00:00.000Z",
      }] : [];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals, nextCursor: null }) });
    }
    tagActions.push(await route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [currentPost], nextCursor: null }) }));
  await page.route(`**/api/social/posts/${POST_ID}`, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ post: {
      ...currentPost,
      body: "Changed in another tab",
      visibility: "private",
      commentPolicy: "locked",
      mutationVersion: 2,
    } }) });
    editAttempts += 1;
    editPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    if (editAttempts === 1) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "EDIT_CONFLICT", error: "Conflict" }) });
    currentPost = editAttempts === 2
      ? { ...currentPost, body: "Changed in another tab", visibility: "private", commentPolicy: "locked", mutationVersion: 3 }
      : { ...currentPost, revision: 2, mutationVersion: 4, editedAt: "2026-08-05T20:01:00.000Z", photo: null };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ post: currentPost, audit: { fromMutationVersion: 2, toMutationVersion: 3 } }) });
  });
  await page.route("**/api/social/posts", async (route) => {
    createAttempts += 1;
    createKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (createAttempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Moderation unavailable" }) });
    if (createAttempts === 2) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "IDEMPOTENCY_CONFLICT", error: "Request key conflict" }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post: { ...currentPost, id: "created-1", moderationState: "pending" } }) });
  });

  await page.goto("/social");
  await expect(page.getByText("Held for review")).toBeVisible();
  const tagReview = page.getByRole("region", { name: "Tags to review" });
  await expect(tagReview.getByRole("img", { name: "Friends outside" })).toBeVisible();
  await expect(tagReview.getByText("Friends audience", { exact: true })).toBeVisible();
  await expect(page.getByText("POST BODY MUST STAY PRIVATE", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await page.getByRole("button", { name: "Withdraw" }).click();
  expect(tagActions).toEqual([
    { proposalId: "tag-1", action: "approve", expectedAudienceRevision: 4 },
    { proposalId: "tag-1", action: "withdraw" },
  ]);

  await page.getByRole("button", { name: "New post" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Write post", exact: true })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Photo draft survives reload");
  const venueCombobox = dialog.getByRole("combobox", { name: "Venue - Friends only" });
  await venueCombobox.fill("Proof");
  await expect(venueCombobox).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("listbox", { name: "Venue results" })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("1 Venue found");
  await venueCombobox.press("ArrowDown");
  await venueCombobox.press("Enter");
  await expect(dialog.getByLabel("Selected Venue")).toContainText("The Proof Arms");
  await dialog.getByLabel("Post type").selectOption("feature_request");
  await dialog.getByLabel("Add photo", { exact: true }).setInputFiles({ name: "proof.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(dialog.getByRole("img", { name: "Selected photo preview" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove selected photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await dialog.getByLabel("Photo description").fill("Friends outside The Proof Arms");
  await dialog.getByLabel("Photo tags", { exact: true }).fill("bob");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Moderation unavailable");
  await expect(dialog.getByRole("alert")).toBeFocused();
  expect((await dialog.getByRole("alert").boundingBox())?.y).toBeLessThan(220);
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: "New post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("Photo draft survives reload");
  await expect(dialog.getByLabel("Photo description")).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside The Proof Arms");
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Photo draft changed after failure");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your draft is still here");
  await expect(dialog.getByRole("button", { name: "Load latest" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("Photo draft changed after failure");
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside The Proof Arms");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(createKeys).toHaveLength(3);
  expect(createKeys[0]).toBe(createKeys[1]);
  expect(createKeys[2]).not.toBe(createKeys[1]);

  await page.getByRole("button", { name: "New post" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Text-only post");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(createAttempts).toBe(4);
  expect(createKeys[3]).not.toBe(createKeys[2]);

  await page.getByRole("button", { name: "Edit post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Selected Venue")).toContainText("The Proof Arms");
  await expect(dialog.getByRole("button", { name: "Remove venue" })).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside");
  await dialog.getByLabel("Add photo", { exact: true }).setInputFiles({ name: "replacement.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(dialog.getByRole("img", { name: "Selected photo preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove selected photo" }).click();
  await expect(dialog.getByRole("img", { name: "Friends outside" })).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside");
  await dialog.getByLabel("Photo description").fill("Corrected friends outside");
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Edited draft survives");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Post changed. Your draft is still here.");
  await expect(dialog.getByRole("alert")).toBeFocused();
  expect((await dialog.getByRole("button", { name: "Load latest" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole("button", { name: "Load latest" }).click();
  await expect(dialog.getByText("Latest post loaded. Review it before saving.")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("Changed in another tab");
  await expect(dialog.getByLabel("Visibility")).toHaveValue("private");
  await expect(dialog.getByLabel("Comments")).toHaveValue("locked");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Changed in another tab")).toBeVisible();
  expect(editPayloads[1]).toMatchObject({ expectedMutationVersion: 2, body: "Changed in another tab", visibility: "private", commentPolicy: "locked" });
  await page.getByRole("button", { name: "Edit post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("Changed in another tab");
  await expect(dialog.getByLabel("Selected Venue")).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside");
  await dialog.getByRole("button", { name: "Remove photo" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Edit post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Photo description")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit post" })).toBeFocused();
});

test("account-bound drafts isolate text and photo while two tabs warn", async ({ context, page }) => {
  let scope = "a".repeat(43);
  await context.route("**/api/social/access", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: "verified", viewerHandle: "alice", draftScope: scope }) }));
  await context.route("**/api/social/interactions?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }));
  await context.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
  await context.route("**/api/social/tags**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
  await context.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));
  await page.goto("/social"); await page.getByRole("button", { name: "New post" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Alice private draft");
  await dialog.getByLabel("Add photo", { exact: true }).setInputFiles({ name: "alice.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await dialog.getByLabel("Photo description").fill("Alice photo");
  await page.waitForTimeout(400);
  const second = await context.newPage(); await second.goto("/social"); await second.getByRole("button", { name: "New post" }).click();
  await expect(second.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("Alice private draft");
  await expect(second.getByLabel("Photo description")).toHaveValue("Alice photo");
  await expect(page.getByText("This draft is open in another tab.")).toBeVisible();
  await expect(second.getByText("This draft is open in another tab.")).toBeVisible();
  await second.getByRole("button", { name: "Remove selected photo" }).click();
  await expect(second.getByLabel("Photo description")).toHaveCount(0);
  await second.getByRole("button", { name: "Clear draft" }).click();
  await expect(second.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("");
  await second.reload(); await second.getByRole("button", { name: "New post" }).click();
  await expect(second.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("");
  await expect(second.getByLabel("Photo description")).toHaveCount(0);
  scope = "b".repeat(43); await second.reload(); await second.getByRole("button", { name: "New post" }).click();
  dialog = second.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Photo description")).toHaveCount(0);
});

test("private visibility and comment policy survive create, owner outbox, and edit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockVerified(page);
  const privatePost = {
    ...basePost,
    id: "33333333-3333-4333-8333-333333333333",
    visibility: "private",
    commentPolicy: "locked",
    body: "Private plan",
    venueId: null,
    venueName: null,
    venueProjected: false,
    photo: null,
    moderationState: "pending",
    revision: 0,
  };
  const createPayloads: Array<Record<string, unknown>> = [];
  const editPayloads: Array<Record<string, unknown>> = [];
  let outboxPosts: typeof privatePost[] = [];
  await page.route("**/api/social/tags**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
  await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));
  await page.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: outboxPosts }) }));
  await page.route("**/api/social/posts", async (route) => {
    createPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    outboxPosts = [privatePost];
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post: privatePost }) });
  });
  await page.route(`**/api/social/posts/${privatePost.id}`, async (route) => {
    editPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ post: { ...privatePost, body: "Private plan updated", revision: 1 } }) });
  });

  await page.goto("/social");
  await page.getByRole("button", { name: "New post" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Private plan");
  await dialog.getByLabel("Visibility").selectOption("private");
  await dialog.getByLabel("Comments").selectOption("locked");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Outbox" })).toBeVisible();
  await expect(page.getByText("Moderation pending")).toBeVisible();
  await expect(page.getByText("Private plan", { exact: true })).toBeVisible();
  expect(createPayloads[0]).toMatchObject({ visibility: "private", commentPolicy: "locked" });

  await page.getByRole("button", { name: "Edit private post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Visibility")).toHaveValue("private");
  await expect(dialog.getByLabel("Comments")).toHaveValue("locked");
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("Private plan updated");
  await dialog.getByRole("button", { name: "Save" }).click();
  expect(editPayloads[0]).toMatchObject({ visibility: "private", commentPolicy: "locked" });

  await page.getByRole("button", { name: "New post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Visibility").locator("option")).toHaveText(["Private", "Friends", "Public"]);
  await expect(dialog.getByLabel("Comments").locator("option")).toHaveText(["Open", "Friends", "Locked"]);
});

test("owner outbox pages older posts without duplicates and labels approved visibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockVerified(page);
  await page.route("**/api/social/tags**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [], nextCursor: null }) }));
  await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));

  const friendsPost = { ...basePost, id: "77777777-7777-4777-8777-777777777777", body: "Friends first page", visibility: "friends" };
  const publicPost = { ...basePost, id: "88888888-8888-4888-8888-888888888888", body: "Public second page", visibility: "public", createdAt: "2026-08-05T17:00:00.000Z" };
  const privatePost = { ...basePost, id: "99999999-9999-4999-8999-999999999999", body: "Private older post", visibility: "private", createdAt: "2026-08-05T16:00:00.000Z" };
  let pageTwoAttempts = 0;
  await page.route("**/api/social/outbox**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [friendsPost], nextCursor: "page-2" }) });
    }
    pageTwoAttempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (pageTwoAttempts === 1) {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [friendsPost, publicPost, privatePost], nextCursor: null }) });
  });

  await page.goto("/social");
  const outbox = page.getByRole("region", { name: "Outbox" });
  await expect(outbox.getByText("Friends", { exact: true })).toBeVisible();
  const loadMore = outbox.getByRole("button", { name: "Load more" });
  expect((await loadMore.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  if (process.env.PW_SOCIAL_COMPOSER_PROOF === "1") {
    await page.waitForTimeout(1_000);
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.cancel()));
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const directory = join(process.cwd(), "docs/proof/social-composer");
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ animations: "disabled", fullPage: false });
    await page.screenshot({
      path: join(directory, "390-light-outbox-load-more-final.png"),
      animations: "disabled",
      fullPage: false,
    });
  }
  await loadMore.click();
  await expect(loadMore).toHaveAttribute("aria-busy", "true");
  await expect(outbox.getByRole("alert")).toHaveText("Older posts are unavailable right now.");
  await loadMore.click();
  await expect(outbox.getByText("Public", { exact: true })).toBeVisible();
  await expect(outbox.getByText("Private", { exact: true })).toBeVisible();
  await expect(outbox.getByText("Friends first page", { exact: true })).toHaveCount(1);
  await expect(outbox.getByText("Private older post", { exact: true })).toBeVisible();
  if (process.env.PW_SOCIAL_COMPOSER_PROOF === "1") {
    // Force Chromium to rebuild its mobile compositor surface after the outbox
    // grows. Without the resize, a screenshot can retain clipped tiles from the
    // shorter first-page frame even after layout and animations have settled.
    await page.setViewportSize({ width: 391, height: 844 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.cancel()));
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const directory = join(process.cwd(), "docs/proof/social-composer");
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ animations: "disabled", fullPage: false });
    await page.screenshot({
      path: join(directory, "390-light-outbox-pagination-final.png"),
      animations: "disabled",
      fullPage: false,
    });
  }
  await outbox.getByRole("button", { name: "Edit private post" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Write post", exact: true })).toHaveValue("Private older post");
});

test("photo tag review fences audience changes and pages approved withdrawals", async ({ page }) => {
  await mockVerified(page);
  await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));
  await page.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));
  const actions: Array<Record<string, unknown>> = [];
  let reviewRevision = 1;
  const proposal = () => ({
    id: "44444444-4444-4444-8444-444444444444", postId: POST_ID,
    mediaId: basePost.photo!.mediaId, authorHandle: "bob", state: "proposed",
    visibility: reviewRevision === 1 ? "friends" : "private",
    photoAltText: "Friends outside", reviewRevision, audienceAtApproval: null,
    createdAt: "2026-08-05T19:00:00.000Z",
  });
  const approved = (id: string, handle: string) => ({
    ...proposal(), id, authorHandle: handle, state: "approved", visibility: "friends",
    audienceAtApproval: { visibility: "friends", revision: 1, shownAt: "2026-08-05T19:02:00.000Z" },
  });
  await page.route("**/api/social/tags**", async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      if (url.searchParams.get("lane") === "approved") {
        if (actions.some((action) => action.action === "withdraw")) {
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [], nextCursor: null }) });
        }
        const next = url.searchParams.get("cursor");
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(next
          ? { proposals: [{
              ...approved("66666666-6666-4666-8666-666666666666", "dee"),
              mediaId: null,
              photoAltText: null,
            }], nextCursor: null }
          : { proposals: [approved("55555555-5555-4555-8555-555555555555", "cee")], nextCursor: "approved-next" }) });
      }
      const proposals = [proposal()];
      if (actions.some((action) => action.action === "withdraw")) {
        proposals.push({
          ...approved("55555555-5555-4555-8555-555555555555", "cee"),
          state: "proposed",
          visibility: "private",
        });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals, nextCursor: null }) });
    }
    const body = await route.request().postDataJSON() as Record<string, unknown>;
    actions.push(body);
    if (body.action === "approve" && reviewRevision === 1) {
      reviewRevision = 2;
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Audience changed" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/social");
  const approvedLane = page.getByRole("region", { name: "Approved tags" });
  await approvedLane.getByRole("button", { name: "Load more" }).click();
  const detachedTag = approvedLane.getByText("@dee").locator("..");
  await expect(detachedTag).toBeVisible();
  await expect(detachedTag.getByRole("img")).toHaveCount(0);
  await detachedTag.getByRole("button", { name: "Withdraw" }).click();

  const proposedLane = page.getByRole("region", { name: "Tags to review" });
  await expect(approvedLane).toHaveCount(0);
  const returnedTag = proposedLane.getByText("@cee").locator("..");
  await expect(returnedTag.getByText("Private audience", { exact: true })).toBeVisible();
  const bobTag = proposedLane.getByText("@bob").locator("..");
  await bobTag.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Photo tag changed. Review it again.", { exact: true })).toBeVisible();
  await expect(bobTag.getByText("Private audience", { exact: true })).toBeVisible();
  await bobTag.getByRole("button", { name: "Approve" }).click();
  expect(actions).toContainEqual({ proposalId: "44444444-4444-4444-8444-444444444444", action: "approve", expectedAudienceRevision: 1 });
  expect(actions).toContainEqual({ proposalId: "44444444-4444-4444-8444-444444444444", action: "approve", expectedAudienceRevision: 2 });
  expect(actions).toContainEqual({ proposalId: "66666666-6666-4666-8666-666666666666", action: "withdraw" });
});

test("photo tag lanes expose read failures, retry, and preserve approved withdrawals", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockVerified(page);
  await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));
  await page.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));

  const proposed = {
    id: "44444444-4444-4444-8444-444444444444", postId: POST_ID,
    mediaId: basePost.photo!.mediaId, authorHandle: "bob", state: "proposed",
    visibility: "friends", photoAltText: "Friends outside", reviewRevision: 1,
    audienceAtApproval: null, createdAt: "2026-08-05T19:00:00.000Z",
  };
  const approved = {
    ...proposed, id: "55555555-5555-4555-8555-555555555555",
    authorHandle: "cee", state: "approved", mediaId: null, photoAltText: null,
    audienceAtApproval: { visibility: "friends", revision: 1, shownAt: "2026-08-05T19:02:00.000Z" },
  };
  let proposedReads = 0;
  let approvedReads = 0;
  await page.route("**/api/social/tags**", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    const lane = new URL(route.request().url()).searchParams.get("lane");
    if (lane === "proposed") {
      proposedReads += 1;
      if (proposedReads === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
      if (proposedReads === 2) return route.abort("connectionrefused");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [proposed], nextCursor: null }) });
    }
    approvedReads += 1;
    if (approvedReads === 2) return route.abort("connectionrefused");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: approvedReads === 1 ? [approved] : [], nextCursor: null }) });
  });

  await page.goto("/social");
  const proposedLane = page.getByRole("region", { name: "Tags to review" });
  const approvedLane = page.getByRole("region", { name: "Approved tags" });
  await expect(proposedLane.getByRole("alert")).toHaveText("Tags to review are unavailable right now.");
  const proposedRetry = proposedLane.getByRole("button", { name: "Retry tags to review" });
  expect((await proposedRetry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await proposedRetry.click();
  await expect(proposedLane.getByRole("alert")).toBeVisible();
  await proposedRetry.click();
  await expect(proposedLane.getByText("@bob")).toBeVisible();

  const approvedTag = approvedLane.getByText("@cee").locator("..");
  await approvedTag.getByRole("button", { name: "Withdraw" }).click();
  await expect(approvedLane.getByRole("alert")).toHaveText("Approved tags are unavailable right now.");
  await expect(approvedTag.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await approvedLane.getByRole("button", { name: "Retry approved tags" }).click();
  await expect(approvedLane).toHaveCount(0);
});

for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${viewport.width}px ${colorScheme} composer has no overflow and passes keyboard and axe`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await mockVerified(page);
      await page.route("**/api/social/tags**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
      await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [basePost], nextCursor: null }) }));
      await page.goto("/social");
      const trigger = page.getByRole("button", { name: "New post" });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const results = await new AxeBuilder({ page }).include(".socialComposer").analyze(); expect(results.violations).toEqual([]);
      if (process.env.PW_SOCIAL_COMPOSER_PROOF === "1") {
        const directory = join(process.cwd(), "docs/proof/social-composer"); mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: join(directory, `${viewport.width}-${colorScheme}.png`), fullPage: false });
      }
      const focusableCount = await dialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])').count();
      for (let index = 0; index < focusableCount + 2; index += 1) await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}
