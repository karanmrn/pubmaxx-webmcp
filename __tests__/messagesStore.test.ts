import { beforeEach, describe, expect, it } from "vitest";

// In-memory store contract. FORCE the memory path (clear Supabase env) so cases
// never touch the network — same convention as notificationsStore.test.ts. Reset
// the shared maps per case so conversations don't leak between tests.
import {
  __resetMemoryMessages,
  MAX_MESSAGES,
  memoryMessagesStore,
  messagesStore,
} from "@/lib/messagesStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryMessages();
});

describe("messagesStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(messagesStore()).toBe(memoryMessagesStore);
  });
});

describe("openConversation — find-or-create, one row per pair", () => {
  it("returns the SAME id regardless of argument order", async () => {
    const s = memoryMessagesStore;
    const a = await s.openConversation("ken", "sam");
    const b = await s.openConversation("@Sam", "KEN");
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("rejects a self-pair / blank handle", async () => {
    const s = memoryMessagesStore;
    expect(await s.openConversation("ken", "ken")).toBeNull();
    expect(await s.openConversation("", "sam")).toBeNull();
  });
});

describe("send — participant gating + body validation", () => {
  it("stores a message from a participant and returns the DTO", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    const msg = await s.send(id, "ken", "  first <b>message</b>  ");
    expect(msg).not.toBeNull();
    expect(msg!.senderHandle).toBe("ken");
    expect(msg!.body).toBe("first bmessage/b"); // cleaned
    expect(msg!.read).toBe(false);
    expect(msg!.flagged).toBe(false);
  });

  it("rejects a NON-participant sender (the leak test)", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    expect(await s.send(id, "mallory", "sneaky")).toBeNull();
  });

  it("rejects an empty body and an unknown conversation", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    expect(await s.send(id, "ken", "   ")).toBeNull();
    expect(await s.send("does-not-exist", "ken", "hi")).toBeNull();
  });
});

describe("listConversations — inbox with preview + per-viewer unread", () => {
  it("shows the other handle, last body, and unread count for the recipient", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    await s.send(id, "ken", "hello sam");
    await s.send(id, "ken", "you there?");

    const samInbox = await s.listConversations("sam");
    expect(samInbox).toHaveLength(1);
    expect(samInbox[0].otherHandle).toBe("ken");
    expect(samInbox[0].lastBody).toBe("you there?");
    expect(samInbox[0].lastFromMe).toBe(false);
    expect(samInbox[0].unread).toBe(2); // two unread from ken

    const kenInbox = await s.listConversations("ken");
    expect(kenInbox[0].unread).toBe(0); // his own messages are never unread
    expect(kenInbox[0].lastFromMe).toBe(true);
  });

  it("is empty for a handle with no conversations / a blank handle", async () => {
    const s = memoryMessagesStore;
    expect(await s.listConversations("nobody")).toEqual([]);
    expect(await s.listConversations("")).toEqual([]);
  });
});

describe("listMessages — participant gating + mark-read", () => {
  it("returns the thread oldest-first for a participant and marks received read", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    await s.send(id, "ken", "one");
    await s.send(id, "sam", "two");

    const thread = await s.listMessages(id, "sam");
    expect(thread).not.toBeNull();
    expect(thread!.map((m) => m.body)).toEqual(["one", "two"]);

    // Sam read the thread → ken's message to her is now read; her own is untouched.
    const samInbox = await s.listConversations("sam");
    expect(samInbox[0].unread).toBe(0);
  });

  it("returns NULL for a non-participant (route → 404, the leak test)", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    await s.send(id, "ken", "secret");
    expect(await s.listMessages(id, "mallory")).toBeNull();
  });

  it("returns NULL for an unknown conversation", async () => {
    const s = memoryMessagesStore;
    expect(await s.listMessages("nope", "ken")).toBeNull();
  });
});

describe("report — abuse flag seam", () => {
  it("flags a message once; a second flag is a no-op", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    const msg = (await s.send(id, "ken", "rude thing"))!;
    expect(await s.report(id, msg.id, "sam")).toBe(true);
    expect(await s.report(id, msg.id, "sam")).toBe(false); // already flagged

    const thread = await s.listMessages(id, "sam");
    expect(thread!.find((m) => m.id === msg.id)!.flagged).toBe(true);
  });

  it("does not flag a message from a different conversation", async () => {
    const s = memoryMessagesStore;
    const kenSam = (await s.openConversation("ken", "sam"))!;
    const jenMax = (await s.openConversation("jen", "max"))!;
    const otherMessage = (await s.send(jenMax, "jen", "not your thread"))!;

    expect(await s.report(kenSam, otherMessage.id, "sam")).toBe(false);

    const otherThread = await s.listMessages(jenMax, "max");
    expect(otherThread!.find((m) => m.id === otherMessage.id)!.flagged).toBe(false);
  });

  it("returns false for an unknown message / blank reporter", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    expect(await s.report(id, "nope", "sam")).toBe(false);
    expect(await s.report(id, "m1", "")).toBe(false);
  });
});

describe("listMessages — capped newest thread window", () => {
  it("keeps the newest messages when a thread exceeds the cap", async () => {
    const s = memoryMessagesStore;
    const id = (await s.openConversation("ken", "sam"))!;
    for (let i = 1; i <= MAX_MESSAGES + 3; i += 1) {
      await s.send(id, "ken", `msg-${i}`);
    }

    const thread = await s.listMessages(id, "sam");
    expect(thread).toHaveLength(MAX_MESSAGES);
    expect(thread![0].body).toBe("msg-4");
    expect(thread![thread!.length - 1].body).toBe(`msg-${MAX_MESSAGES + 3}`);
  });
});
