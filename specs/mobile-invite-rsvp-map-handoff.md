# Mobile Invite RSVP Map Handoff

Status: Approved for implementation

## Outcome

An authorised guest on a public Plan invite gets one clear next action:
`Open these stops on the map`. The action opens the ordered Crawl Route with no
account gate, including after reload or an RSVP recorded on another device.

## Design contract

| Field | Decision |
| --- | --- |
| Screen job | Show guest intent controls and return the guest to PUBMAXX Map truth for the same Crawl Route. |
| Primary user and action | Invite guest opens the ordered stops on the Map before or after recording Going or Maybe. |
| Content hierarchy | Plan identity and stops first. RSVP form and Map action next. Reactions remain last. |
| Navigation and controls | One native Map link whenever valid Venue IDs exist. No automatic redirect. Browser Back returns to the invite. |
| Visual language | Reuse invite mat, brass, ink, line, radius, focus, and press tokens. Success reads as a compact continuation inside RSVP flow, not a new card or modal. |
| Required states | Initial, confirmed, returning, and failed RSVP states keep the Map handoff. Zero valid Venue IDs render no Map link. |
| Responsive behavior | At 320px, 390px, and 430px, action is full-width, at least 44px high, does not overflow, and remains after the RSVP form in focus order. Desktop stays within the existing 560px mat. |
| Evidence used | [Revolut reimbursement confirmation](https://uizze.com/screens/699b436a002cf4cffead): completion state leads to one next action. [LinkedIn verification entry](https://uizze.com/screens/699c70f10006b7e2a68d): one linear continuation after a high-intent form. [Duolingo learning path selection](https://uizze.com/screens/4102a7711ec7dbe9a56e03bc6385e3af): one dominant full-width continuation on phone. Repository invite mat and existing Map URL builder remain authoritative. |
| Forbidden defaults | No generic toast, confetti, modal, floating CTA, duplicate Map link, automatic navigation, account prompt, invented route, or new analytics event. |
| Acceptance criteria | Every condition in the next section passes in a production browser at 390x844 and in affected regression tests. |

Reference screens provide hierarchy evidence only. Do not copy their branding,
text, imagery, or exact layout.

## Product rules

1. RSVP state may seed the committed response, but it does not own Map access.
2. A reload, later return, cross-device RSVP, HTTP error, or network error must
   not remove the Map handoff from an authorised invite.
3. One next action owns the Map transition.
4. Reuse `InviteMapLink`, `buildCrawlMapHref`, `venueMapUrl`, and
   `invite_map_opened`.
5. Two or more valid Venue IDs open
   `/map?mode=build&pubs=<ordered ids>`. One valid Venue ID opens its canonical
   selected-Venue Map URL. No valid IDs render no link.
6. The success status is announced without moving focus. Link remains a native
   anchor with visible focus and a 44px target.
7. Going and Maybe share the same next action. The action is independent of
   RSVP choice and current-session history.

## Acceptance matrix

| Gate | Verification | Pass condition |
| --- | --- | --- |
| Initial access | 390px Playwright | `Open these stops on the map` is present before RSVP. |
| Confirmed success | Real public invite POST | Guest row and count update; Map link remains present. |
| Failure posture | Intercepted 503 POST | Inline error appears; Map handoff remains present. |
| Ordered route | Link href and navigation | Multi-stop link preserves Venue ID order in `mode=build&pubs=`. |
| Mobile craft | Bounding boxes and screenshot | 44px target, no horizontal overflow, one clear primary continuation. |
| Accessibility | Keyboard and semantics | Completion uses status semantics; link is next in focus order and has visible focus. |
| Analytics | Existing event contract | Click emits only `invite_map_opened`; no registry change. |
| Regression safety | Focused tests, typecheck, lint, build | Existing invite RSVP, host removal, reactions, single-stop URL, and Map hydration remain green. |
