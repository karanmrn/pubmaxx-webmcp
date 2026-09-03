// What the Pal may say it remembers, and where that memory comes from.
//
// IN-THREAD ONLY (ADR 0014 §6). This reads the asks already on screen in this
// conversation and nothing else: no storage, no account read, no durable Pal
// memory. Durable memory stays confirm-gated (ADR 0006), so a line here can
// never be the Pal quietly keeping something the drinker did not approve.
//
// It exists because a companion that has forgotten the question you asked two
// turns ago is not a companion. One quiet line, at most one per answer, naming
// a subject the drinker themselves raised.

/** Words that are in every ask and therefore recall nothing. */
const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "around",
  "cheap",
  "cheaper",
  "cheapest",
  "close",
  "drink",
  "drinks",
  "near",
  "night",
  "place",
  "places",
  "pint",
  "pints",
  "please",
  "pubs",
  "quiet",
  "round",
  "some",
  "somewhere",
  "there",
  "these",
  "thing",
  "things",
  "tonight",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

const MIN_TOPIC_LENGTH = 4;

function topics(ask: string): string[] {
  return ask
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length >= MIN_TOPIC_LENGTH && !STOPWORDS.has(word));
}

/** Print the topic the way the drinker wrote it, not lowercased back at them. */
function asWritten(ask: string, topic: string): string {
  const match = ask.match(new RegExp(`\\b${topic}\\b`, "i"));
  return match ? match[0] : topic;
}

export type PalRecall = {
  /** The subject both asks share, spelled as the drinker spelled it. */
  topic: string;
  line: string;
};

/**
 * One recall line for this answer, or none.
 *
 * `priorAsks` is oldest first. The EARLIEST ask that shares a subject wins,
 * because "you asked about this earlier" is about the first time, not the last.
 * An immediate repeat of the previous ask recalls nothing: the drinker can see
 * that turn, and telling them what they just typed is noise, not memory.
 */
export function palRecall(
  priorAsks: readonly string[],
  currentAsk: string,
): PalRecall | null {
  const current = new Set(topics(currentAsk));
  if (current.size === 0) return null;
  // The turn directly above is on screen; recalling it says nothing.
  const older = priorAsks.slice(0, -1);
  for (const ask of older) {
    for (const topic of topics(ask)) {
      if (!current.has(topic)) continue;
      const written = asWritten(ask, topic);
      return {
        topic: written,
        line: `You asked about ${written} earlier.`,
      };
    }
  }
  return null;
}
