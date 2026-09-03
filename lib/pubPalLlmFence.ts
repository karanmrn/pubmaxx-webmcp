// Register fence for Pub Pal Custom LLM: get-home and sobriety topics never
// receive freestyle model prose. Grounded Ask tools may supply last-train and
// journey facts; the pal never assesses sobriety or nudges another drink.

export const PUB_PAL_GET_HOME_SOBRIETY_RE =
  /\b(?:get(?:ting)?\s+home|last\s+train|heading\s+home|should\s+i\s+have\s+(?:one\s+)?more|one\s+more\s+(?:drink|pint)|am\s+i\s+(?:okay|ok|fine|sober|drunk)|sobri(?:ety|ous)|drunk\s+enough|fit\s+to\s+drive|drive\s+home|uber\s+home|taxi\s+home|way\s+home|how\s+(?:do|can)\s+i\s+get\s+home)\b/i;

export const PUB_PAL_SOBRIETY_ONLY_RE =
  /\b(?:should\s+i\s+have\s+(?:one\s+)?more|one\s+more\s+(?:drink|pint)|am\s+i\s+(?:okay|ok|fine|sober|drunk)|sobri(?:ety|ous)|drunk\s+enough|fit\s+to\s+drive)\b/i;

export const PUB_PAL_GET_HOME_REGISTER_CLOSER =
  "Open Getting Home on the venue sheet for last-train times, ride links, and the TfL planner.";

export const PUB_PAL_SOBRIETY_REGISTER =
  "I cannot tell you whether to have another drink.";

export function isPubPalGetHomeOrSobrietyIntent(text: string): boolean {
  return PUB_PAL_GET_HOME_SOBRIETY_RE.test(text.trim());
}

export function isPubPalSobrietyOnlyIntent(text: string): boolean {
  return PUB_PAL_SOBRIETY_ONLY_RE.test(text.trim());
}

/** Compose a plain register answer from grounded tool hints only. */
export function pubPalGetHomeRegisterAnswer(
  groundedAnswer: string,
  sobrietyOnly: boolean,
): string {
  if (sobrietyOnly) {
    const fact = groundedAnswer.trim();
    if (fact && !/cannot tell you whether to have another drink/i.test(fact)) {
      return `${PUB_PAL_SOBRIETY_REGISTER} ${fact} ${PUB_PAL_GET_HOME_REGISTER_CLOSER}`;
    }
    return `${PUB_PAL_SOBRIETY_REGISTER} ${PUB_PAL_GET_HOME_REGISTER_CLOSER}`;
  }

  const fact = groundedAnswer.trim();
  if (!fact) {
    return PUB_PAL_GET_HOME_REGISTER_CLOSER;
  }
  return `${fact} ${PUB_PAL_GET_HOME_REGISTER_CLOSER}`;
}
