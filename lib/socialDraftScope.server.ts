import "server-only";

import { createHmac } from "node:crypto";

import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

export function socialDraftScope(profileId: string): string {
  return createHmac("sha256", trustedSigningKey())
    .update(`social-draft:${profileId}`)
    .digest("base64url");
}
