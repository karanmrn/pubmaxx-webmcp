# Future People and Data Platform Research

**Date:** 2026-07-15  
**Scope:** PubMax visual direction for living, translucent future characters; motion and accessibility principles; and a primary-source comparison of Convex and Supabase for a staged platform transition.

## Executive findings

1. The current procedural face is the wrong production direction. Premium examples create the feeling of a living subject from authored source material—face scans, depth maps, a facial rig, captured performance, or carefully art-directed video—and use shaders to transform that material. Shaders alone do not create believable character presence.
2. The strongest reference for PubMax is Phantom's depth-driven particle face system: a 2D colour render plus depth map drives roughly 78,400 particles, with manual calibration per face. It provides a credible route to a face-only hologram without shipping a photorealistic full body.
3. “Cyberpunk” should describe a coherent material and world system, not a layer of generic neon. CURSE's first-party positioning is useful here: it builds visual languages across concept artwork, video, stills, live visuals, branding, and installations. PubMax likewise needs one art bible that governs characters, glassware, motion, sound, typography, and environmental response.
4. The product shell should remain calm and legible while the character is expressive. Apple explicitly frames motion as a way to convey status, feedback, and instruction, and advises keeping important spatial content central while avoiding distracting peripheral motion.
5. A database migration should be staged by domain and contract, not treated as a visual-redesign prerequisite. The Night Signal renderer can ship against a static/versioned asset manifest. Application data can move later behind typed server functions with measured dual-read or dual-write cutovers.

## Visual reference audit

### Phantom / Codrops: the closest technical precedent

Phantom Studios' authored case study describes a Next/React site using React Three Fiber, GLSL, and one animation system across DOM and WebGL. Its employee faces are not CSS illustrations or generic generated heads: each starts with an iPhone RealityScan capture, is cleaned and rendered in Cinema4D to colour and position passes, then becomes two optimized 256×256 WebP inputs. A custom `BufferGeometry` shader constructs each face from a 280×280 particle grid. Brighter facial regions can receive larger particles, and each face is manually calibrated for depth, scale, and focus. [Phantom case study on Codrops](https://tympanus.net/codrops/2025/06/30/invisible-forces-the-making-of-phantom-lands-interactive-grid-and-3d-face-particle-system/)

**PubMax application:** commission or author six synthetic adult performances with a common capture/rig pipeline. Export a colour/emission pass, depth or position pass, facial masks, and glass/hand mattes. Reconstruct these as a particle or translucent-surface Signal in one canvas. This preserves human micro-expression while making the result visibly fictional and holographic.

### Until Labs / Codrops: particles need physical behavior

Basement Studio's authored Until Labs case study builds a living image from 60,000 particles, a framebuffer-based simulation, and physics-driven motion, keeping the particle field in one draw call with `GL_POINTS`. The useful lesson is not the exact particle count; it is the separation between source image, simulation state, and final composition. [Until Labs case study on Codrops](https://tympanus.net/codrops/2025/12/10/simulating-life-in-the-browser-creating-a-living-particle-system-for-the-untillabs-website/)

**PubMax application:** give particles a restrained lifecycle—assembly, breath, sip impulse, refraction wake, and dissolution—rather than continuous random jitter. The movement should respond to the character performance and selection state.

### Resn: interaction as a world, not decoration

Resn's first-party R&D archive spans mobile WebGL, browser AR, WebSockets, in-browser style transfer, dynamic video, and VR. Its `Little HelpAR` and `Hard Boiled` experiments demonstrate a recurring practice: choose interaction technology to serve a compact, playful premise, especially on mobile. [Resn Labs](https://labs.resn.co.nz/)

Awwwards' record of Resn's *Kekubian Assassin* identifies a mobile 3D/WebGL experience using gestures, sound, filters, and GSAP; its *adidas Originals NMD* record describes “urban noir” with product navigation and image shaders. These are useful precedents for a tightly art-directed atmosphere, but should not be copied literally. [Kekubian Assassin](https://www.awwwards.com/sites/kekubian-assassin) and [adidas Originals NMD](https://www.awwwards.com/sites/adidas-originals-nmd)

**PubMax application:** the Signal must have a simple product job: help the person choose a nightlife mood and summon the Pal. Do not turn core planning into a game level or force gesture-heavy navigation.

### Active Theory and Awwwards: immersive work still needs a clear interaction grammar

Awwwards' Active Theory examples document WebGL/GLSL hover and animation work and a Three.js/WebGL product customizer. [Active Theory about interaction](https://www.awwwards.com/inspiration/active-theory-about-page) and [Bonds Mash Up](https://www.awwwards.com/sites/bonds-mash-up)

**PubMax application:** use one interaction grammar across DOM and canvas—scroll advances the current Signal, tap selects, a second explicit action saves a preference, and back/escape always returns control. Avoid separate motion languages for the shell and the character.

### CURSE: likely meaning of the user's “Curse” reference

The plausible reference is [CURSE](https://www.curse.studio/), a London creative studio describing its work as visual identities across concept art, video/stills, live visuals, merchandise, branding, and installations. This is a much closer interpretation than a software or gaming site named “Curse.”

**PubMax application:** develop a short art bible before production: future-London premise; silhouette rules; adult age cues; face and hand framing; material response for each drink family; glassware accuracy; palette; camera; prohibited clichés; and fallback-frame composition.

### Airbnb: use motion assets as controlled product components

Airbnb's Lottie documentation describes an asset pipeline in which After Effects animations are exported as JSON and rendered across web and native platforms. Animations can be resized, scrubbed, recoloured, paused, and cached; Airbnb contrasts this with fixed-size GIF and PNG-sequence costs. [Lottie documentation](https://lottie.airbnb.tech/) and [Airbnb engineering overview](https://airbnb.tech/opensource/lottie/)

**PubMax application:** Lottie is appropriate for Pal reactions, progress unlocks, empty states, and lightweight shell transitions. It is not the renderer for the translucent 3D human face, hand, or refractive glass.

### X: useful restraint, not a character reference

X's first-party brand toolkit emphasizes a small set of recognizable, protected assets and unmodified post templates. [X brand toolkit](https://about.x.com/en/who-we-are/brand-toolkit)

**PubMax application:** borrow the discipline of a sparse, content-first shell and recognizable Signal silhouettes. Do not borrow X's monochrome identity or mistake brand minimalism for an immersive character system.

### Apple: hierarchy, tactility, and motion with purpose

Apple's Human Interface Guidelines say motion should convey status, feedback, and instruction, and note that interaction modality can change motion emphasis. Its spatial-layout guidance recommends keeping important content centered, avoiding distracting bright peripheral motion, and using depth in proportion to importance. [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) and [Apple spatial layout guidance](https://developer.apple.com/design/human-interface-guidelines/spatial-layout/)

**PubMax application:** the face and glass occupy the focal plane; route facts, price, and next action remain stable and readable. Depth should clarify the selected Signal, not push controls behind decorative layers.

## Recommended character system

### Art direction

- Six clearly adult, fictional “future people,” framed from face to partial neck plus one hand and correct glassware.
- Synthetic rather than realistic skin: translucent volume, particle breakup, internal contour lines, refractive edges, and selective opacity. Preserve eyes, eyelids, mouth, fingers, and glass rim so the performance reads emotionally.
- Each Signal has one material behavior tied to the drink—carbonation, botanical crystal, copper smoke, faceted amber, polished contours, or ice interference—but shares the same world, camera, facial proportions, and interaction grammar.
- No full bodies, celebrity likenesses, weapon motifs, random circuitry tattoos, generic neon city backdrops, or constant glitch.

### Asset and render pipeline

1. Create an art bible and 12–18 still look-development frames before implementation.
2. Build one shared facial/hand rig with blend shapes for blink, gaze, breath, glass raise, sip, swallow impression, reaction, and dissolve.
3. Author six performances from the same shot list and camera. Use synthetic designs or licensed performers transformed beyond identification; retain provenance and releases.
4. Export two delivery tiers:
   - High/medium: glTF/GLB geometry and animation, Meshopt or Draco geometry compression, KTX2 textures, masks, and material presets.
   - Low/reduced-motion: alpha-capable or background-matched short loops plus still WebP/AVIF posters.
5. Render one active Signal in one canvas. Dispose textures, render targets, and animation mixers on transitions and WebGL context loss.

Three.js' `GLTFLoader` supports Draco, Meshopt, KTX2/Basis textures, transmission, volume, iridescence, and WebP/AVIF texture extensions. Khronos describes KTX2 as reducing both transfer size and GPU memory through runtime transcoding to device-native compressed formats. [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [Khronos KTX](https://www.khronos.org/ktx/), and [Khronos glTF](https://www.khronos.org/gltf/)

### Accessibility and capability policy

- Start static; enable animation only when capability and user preference permit it.
- Under `prefers-reduced-motion: reduce`, suppress scroll-linked motion and looping performance; show a poster and user-triggered short cross-fade only. W3C Technique C39 specifically recommends using the media query to suppress non-essential interaction-triggered motion. [W3C C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
- Provide a text description and equivalent drink/mood selector outside the canvas.
- Never encode selection only in hue, transparency, sound, or animation.
- Treat reduced transparency and increased contrast as separate modes with solid panels and hard edges.

## Design decisions implied by the research

1. **Stop iterating the CSS/procedural face as if it can become the final asset.** Keep it only as an interaction-state-machine test fixture.
2. **Approve still frames before motion.** A beautiful animation cannot rescue an unconvincing silhouette, face, hand, or glass.
3. **Prototype one Signal end to end before producing all six.** Beer is the best pilot because bubbles make the material behavior immediately legible. Validate facial presence, glass contact, alpha edges, mobile thermals, reduced motion, and fallback quality.
4. **Separate cinematic and product layers.** The canvas owns character rendering; semantic HTML owns copy, price, route facts, controls, focus, and screen-reader behavior.
5. **Measure emotional quality and product clarity separately.** A moderated five-second impression test can assess “future person / alive / premium / adult,” while task tests measure whether a user can select a mood and open a plan without instruction.

## Platform research

### What “server-only database access” means with Convex

Convex's public interface is functions: queries read and are automatically cached/subscribable, mutations write transactionally, and actions call external APIs without direct database access. The browser can call a typed query or mutation, but it does not receive a raw table client. [Convex functions overview](https://docs.convex.dev/functions/overview)

There are therefore two valid boundaries:

1. **Typed-function boundary — recommended for reactive product state.** The browser calls narrowly scoped Convex queries/mutations. Every public function validates arguments, obtains the authenticated identity, authorizes the object/action, and returns a deliberate DTO. Raw database access remains server-side inside Convex.
2. **Next.js-only boundary — use for high-risk or non-reactive operations.** The browser calls a Next Route Handler or Server Action, which calls `fetchQuery`, `fetchMutation`, or `fetchAction`. Convex officially supports these helpers, plus `preloadQuery` to SSR a result and continue it as a reactive client query. [Convex Next.js module](https://docs.convex.dev/api/modules/nextjs)

Forcing every ordinary reactive read through Next.js would discard a central Convex benefit and add another network hop. PubMax should instead reserve the Next.js boundary for voice-token issuance, admin operations, file signing, exports, provider webhooks, and consequential Pal tool confirmations.

### Recommended target split

| Capability | Initial system of record | Reason |
|---|---|---|
| Authentication and account lifecycle | Supabase Auth | Already integrated; Convex Auth is beta and its Next.js SSR/server support is described as under active development. [Convex Auth](https://docs.convex.dev/auth/convex-auth) |
| Night Signal manifests | Versioned app/CDN assets | Visual deployment must not wait on a database migration. |
| Pal, appearance, personality, approved memory, mastery, Plan Completion | Convex | High-churn, user-scoped, reactive application state suits typed cached queries and transactional mutations. |
| Plan collaboration, presence, route-event state | Convex after the first domain cutover | Reactive subscriptions and optimistic updates are valuable here. [Convex optimistic updates](https://docs.convex.dev/client/react/optimistic-updates) |
| Pub/venue catalogue, geospatial analysis, admin reporting | Keep Postgres initially | Existing SQL/PostGIS and operational workflows are valuable; migrate only with evidence of a bottleneck. |
| User photos and production video | Supabase Storage/CDN initially | Mature private buckets, RLS, signed URLs, resumable uploads, transforms, and CDN. [Supabase Storage](https://supabase.com/docs/guides/storage) |
| ElevenLabs and other provider calls | Server-issued Next route plus internal Convex action/workflow | Secrets stay server-side; durable mutation records intent before scheduling external work. |

### Auth bridge and authorization

Convex supports OIDC/JWT authentication, but authorization is application code: each public function must check identity and resource ownership. [Convex auth overview](https://docs.convex.dev/auth/overview) and [authorization in functions](https://docs.convex.dev/auth/functions-auth)

The safest first migration retains Supabase Auth and maps its immutable JWT `sub` to an internal Convex user. Convex's custom JWT provider accepts RS256/ES256 and requires an exact issuer/JWKS configuration; its documentation warns that omitting audience verification is often insecure. Supabase publishes a JWKS endpoint when asymmetric signing keys are used. Before committing to the bridge, inspect a real PubMax token's `iss`, `aud`, `alg`, refresh behavior, and key configuration in a non-production test project. [Convex custom JWT provider](https://docs.convex.dev/auth/advanced/custom-jwt) and [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys)

Use these invariants in every public Convex function:

- validate the complete input schema;
- require identity for owned state;
- resolve identity through the immutable mapping, never a client-supplied user ID;
- authorize the specific plan, Pal, memory, or crew membership;
- return a minimal DTO;
- use internal functions for privileged follow-up work.

Supabase remains defensible if the team prefers a stricter BFF model: it supports Data API + RLS, Edge Functions, or trusted direct connections, and the Data API can be disabled for a server-only database. RLS is mandatory for exposed schemas; service-role clients bypass it and must never enter the browser. [Supabase securing data](https://supabase.com/docs/guides/database/secure-data) and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

### External actions and scheduling

Convex actions can call external providers but are not transactional and do not have direct database access. Convex specifically recommends recording intent in a mutation and scheduling an internal action instead of calling an action directly from the client. A mutation can atomically schedule `runAfter`/`runAt`; scheduled mutations execute exactly once, while scheduled actions execute at most once. Scheduled functions do not inherit auth context, so the trusted actor and authorization decision must be recorded explicitly. [Convex actions](https://docs.convex.dev/functions/actions) and [scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)

**PubMax pattern:** `requestVoiceTurn` mutation validates quota and consent, creates an idempotent job, and schedules an internal ElevenLabs action. The action reports outcome and metering through internal mutations. A failed provider call never silently mutates a Plan or memory.

Convex cron jobs suit small recurring reconciliation/expiry work. Supabase's `pg_cron` is also viable but its guide recommends no more than eight concurrent jobs and jobs under ten minutes. [Convex cron jobs](https://docs.convex.dev/scheduling/cron-jobs) and [Supabase Cron](https://supabase.com/docs/guides/cron)

### Files and media

Convex supports upload URLs and storage IDs, but its standard `storage.getUrl()` produces a reusable bearer URL that is revoked only when the file is deleted. Its docs recommend an authorized HTTP action when permissions may change, with a 20 MB response limit. [Convex file storage](https://docs.convex.dev/file-storage/overview) and [upload flow](https://docs.convex.dev/file-storage/upload-files)

That is not a reason to reject Convex, but it is a reason not to move PubMax media first. Keep Night Signal assets on a versioned CDN and user images/video in private Supabase buckets with signed URLs. Supabase Storage applies RLS to object metadata and supports private buckets. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

### Import, export, and staged migration

Convex import/export is beta. Its CLI accepts CSV, JSON, JSONL, and ZIP snapshots; a snapshot can preserve Convex IDs, while records originating in Postgres require an explicit stable-ID mapping. Imports can append or replace tables, with table replacement atomic. [Convex import/export](https://docs.convex.dev/database/import-export/) and [Convex import](https://docs.convex.dev/database/import-export/import)

Supabase backups cover Postgres data but not Storage object bytes, and the CLI supports logical database dumps. Both data and object manifests therefore need separate export/restore drills. [Supabase backups](https://supabase.com/docs/guides/platform/backups)

Recommended sequence:

1. **Contract and measurement:** inventory tables, store seams, auth ownership, realtime channels, storage paths, retention, and current P50/P95/P99. Define stable domain IDs and idempotency keys.
2. **Auth proof:** validate Supabase JWTs against Convex in a non-production environment; add a one-to-one identity mapping and negative authorization tests.
3. **New-domain pilot:** make Pal appearance/personality the first Convex-owned domain. Backfill nothing critical; retain a feature-flagged memory fallback.
4. **Trusted-state slice:** move proposed/approved memory, mastery ledger, and Plan Completion using idempotent mutations and audit fields.
5. **Reactive slice:** move active Plan collaboration and presence. Shadow-read against Supabase where equivalent data exists, compare, then cut reads over.
6. **Selective retention:** keep venue/geospatial/admin SQL and Storage until measurements demonstrate that moving them has greater benefit than risk.
7. **Cutover discipline:** per domain, backfill, checksum/count, shadow read, dual write only for a short bounded window, cut reads, stop old writes, observe, then archive. Every phase has a tested rollback and ownership runbook.

### Caching and navigation implications

- Use `preloadQuery` for authenticated Server Component shells that must become reactive after hydration; use direct `useQuery` for client-only live state and `fetchQuery` for server-only reads.
- Let Convex own caching for reactive queries. Avoid layering a stale Next data cache on top of personalized Convex state.
- Use Next's cache/CDN for public, versioned venue summaries and asset manifests only; invalidate by explicit version/tag.
- Prefetch the next likely tab's code and compact data after the current screen becomes interactive, not all tabs or all 3D assets at startup.
- Cache the selected Signal poster and low-tier loop locally; never eagerly download all six high-tier rigs.
- Do not cache authenticated Supabase responses that refresh a session: Supabase warns a cached `Set-Cookie` response can leak one user's session to another. [Supabase SSR auth advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- Prefer Supabase Broadcast over Postgres Changes if any legacy collaborative surface remains on Supabase; the Supabase guide recommends Broadcast for scalability and security. [Supabase Realtime database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)

### Migration decision

Adopt a **hybrid, domain-by-domain Convex migration**, not a database rewrite:

- keep Supabase Auth, Storage, and Postgres strengths initially;
- put new reactive Pal and completed-night state behind typed Convex functions;
- use direct typed client queries only where realtime matters, with authorization in every function;
- use Next.js routes/server actions for secrets and consequential operations;
- do not migrate authentication to Convex Auth in this release;
- do not migrate venue/PostGIS or media without measured evidence.

## Source-quality note

This is a representative, decision-oriented audit, not a claim to enumerate every design website. First-party studio case studies, product documentation, standards bodies, and official framework documentation were preferred. Awwwards is used only where it preserves useful project/technology records not exposed in a first-party case study.
