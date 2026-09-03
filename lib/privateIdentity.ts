export const PRIVATE_IDENTITY_SEX_VALUES = [
  "female",
  "male",
  "intersex",
  "prefer_not_to_say",
] as const;

export type PrivateIdentitySex =
  (typeof PRIVATE_IDENTITY_SEX_VALUES)[number];

export const PRIVATE_IDENTITY_GENDER_VALUES = [
  "woman",
  "man",
  "non_binary",
  "self_described",
  "prefer_not_to_say",
] as const;

export type PrivateIdentityGender =
  (typeof PRIVATE_IDENTITY_GENDER_VALUES)[number];

export const MAX_GENDER_SELF_DESCRIBED = 60;

/**
 * Display migration for accounts that answered the legacy sex question before
 * gender existed: the editor shows one Gender field, so a legacy answer maps
 * to the gender it plainly names. "intersex" names no gender and stays unset.
 * The stored sex value is never rewritten by this mapping; a save persists
 * the shown gender through the gender columns only.
 */
export function genderFromLegacySex(
  sex: "" | PrivateIdentitySex,
): "" | PrivateIdentityGender {
  switch (sex) {
    case "female":
      return "woman";
    case "male":
      return "man";
    case "prefer_not_to_say":
      return "prefer_not_to_say";
    default:
      return "";
  }
}

export function londonCalendarDate(now: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function cleanDateOfBirth(
  value: unknown,
  now: number = Date.now(),
): string | null {
  if (typeof value !== "string") return null;
  const dateOfBirth = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    dateOfBirth > londonCalendarDate(now)
  ) {
    return null;
  }
  return dateOfBirth;
}
