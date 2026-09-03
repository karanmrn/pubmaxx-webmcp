# Design Judge — Wave 2 Verdict (2026-07-20)

_The overnight taste loop's exit test. Every core mobile surface captured at 390x844 in both themes on a production build (SwiftShader WebGL for the map), judged against docs/DESIGN_DIRECTION_2026-07-18.md, docs/DESIGN_SYSTEM.md, docs/VOICE_AND_WORDING_SPEC_2026-07-18.md, docs/VIBE_LAYER_SPEC_2026-07-19.md and the design-engineering discipline. Evidence: docs/screenshots/judge-w2-*.png (14 primary shots + landing scroll pair; map re-shot at 15s paint via JUDGE_MAP_WAIT_MS)._

**Verdict: CLEAN PASS. Zero blocking findings. The #423-#432 wave holds together as one app.**

## Per-surface status

| Surface | Status | One-liner |
|---|---|---|
| / (landing) | Clean | Hierarchy carries: display headline, receipts subhead, one coral action, mono proof points; six-tab bar even in both themes. |
| /map/london | Clean | Fully painted both themes; compass sits clear of the pill row and floaters (judge-w1 fix verified); landmark register consistent. |
| /tonight | Clean | Honest quiet-night line with underlined map exit (friction fix live), vibe chips stamp in Bungee without shouting, value cards below the fold-line. |
| /today | Clean | Brief reads as a morning ritual: weather verdict, picks with map exit, privacy-honest last-train ask; card rhythm even. |
| /pal/chat | Clean | Chips + Tonight glance give the first open real value; covenant copy up top; input anchored with thumb-reach send. |
| /feed | Clean | One-row header, "Yours" label (banned Apple-ism gone), empty state hands a CTA not an apology. |
| /near (location denied) | Clean | Five priced cards render instantly, one dry line, compact Change area + retry; the borough wall is gone in both themes. |
| Pal first-open glance | Clean | Quiet-night line with map exit when whats-on is thin; nothing renders on outage. |

## Remaining polish (ranked, none blocking — wave-3 candidates)

1. **Pal chat mid-zone**: below the glance panel ~250px still sits empty at 390x844. Candidates: recent-ask history once transcripts persist, or a second glance row (cheapest pint near the remembered patch).
2. **Feed tab strip truncation**: "Cheap Lege…" clips at the viewport edge; the scroll fade + partial-chip peek is the affordance, but shorter labels would remove the need.
3. **/near header idiom**: back-arrow + centred logo differs from the main-surface header pill; acceptable for a sub-page, unify if it ever gains siblings.
4. **Landing coach chip**: the "Pick a drink" tooltip overlaps the hero image edge on first paint; transient and self-dismissing.
5. **Map first-frame attitude**: fresh-session capture reads flat; the designed 38/-8 attitude and its session restore were verified live post-#421. Watch only.

## Wave-3 disposition (2026-07-20, #434 + the w3 tail; closes #442)

1. **Pal chat mid-zone — burned (#434).** Second honest glance row (cheapest priced pub around the remembered patch, same `rankNearMe` answer Near me serves, pure `cheapestGlanceLine` formatter, silent on failure). After-shots `judge-w2-pal-chat-*-w3after.png`: chips + Tonight glance + Cheapest glance leave ~110px of breathing room above the composer, not a dead zone. Recent-ask history stays parked until transcripts persist.
2. **Feed tab strip — burned (#434 + w3 tail).** #434 shortened "Cheap Legends" to "Cheap pints" (stored id `cheap` unchanged); the w3after shot still clipped it mid-word at the 390px edge. The tail tightens the phone strip (column-gap 8→6px, chip inset 14→12px, 44px tap targets kept) so all four primary labels sit whole and the at-rest cut lands between chips, "More" peeking under the existing edge-fade. Label budget pinned as a contract test in `__tests__/feed.test.ts` (no chip label longer than "Cheap pints").
3. **/near header idiom — burned (#434).** Sub-page header echoes the app's `.siteNav` pill (border mix, pill radius, raised-panel gradient); back arrow stays. After-shots `judge-w2-near-denied-*-w3after.png`. Revisit only if /near gains siblings.
4. **Landing coach chip — closed, non-repro (#434).** Hint/card bounding rects identical at 300/700/1200/2500ms boot frames; `hint.top` always 18px inside the card, and the pill carries its own contrast (dark fill + backdrop blur, solid-panel fallback). The judged overlap was fold-contrast on first paint, not geometry. No change.
5. **Map first-frame attitude — watch only, mechanism confirmed (w3 tail).** The map is CONSTRUCTED with the designed London attitude (`city.mapView` pitch 38 / bearing -8 spread into the MapLibre constructor, PubMapCanvas), and a flat 0/0 saved viewport upgrades back to it via `withCityCameraAttitude` (lib/mobileShell.ts); no boot path zeroes pitch. The flat read in a fresh-session capture is perceptual: at zoom 11.5 the city-wide frame has almost no depth cues (no extruded geometry at that zoom), so 38° of pitch and -8° of bearing barely register in a still. Boot shots `polish-w3-map-boot-{1000,3000,6000}ms-dark-390.png`. No code change; drop the item if w4 re-judges clean at closer zooms.

## Notes

- Both themes were captured for every surface; no theme-specific defect found.
- All copy on the judged surfaces is em-dash free and in house voice; no banned register appeared.
- The vibe chips read as the user's voice (stamps), not the brand shouting: Bungee at chip scale with letter-spaced caps held its discipline on both Tonight and pal surfaces.
