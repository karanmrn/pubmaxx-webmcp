import { cleanText } from "@/lib/textClean";

export const CREW_NAME_MAX = 40;
export const CREW_MAX_MEMBERS = 20;

export const CREW_PRESENCE_STATUSES = [
  "in",
  "on_the_way",
  "here",
  "running_late",
  "start_without_me",
] as const;

export type CrewPresenceStatus = (typeof CREW_PRESENCE_STATUSES)[number];

export type CrewMemberDTO = {
  id: string;
  name: string;
  status: CrewPresenceStatus;
  joinedAt: string;
  updatedAt: string;
};

export function cleanCrewName(value: unknown): string {
  return cleanText(value, CREW_NAME_MAX);
}

/** Signed-in lock-in: prefer account metadata over an empty composer field. */
export function creatorNameFromAuthUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = user.user_metadata ?? {};
  const raw =
    (typeof meta.full_name === "string" && meta.full_name.trim())
    || (typeof meta.name === "string" && meta.name.trim())
    || (typeof user.email === "string" && user.email.split("@")[0]?.trim())
    || "";
  return cleanCrewName(raw);
}

export function isCrewPresenceStatus(value: unknown): value is CrewPresenceStatus {
  return typeof value === "string" && CREW_PRESENCE_STATUSES.includes(value as CrewPresenceStatus);
}
