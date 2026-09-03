// Shared types for the global ⌘K command palette (feature N1).
// Kept in a react-free module so the command registry + the pure filter can be
// imported anywhere (including the node-environment vitest suite) without
// pulling in Next/React.

/** Palette sections, rendered in this order under their group headers. */
export type CommandGroup = "Navigate" | "Actions";

/**
 * The side-effects a command may run. Supplied by CommandPaletteProvider /
 * CommandPalette at call time so `commands.ts` stays a pure data module and
 * never has to reach for a router or the DOM itself.
 */
export type CommandContext = {
  /** Client-navigate to an in-app href (router.push under the hood). */
  navigate: (href: string) => void;
  /** Close the palette. */
  close: () => void;
  /** Flip light ↔ dark (mirrors the ThemeToggle mechanism). */
  toggleTheme: () => void;
};

/** One entry in the palette. */
export type Command = {
  /** Stable id — also used as the option's DOM id for aria-activedescendant. */
  id: string;
  /** Primary, human label shown in the row (and matched first when filtering). */
  label: string;
  /** Optional trailing hint (e.g. a route or a short description). */
  hint?: string;
  /** Extra search terms that never render but widen what the filter matches. */
  keywords?: string[];
  /** Which section the command lives under. */
  group: CommandGroup;
  /** Run the command. The palette closes itself before invoking this. */
  run: (ctx: CommandContext) => void;
};
