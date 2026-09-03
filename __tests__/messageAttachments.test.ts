// What a message may carry beside its words, and what a surface may say about
// it. The pure half of the attachment lane, plus the SQL shape the store leans
// on and the one projection both backends read.
//
// THE RULES BEING FENCED, in the order they would break:
//   - the set is closed at two, and a photo's key names its own conversation;
//   - a pub card holds no coordinate of any kind, so the viewer-coordinate
//     egress law is untouched;
//   - a figure on a card names the drink, because a bare number beside a pub
//     name reads as tonight's pint;
//   - a reported message stops carrying its photo, in the ONE projection both
//     the durable and the in-memory backend read.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  isMessagePhotoServingKey,
  isMessageVenueId,
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_PHOTO_ASPECT_RATIO,
  MESSAGE_PHOTO_CROP_TARGET,
  MESSAGE_PHOTO_OUTPUT_HEIGHT,
  MESSAGE_PHOTO_OUTPUT_WIDTH,
  messagePhotoAltText,
  messagePhotoServePath,
  messagePhotoServingKey,
  messagePhotoStagingKey,
  messageVenueCardLabel,
  messageVenuePriceLine,
} from "@/lib/messageAttachments";
import { cleanAttachedBody, cleanBody } from "@/lib/messages";
import { __resetMemoryMessages, memoryMessagesStore } from "@/lib/messagesStore";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const MIGRATION = "supabase/migrations/20260810180000_0102_message_attachments.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260810180000_0102_message_attachments_rollback.sql";

describe("the attachment set is closed at two", () => {
  it("names exactly a photo and a pub", () => {
    expect([...MESSAGE_ATTACHMENT_KINDS]).toEqual(["photo", "venue"]);
  });

  it("keys a photo to its own conversation and message", () => {
    expect(messagePhotoServingKey("conv-1", "msg-9")).toBe("messages/conv-1/msg-9.jpg");
    // Siblings, not nested: a listing of the conversation prefix never confuses
    // a message's folder for a file.
    expect(messagePhotoStagingKey("conv-1", "msg-9")).toBe("messages/conv-1/msg-9.staging.jpg");
    expect(messagePhotoServePath("conv-1", "msg-9")).toBe("/api/messages/conv-1/photo/msg-9");
  });

  it("refuses a key that belongs to another conversation or the staging lane", () => {
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-1/msg-9.jpg")).toBe(true);
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-2/msg-9.jpg")).toBe(false);
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-1/msg-8.jpg")).toBe(false);
    expect(
      isMessagePhotoServingKey("conv-1", "msg-9", "messages/conv-1/msg-9.staging.jpg"),
    ).toBe(false);
    expect(isMessagePhotoServingKey("conv-1", "msg-9", "avatars/conv-1/msg-9.jpg")).toBe(false);
  });

  it("frames a message photo portrait, because a phone photograph is", () => {
    expect(MESSAGE_PHOTO_ASPECT_RATIO).toBeCloseTo(0.8);
    expect(MESSAGE_PHOTO_OUTPUT_HEIGHT).toBe(
      Math.round(MESSAGE_PHOTO_OUTPUT_WIDTH / MESSAGE_PHOTO_ASPECT_RATIO),
    );
    expect(MESSAGE_PHOTO_CROP_TARGET.outputBox).toEqual({
      width: MESSAGE_PHOTO_OUTPUT_WIDTH,
      height: MESSAGE_PHOTO_OUTPUT_HEIGHT,
    });
  });
});

describe("a pub card holds a pub, never a place", () => {
  it("admits an ordinary venue id and refuses one that could walk a path", () => {
    expect(isMessageVenueId("ldn-coach-and-horses")).toBe(true);
    expect(isMessageVenueId("uk_base:osm:node:123")).toBe(true);
    expect(isMessageVenueId("../../etc/passwd")).toBe(false);
    expect(isMessageVenueId("a/b")).toBe(false);
    expect(isMessageVenueId("")).toBe(false);
    expect(isMessageVenueId("x".repeat(65))).toBe(false);
  });

  it("carries no latitude, longitude or viewer point anywhere in the module", () => {
    // Comments stripped first: the header EXPLAINS the rule in these words, and
    // a fence that read prose would forbid saying what it forbids.
    const code = read("lib/messageAttachments.ts")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .toLowerCase();
    for (const forbidden of ["lat", "lng", "latitude", "longitude", "coord", "point"]) {
      expect(code, `message attachments must not carry ${forbidden}`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });

  it("names the drink beside the figure, and stays silent without one", () => {
    // A bare "£5.40" beside a pub name is the masquerade the pin label rule
    // exists to stop.
    expect(messageVenuePriceLine(5.4)).toBe("Cheapest pint £5.40");
    expect(messageVenuePriceLine(6)).toBe("Cheapest pint £6.00");
    expect(messageVenuePriceLine(null)).toBeNull();
    expect(messageVenuePriceLine(0)).toBeNull();
    expect(messageVenuePriceLine(Number.NaN)).toBeNull();
  });

  it("names the pub and where it is, and leaves the figure out of the link name", () => {
    const card = {
      venueId: "v1",
      name: "The Coach and Horses",
      area: "Soho",
      priceGbp: 5.4,
      mapUrl: "/map?sel=v1",
    };
    expect(messageVenueCardLabel(card)).toBe("The Coach and Horses, Soho. Open on the map");
    expect(messageVenueCardLabel({ ...card, area: "" })).toBe(
      "The Coach and Horses. Open on the map",
    );
    expect(messageVenueCardLabel(card)).not.toContain("5.40");
  });

  it("names the sender in a photo's accessible name, never the file", () => {
    expect(messagePhotoAltText("sam")).toBe("Photo from @sam");
    expect(messagePhotoAltText("")).toBe("Photo in this conversation");
  });
});

describe("a body is only required when nothing else is", () => {
  it("keeps refusing an empty text-only message", () => {
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody("hi")).toBe("hi");
  });

  it("lets a photo travel without a caption", () => {
    // Refusing this would make the words the point of a picture.
    expect(cleanAttachedBody("   ")).toBe("");
    expect(cleanAttachedBody(undefined)).toBe("");
    expect(cleanAttachedBody(" hello ")).toBe("hello");
  });
});

describe("a reported message stops carrying its photo", () => {
  beforeEach(() => {
    __resetMemoryMessages();
  });

  it("drops the attachment from the read the moment the row is flagged", async () => {
    const conversationId = await memoryMessagesStore.openConversation("ken", "sam");
    expect(conversationId).toBeTruthy();
    const messageId = "11111111-2222-4333-8444-555555555555";
    const sent = await memoryMessagesStore.send(conversationId!, "ken", "", {
      kind: "photo",
      messageId,
      objectKey: messagePhotoServingKey(conversationId!, messageId),
      width: 1080,
      height: 1350,
    });
    expect(sent?.attachment).toEqual({
      kind: "photo",
      url: messagePhotoServePath(conversationId!, messageId),
      width: 1080,
      height: 1350,
    });
    expect(await memoryMessagesStore.photoObjectKey(conversationId!, messageId, "sam")).toBe(
      messagePhotoServingKey(conversationId!, messageId),
    );

    expect(await memoryMessagesStore.report(conversationId!, messageId, "sam")).toBe(true);

    const after = await memoryMessagesStore.listMessages(conversationId!, "sam");
    expect(after?.[0].flagged).toBe(true);
    expect(after?.[0].attachment).toBeUndefined();
    // The bytes stop being reachable at the same moment, through the same
    // projection, not through a second copy of the rule.
    expect(
      await memoryMessagesStore.photoObjectKey(conversationId!, messageId, "sam"),
    ).toBeNull();
  });

  it("hands an outsider nothing, and says nothing about whether the id exists", async () => {
    const conversationId = await memoryMessagesStore.openConversation("ken", "sam");
    const messageId = "11111111-2222-4333-8444-666666666666";
    await memoryMessagesStore.send(conversationId!, "ken", "", {
      kind: "photo",
      messageId,
      objectKey: messagePhotoServingKey(conversationId!, messageId),
      width: 1080,
      height: 1350,
    });
    expect(
      await memoryMessagesStore.photoObjectKey(conversationId!, messageId, "mallory"),
    ).toBeNull();
    expect(
      await memoryMessagesStore.photoObjectKey(conversationId!, "no-such-message", "sam"),
    ).toBeNull();
  });
});

describe("0102 message_attachments", () => {
  const sql = read(MIGRATION);
  const rollback = read(ROLLBACK);

  it("closes the kind set in the database too", () => {
    expect(sql).toMatch(/attachment_kind in \('photo', 'venue'\)/);
  });

  it("says the same sentence about a serving key that the code says", () => {
    expect(sql).toMatch(
      /attachment_object_key = \('messages\/' \|\| conversation_id::text \|\| '\/' \|\| id::text \|\| '\.jpg'\)/,
    );
    expect(messagePhotoServingKey("C", "I")).toBe("messages/C/I.jpg");
  });

  it("gives each kind its own columns and nothing else's", () => {
    expect(sql).toMatch(/messages_attachment_shape_chk/);
    expect(sql).toMatch(/attachment_kind = 'venue'[\s\S]{0,200}attachment_object_key is null/);
    expect(sql).toMatch(/attachment_kind = 'photo'[\s\S]{0,200}attachment_venue_id is null/);
  });

  it("stores no coordinate for a shared pub", () => {
    expect(sql).not.toMatch(/attachment_(lat|lng|latitude|longitude)/);
  });

  it("lets a photo be a message without words, and still refuses an empty one", () => {
    expect(sql).toMatch(/char_length\(body\) <= 1000/);
    expect(sql).toMatch(/char_length\(body\) >= 1 or attachment_kind is not null/);
    // The old constraint would have refused a caption-free photo.
    expect(sql).toMatch(/drop constraint if exists messages_body_len_chk/);
  });

  it("adds no RLS policy to a deny-all table", () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/Never add a public-read policy to this table/);
  });

  it("takes a leaving account's photos and leaves the conversation's words", () => {
    expect(sql).toMatch(/delete from storage\.objects o[\s\S]{0,400}public\.messages m/);
    expect(sql).toMatch(/attachment_object_key is not null/);
    expect(sql).toMatch(/set body = case when char_length\(m\.body\) >= 1 then m\.body/);
    // The words are never deleted, only the picture.
    expect(sql).not.toMatch(/delete from public\.messages/);
  });

  it("restates the definer's search_path, which create-or-replace would drop", () => {
    expect(sql).toMatch(/set search_path = public, storage/);
    expect(rollback).toMatch(/set search_path = public, storage/);
  });

  it("rolls back to 0019's body rule without leaving a row that breaks it", () => {
    // A photo-only message has an empty body; restoring `between 1 and 1000`
    // over it would fail the migration.
    expect(rollback).toMatch(/set body = 'Photo removed\.'/);
    expect(rollback).toMatch(/char_length\(body\) between 1 and 1000/);
    for (const column of [
      "attachment_kind",
      "attachment_object_key",
      "attachment_width",
      "attachment_height",
      "attachment_venue_id",
    ]) {
      expect(rollback).toMatch(new RegExp(`drop column if exists ${column}`));
    }
  });
});
