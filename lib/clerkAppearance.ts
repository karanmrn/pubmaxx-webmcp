// Clerk's rendered chrome, expressed in PUBMAXX design tokens.
//
// WHY EVERY VALUE IS A `var(--token)` AND NOT A HEX:
// DESIGN.md forbids forking hexes out of the token set, and the tokens are what
// carry the Candle Coral / Night Out theme swap. A hex here would be a third
// copy of the palette that stops following the theme toggle the moment either
// theme is retuned. Clerk emits these variables into real CSS, so a `var()`
// resolves live: Clerk's dialog re-themes with the rest of the app, for free
// and with no JavaScript listening to the theme.
//
// Clerk's modal renders in a portal on <body>, which is where app/globals.css
// remaps --paper, --panel-raised and --line to their DOM values (the :root
// copies belong to the map). So the dialog picks up the DOM palette by sitting
// where it sits. Do not "fix" this by pinning the :root values.

import type { ComponentProps } from "react";

import type { ClerkProvider } from "@clerk/nextjs";

// Derived from the prop we actually pass rather than imported from
// @clerk/shared/types: that package is a transitive dependency, so naming it
// here would let a Clerk minor version move the type out from under us.
type ClerkAppearance = NonNullable<
  ComponentProps<typeof ClerkProvider>["appearance"]
>;

export const clerkAppearance: ClerkAppearance = {
  variables: {
    // The One Accent Rule (DESIGN.md §2): coral owns the primary action in BOTH
    // themes. Clerk's stock chrome ships a blue primary, which would put a
    // second accent on screen and break that rule on sight.
    colorPrimary: "var(--brass)",
    // The coral CTA carries fixed dark label ink for AA contrast, exactly as
    // .planBtn does — coral is too light to take white text.
    colorPrimaryForeground: "var(--ink-deep)",

    colorBackground: "var(--panel-raised)",
    colorForeground: "var(--ink)",
    colorMuted: "var(--panel)",
    colorMutedForeground: "var(--muted)",

    colorInput: "var(--panel-raised)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--line)",
    // DESIGN.md §5, Inputs: focus is a coral accent ring, never a browser blue.
    colorRing: "var(--brass)",
    colorShadow: "var(--shadow-color, rgba(60, 30, 20, 0.18))",

    // Semantic roles keep their Field Guide jobs rather than Clerk's defaults.
    colorDanger: "var(--brick)",
    colorSuccess: "var(--pint)",
    colorWarning: "var(--amber)",

    // A modal is a blocking task, so it earns a dimming scrim that pushes the
    // page back (Apple HIG: dim to focus, separate to keep flow).
    colorModalBackdrop: "rgba(11, 11, 13, 0.55)",

    // The Inter-Is-Body Rule (DESIGN.md §3): Inter is never the display face,
    // and Clerk only ever sets body and control copy, so body is correct here.
    fontFamily: "var(--font-body)",
    fontFamilyButtons: "var(--font-body)",
    fontFamilyMono: "var(--font-data)",

    // Matches .authSignIn's pill radius, so a Clerk control and the Google and
    // Apple buttons beside it read as one family rather than two toolkits.
    borderRadius: "var(--control-radius, 14px)",
  },
};
