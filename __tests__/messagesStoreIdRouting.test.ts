// Which BACKEND a conversation id belongs to is decided by the id's whole shape,
// never by its first character. A memory id is `c` plus a decimal sequence
// number; a durable id is a Postgres UUID, and `c` is a hex digit, so one durable
// conversation in sixteen used to route into the empty in-memory store and answer
// 404 for the life of the pair. These cases pin both directions.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ from: supabase.from }),
}));

import {
  __resetMemoryMessages,
  isMemoryConversationId,
  supabaseMessagesStore,
} from "@/lib/messagesStore";

// A real gen_random_uuid() answer whose first hex digit happens to be `c`.
const DURABLE_ID_STARTING_WITH_C = "c3f8a1b2-4d5e-4f60-9a1b-2c3d4e5f6071";
const PAIR = { handle_a: "ken", handle_b: "sam" };

/**
 * The smallest chainable stand-in for the Supabase query builder: every method
 * returns the builder, and the builder resolves to the result the case queued for
 * that table.
 */
function fakeSupabase(results: Record<string, unknown>) {
  const tables: string[] = [];
  supabase.from.mockImplementation((table: string) => {
    tables.push(table);
    const result = { data: results[table] ?? null, error: null };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of [
      "select",
      "insert",
      "update",
      "upsert",
      "eq",
      "neq",
      "is",
      "or",
      "order",
      "limit",
    ]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = () => Promise.resolve(result);
    builder.single = () => Promise.resolve(result);
    return builder;
  });
  return tables;
}

beforeEach(() => {
  supabase.from.mockReset();
  __resetMemoryMessages();
});

describe("isMemoryConversationId", () => {
  it("claims a memory-minted id and NOT a UUID that merely starts with c", () => {
    expect(isMemoryConversationId("c1")).toBe(true);
    expect(isMemoryConversationId("c42")).toBe(true);
    expect(isMemoryConversationId(DURABLE_ID_STARTING_WITH_C)).toBe(false);
    expect(isMemoryConversationId("cafe1234-0000-4000-8000-000000000001")).toBe(false);
    expect(isMemoryConversationId("c")).toBe(false);
  });
});

describe("supabaseMessagesStore — a durable UUID starting with 'c' stays durable", () => {
  it("reads the thread from Supabase instead of the empty memory store", async () => {
    const tables = fakeSupabase({
      conversations: PAIR,
      messages: [
        {
          id: "m1",
          conversation_id: DURABLE_ID_STARTING_WITH_C,
          sender_handle: "ken",
          body: "durable hello",
          created_at: "2026-08-15T18:00:00.000Z",
        },
      ],
    });

    const thread = await supabaseMessagesStore.listMessages(
      DURABLE_ID_STARTING_WITH_C,
      "sam",
    );

    expect(tables).toContain("conversations");
    expect(thread).not.toBeNull();
    expect(thread!.map((m) => m.body)).toEqual(["durable hello"]);
  });

  it("sends through Supabase instead of returning null", async () => {
    fakeSupabase({
      conversations: PAIR,
      messages: {
        id: "m2",
        conversation_id: DURABLE_ID_STARTING_WITH_C,
        sender_handle: "ken",
        body: "still here",
        created_at: "2026-08-15T18:01:00.000Z",
      },
    });

    const sent = await supabaseMessagesStore.send(
      DURABLE_ID_STARTING_WITH_C,
      "ken",
      "still here",
    );

    expect(sent).not.toBeNull();
    expect(sent!.body).toBe("still here");
  });

  it("reports through Supabase instead of no-opping", async () => {
    fakeSupabase({ messages: [{ id: "m1" }] });

    expect(
      await supabaseMessagesStore.report(DURABLE_ID_STARTING_WITH_C, "m1", "sam"),
    ).toBe(true);
  });

  it("resolves a message photo key through Supabase", async () => {
    fakeSupabase({
      conversations: PAIR,
      messages: {
        id: "m1",
        conversation_id: DURABLE_ID_STARTING_WITH_C,
        sender_handle: "ken",
        body: "",
        created_at: "2026-08-15T18:02:00.000Z",
        attachment_kind: "photo",
        attachment_object_key: `messages/${DURABLE_ID_STARTING_WITH_C}/m1.jpg`,
        attachment_width: 800,
        attachment_height: 1000,
      },
    });

    expect(
      await supabaseMessagesStore.photoObjectKey(DURABLE_ID_STARTING_WITH_C, "m1", "sam"),
    ).toBe(`messages/${DURABLE_ID_STARTING_WITH_C}/m1.jpg`);
  });

  it("still routes a memory-minted id to the in-memory store", async () => {
    fakeSupabase({});

    expect(await supabaseMessagesStore.listMessages("c1", "sam")).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
