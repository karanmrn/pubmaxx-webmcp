import { describe, expect, it } from "vitest";

import {
  buildOptimisticSpillRetryFormData,
  buildOptimisticSpillRetryPayload,
  buildOptimisticSpillDrop,
  failOptimisticSpill,
  markOptimisticSpillRetrying,
  mergeOptimisticSpillDrops,
  reconcileOptimisticSpill,
  upsertOptimisticSpill,
  type StoredOptimisticSpill,
} from "@/lib/optimisticSpillPost";
import type { PintDropDTO } from "@/lib/feed";

function serverDrop(overrides: Partial<PintDropDTO> = {}): PintDropDTO {
  return {
    id: "server-1",
    handle: "karan",
    priceGbp: 5.8,
    drink: "Pale ale",
    passedDownNote: "By the dartboard",
    era: "",
    provenance: "contributor",
    venueId: "venue-1",
    createdAt: "2026-07-07T21:02:00.000Z",
    vibeTags: ["proper"],
    pintPhotoUrl: "https://cdn.example/pint.jpg",
    venuePhotoUrl: null,
    venueName: "The Crown",
    venueMapUrl: "/map?sel=venue-1",
    ...overrides,
  };
}

describe("optimistic Spill posting", () => {
  it("builds a final-card-shaped uploading draft with local photo previews", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      venueName: "The Crown",
      handle: " karan ",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "public",
      vibeTags: ["proper"],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });

    expect(draft).toMatchObject({
      id: "optimistic-client-1",
      handle: "karan",
      priceGbp: 5.8,
      provenance: "contributor",
      venueName: "The Crown",
      venueMapUrl: "/map?sel=venue-1",
      pintPhotoUrl: "blob:http://localhost/pint",
      optimistic: {
        state: "uploading",
        message: "Posting Spill, uploading photo",
        uploadProgress: 0,
        canRetry: false,
        clientRequestId: "client-1",
      },
    });
  });

  it("builds city-scoped map URLs for prefixed venue ids", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-oxf",
      venueId: "venue-oxf-16404bl",
      venueName: "Turf Tavern",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the alley",
      era: "",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });

    expect(draft.venueMapUrl).toBe("/map/oxford?sel=venue-oxf-16404bl");
  });

  it("reconciles a draft with the authoritative server response", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const stored: StoredOptimisticSpill[] = [{ clientRequestId: "client-1", drop: draft }];

    expect(reconcileOptimisticSpill(stored, "client-1", serverDrop())).toEqual([
      { clientRequestId: "client-1", drop: serverDrop() },
    ]);
  });

  it("marks a failed draft honestly and keeps it retryable", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "",
      drink: "",
      passedDownNote: "Story only",
      era: "1980s",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const retry = buildOptimisticSpillRetryPayload({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "",
      drink: "",
      passedDownNote: "Story only",
      era: "1980s",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const stored: StoredOptimisticSpill[] = [{ clientRequestId: "client-1", drop: draft, retry }];

    expect(failOptimisticSpill(stored, "client-1", "Network or storage error — try again.")).toEqual([
      {
        clientRequestId: "client-1",
        retry,
        drop: {
          ...draft,
          optimistic: {
            state: "failed",
            message: "Network or storage error — try again.",
            uploadProgress: null,
            canRetry: true,
            clientRequestId: "client-1",
          },
        },
      },
    ]);
  });

  it("stores the original retry payload without flattening the public card", () => {
    const input = {
      clientRequestId: "client-1",
      venueId: "venue-1",
      venueName: "The Crown",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "anonymous" as const,
      vibeTags: ["proper"],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    };
    const draft = buildOptimisticSpillDrop(input);

    expect(upsertOptimisticSpill([], draft, buildOptimisticSpillRetryPayload(input))).toEqual([
      {
        clientRequestId: "client-1",
        drop: draft,
        retry: {
          venueId: "venue-1",
          venueName: "The Crown",
          handle: "karan",
          priceGbp: "5.8",
          drink: "Pale ale",
          passedDownNote: "By the dartboard",
          era: "",
          visibility: "anonymous",
          vibeTags: ["proper"],
          pintPhotoUrl: "blob:http://localhost/pint",
          venuePhotoUrl: null,
        },
      },
    ]);
  });

  it("rebuilds multipart retry data from the stored payload and local blob previews", async () => {
    const payload = buildOptimisticSpillRetryPayload({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "public",
      vibeTags: ["proper", "riverside"],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });

    const form = await buildOptimisticSpillRetryFormData(payload, async (url) => {
      expect(url).toBe("blob:http://localhost/pint");
      return new Blob(["photo"], { type: "image/png" });
    });

    expect(form.get("venueId")).toBe("venue-1");
    expect(form.get("handle")).toBe("karan");
    expect(form.get("priceGbp")).toBe("5.8");
    expect(form.get("visibility")).toBe("public");
    expect(form.getAll("vibe_tags")).toEqual(["proper", "riverside"]);
    expect(form.get("pint_photo")).toBeInstanceOf(Blob);
  });

  it("marks a failed draft as retrying before the retry request settles", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "",
      era: "",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const failed = failOptimisticSpill(
      [{ clientRequestId: "client-1", drop: draft }],
      "client-1",
      "Network or storage error — try again.",
    );

    expect(markOptimisticSpillRetrying(failed, "client-1")).toEqual([
      {
        clientRequestId: "client-1",
        drop: {
          ...draft,
          optimistic: {
            state: "uploading",
            message: "Retrying Spill, uploading photo",
            uploadProgress: 0,
            canRetry: false,
            clientRequestId: "client-1",
          },
        },
      },
    ]);
  });

  it("merges local optimistic drops ahead of server drops without duplicating reconciled ids", () => {
    const local = [
      { clientRequestId: "client-1", drop: serverDrop({ id: "server-1" }) },
      {
        clientRequestId: "client-2",
        drop: buildOptimisticSpillDrop({
          clientRequestId: "client-2",
          venueId: "venue-2",
          handle: "sam",
          priceGbp: "4.5",
          drink: "Lager",
          passedDownNote: "",
          era: "",
          visibility: "public",
          vibeTags: [],
          pintPhotoUrl: null,
          venuePhotoUrl: null,
          createdAt: "2026-07-07T21:03:00.000Z",
        }),
      },
    ];

    expect(mergeOptimisticSpillDrops([serverDrop({ id: "server-1" })], local).map((d) => d.id)).toEqual([
      "server-1",
      "optimistic-client-2",
    ]);
  });
});
