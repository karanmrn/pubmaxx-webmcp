import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the in-memory notifications store + the emit model directly — no live
// Supabase, no env keys. FORCE the in-memory path (see reactionsStore.test.ts for
// the rationale): if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present the
// store would try the Supabase client (network) and cases would fail only in CI.
// Clearing them in beforeEach pins the store to memory everywhere; we also reset
// the shared memory map so cases can't leak notifications into each other.
import {
  cleanNotification,
  isNotificationKind,
  NOTIFICATION_KINDS,
} from "@/lib/notifications";
import {
  __resetMemoryNotifications,
  emitNotification,
  filterDropLinkedNotifications,
  memoryNotificationsStore,
  notificationsStore,
} from "@/lib/notificationsStore";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryNotifications();
  __resetPintDrops();
});

function makeDrop(overrides: Partial<PintDrop> = {}): PintDrop {
  return {
    id: "drop-visible",
    venueId: "venue-1",
    handle: "@ken",
    drink: "Bitter",
    priceGbp: 5.2,
    passedDownNote: "A note",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-07-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("notificationsStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(notificationsStore()).toBe(memoryNotificationsStore);
  });
});

describe("NOTIFICATION_KINDS / isNotificationKind — trust boundary", () => {
  it("accepts every canonical kind", () => {
    for (const k of NOTIFICATION_KINDS) expect(isNotificationKind(k)).toBe(true);
  });
  it("rejects unknown / malformed kinds", () => {
    expect(isNotificationKind("like")).toBe(false);
    expect(isNotificationKind("")).toBe(false);
    expect(isNotificationKind(null)).toBe(false);
    expect(isNotificationKind(42)).toBe(false);
  });
});

describe("cleanNotification — normalisation + self-notify guard", () => {
  it("normalises handles and keeps a valid notification", () => {
    const clean = cleanNotification({
      recipientHandle: "  Ken ",
      actorHandle: "ALE",
      kind: "follow",
      subjectRef: "ale",
    });
    expect(clean).not.toBeNull();
    expect(clean!.recipientHandle).toBe("ken");
    expect(clean!.actorHandle).toBe("ale");
  });

  it("drops a self-directed notification (you don't get notified about yourself)", () => {
    expect(
      cleanNotification({ recipientHandle: "ken", actorHandle: "ken", kind: "follow" }),
    ).toBeNull();
  });

  it("drops a notification with a missing handle or an unknown kind", () => {
    expect(cleanNotification({ recipientHandle: "", actorHandle: "ale", kind: "follow" })).toBeNull();
    expect(cleanNotification({ recipientHandle: "ken", actorHandle: "", kind: "follow" })).toBeNull();
    expect(
      cleanNotification({ recipientHandle: "ken", actorHandle: "ale", kind: "like" as never }),
    ).toBeNull();
  });
});

describe("emit per kind → list + unread count", () => {
  it("emits one notification per kind and counts them all unread", async () => {
    const store = notificationsStore();
    await store.emit({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" });
    await store.emit({ recipientHandle: "ken", actorHandle: "sam", kind: "reaction", subjectRef: "d1" });
    await store.emit({ recipientHandle: "ken", actorHandle: "sam", kind: "comment", subjectRef: "d1" });
    await store.emit({ recipientHandle: "ken", actorHandle: "jo", kind: "crawl_save", subjectRef: "c1" });

    const inbox = await store.list("ken");
    expect(inbox.notifications).toHaveLength(4);
    expect(inbox.unread).toBe(4);
    // Newest-first: the crawl_save (last emitted) leads.
    expect(inbox.notifications[0].kind).toBe("crawl_save");
    // Every kind is represented.
    expect(new Set(inbox.notifications.map((n) => n.kind))).toEqual(
      new Set(["follow", "reaction", "comment", "crawl_save"]),
    );
  });

  it("partitions by recipient — one handle never sees another's inbox", async () => {
    const store = notificationsStore();
    await store.emit({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" });
    expect((await store.list("ken")).notifications).toHaveLength(1);
    expect((await store.list("sam")).notifications).toHaveLength(0);
  });

  it("never leaks a self-notification into the inbox", async () => {
    const store = notificationsStore();
    const wrote = await store.emit({ recipientHandle: "ken", actorHandle: "ken", kind: "follow" });
    expect(wrote).toBe(false);
    expect((await store.list("ken")).notifications).toHaveLength(0);
  });
});

describe("markRead — one and all", () => {
  it("marks a single notification read, decrementing unread", async () => {
    const store = notificationsStore();
    await store.emit({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" });
    await store.emit({ recipientHandle: "ken", actorHandle: "sam", kind: "comment", subjectRef: "d1" });
    const before = await store.list("ken");
    expect(before.unread).toBe(2);

    const target = before.notifications[0].id;
    const after = await store.markRead("ken", target);
    expect(after.unread).toBe(1);
    expect(after.notifications.find((n) => n.id === target)!.read).toBe(true);
  });

  it("marks ALL read when no id is given", async () => {
    const store = notificationsStore();
    await store.emit({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" });
    await store.emit({ recipientHandle: "ken", actorHandle: "sam", kind: "reaction", subjectRef: "d1" });
    const after = await store.markRead("ken");
    expect(after.unread).toBe(0);
    expect(after.notifications.every((n) => n.read)).toBe(true);
  });
});

describe("best-effort contract — a failure never breaks the parent write", () => {
  it("emitNotification never throws, even when the store throws", async () => {
    // Force the store's emit to blow up; the seam must swallow it.
    const spy = vi
      .spyOn(memoryNotificationsStore, "emit")
      .mockRejectedValueOnce(new Error("storage down"));
    await expect(
      emitNotification({ recipientHandle: "ken", actorHandle: "ale", kind: "follow" }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("store.emit returns false (not throw) on an undeliverable notification", async () => {
    // A self-notification is undeliverable — reported as false, never an error.
    const wrote = await memoryNotificationsStore.emit({
      recipientHandle: "ken",
      actorHandle: "ken",
      kind: "follow",
    });
    expect(wrote).toBe(false);
  });
});

describe("parent-drop visibility gate — drop-linked notifications", () => {
  beforeEach(() => {
    addPintDrop(makeDrop({ id: "drop-public", handle: "@ken" }));
    addPintDrop(makeDrop({ id: "drop-hidden", handle: "@ken", status: "hidden" }));
    addPintDrop(makeDrop({ id: "drop-legacy", handle: "@ken", visibility: "legacy" }));
    addPintDrop(makeDrop({ id: "drop-friends", handle: "@ken", visibility: "friends" }));
  });

  it("filterDropLinkedNotifications keeps follow/crawl rows and public-drop signals", () => {
    const resolved = new Map<string, PintDrop>([
      ["drop-public", makeDrop({ id: "drop-public", handle: "@ken" })],
      ["drop-hidden", makeDrop({ id: "drop-hidden", handle: "@ken", status: "hidden" })],
    ]);
    const dtos = [
      {
        id: "n1",
        actorHandle: "ale",
        kind: "follow" as const,
        createdAt: "2026-07-07T12:00:00.000Z",
        read: false,
      },
      {
        id: "n2",
        actorHandle: "sam",
        kind: "comment" as const,
        subjectRef: "drop-public",
        createdAt: "2026-07-07T12:01:00.000Z",
        read: false,
      },
      {
        id: "n3",
        actorHandle: "sam",
        kind: "reaction" as const,
        subjectRef: "drop-hidden",
        createdAt: "2026-07-07T12:02:00.000Z",
        read: false,
      },
    ];
    const kept = filterDropLinkedNotifications(dtos, resolved, "ken");
    expect(kept.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("list omits notifications for hidden drops but keeps owner-visible friends/legacy", async () => {
    const store = notificationsStore();
    await store.emit({
      recipientHandle: "ken",
      actorHandle: "ale",
      kind: "comment",
      subjectRef: "drop-hidden",
    });
    await store.emit({
      recipientHandle: "ken",
      actorHandle: "sam",
      kind: "reaction",
      subjectRef: "drop-legacy",
    });
    await store.emit({
      recipientHandle: "ken",
      actorHandle: "jo",
      kind: "comment",
      subjectRef: "drop-friends",
    });
    await store.emit({
      recipientHandle: "ken",
      actorHandle: "ale",
      kind: "follow",
    });

    const inbox = await store.list("ken");
    expect(inbox.notifications.map((n) => n.kind)).toEqual(["follow", "comment", "reaction"]);
    expect(inbox.notifications.some((n) => n.subjectRef === "drop-hidden")).toBe(false);
  });

  it("emit returns false for a hidden drop's notification (never stored)", async () => {
    const wrote = await memoryNotificationsStore.emit({
      recipientHandle: "ken",
      actorHandle: "ale",
      kind: "comment",
      subjectRef: "drop-hidden",
    });
    expect(wrote).toBe(false);
    expect((await memoryNotificationsStore.list("ken")).notifications).toHaveLength(0);
  });
});
