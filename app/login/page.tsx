import type { Metadata } from "next";

import LoginPage from "@/components/auth/LoginPage";
import {
  ARRIVAL_FROM_PARAM,
  ARRIVAL_INTENT_PARAM,
  LOGIN_ADD_ACCOUNT_PARAM,
  parseAddAccount,
  parseArrivalIntent,
} from "@/lib/arrivalWelcome";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to PUBMAXXING with email or a social account. Save prices, claim a handle, keep your nights.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

type RouteSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The chosen door, the page to return to and whether this is a SECOND account
 * are read on the server, so /login?mode=signup is a real destination that
 * renders as the sign-up door on first paint, and a nav hand-off (?from=/map)
 * needs no client round trip.
 */
export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return (
    <LoginPage
      initialIntent={parseArrivalIntent(first(params[ARRIVAL_INTENT_PARAM]))}
      from={first(params[ARRIVAL_FROM_PARAM])}
      addAccount={parseAddAccount(first(params[LOGIN_ADD_ACCOUNT_PARAM]))}
    />
  );
}
