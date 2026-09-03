import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isCrewId } from "@/lib/socialCrewsUi";

import PublicCrewRouteClient from "@/components/social/PublicCrewRouteClient";

// Invite and Crew routes stay noindex. Open Crews may show a narrow public
// preview without an account, while member data and every write remain behind
// the verified Social actor route.
export const metadata: Metadata = {
  title: "Crew",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CrewPage({
  params,
  searchParams,
}: {
  params: Promise<{ crewId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crewId } = await params;
  if (!isCrewId(crewId)) notFound();
  const search = await searchParams;
  const raw = Array.isArray(search.invitation)
    ? search.invitation[0]
    : search.invitation;
  const invitationId = isCrewId(raw) ? raw : null;

  return <PublicCrewRouteClient key={crewId} crewId={crewId} invitationId={invitationId} />;
}
