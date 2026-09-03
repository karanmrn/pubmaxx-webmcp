// What a PUBMAXX password must be, and the words we use to say so.
//
// ONE module owns this, because three surfaces ask the same question and a
// second copy of the rules is how a hint comes to promise something the check
// refuses: the login form (`components/auth/HandlePasswordSignIn.tsx`), the
// create/change form (`components/auth/SetAccountPassword.tsx`) and the
// sign-in route (`app/api/auth/handle-password/route.ts`).
//
// The module is PURE - no server imports, no browser imports - so both halves
// read the same table.
//
// CREATION and SIGN-IN are two questions. `PASSWORD_RULES` governs what a
// person may CREATE. Sign-in applies the length floor alone: a password that
// predates a rule is still that account's password, and refusing it at our own
// door would lock an owner out of the account rather than protect it. The
// character rules are enforced where the password is chosen.

export const MIN_PASSWORD_LENGTH = 8;

/** One line under the field, shown before anybody types. */
export const PASSWORD_HINT =
  "At least 8 characters, with one capital letter, one number and one special character.";

/** The single line a refused password gets. Same words as the hint. */
export const PASSWORD_POLICY_ERROR =
  "Use at least 8 characters, with one capital letter, one number and one special character.";

/** Sign-in says nothing about WHICH half was wrong. */
export const HANDLE_PASSWORD_GENERIC_ERROR = "Handle or password is wrong.";

/** Change-password verification names no field when proof fails. */
export const PASSWORD_CHANGE_GENERIC_ERROR =
  "Could not change your password. Try again.";

export type PasswordRuleId = "length" | "capital" | "number" | "special";

export type PasswordRule = {
  id: PasswordRuleId;
  /** The tick's own label. Reads on its own, because a tick is read on its own. */
  label: string;
  test: (value: string) => boolean;
};

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `${MIN_PASSWORD_LENGTH} characters or more`,
    test: (value) => value.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: "capital",
    label: "One capital letter",
    test: (value) => /\p{Lu}/u.test(value),
  },
  {
    id: "number",
    label: "One number",
    test: (value) => /\p{Nd}/u.test(value),
  },
  {
    // Anything that is neither a letter nor a number. A wider net than a fixed
    // symbol list, which would refuse a symbol somebody's keyboard offers.
    id: "special",
    label: "One special character",
    test: (value) => /[^\p{L}\p{N}]/u.test(value),
  },
];

export type PasswordRuleResult = {
  id: PasswordRuleId;
  label: string;
  met: boolean;
};

/** Per-rule state for the live ticks. Order matches the hint. */
export function passwordRuleResults(value: string): PasswordRuleResult[] {
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(value),
  }));
}

export type PasswordCheck =
  | { ok: true }
  | { ok: false; failed: PasswordRuleId[]; message: string };

/** The one check both halves run before a password is accepted. */
export function checkPassword(value: unknown): PasswordCheck {
  const password = typeof value === "string" ? value : "";
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(password)).map(
    (rule) => rule.id,
  );
  return failed.length === 0
    ? { ok: true }
    : { ok: false, failed, message: PASSWORD_POLICY_ERROR };
}

/** True when the value clears every rule. */
export function meetsPasswordPolicy(value: unknown): boolean {
  return checkPassword(value).ok;
}
