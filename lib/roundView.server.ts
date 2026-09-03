import "server-only";

import { callerUserId } from "@/lib/authServer";
import { identityHandleStore } from "@/lib/identityHandleStore";
import type { RoundState, RoundViewState } from "@/lib/rounds";

export async function projectRoundView(
  request: Request,
  state: RoundState,
): Promise<RoundViewState> {
  try {
    const userId = await callerUserId(request);
    if (!userId) return state;
    const viewerMemberHandle = await identityHandleStore().ownedHandle(
      userId,
      state.members.map((member) => member.handle),
    );
    return {
      ...state,
      ...(viewerMemberHandle ? { viewerMemberHandle } : {}),
    };
  } catch {
    return state;
  }
}
