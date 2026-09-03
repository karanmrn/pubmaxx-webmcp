import { v } from "convex/values";
import { pubPalDto } from "./dtoValidators";
import { requireOwnerIdentity } from "./lib/auth";
import { toPubPalDto } from "./lib/dto";
import { findOwnedPal } from "./lib/ownedPal";
import { query } from "./model";

export const getMine = query({
  args: {},
  returns: v.union(v.null(), pubPalDto),
  handler: async (ctx) => {
    const owner = await requireOwnerIdentity(ctx.auth);
    const pal = await findOwnedPal(ctx, owner);
    return pal ? toPubPalDto(pal) : null;
  },
});
