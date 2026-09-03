import "server-only";

import type { PintDropPhotos } from "@/lib/pintDropsStore";

export type PriceSubmitPostBody = Readonly<{
  fields: Record<string, unknown>;
  photos: PintDropPhotos;
}>;

/** JSON or multipart (optional pint_photo) for POST /api/price-submit. */
export async function parsePriceSubmitPostBody(
  request: Request,
): Promise<PriceSubmitPostBody | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      const photos: PintDropPhotos = { pint: null, venue: null };
      for (const [key, value] of form.entries()) {
        if (key === "pint_photo" && value instanceof File && value.size > 0) {
          photos.pint = value;
        } else if (typeof value === "string") {
          fields[key] = value;
        }
      }
      return { fields, photos };
    } catch {
      return null;
    }
  }
  try {
    return {
      fields: (await request.json()) as Record<string, unknown>,
      photos: { pint: null, venue: null },
    };
  } catch {
    return null;
  }
}
