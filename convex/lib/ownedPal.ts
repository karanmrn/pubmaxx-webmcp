import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../model";
import type { OwnerIdentity } from "./auth";

export async function findOwnedPal(
  ctx: Pick<GenericQueryCtx<DataModel>, "db">,
  owner: OwnerIdentity,
) {
  return ctx.db
    .query("pubPals")
    .withIndex("by_owner_issuer_subject", (q) =>
      q.eq("ownerIssuer", owner.issuer).eq("ownerSubject", owner.subject),
    )
    .unique();
}
