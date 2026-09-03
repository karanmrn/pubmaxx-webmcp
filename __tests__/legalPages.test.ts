import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { CONTACT_EMAIL } from "@/lib/siteContact";
import {
  WEATHER_RECOMMENDATION_CONDITIONS,
  weatherRecommendationConditionLabel,
} from "@/lib/weatherRecommendations";

// The /privacy + /terms fence. These pages are the only surfaces where the site
// makes promises about data ON THE RECORD, so the regressions that matter are
// (a) a reader who cannot find them, (b) a dead contact address, and (c) a
// privacy claim drifting away from what the code does. Source-level assertions,
// the same house pattern as landingChromeCss.test.ts: they fail in CI rather
// than needing a browser pass we can't run headless.

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function pageVisibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const privacy = read("app/privacy/page.tsx");
const terms = read("app/terms/page.tsx");
const privacyText = pageVisibleText(renderToStaticMarkup(createElement(PrivacyPage)));
const termsText = pageVisibleText(renderToStaticMarkup(createElement(TermsPage)));
const landing = read("components/landing/LandingPage.tsx");
const sitemap = read("app/sitemap.ts");

describe("legal content pages", () => {
  it("reaches the reader from the site footer", () => {
    expect(landing).toMatch(/<Link\b[^>]*href="\/privacy"[^>]*>/);
    expect(landing).toMatch(/<Link\b[^>]*href="\/terms"[^>]*>/);
    expect(landing).toMatch(/CONTACT_MAILTO/);
  });

  it("is discoverable in the sitemap", () => {
    expect(sitemap).toMatch(/path: "\/privacy"/);
    expect(sitemap).toMatch(/path: "\/terms"/);
  });

  it("quotes the one monitored contact address on both pages", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/from "@\/lib\/siteContact"/);
      expect(page).toMatch(/\{CONTACT_EMAIL\}/);
      // The address itself never gets hardcoded into a page: swapping to a
      // company inbox later must stay a one-constant change.
      expect(page).not.toContain(CONTACT_EMAIL);
    }
  });

  it("claims nothing we have not got", () => {
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/ISO ?27001|SOC ?2|GDPR certified|Privacy Shield/i);
      // We are one person, not a company with a Data Protection Officer. The
      // privacy page may say we have NOT appointed one; neither page may claim
      // we have.
      expect(page).not.toMatch(/(?<!not )appointed a Data Protection Officer/i);
    }
  });

  it("keeps the privacy notice honest about how analytics actually work", () => {
    // Each of these mirrors a real gate: the first-visit choice
    // (components/AnalyticsConsentPrompt.tsx), later withdrawal in the account
    // hub, Do Not Track (client beacon + app/api/events/route.ts), the
    // header-stripping first-party proxy (app/ingest/[...path]/route.ts), and
    // hashed-never-stored IP rate limits plus consent-gated PostHog request
    // context (lib/supabase.ts clientIp/hashIp).
    expect(privacy).toMatch(/off by default/i);
    expect(privacy).toMatch(/first visit/i);
    expect(privacy).toMatch(/Allow or No thanks/i);
    expect(privacy).toMatch(/remembers\s+that choice/i);
    expect(privacy).toMatch(/page visits/i);
    expect(privacy).toMatch(/account settings/i);
    expect(privacy).toMatch(/Do Not Track/);
    expect(privacy).toMatch(/persistent\s+device\s+identifier/i);
    expect(privacy).toMatch(/browser\s+and\s+version/i);
    expect(privacy).toMatch(/operating\s+system/i);
    expect(privacy).toMatch(/device\s+type/i);
    expect(privacy).toMatch(/screen\s+and\s+viewport\s+size/i);
    expect(privacy).toMatch(/referrer/i);
    expect(privacy).toMatch(/campaign\s+parameters/i);
    expect(privacy).toMatch(/Web\s+Vitals/i);
    expect(privacy).toMatch(/person\s+and\s+device\s+records/i);
    expect(privacy).toMatch(/raw\s+IP\s+address[\s\S]*PostHog/i);
    expect(privacy).not.toMatch(/no forwarded IP address/i);
    expect(privacy).not.toMatch(/person profiles are switched off/i);
    expect(privacy).toMatch(/never the address itself/i);
    expect(privacy).toMatch(/PostHog/);
    expect(privacy).toMatch(/Supabase/);
    expect(privacy).toMatch(/Vercel/);
    expect(privacy).toMatch(/PUBMAXX never stores raw IP addresses in its own/);
    expect(privacy).not.toMatch(/We never store your IP address/);
    expect(privacy).not.toMatch(/Browsing is anonymous/);
    expect(privacy).not.toMatch(/Anonymous usage analytics/);
  });

  it("keeps analytics optional in the terms as well as the privacy notice", () => {
    expect(terms).toMatch(/Browsing doesn&rsquo;t need an account or analytics/);
    expect(terms).toMatch(/Allow or No thanks/);
    expect(terms).toMatch(/same app either way/);
    expect(terms).toMatch(/persistent\s+device\s+identifier/i);
    expect(terms).toMatch(/browser,\s+operating\s+system\s+and\s+device\s+type/i);
    expect(terms).toMatch(/screen\s+size/i);
    expect(terms).toMatch(/referrer\s+and\s+campaign/i);
    expect(terms).toMatch(/performance/i);
    expect(terms).not.toMatch(/optional anonymous analytics/i);
  });

  it("discloses Social ownership and the self-asserted 18+ gate", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/18\+/);
      expect(page).toMatch(/date of birth you gave at onboarding/i);
    }
    expect(privacy).toMatch(/Supabase sign-in/);
    expect(privacy).toMatch(/private product account/);
    expect(terms).toMatch(/private product account tied to your Supabase sign-in/);
    expect(terms).toMatch(/doesn&rsquo;t use your email or handle to join\s+accounts/);
    expect(terms).toMatch(/do not run a\s+separate\s+hosted\s+age\s+check/i);
  });

  it("describes self-asserted 18+ honestly and keeps Yoti optional", () => {
    expect(privacy).toMatch(/date of birth you gave at onboarding/i);
    expect(privacy).toMatch(/do not run a\s+separate\s+hosted\s+age\s+check/i);
    expect(terms).toMatch(/do not run a\s+separate\s+hosted\s+age\s+check/i);
    expect(privacy).toMatch(/does not currently\s+send data to Yoti/i);
    expect(privacy).not.toMatch(/Yoti runs the\s+adult check/i);
    expect(privacy).not.toMatch(/Hosted 18\+ age checking/i);
    expect(privacy).not.toMatch(/returns the authoritative result/i);
    expect(terms).not.toMatch(/until Yoti returns a current\s+18\+ decision/i);
  });

  it("discloses OpenAI moderation of held Social post content", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/OpenAI/);
      expect(page).toMatch(/Social post text/i);
      expect(page).toMatch(/omni moderation/i);
      expect(page).toMatch(/held[^]*decision/i);
    }
    expect(privacy).toMatch(/Social photos are normalised/i);
    expect(privacy).toMatch(/short-lived signed copy[^]*OpenAI/i);
    expect(privacy).toMatch(/moderation queue/i);
  });

  it("discloses OpenAI moderation and report/hide retention for profile pictures", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/profile picture/i);
      expect(page).toMatch(/OpenAI/);
      expect(page).toMatch(/omni moderation/i);
      expect(page).toMatch(/report/i);
      expect(page).toMatch(/hide/i);
    }
    expect(privacy).toMatch(/profile pictures go to OpenAI/i);
    expect(privacy).toMatch(/does not hide the picture on\s+its own/i);
    expect(privacy).toMatch(/Hiding stops public delivery/i);
    expect(privacy).toMatch(/never deletes the stored file/i);
    expect(privacy).toMatch(/Removing\s+the picture yourself[^]*removes the stored\s+file/i);
    expect(terms).toMatch(/Profile pictures use the same OpenAI omni\s+moderation/i);
    expect(terms).toMatch(/hiding never deletes\s+the stored file/i);
  });

  it("discloses Social interactions, private saves, governance, and held derivatives", () => {
    expect(privacy).toMatch(/Cheers, comments, private saves, reposts and quote posts/i);
    expect(privacy).toMatch(/comments and quote-post text[^]*OpenAI[^]*held/i);
    expect(privacy).toMatch(/saves are private/i);
    expect(privacy).toMatch(/reports[^]*do not hide content/i);
    expect(privacy).toMatch(/named staff member[^]*audit/i);
    expect(privacy).toMatch(/in-app notifications/i);
    expect(terms).toMatch(/comments and quote posts[^]*held[^]*moderation decision/i);
    expect(terms).toMatch(/lock comments/i);
    expect(terms).toMatch(/Feature requests[^]*status and response history/i);
    expect(terms).toMatch(/chronological[^]*not popularity/i);
  });

  it("discloses Social Crew reads, authority records, and retention", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/Social Crews/);
      expect(page).toMatch(/Planned Night title/i);
      expect(page).toMatch(/private[^]*friends-only[^]*open/i);
      expect(page).toMatch(/Crew-bound Plan/i);
    }
    expect(privacy).toMatch(/owner[^]*active members who remain Mutual with the owner[^]*full roster[^]*Crew-bound Plan/i);
    expect(privacy).toMatch(/friends[^]*current Mutuals[^]*preview/i);
    expect(privacyText).toMatch(
      /While a plan is open, anyone can see its title, the pub or place it starts at, its start time, how many people are in it, and your handle as host/i,
    );
    expect(privacyText).toMatch(/Close the plan and it drops out of the public list/i);
    expect(termsText).toMatch(
      /While a plan is open, anyone can see its title, the pub or place it starts at, its start time, how many people are in it, and the host handle/i,
    );
    expect(termsText).toMatch(/Close the plan and it drops out of the public list/i);
    expect(privacy).toMatch(/private Crew[^]*owner[^]*active members who\s+remain Mutual with the owner/i);
    expect(privacy).toMatch(/invitation[^]*sender[^]*recipient[^]*expiry[^]*state/i);
    expect(privacy).toMatch(/Join Request[^]*requester[^]*owner and\s+cohosts/i);
    expect(privacy).toMatch(/pending request[^]*expires[^]*decision history/i);
    expect(privacy).toMatch(/write receipts[^]*actor[^]*action[^]*audit/i);
    expect(privacy).toMatch(/write receipts[^]*never public/i);
    expect(privacy).toMatch(/left or\s+removed[^]*membership\s+row[^]*history/i);
    expect(privacy).toMatch(/invitations and Join Requests[^]*Crew-bound Plan is deleted/i);
    expect(privacy).toMatch(/write\s+receipts[^]*account deletion request/i);
    expect(terms).toMatch(/owner chooses one visibility setting[^]*private[^]*friends-only[^]*open/i);
    expect(terms).toMatch(/active members\s+who remain Mutual with the owner[^]*roster[^]*Crew-bound Plan/i);
    expect(terms).toMatch(/owner can\s+change roles[^]*owner or a cohost[^]*remove a non-owner/i);
    expect(terms).toMatch(/leaving or removal[^]*doesn&rsquo;t erase/i);
  });

  it("discloses interrupted Social upload retention without widening local drafts", () => {
    expect(privacy).toMatch(/failed or interrupted Social photo uploads/i);
    expect(privacy).toMatch(/can stay temporarily/i);
    expect(privacy).toMatch(/eligible for deletion after 24 hours/i);
    expect(privacy).toMatch(/daily scheduled cleanup/i);
    expect(privacy).toMatch(/outage[s]? can delay/i);
    expect(privacy).toMatch(/unfinished text and selected photo\s+data on this device until you post or clear the draft/i);
    expect(privacy).not.toMatch(/Social Drafts?[^.]*server/i);
  });

  it("discloses the private Social media removal audit", () => {
    expect(privacy).toMatch(
      /media ID, post, actor, detachment action and retention\s+deadline/i,
    );
    expect(privacy).toMatch(/private removal\s+audit/i);
  });

  it("states both 12-month analytics retention clocks on both legal pages", () => {
    expect(privacy).toMatch(
      /PostHog\s+deletes\s+analytics\s+events\s+12 months after collection/i,
    );
    expect(privacy).toMatch(
      /It\s+deletes\s+pseudonymous\s+person\s+and\s+device\s+records\s+12 months after their last activity/i,
    );
    expect(terms).toMatch(
      /PostHog\s+deletes\s+analytics\s+events\s+12 months after collection\s+and\s+pseudonymous\s+person\s+and\s+device\s+records\s+12 months after their last activity/i,
    );
  });

  it("discloses same-journey referral signup and post-erasure blocking", () => {
    expect(privacy).toMatch(/same\s+sign-in journey/i);
    expect(privacy).toMatch(/delayed return/i);
    expect(privacy).not.toMatch(/referral attribution[^]*consent-only/);
    expect(privacy).toMatch(/one-way hash of the deleted account ID/);
    expect(privacy).toMatch(/existing session can&rsquo;t recreate/);
  });

  it("discloses handle-free Plan public invite RSVPs and reactions", () => {
    expect(privacy).toMatch(/Plan can also publish a separate public invite link/i);
    expect(privacy).toMatch(/RSVP with a display name/i);
    expect(privacy).toMatch(/salted hash of a browser device id/i);
    expect(privacy).toMatch(/do not store the raw\s+device id/i);
    expect(privacy).toMatch(/Plan host can remove an RSVP/i);
  });

  it("discloses precise location processing without overstating retention", () => {
    expect(privacy).toMatch(/coordinates never leave your\s+device/);
    expect(privacy).toMatch(/Viewer coordinates never leave your\s+device at full precision/i);
    expect(privacy).toMatch(/\/api\/whats-on/);
    expect(privacy).toMatch(/\/api\/tonight-conditions/);
    expect(privacy).toMatch(/\/api\/last-train/);
    expect(privacy).toMatch(/\/api\/nearby-bus-departures/);
    expect(privacy).toMatch(/\/api\/tfl-disruption/);
    expect(privacy).toMatch(/\/api\/citymcp\/journey/);
    expect(privacy).not.toMatch(/without\s+rounding them first/);
    expect(privacy).toMatch(/rounds your\s+point to three decimal places/);
    expect(privacy).toMatch(/public StopPoint API/);
    expect(privacy).toMatch(/pub(?:&rsquo;|’)s public map coordinates/);
    expect(privacy).not.toMatch(/does not\s+write them to our database/);
    expect(privacy).not.toMatch(/not sent to us or stored anywhere/);
  });

  it("names every third party that receives a viewer point", () => {
    // What this block does: it locks the disclosed coordinate-recipient set
    // (TfL, CityMCP, Google Maps) against silent removal from the page, and
    // checks each disclosed host still appears in the source file that
    // actually contacts it. What it does NOT do: discover a new provider
    // added through an unrecognised code path. The backstop for that is the
    // AGENTS.md rule that any data-practice change must update the privacy
    // page in the same commit.
    const thirdPartySection =
      privacy.match(/aria-labelledby="third"[\s\S]*?aria-labelledby="keep"/)?.[0] ?? "";

    const coordinateRecipients = [
      { name: "Transport for London", host: "api.tfl.gov.uk", source: "lib/tflClient.server.ts" },
      { name: "CityMCP", host: "citymcp.com", source: "lib/citymcp/client.ts" },
      { name: "Google Maps", host: "google.com", source: "lib/venueJourney.ts" },
    ];
    for (const recipient of coordinateRecipients) {
      expect(thirdPartySection, `Missing recipient name ${recipient.name}`).toContain(recipient.name);
      expect(thirdPartySection, `Missing recipient host ${recipient.host}`).toContain(recipient.host);
      expect(read(recipient.source), `${recipient.source} no longer contacts ${recipient.host}`).toContain(
        recipient.host,
      );
    }
  });

  it("discloses push subscription storage and retention", () => {
    // Mirrors lib/pushTokenStore.ts + lib/webPush.ts: registration posts the
    // serialized subscription to /api/push-tokens, the store keeps a durable
    // row, and deletion happens on provider-reported invalidation or request.
    expect(privacy).toMatch(/PUBMAXX\s+stores\s+your\s+browser&rsquo;s\s+push\s+subscription/);
    expect(privacy).toMatch(/endpoint\s+plus\s+its\s+keys/);
    expect(privacy).toMatch(/until\s+the\s+push\s+service\s+reports\s+it\s+dead\s+or\s+you\s+ask\s+us\s+to\s+remove\s+it/);
    expect(privacy).toMatch(/belongs\s+to\s+your\s+own\s+browser&rsquo;s\s+push\s+service/);
    expect(privacy).toMatch(/stored\s+subscription\s+row\s+stays/);
    expect(privacy).toMatch(/Step Out weekly nudge is off by default/i);
    expect(privacy).toMatch(/at most one\s+place-bound push a week/i);
    expect(privacy).not.toMatch(/a push subscription is held\s+by your own browser/);
  });

  it("describes remembered-area request use without claiming all state stays local", () => {
    expect(privacy).toMatch(/public area&rsquo;s coarse centre/);
    expect(privacy).toMatch(/The saved choice itself isn&rsquo;t\s+uploaded/);
    expect(privacy).toMatch(/don&rsquo;t upload those stored values as a bundle/);
    expect(privacy).toMatch(/device night profile stays\s+on your device unless you sign in/);
    expect(privacy).not.toMatch(/These never leave your\s+device/);
  });

  it("describes durable rate-limit retention", () => {
    expect(privacy).toMatch(/durable limiter rows are\s+keyed to salted hashes/);
    expect(privacy).toMatch(/expires\s+at\s+the end of its limiter window/i);
    expect(privacy).toMatch(/deleted\s+the next time the\s+durable limiter runs/i);
    expect(privacy).not.toMatch(/the key row remains/);
    expect(privacy).not.toMatch(/Server and rate-limit records/);
  });

  it("discloses the durable Recommendation row and its retention", () => {
    // Mirrors lib/weatherRecommendationStore.ts and migration 0058: a durable
    // row carrying a public handle, the venue, one closed condition, the
    // authored reason, a server timestamp, and a server-derived actor token.
    // Current community prices also carry an account-owned public handle;
    // anonymity is reserved for legacy price rows without one.
    expect(privacy).toMatch(/Recommendations, and Night\s+Memories/);
    expect(privacy).toMatch(/public PUBMAXX\s+handle/);
    expect(privacy).toMatch(/needs a signed-in account/);
    expect(privacy).toMatch(/stable private profile key/);
    expect(privacy).toMatch(
      /derives the handle and private key from your authenticated\s+account/,
    );
    expect(privacy).toMatch(/ignores any handle sent by the browser/);
    expect(privacy).toMatch(
      /They are excluded\s+only while their stored handle does not resolve to a public profile/,
    );
    expect(privacy).not.toMatch(/can remain visible but stay excluded/);
    expect(privacy).toMatch(/the time our\s+server took it/);
    expect(privacy).toMatch(/<strong>Recommendations:<\/strong>/);
    expect(privacy).toMatch(
      /handle and private profile key[\s\S]*for as long as it is up/,
    );
    expect(privacy).toMatch(/replaces the one you already had/);
    // The closed vocabulary is the product's, not the page's: if a condition is
    // added or renamed, this sentence has to be rewritten with it.
    const privacyProse = privacy.toLowerCase().replace(/\s+/g, " ");
    for (const condition of WEATHER_RECOMMENDATION_CONDITIONS) {
      const label = weatherRecommendationConditionLabel(condition);
      expect(privacyProse, `Missing condition ${label}`).toContain(
        label.toLowerCase(),
      );
    }
  });

  it("discloses crowd occupancy reports as account-linked and deletable", () => {
    expect(privacy).toMatch(/Crowd occupancy reports/);
    expect(privacy).toMatch(/linked to your signed-in account/);
    expect(privacy).toMatch(/deleted with the account/);
  });

  it("discloses price trust milestones and audit reversals as account-linked", () => {
    expect(privacy).toMatch(/Price trust milestones/);
    expect(privacy).toMatch(/account-linked milestone/);
    expect(privacy).toMatch(/audit reversal/);
    expect(privacy).toMatch(/personal credit is deleted with the\s+account/);
    expect(privacy).toMatch(/Append-only audit\s+reversals stay with the pub/);
  });

  it("discloses community venue reports and their contributor count", () => {
    expect(privacy).toMatch(/Community venue reports/);
    expect(privacy).toMatch(/rough or\s+posh/);
    expect(privacy).toMatch(/entrance and toilet access\s+separately/);
    expect(privacy).toMatch(/door policy/);
    expect(privacy).toMatch(/people were eating/);
    expect(privacy).toMatch(/same stable private profile key/);
    expect(privacy).toMatch(/Venue reports don&rsquo;t enter the public\s+contributor record/);
    expect(privacy).toMatch(/Community prices and venue reports:/);
  });

  it("explains account-bound price attribution and public contributor ranking", () => {
    expect(privacy).toMatch(/public contributor record/i);
    expect(privacy).toMatch(
      /prices[\s\S]*Visit Reports[\s\S]*Recommendations/i,
    );
    expect(privacy).toMatch(/needs a signed-in account/);
    expect(privacy).toMatch(
      /server\s+derives both contribution\s+identifiers from the authenticated account/,
    );
    expect(privacy).toMatch(/Older rows that had no handle remain\s+anonymous/);
    expect(privacy).toMatch(/hidden[\s\S]*don&rsquo;t count/i);
    expect(privacy).toMatch(
      /Visit Reports and Recommendations[\s\S]*existing public profile[\s\S]*remain visible[\s\S]*excluded/i,
    );
    expect(privacy).toMatch(/all\s+time/i);
    expect(privacy).not.toMatch(/future contributor count/i);
  });

  it("states exactly what private profile data is retained", () => {
    expect(privacy).toMatch(/Google or Apple sign-in/);
    expect(privacy).toMatch(/date of birth is needed to finish signup/i);
    expect(privacy).toMatch(/Full name, gender and sex are optional/);
    expect(privacy).toMatch(/only identity shown with contributions/);
    expect(privacy).toMatch(
      /date of birth[\s\S]*full name[\s\S]*sex[\s\S]*existing\s+account tools[\s\S]*Social adult access does not use full name, gender or sex/i,
    );
    expect(privacy).toMatch(
      /date of birth[\s\S]*until you delete your profile/i,
    );
    expect(privacy).toMatch(
      /Full name, gender and sex[\s\S]*until you edit or clear them[\s\S]*delete your profile/i,
    );
    expect(privacy).toMatch(
      /Deleting your profile[\s\S]*removes these\s+private identity fields/,
    );
    expect(privacy).toMatch(
      /keeps your authentication account,\s+public\s+handle and\s+handle-keyed contribution history/,
    );
    expect(terms).toMatch(
      /date of birth is needed to finish signup/i,
    );
    expect(terms).toMatch(
      /date of birth[\s\S]*full name[\s\S]*sex[\s\S]*existing\s+account tools[\s\S]*Social adult access does not use full name, gender or sex/i,
    );
    expect(terms).toMatch(/date of birth[\s\S]*until you delete your profile/i);
    expect(terms).toMatch(
      /Deleting your profile[\s\S]*removes these\s+private identity fields/,
    );
    expect(terms).toMatch(/Only your handle is public/);
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(
        /discard the date of birth|adult confirmation|date you become eligible/i,
      );
      expect(page).not.toMatch(/under 18[\s\S]*cannot contribute/i);
    }
  });

  it("names all three price lanes and fences the historical one", () => {
    // lib/priceHistory.ts added a THIRD price lane: dated, sourced prices from
    // years gone by, shown on the venue sheet and barred from every
    // current-price system. A terms page that still says prices come from two
    // places would be describing a product that no longer exists, so the count
    // and the "not tonight's price" fence are both pinned here.
    expect(terms).toMatch(/Prices\s+come\s+from\s+three\s+places/);
    expect(terms).toMatch(/never\s+a\s+price\s+for\s+tonight/);
    expect(terms).toMatch(/dated\s+record\s+of\s+the\s+past/);
    expect(terms).not.toMatch(/Prices\s+come\s+from\s+two\s+places/);
    expect(terms).toMatch(
      /A current price names and links its publisher when its record does/,
    );
    expect(terms).toMatch(
      /When no publisher is recorded for a price, we say so beside it/,
    );
    expect(terms).not.toMatch(/Every current price names where it came from/);
    expect(terms).not.toMatch(
      /Every price on PUBMAXX is what someone saw, on a date we show you/,
    );
  });

  it("keeps existing tools open while making full Social 18+", () => {
    expect(terms).toMatch(
      /map and existing contribution tools don&rsquo;t use age to block an\s+account/i,
    );
    expect(termsText).toMatch(/Social is live by default/i);
    expect(termsText).toMatch(/one recorded self-assertion can answer the access question/i);
    expect(terms).toMatch(/Pubs\s+decide who they serve/i);
    expect(terms).toMatch(/drinkaware\.co\.uk/);
  });

  it("discloses private referral attribution and its genuine browser limits", () => {
    expect(privacy).toMatch(/private referral edge/i);
    expect(privacy).not.toMatch(/referral journey cookie/i);
    expect(privacy).toMatch(/same\s+sign-in journey/i);
    expect(privacy).toMatch(/different\s+browser or device/i);
    expect(privacy).toMatch(/never shown on a public profile/i);
    expect(privacy).toMatch(/first accepted contribution/i);
    expect(privacy).toMatch(/milestone records/i);
    expect(privacy).toMatch(/until either account is deleted/i);
    expect(privacy).not.toMatch(/Unclaimed journeys/i);
  });

  it("states referral qualification and the mark-of-honour law in the terms", () => {
    expect(terms).toMatch(/self-referrals/i);
    expect(terms).toMatch(/circular\s+referrals/i);
    expect(terms).toMatch(/signs up and makes a first accepted contribution/i);
    // The terms describe what the code does. A milestone confers recognition,
    // so the page may not go back to promising, or withholding, a feature.
    expect(terms).toMatch(/mark of honour/i);
    expect(terms).toMatch(/buys no feature, no\s+tier and no discount/i);
    expect(terms).toMatch(/cannot grant, any paid feature/i);
    expect(terms).not.toMatch(/rewards? aren&rsquo;t active/i);
  });
});
