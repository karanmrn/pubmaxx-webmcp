import { describe, expect, it } from "vitest";

// Pure model tests — no store, no env, no network. Covers pair normalisation,
// participant check, body validation/cleaning, unread counting, and the @-mention
// linkifier.
import {
  cleanBody,
  isParticipant,
  linkifyMentions,
  MAX_MESSAGE_BODY,
  normalizePair,
  unreadForViewer,
} from "@/lib/messages";

describe("normalizePair — lexicographic order + validity", () => {
  it("orders a pair the same regardless of argument order", () => {
    const a = normalizePair("ken", "sam");
    const b = normalizePair("sam", "ken");
    expect(a).toEqual({ handleA: "ken", handleB: "sam" });
    expect(a).toEqual(b);
  });

  it("normalises handles (strips @, lowercases) before ordering", () => {
    expect(normalizePair("@Sam", "KEN")).toEqual({ handleA: "ken", handleB: "sam" });
  });

  it("rejects a self-pair (can't DM yourself)", () => {
    expect(normalizePair("ken", "ken")).toBeNull();
    expect(normalizePair("@Ken", "ken")).toBeNull();
  });

  it("rejects a blank/invalid handle on either side", () => {
    expect(normalizePair("", "sam")).toBeNull();
    expect(normalizePair("ken", "   ")).toBeNull();
    expect(normalizePair("!!!", "sam")).toBeNull();
  });
});

describe("isParticipant — the courtesy check primitive", () => {
  const pair = { handleA: "ken", handleB: "sam" };
  it("accepts either participant (normalising the input)", () => {
    expect(isParticipant(pair, "ken")).toBe(true);
    expect(isParticipant(pair, "@Sam")).toBe(true);
  });
  it("rejects a non-participant and a blank handle", () => {
    expect(isParticipant(pair, "mallory")).toBe(false);
    expect(isParticipant(pair, "")).toBe(false);
  });
});

describe("cleanBody — free-text trust boundary + cap", () => {
  it("strips angle brackets and collapses whitespace", () => {
    expect(cleanBody("  hi   <script>there</script>  ")).toBe("hi scriptthere/script");
  });
  it("returns null for empty / whitespace-only / non-string", () => {
    expect(cleanBody("")).toBeNull();
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody(null)).toBeNull();
    expect(cleanBody(42)).toBeNull();
  });
  it("caps at MAX_MESSAGE_BODY characters", () => {
    const out = cleanBody("x".repeat(MAX_MESSAGE_BODY + 500));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(MAX_MESSAGE_BODY);
  });
});

describe("unreadForViewer — per-viewer unread count", () => {
  it("counts only unread messages NOT sent by the viewer", () => {
    const rows = [
      { senderHandle: "sam", read: false }, // received, unread → counts
      { senderHandle: "sam", read: true }, // received, read → no
      { senderHandle: "ken", read: false }, // my own → never counts
    ];
    expect(unreadForViewer(rows, "ken")).toBe(1);
  });
  it("is zero for a blank viewer", () => {
    expect(unreadForViewer([{ senderHandle: "sam", read: false }], "")).toBe(0);
  });
});

describe("linkifyMentions — light @-mention linkify", () => {
  it("splits a mention out and preserves surrounding text", () => {
    const segs = linkifyMentions("hey @ken check this");
    expect(segs).toEqual([
      { type: "text", text: "hey " },
      { type: "mention", handle: "ken", raw: "@ken" },
      { type: "text", text: " check this" },
    ]);
  });

  it("linkifies a mention at the very start", () => {
    const segs = linkifyMentions("@sam hello");
    expect(segs[0]).toEqual({ type: "mention", handle: "sam", raw: "@sam" });
  });

  it("does NOT treat an email's @host as a mention", () => {
    const segs = linkifyMentions("mail me at ken@host.com");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("reproduces the input when segments are concatenated", () => {
    const input = "yo @ken and @sam!";
    const joined = linkifyMentions(input)
      .map((s) => (s.type === "text" ? s.text : s.raw))
      .join("");
    expect(joined).toBe(input);
  });

  it("returns an empty array for an empty body", () => {
    expect(linkifyMentions("")).toEqual([]);
  });
});
