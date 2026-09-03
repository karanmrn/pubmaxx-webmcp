import "server-only";

import { cheapPintPingStore } from "@/lib/stepOutNudgeStore";
import { profileStore } from "@/lib/profileStore";

/** Mark an owner qualified after their first pint drop or saved favourite pint. */
export async function qualifyCheapPintForOwnerActor(ownerActor: string): Promise<void> {
  try {
    await cheapPintPingStore().qualifyCheapPint(ownerActor);
  } catch {
    // Qualifying must never block the write that triggered it.
  }
}

/** Resolve profile actor from a signed-in account id, then qualify. */
export async function qualifyCheapPintForAccountId(accountId: string): Promise<void> {
  try {
    const profile = await profileStore().getByUserId(accountId);
    if (!profile?.id) return;
    await qualifyCheapPintForOwnerActor(`profile:${profile.id}`);
  } catch {
    // Best-effort only.
  }
}
