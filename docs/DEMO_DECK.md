# PubMaxing — Demo Deck

> Markdown source of truth for the client demo. Replaces the stale `PubMaxing_Final_Demo.pptx` (kept as a build artifact only). Every claim here is checkable against `PRD_FINAL_FOR_FABLE.md` § "Current state".

---

## 1. PubMaxing

**Every real pint price in London, on a living map — and the story of every pub worth the walk.**

A price-aware, story-led pub-crawl planner. Truth in the price, truth in the past.

*Open on the pitched map and let London make the first impression.*

---

## 2. The problem

London pub discovery is split three ways: price lists, generic map directories, and personal memory.

- You can find a **cheap pint**, or a **nearby pub**, or a **famous old boozer** — never all three at once.
- The knowledge that makes a pub matter lives in people's heads, and the pubs are closing.
- No single place makes the tradeoff visible: a cheaper pint vs. a better room vs. a riverside setting vs. a stronger story.

*One sentence: nobody has put price, place, and story on the same map.*

---

## 3. The map — a living 3-D London

Built and running today:

- **3-D pitched view on load** with a stable reading surface. Camera motion follows an explicit place, route, cluster, city, or reader gesture.
- **3-D buildings, sky and fog** — the City and Canary Wharf read as skyline, not as a chart.
- **Price-aware venues** as custom price-coloured pins — brass stroke for story pubs, a halo where there are Pint Drops, clustered at low zoom.
- **Cinematic fly-to** on selection with a brass ring; crawl routes draw as an animated brass line between stops.
- **Landmark layer** — Big Ben, Tower Bridge, St Paul's and more, each with a short history card.
- **Two moods, one system** — candle-lit night city and printed day guidebook, fully token-themed.

*Demo live: tap a riverside pub, then watch the deliberate fly-to and brass route draw.*

---

## 4. The community layer — Pint Drops

A Pint Drop is a photo + the price you paid + a Passed-Down Note, attached to a real pub.

- **Shipped end-to-end**: photo composer, server-side validation, thumbnails, public photo URLs, and a report flow — all persisting to a live backend.
- **Provenance never blurs**: every claim renders as Sourced / Contributor / Anecdote — history and legend stay distinct.
- **Honest on day one**: the drops you see today are clearly-labelled **example** content seeded on the curated heritage pubs. Real community contributions activate at launch — the pipeline they'll flow through is already live.

*Be explicit that the seeds are labelled examples — the honesty is the pitch.*

---

## 5. The Landlord — a narrator that won't make it up

An AI that tells a pub's real history, grounded only in facts retrieved on the server.

- Answers **only from the heritage cache and curated sources** — user-supplied context is labelled Contributor, never Sourced.
- If it can't ground an answer, it says so: *"I won't make one up."*
- **Fail-closed by design**: deterministic output, hard timeout, token cap, and any response citing a fact that doesn't exist is rejected outright.

*Ask it something it can't know — the refusal is the demo.*

---

## 6. Trust & hardening

The unglamorous layer that makes public contributions safe:

- **Moderation console shipped**: report → hide → token-gated `/admin` review → restore or keep-hidden. Reviewers see hidden photos; the public never does.
- **Durable rate limiting** in Postgres — atomic, keyed on handle + salted-hashed IP, survives redeploys.
- **Quality gates**: 91 passing unit tests + a Playwright E2E smoke suite; lint, typecheck, and build green in CI.

*One line: community features are only as good as the abuse handling behind them.*

---

## 7. The honest numbers

- Cheapest real pint on the map: **£1.99** — not a marketing floor, an observed price.
- **3,000+ prices mapped** across London — mapped from a real dataset, not yet community-logged; that's what Pint Drops are for.
- Every sample card and chat mock in the product is labelled **Example**. No fake activity, anywhere.

*This slide exists because the product's whole thesis is that the data is real.*

---

## 8. Close — where Fable comes in

The engine is built: the interactive map, the community write-path, the grounded narrator, the moderation and rate limits. What it needs now is **craft**: pin design, landmark glyphs, the fly-to feel, the two-mood palette - the difference between a working map and an unforgettable one.

> "Open the map: London is ready to read, the old riverside pubs glow, and tapping one tells you why it's still standing."

*End on the map again — the ask is design partnership on a product that already works.*
