/**
 * Choose the handle shown and sent by the Pint Drop composer.
 *
 * An account handle is the authority-bearing value. A browser draft remains
 * available only for the keyless demo path, where no account identity exists.
 */
export function pintDropAuthorValue(input: {
  accountHandle: string | null | undefined;
  draftHandle: string;
  signedIn: boolean;
  identityReady: boolean;
  authRequired?: boolean;
}): { handle: string; accountOwned: boolean; canSubmit: boolean } {
  if (input.signedIn && !input.identityReady) {
    return { handle: "", accountOwned: false, canSubmit: false };
  }

  if (input.authRequired && !input.signedIn) {
    return { handle: "", accountOwned: false, canSubmit: false };
  }

  const accountHandle = input.accountHandle?.trim() ?? "";
  if (accountHandle) {
    return { handle: accountHandle, accountOwned: true, canSubmit: true };
  }

  // A signed-in account without a profile handle must never inherit a previous
  // account's browser draft. Keep the field empty until onboarding resolves
  // the account-owned handle, and block programmatic submits too.
  if (input.signedIn) {
    return { handle: "", accountOwned: false, canSubmit: false };
  }

  return { handle: input.draftHandle, accountOwned: false, canSubmit: true };
}
