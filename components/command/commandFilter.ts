// Pure, dependency-free filter/ranking for the command palette. Kept a plain
// function (no React, no DOM) so it is unit-testable in the node vitest env and
// so the palette component can wrap it in a single useMemo.

import type { Command } from "./types";

/** Is `query` a subsequence of `target` (chars in order, gaps allowed)? */
function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i += 1) {
    if (target[i] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

/**
 * Score a single command against a normalised (lowercased, trimmed) query.
 * Higher is a better match; a return of 0 means "no match" (excluded).
 *
 * Ranking, high→low: exact label · label prefix · label substring · keyword
 * exact · keyword prefix · keyword substring · label subsequence · keyword
 * subsequence. Label matches always outrank keyword matches at the same tier so
 * "map" surfaces the Map command above anything that merely lists "map" as a
 * keyword.
 */
export function scoreCommand(command: Command, query: string): number {
  if (query === "") return 1; // empty query → everything matches (order kept by caller)

  const label = command.label.toLowerCase();
  const keywords = (command.keywords ?? []).map((k) => k.toLowerCase());

  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;

  if (keywords.some((k) => k === query)) return 55;
  if (keywords.some((k) => k.startsWith(query))) return 45;
  if (keywords.some((k) => k.includes(query))) return 35;

  if (isSubsequence(query, label)) return 20;
  if (keywords.some((k) => isSubsequence(query, k))) return 15;

  return 0;
}

/**
 * Filter + rank a command list for a raw query string.
 *  - Empty/whitespace query returns every command in its original order.
 *  - Otherwise only matches are returned, ranked by score (desc). Ties keep the
 *    registry's original order (stable) so the layout stays predictable.
 */
export function filterCommands(commands: Command[], rawQuery: string): Command[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === "") return [...commands];

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}
