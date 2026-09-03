import type { PersonaDrink } from "@/lib/personaDrinks";

export type PersonaPickerListEntry =
  | { kind: "clear" }
  | { kind: "persona"; persona: PersonaDrink };

export function buildPersonaPickerListEntries(input: {
  sections: ReadonlyArray<{
    personas: ReadonlyArray<PersonaDrink>;
  }>;
  includeClear: boolean;
}): PersonaPickerListEntry[] {
  const entries: PersonaPickerListEntry[] = [];
  if (input.includeClear) entries.push({ kind: "clear" });
  for (const section of input.sections) {
    for (const persona of section.personas) {
      entries.push({ kind: "persona", persona });
    }
  }
  return entries;
}

export function stepPersonaPickerActiveIndex(
  current: number,
  delta: 1 | -1,
  length: number,
): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  const next = current + delta;
  if (next < 0) return length - 1;
  if (next >= length) return 0;
  return next;
}
