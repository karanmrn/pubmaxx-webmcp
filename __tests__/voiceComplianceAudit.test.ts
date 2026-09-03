import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  nightAreaOptionLabel,
  nightAreaSelectorGroups,
} from "@/components/plan/PlanComposer";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function notInspectedFiles(evidence: string): Set<string> {
  const sections = evidence.split("Not inspected:").slice(1);
  return new Set(sections.flatMap((section) => {
    const inventory = section.split(/\n##/u, 1)[0] ?? "";
    return [...inventory.matchAll(/^- `([^`]+)`$/gmu)].map((match) => match[1]);
  }));
}

describe("VOICE.md compliance audit", () => {
  it("records changed audit candidates as inspected and documents absolute-claim policy", () => {
    const evidence = read("docs/voice-audit-evidence.md");
    const notInspected = notInspectedFiles(evidence);
    const correctedCandidates = [
      "app/activity/ActivityClient.tsx",
      "app/borough/[slug]/page.tsx",
      "app/crawls/[slug]/not-found.tsx",
      "app/crawls/[slug]/page.tsx",
      "app/discover/DiscoverPageClient.tsx",
      "app/feed/FeedPageClient.tsx",
      "app/layout.tsx",
      "app/messages/MessagesInboxClient.tsx",
      "app/tonight/TonightClient.tsx",
      "components/PubMapCanvas.tsx",
      "components/areanews/AreaNewsList.tsx",
      "components/feed/FeedCard.tsx",
      "components/map/ControlRail.tsx",
      "components/map/pubmap/MapOnboardingOverlay.tsx",
      "components/mobile/MobileMapShell.tsx",
      "components/nearme/NearMeNow.tsx",
      "components/pal/PalExperience.tsx",
      "components/plan/PlanCollaborationPanel.tsx",
      "lib/cities/glasgow/curatedCrawls.ts",
      "lib/curation.ts",
      "lib/heritageCrawls.ts",
      "lib/planComposerHandoff.ts",
      "lib/pushSender.ts",
      "lib/pushTokenStore.ts",
      "lib/weeklyDigest.ts",
    ];

    expect([...notInspected].filter((file) => correctedCandidates.includes(file))).toEqual([]);
    expect(evidence).toContain("Total: 519. Inspected: 45. Not inspected: 474.");
    expect(evidence).toContain("Total: 93. Inspected: 29. Not inspected: 64.");
    expect(evidence).toContain("Total: 27. Inspected: 9. Not inspected: 18.");
    expect(evidence).toContain(
      "Absolute copy is kept only when a named code or data invariant enforces it.",
    );
  });

  it("keeps account and sign-in copy plain, precise, and free of identity plumbing", () => {
    const onboarding = read("components/identity/AccountOnboarding.tsx");
    const contributionGate = read(
      "components/identity/ContributionGateDialog.tsx",
    );
    const accountHub = read("components/profile/PubmaxxAccountHub.tsx");
    const checkInRoute = read("app/api/check-ins/route.ts");
    const checkInValidation = read("lib/checkIn.ts");
    const checkInClient = read("app/we-are-out/WeAreOutClient.tsx");

    expect(onboarding).toContain(
      "Your public handle appears on every contribution you make.",
    );
    expect(onboarding).not.toContain("owns every contribution");

    expect(contributionGate).toMatch(
      /Contributions show your public handle, so you need an account\s+first\./,
    );
    expect(contributionGate).toMatch(
      /Choose a public handle and add your date of birth before\s+contributing\./,
    );
    expect(contributionGate).not.toContain("account-owned");
    expect(contributionGate).not.toContain("private profile");

    expect(accountHub).toContain("<h3>Optional usage analytics</h3>");
    expect(accountHub).not.toContain("Anonymous usage analytics");
    expect(accountHub).not.toContain("person-level account checks");

    for (const source of [checkInRoute, checkInValidation, checkInClient]) {
      expect(source).toContain("Choose a handle in your account first.");
      expect(source).not.toContain("Drop a pint to claim one.");
    }
  });

  it("keeps map trust and failure copy exact without exposing map plumbing", () => {
    const legend = read("lib/mapPriceLegend.ts");
    const priceSubmit = read("components/map/VenuePriceSubmit.tsx");
    const communityPrice = read("lib/communityPrice.ts");
    const mapCanvas = read("components/PubMapCanvas.tsx");

    expect(legend).not.toContain("One recent pint report");
    expect(legend).not.toContain("curated pub");
    expect(legend).toContain("A recent pint report");
    expect(legend).toContain(
      "a second independent drinker reporting a similar price can set the pin's band",
    );

    for (const source of [priceSubmit, communityPrice]) {
      expect(source).not.toContain("logging the same price");
      expect(source).not.toContain("logs the same");
    }
    expect(priceSubmit).not.toContain("badged as community -");
    expect(communityPrice).not.toMatch(
      /(?:old|confirmation|unconfirmed) - /i,
    );
    expect(priceSubmit).not.toContain("account-owned");

    expect(mapCanvas).not.toContain("The map couldn't start its renderer.");
    expect(mapCanvas).not.toContain(
      "The map's renderer started but never drew a frame.",
    );
    expect(mapCanvas).not.toContain("Map renderer unavailable");
    expect(mapCanvas).not.toContain("can't paint the map");
    expect(mapCanvas).toContain("This browser or device cannot show the map right now.");
  });

  it("keeps journeys, empty states, and locality copy plain and supportable", () => {
    const plan = read("components/plan/PlanComposer.tsx");
    const planPage = read("app/plan/page.tsx");
    const feed = read("app/feed/FeedPageClient.tsx");
    const feedCard = read("components/feed/FeedCard.tsx");
    const today = read("app/today/TodayClient.tsx");
    const tonight = read("app/tonight/TonightClient.tsx");
    const tonightPage = read("app/tonight/page.tsx");
    const near = read("components/nearme/NearMeNow.tsx");
    const nearHeadline = read("lib/nearMeAnswer.ts");
    const nearPage = read("app/near/page.tsx");
    const palChatPage = read("app/pal/chat/page.tsx");
    const deals = read("components/discovery/DealsTonightLane.tsx");
    const rivalry = read("components/discovery/CityRivalryTable.tsx");
    const borough = read("app/borough/[slug]/page.tsx");
    const memories = read("components/profile/NightMemoryStudio.tsx");
    const planTemplates = read("lib/planTemplates.ts");

    for (const source of [plan, planPage]) {
      expect(source).not.toMatch(
        /capture state|captured coverage|evidence capture|evidence gate|evidence gaps|snapshot/iu,
      );
    }
    expect(planPage).not.toContain("group-chat archaeology");
    expect(planPage).not.toContain("actually make sense");

    expect(feed).toContain('title="Couldn\'t load Stories."');
    expect(feed).not.toContain("Couldn't pour the feed.");
    expect(feed).not.toContain("reach the bar");
    expect(feed).not.toContain("Capture a Moment");
    expect(feedCard).not.toContain("Provenance:");

    expect(today).not.toContain("refresh this by hand right now");
    expect(today).not.toContain("catch up shortly");
    expect(tonight).not.toContain("same spine as the map");
    expect(tonightPage).not.toContain("Same spine as the map");
    expect(tonightPage).toContain(
      "Check sourced London pub listings for tonight, with map links when available.",
    );
    expect(planTemplates).not.toContain("What's-On spine");
    expect(planTemplates).toContain("Quiz listings with start times.");

    // The near-me headline moved to lib/nearMeAnswer.ts (nearMeAnswerHeadline)
    // so the map's sheet chrome can check it never restates the body's line.
    // The sentence is still the one the reader gets, so the fence follows it.
    expect(nearHeadline).toContain("Cheapest listed near you");
    expect(near).not.toContain("Finding the cheapest");
    expect(near).not.toContain("Pulling up the cheapest");
    expect(nearPage).not.toContain("good pints");
    expect(nearPage).not.toContain("dated prices");
    expect(palChatPage).not.toContain("grounded picks");
    expect(palChatPage).not.toContain("nothing is made up");

    expect(deals).not.toContain("experience deals");
    expect(rivalry).not.toContain(
      'caption = "UK city energy. Demo Pint Drops, curated crawls',
    );
    expect(borough).not.toMatch(/curated (?:route|crawls)/iu);
    expect(memories).not.toContain("Capture a Moment");
  });

  it("keeps legal and Pint Index copy truthful and free of data plumbing", () => {
    const privacy = read("app/privacy/page.tsx");
    const terms = read("app/terms/page.tsx");
    const pintIndex = read("app/pint-index/page.tsx");
    const pintFacts = read("lib/pintFacts.ts");
    const leaderboard = read("components/discovery/LeaderboardTable.tsx");

    expect(privacy).not.toContain("Browsing is anonymous");
    expect(privacy).not.toContain("Anonymous usage analytics");
    expect(privacy).not.toContain("not a queue");
    expect(privacy).not.toContain("community observation rows");
    expect(privacy).not.toContain("A row is one observation");

    expect(terms).not.toContain("optional anonymous analytics");
    expect(terms).not.toContain("account identity boundary");
    expect(terms).not.toContain("Prices are observations, not offers");
    expect(terms).not.toContain(
      "Every price on PUBMAXX is what someone saw, on a date we show you",
    );
    expect(terms).toContain(
      "A current price names and links its publisher when its record does.",
    );
    expect(terms).toContain(
      "When no publisher is recorded for a price, we say so beside it.",
    );
    expect(terms).not.toContain(
      "Every current price names where it came from.",
    );

    for (const phrase of [
      "observation-date validation",
      "provenance-first",
      "provenance-validated snapshot",
      "Observation window:",
      "Download the public snapshot",
      "Methodology &amp; provenance",
      "Eligible evidence.",
      "boundary artifact",
      "Quarantine.",
      "product continuity",
      "evidence record",
      "Top of it right now:",
    ]) {
      expect(pintIndex).not.toContain(phrase);
    }
    expect(pintIndex).toContain("Method and sources");
    expect(pintIndex).toContain("Prices seen:");
    expect(pintFacts).toContain("Never a live feed.");
    expect(leaderboard).toContain("Not necessarily tonight's price.");
    expect(leaderboard).toContain("Not a live feed.");
  });

  it("keeps route, photo, operator, navigation, and API copy out of the plumbing", () => {
    const nightAreas = read("lib/nightAreas.ts");
    const coverage = read("components/night/NightAreaCoverage.tsx");
    const cityCapabilities = read("lib/cityCapabilities.ts");
    const planEndings = read("lib/planEndings.ts");
    const planOptimizer = read("lib/planRouteOptimizer.ts");
    const planCollaboration = read(
      "components/plan/PlanCollaborationPanel.tsx",
    );
    const operatorRail = read("components/operators/OperatorRailPanel.tsx");
    const operatorValidation = read("lib/venueOperators.ts");
    const mapList = read("components/map/MapVenueList.tsx");
    const mapOnboarding = read(
      "components/map/pubmap/MapOnboardingOverlay.tsx",
    );
    const controlRail = read("components/map/ControlRail.tsx");
    const momentPage = read("app/moment/page.tsx");
    const moment = read("components/moment/MomentCapture.tsx");
    const desktopPhoto = read(
      "components/map/composer/SpillDesktopCapture.tsx",
    );
    const layout = read("app/layout.tsx");
    const historicCard = read("app/historic/[slug]/opengraph-image.tsx");
    const crawlPage = read("app/crawls/[slug]/page.tsx");
    const crawlMissing = read("app/crawls/[slug]/not-found.tsx");
    const priceRoute = read("app/api/price-submit/route.ts");
    const conciergeRoute = read("app/api/concierge/route.ts");
    const weatherRoute = read("app/api/weather-recommendations/route.ts");
    const planRoute = read("app/api/plans/[id]/route.ts");
    const planComplete = read("app/api/plans/[id]/complete/route.ts");
    const operatorProposals = read("app/api/operator-proposals/route.ts");
    const admin = read("app/admin/AdminClient.tsx");

    expect(nightAreas).not.toMatch(
      /"[^"]*(?:capture district|Capture evidence|reviewed snapshot|evidence to verify|Crawl Route)[^"]*"/u,
    );
    expect(coverage).not.toMatch(/label: "(?:Captured|Discovered)"/u);
    expect(cityCapabilities).not.toContain("pint-price snapshot");
    expect(cityCapabilities).not.toContain("per-item provenance");
    expect(planEndings).not.toMatch(
      /"[^"]*(?:Night Area|late-food evidence|verify tonight)[^"]*"/u,
    );
    expect(planEndings).not.toMatch(/Nothing[^"]*close enough/iu);
    expect(planOptimizer).not.toContain("mapped Night Area radius");

    expect(planCollaboration).not.toContain("Could not verify that evidence");
    expect(planCollaboration).not.toContain("Route proposal to verify");
    expect(planCollaboration).not.toContain("Verify this proposal");
    for (const source of [operatorRail, operatorValidation]) {
      expect(source).not.toMatch(/"[^"]*verify you[^"]*"/iu);
    }
    expect(operatorRail).not.toContain("review every claim by hand");

    expect(mapList).not.toContain("Priced and curated");
    expect(mapOnboarding).not.toContain("Curated crawls");
    expect(controlRail).not.toContain("Curated crawls");
    expect(momentPage).not.toContain('title: "Capture a Moment"');
    expect(moment).not.toContain('aria-label="Choose what to capture"');
    expect(desktopPhoto).not.toContain(">Capture<");

    expect(layout).not.toContain("provenance-first");
    expect(historicCard).not.toContain("provenance-honest");
    for (const source of [crawlPage, crawlMissing]) {
      expect(source).not.toContain(">Discover</");
    }

    expect(priceRoute).not.toContain('"Missing observation id."');
    expect(priceRoute).not.toContain('"We cannot find that observation."');
    expect(conciergeRoute).not.toContain('"cityId is invalid."');
    expect(conciergeRoute).toContain('"Choose a listed city."');
    expect(weatherRoute).not.toContain("contributor provenance");
    expect(planRoute).not.toContain("Crawl Route");
    expect(planComplete).not.toContain("Crawl Route");
    expect(operatorProposals).toContain(
      "Only an approved operator of this venue can propose an update.",
    );
    expect(operatorProposals).not.toContain(
      "Only a verified operator of this venue can propose an update.",
    );
    expect(admin).toContain(
      "Proposals from approved pub operators land here for review before they show.",
    );
    expect(admin).not.toContain(
      "Claims from approved pub operators land here for review before they show.",
    );
  });

  it("keeps remaining public copy free of hard bans, AI contrasts, jokes in errors, and live-price overclaims", () => {
    const palPortrait = read("components/pal/PalPortrait.tsx");
    const palManifest = read("lib/pubPal.ts");
    const near = read("components/nearme/NearMeNow.tsx");
    const privacy = read("app/privacy/page.tsx");
    const terms = read("app/terms/page.tsx");
    const recap = read("lib/recapView.ts");
    const tour = read("components/onboarding/FirstRunTour.tsx");
    const stories = read("app/discover/DiscoverPageClient.tsx");
    const digest = read("lib/weeklyDigest.ts");
    const landing = read("components/landing/LandingPage.tsx");
    const crew = read("components/plan/PlanCrew.tsx");
    const plan = read("components/plan/PlanComposer.tsx");
    const activity = read("app/activity/ActivityClient.tsx");
    const profile = read("app/u/[handle]/ProfilePageClient.tsx");
    const unsupportedArea = read(
      "components/coverage/UnsupportedAreaPreview.tsx",
    );
    const areaDemandRoute = read("app/api/area-demand/route.ts");
    const pintDropsRoute = read("app/api/pint-drops/route.ts");
    const pintDropsStore = read("lib/pintDropsStore.ts");
    const whatsOn = read("lib/concierge/whatsOn.ts");
    const palChat = read("lib/palChat.ts");
    const pushSender = read("lib/pushSender.ts");
    const about = read("app/about/page.tsx");
    const accountHub = read("components/profile/PubmaxxAccountHub.tsx");

    expect(palPortrait).not.toMatch(
      /(?:collar|bell) beacon|crew-band harness/iu,
    );
    expect(palManifest).not.toMatch(
      /signatureProp: "(?:brass bell beacon|crew-band harness)"/iu,
    );
    expect(near).not.toContain('aria-label="Pick a night area"');
    expect(privacy).not.toContain("law doesn&rsquo;t require one");
    expect(terms).not.toMatch(/\b(?:does not require|required to finish)\b/iu);
    expect(terms).not.toContain("So does everyone logging prices");
    expect(terms).not.toContain("If rewards go live");
    expect(recap).not.toContain("ancient bylaws require");

    expect(tour).not.toContain("See who pours cheap tonight");
    expect(tour).not.toContain('title: "Cheapest tonight"');
    // #816 collapsed the tour to one legend beat: the title is the shared
    // ORIENTATION_LEGEND_TITLE and the body owns the honest grey-pin line.
    expect(tour).toContain("ORIENTATION_LEGEND_TITLE");
    expect(tour).toContain("Grey means nobody has logged a");
    expect(stories).not.toContain("There is a story behind every pint.");
    expect(stories).not.toContain("Cheapest Pints Tonight");
    expect(stories).not.toContain("not gospel");
    expect(stories).toContain(
      "Latest community-reported pint against the earlier price",
    );
    expect(stories).toContain("Recently logged cheap pints");
    expect(digest).not.toContain("Cheapest isn't just Wetherspoons:");
    expect(digest).not.toMatch(/independent pubs[^"]*undercut/iu);
    expect(digest).not.toContain("data moat");
    expect(digest).not.toContain("We never invent");
    expect(palChat).not.toContain("Nothing verified for that yet");
    expect(palChat).not.toContain("I won't make anything up");
    expect(pushSender).not.toContain("new signals tonight");
    expect(pushSender).toContain("updates for tonight");
    expect(landing).not.toContain("Cheap pints near you, live");
    expect(landing).not.toContain("No endless listings. Just");
    expect(landing).not.toContain("Every price names where it came from");
    expect(about).not.toContain("Every one names where it came from");
    expect(about).not.toContain("Listed prices name their sources");
    expect(about).not.toContain("Listed pint prices with named sources");
    expect(about).not.toMatch(/prices from real people|every figure links back/iu);
    expect(accountHub).not.toMatch(/prices from real people/iu);
    expect(about).toMatch(
      /names? and links? publishers? when recorded[\s\S]*says? when none is recorded/iu,
    );
    expect(accountHub).toMatch(
      /prices name and link their publisher when recorded and say when none is recorded/iu,
    );
    expect(crew).not.toContain("No account. Just your name.");

    expect(activity).not.toContain("reach the bar");
    expect(activity).not.toContain("every follow, cheer and comment");
    expect(about).not.toContain("Every price and every fact");
    expect(about).not.toContain("Nothing in here nudges you to drink more");
    expect(plan).not.toContain("Every listed area can be planned");
    expect(plan).not.toContain("Every area can still make an editable route");
    expect(profile).not.toContain("Please try again");
    expect(unsupportedArea).not.toContain("Could not note that just now");
    expect(areaDemandRoute).not.toContain("Could not note that right now");
    expect(pintDropsRoute).not.toContain("Thanks!");
    expect(pintDropsStore).not.toContain("Please try a different image");
    expect(whatsOn).not.toContain("No verified");
    expect(whatsOn).not.toMatch(/Found .* verified /u);
    expect(plan).not.toContain(
      "Night Context could not be saved. Please try again.",
    );
  });
});

// Design judgement 2026-08-01, finding 2.11. Every string below was printed on
// a reader surface and named an internal thing: a component ("Tonight arc"), a
// spine enum ("Freshness unknown"), an evidence stage ("Review expired"), or a
// scoring band ("Low confidence"). VOICE.md rule 2 bans all four shapes, so the
// fence names each removed literal rather than the class of literal, and a
// reintroduction fails here instead of reaching a thirsty reader.
describe("VOICE.md rule 2 — plumbing words stay off reader surfaces", () => {
  it("keeps the Tonight arc chips without their component name", () => {
    const chips = read("components/map/TonightArcChips.tsx");
    const chipsCss = read("components/map/tonightArcChips.css");

    // Neither the visible title nor the accessible name may carry it: a screen
    // reader user is a reader too.
    expect(chips).not.toMatch(/>\s*Tonight arc\s*</u);
    expect(chips).not.toContain('aria-label="Tonight arc');
    expect(chips).toContain('aria-label="Venue types"');
    expect(chipsCss).not.toContain(".tonightArcLabel");
  });

  it("never prints the freshness spine's enum", () => {
    for (const path of [
      "lib/tonight.ts",
      "lib/whatsOnBadges.ts",
      "app/tonight/TonightClient.tsx",
    ]) {
      expect(read(path)).not.toContain("Freshness unknown");
    }

    // An undatable source states the fact plainly instead of sitting in the
    // interpunct chain, which is what made the /tonight subtitle read as debug
    // output rather than a sentence.
    // The sentence itself now lives in TonightProvenanceLines.tsx, which
    // TonightClient.tsx renders rather than inlining the string.
    expect(read("app/tonight/TonightProvenanceLines.tsx")).toContain("We can’t date these listings yet.");
    expect(read("lib/whatsOnBadges.ts")).toContain("No date on this yet");
    expect(read("lib/tonight.ts")).toContain("No date on this yet");
  });

  it("names area coverage in pub words, not evidence stages or score bands", () => {
    const areaButton = read("lib/areaButton.ts");
    const mobilePlan = read("components/plan/MobilePlanActivation.tsx");

    for (const source of [areaButton, mobilePlan]) {
      expect(source).not.toContain("Low confidence");
      expect(source).not.toContain("Higher confidence");
      expect(source).not.toContain("Plan with warnings");
      expect(source).not.toContain("Plan with checks");
      expect(source).not.toContain("Review expired");
    }
    // The replacement set is one vocabulary across all three call sites.
    expect(areaButton).toContain("Rough guess");
    expect(areaButton).toContain("Not all checked");
    expect(areaButton).toContain("Gone stale");
    expect(mobilePlan).toContain("Prices checked");

    const groups = nightAreaSelectorGroups(new Date("2026-07-13T12:00:00.000Z"));
    expect(groups.map((group) => group.label)).toEqual([
      "Crawl-ready",
      "Not crawl-ready yet",
    ]);
    const notReady = groups[1]?.areas.find((area) => area.slug === "barnes");
    expect(notReady).toBeDefined();
    expect(nightAreaOptionLabel(notReady!, false)).toBe("Barnes - not crawl-ready yet");
  });

  it("keeps the Plan result and Pub Pal free of product-speak", () => {
    const composer = read("components/plan/PlanComposer.tsx");
    const pal = read("components/pal/PalExperience.tsx");

    expect(composer).not.toContain("Context changed");
    expect(composer).toMatch(/You&rsquo;ve changed the night since we sorted it/u);
    expect(pal).not.toContain("Optional by design");
    expect(pal).not.toContain("Route before character");
    expect(pal).toContain("Meet your companion");
    expect(pal).toContain("A little signal that becomes yours.");
  });
});

// Design judgement 2026-08-01, finding 2.12. DESIGN_SYSTEM.md retired tracked
// all-caps labels: sentence case at ~0.01em, caps kept only for stamp chips
// that read as a pressed mark. These are the eyebrow rules that broke it.
describe("DESIGN_SYSTEM.md caps policy — eyebrows are sentence case", () => {
  const EYEBROW_RULES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["app/plan/plan.css", [
      ".planPage__masthead",
      ".planPage__eyebrow",
      ".matchGroupPrefs__eyebrow",
      ".planIntake__eyebrow",
      ".planComposer__coverageGroups h3",
      ".planComposer__stops legend",
      ".invitePreview__detail dt",
    ]],
    ["app/tonight/tonight.css", [
      ".tonightEyebrow",
      ".tonightRowKind",
    ]],
    ["components/vibe/vibeChips.css", [".vibeChipsLede"]],
    ["app/pal/pal.css", [".palEyebrow", ".palMemoryList__meta span"]],
    ["components/pal/palChat.css", [".palChatEyebrow", ".palGlanceLabel"]],
    ["components/emptyState.css", [".emptyStateEyebrow"]],
    ["app/messages/messages.css", [".messagesThreadEyebrow"]],
    ["components/landing/landing.css", [".lpSectionLabel", ".thamesHeroPinCat"]],
    ["components/plan/nightCrawl.css", [
      ".nightCrawl__kicker",
      ".nightCrawl__eyebrow",
      ".nightCrawl__crewLabel",
      ".nightCrawl__enterKicker",
    ]],
  ];

  it.each(EYEBROW_RULES)("keeps %s eyebrows out of uppercase", (path, selectors) => {
    const css = read(path);
    for (const selector of selectors) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const rule = new RegExp(`${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "u");
      const match = rule.exec(css);
      expect(match, `${selector} not found in ${path}`).not.toBeNull();
      // Wide tracking existed only to make caps legible. Both go together, so
      // a rule that drops the caps and keeps 0.13em is still the retired look.
      expect(match![1]).not.toContain("text-transform: uppercase");
      expect(match![1]).not.toMatch(/letter-spacing:\s*0?\.(?:0[2-9]|[1-9])/u);
    }
  });
});
