import "server-only";

import { createHash, createHmac } from "node:crypto";

import type { SocialPostFields } from "@/lib/socialPosts";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

export function validSocialPostIdempotencyKey(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

export function socialPostRequestDigest(fields: SocialPostFields, mediaSha256: string | null, tags: string[]): string {
  return createHash("sha256").update(JSON.stringify({ fields, mediaSha256, tags })).digest("hex");
}

export function socialPhotoMediaId(profileId: string, key: string, sha256: string): string {
  const hex = createHmac("sha256", trustedSigningKey()).update(`${profileId}:${key}:${sha256}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
