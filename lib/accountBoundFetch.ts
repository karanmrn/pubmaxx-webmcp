import type { Session } from "@supabase/supabase-js";

export type AccountAuthSnapshot = Readonly<{
  userId: string;
  accessToken: string;
}>;

type AccountSession = Pick<Session, "access_token"> & {
  user: Pick<Session["user"], "id">;
};

export type AccountBoundRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function captureAccountAuth(
  expectedUserId: string | null,
  session: AccountSession | null,
): AccountAuthSnapshot | null {
  if (
    !expectedUserId ||
    session?.user.id !== expectedUserId ||
    !session.access_token
  ) {
    return null;
  }
  return {
    userId: expectedUserId,
    accessToken: session.access_token,
  };
}

export function sameAccountAuth(
  left: AccountAuthSnapshot | null | undefined,
  right: AccountAuthSnapshot | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.userId === right.userId &&
    left.accessToken === right.accessToken
  );
}

export function accountComposerAuth(
  expectedUserId: string | null,
  session: AccountSession | null,
  rejectedAuth: AccountAuthSnapshot | null | undefined,
): AccountAuthSnapshot | null {
  const auth = captureAccountAuth(expectedUserId, session);
  return sameAccountAuth(auth, rejectedAuth) ? null : auth;
}

export function rejectAccountAuth(
  current: AccountAuthSnapshot | null,
  rejected: AccountAuthSnapshot | null,
): AccountAuthSnapshot | null {
  if (!rejected || sameAccountAuth(current, rejected)) return current;
  return rejected;
}

export async function accountBoundFetch(
  auth: AccountAuthSnapshot | null,
  input: RequestInfo | URL,
  init: RequestInit = {},
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  if (!auth) throw new Error("Authenticated account changed.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${auth.accessToken}`);
  return request(input, { ...init, headers });
}
