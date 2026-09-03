import type { Auth } from "convex/server";

export type OwnerIdentity = Readonly<{
  issuer: string;
  subject: string;
}>;

export async function requireOwnerIdentity(auth: Auth): Promise<OwnerIdentity> {
  const identity = await auth.getUserIdentity();
  if (!identity?.issuer || !identity.subject) {
    throw new Error("Unauthenticated");
  }
  return { issuer: identity.issuer, subject: identity.subject };
}

export function assertOwner(
  expected: Pick<OwnerIdentity, "issuer" | "subject">,
  actual: OwnerIdentity,
): void {
  if (
    expected.issuer !== actual.issuer ||
    expected.subject !== actual.subject
  ) {
    throw new Error("Forbidden");
  }
}
