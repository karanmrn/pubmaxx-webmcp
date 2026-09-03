import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";

import "../legal.css";

// /privacy - the public privacy notice. Server component, zero client JS.
//
// HOUSE RULE, same as every other surface: this page describes what the code
// actually does, and nothing else. Every claim below is checkable in the repo -
// the first-visit consent prompt (components/AnalyticsConsentPrompt.tsx), the
// later control (components/profile/PubmaxxAccountHub.tsx), the event
// registry and its gates (lib/analyticsEvents.ts, app/api/events/route.ts),
// the browser SDK config (lib/posthogClient.ts), the first-party ingest proxy
// (app/ingest/[...path]/route.ts), the hashed-actor derivation (lib/supabase.ts
// hashIp/hashActor) used for price-report abuse controls, the account-derived
// Visit Report and Recommendation identity in their API routes, their row
// shapes and migrations, and the sign-in paths in
// components/auth/AuthProvider.tsx. If one of those changes, this page
// changes in the same commit. Do NOT add practices we don't have, certifications
// we don't hold, or a DPO we haven't appointed.

const PAGE_TITLE = "Privacy";
const PAGE_DESCRIPTION =
  "What PUBMAXX collects, why, who else sees it, how long we keep it, and how to get it deleted. Written against the app's behaviour.";
const LAST_UPDATED = "16 August 2026";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/privacy",
    siteName: metadataSiteName(),
    type: "website",
  },
};

export default function PrivacyPage() {
  return (
    <main id="main" className="legalPage">
      <header className="legalHead">
        <p className="legalEyebrow">Privacy</p>
        <h1 className="legalTitle">How PUBMAXX handles your data</h1>
        <p className="legalLede">
          You can browse the whole map, every price and every historic pub,
          without an account and without telling us anything about yourself.
          Everything below is what happens when you go further than that.
        </p>
        <p className="legalUpdated">Last updated {LAST_UPDATED}</p>
      </header>

      <section className="legalSection" aria-labelledby="short">
        <h2 id="short" className="legalH2">The short version</h2>
        <ul className="legalPanelList">
          <li>
            <strong>No account needed to look.</strong>{" "}We don&rsquo;t ask who
            you are to show you the price of a pint.
          </li>
          <li>
            <strong>Analytics are off until you switch them on.</strong>{" "}On
            your first visit we ask you to tap Allow or No thanks. We remember
            that choice, and you can change it later in your account settings.
          </li>
          <li>
            <strong>PUBMAXX never stores raw IP addresses in its own
            database.</strong>{" "}Where an unauthenticated action needs abuse
            controls or deduplication, we store a salted hash of it, never the address itself.
          </li>
          <li>
            <strong>We don&rsquo;t sell anything to anyone.</strong>{" "}No ads, no
            data sales, no ad networks, no advertising trackers on the site.
          </li>
          <li>
            <strong>Your nights are yours.</strong>{" "}Night Memories and private
            plans aren&rsquo;t public unless you choose to share them.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="who">
        <h2 id="who" className="legalH2">Who&rsquo;s responsible</h2>
        <p className="legalBody">
          PUBMAXXING is run by Karan Manoharan, an individual based in London,
          UK. There is no company behind it yet, so for UK GDPR purposes the
          data controller is that individual, reachable at{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>. We
          don&rsquo;t have a Data Protection Officer, because at this size the law
          doesn&rsquo;t call for one.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="collect">
        <h2 id="collect" className="legalH2">What we collect</h2>

        <h3 className="legalH3">If you browse</h3>
        <p className="legalBody">
          Nothing you type, and no account. Our hosting provider records the
          ordinary technical detail every web server sees when it serves a page:
          the request, the time, the browser type and the IP address it came
          from. That is how the site gets served and how abuse gets stopped.
          Map tiles are fetched by your browser directly from the tile hosts
          named below, so those hosts see your IP address the same way any
          website you visit does.
        </p>

        <h3 className="legalH3">If you ask for a new area</h3>
        <p className="legalBody">
          We store the area name you send. You can add an email address if you
          want one message when PUBMAXX reaches that area. Most area requests
          have no email address. We don&rsquo;t add it to a marketing list or a
          digest.
        </p>

        <h3 className="legalH3">If you make an account</h3>
        <p className="legalBody">
          Sign-in is handled by Supabase, using either an emailed magic link or
          Google or Apple sign-in. That means we hold your email address. You
          must choose one public handle, which is linked to your authenticated
          account and is the only identity shown with contributions. Handle
          is needed to finish signup. Date of birth is needed to finish signup
          too. Full name, gender and sex are optional. We collect and store date
          of birth, full name, gender and sex as private details for existing
          account tools.
          Social adult access does not use full name, gender or sex. They are never shown on prices,
          reports, signals, Recommendations, leaderboards or the public
          contributor record.
        </p>
        <p className="legalBody">
          We keep date of birth until you delete your profile. Full name, gender
          and sex stay until you edit or clear them, or delete your profile.
          Deleting your profile removes these private identity fields and clears its
          editable public details. That action keeps your authentication account,
          public handle and handle-keyed contribution history. You can
          ask us to delete other account data. We don&rsquo;t use date of birth to
          block an account or contribution.
        </p>
        <p className="legalBody">
          Social uses a private product account tied to your Supabase sign-in
          session and stable profile. We don&rsquo;t match accounts by email, public
          handle or anything typed into a form.
        </p>
        <p className="legalBody">
          Full Social access is for signed-in accounts with a claimed handle and
          an 18+ answer. The date of birth you gave at onboarding decides when it
          it is present. New accounts must provide date of birth at onboarding;
          for an existing account where it was not recorded, one self-assertion
          can answer the access question. Social is live by default and may return
          to preview during an emergency rollback. We do not run a separate hosted
          age check. None of that private data appears on your profile as an age or
          verification badge.
        </p>
        <p className="legalBody">
          Your public profile may also contain a display name, home city and
          short bio. A profile picture is an optional upload you choose: we
          store the normalised JPEG under our own private storage (not a
          hotlinked URL), strip embedded metadata before it is saved, and send
          a short-lived signed copy to OpenAI for omni moderation before the
          picture is publicly addressable. If that check is unavailable or
          returns no usable decision, we refuse the upload and keep your
          previous picture (or none). Readers may report a profile picture; a
          report joins a private review queue and does not hide the picture on
          its own. A named staff member must hide or restore it, and that
          decision keeps a private audit record. Hiding stops public delivery
          and never deletes the stored file or the report provenance. Removing
          the picture yourself, or deleting your account, removes the stored
          file from our storage. If you connect an external social profile (X,
          Instagram, TikTok) we store the account details you connected and any
          provider tokens encrypted at rest.
        </p>

        <h3 className="legalH3">If you use an invite link</h3>
        <p className="legalBody">
          Making an invite gives you an opaque link tied to your account. When
          someone follows it, the opaque code stays in the page address. We set
          no referral cookie and store no attribution record while they browse.
          If that person starts and completes account creation in the same
          sign-in journey, the completed callback submits the code and we record
          one private referral edge between the two account IDs. It is recorded
          once and is never shown on a public profile, contributor record, venue
          page or anywhere else public.
        </p>
        <p className="legalBody">
          Attribution works only during that sign-up. A delayed return, a
          different browser or device, an invalid link, or signing into an
          existing account isn&rsquo;t attributed. We don&rsquo;t guess when the
          same-journey proof is absent.
        </p>
        <p className="legalBody">
          A referral isn&rsquo;t qualified by signup alone. It needs the new account
          to make its first accepted contribution. We keep append-only milestone
          records so later decisions can be explained. Those milestone records
          don&rsquo;t grant paid features today, because sign-in doesn&rsquo;t prove that
          one person has only one account.
        </p>
        <p className="legalBody">
          A Plan can also publish a separate public invite link. Anyone with
          that link can RSVP with a display name (Going or Maybe) and leave a
          closed set of emoji reactions, without creating an account. We store
          the display name you type, your RSVP choice, your reaction choices,
          and a salted hash of a browser device id so the same device can update
          its own RSVP instead of stacking duplicates. We do not store the raw
          device id. Anyone who has the link can see the guest list and reaction
          counts on that invite page. The Plan host can remove an RSVP from the
          list. Closing or deleting the Plan removes those invite RSVPs and
          reactions with it.
        </p>

        <h3 className="legalH3">What you post</h3>
        <p className="legalBody">
          Pint Drops (a price, a note, sometimes a photo), plans and crawl
          routes, presence taps (&ldquo;I&rsquo;m here tonight&rdquo;), ratings,
          messages to other people, Visit Reports, Recommendations, and Night
          Memories. We keep these because they are the product. A price with no
          date and no source is worth nothing. Presence is always a deliberate
          tap; the app never tracks your location in the background.
        </p>
        <p className="legalBody">
          Social post text is stored in a private moderation queue, then sent
          to OpenAI for omni moderation. A post stays held from every Social
          feed and direct read until OpenAI returns a decision. If OpenAI is
          unavailable or returns no usable decision, the post stays held. No
          account ID, public handle, area or exact venue is included in that
          moderation request. Social photos are normalised to JPEG, resized and
          stripped of embedded metadata before private storage. OpenAI receives
          a short-lived signed copy with the post text for moderation. Photo
          tags appear only after the tagged person approves them and can be
          withdrawn later. The browser keeps unfinished text and selected photo
          data on this device until you post or clear the draft.
        </p>
        <p className="legalBody">
          Failed or interrupted Social photo uploads can stay temporarily in
          private server storage so an exact retry cannot damage another upload. They become
          eligible for deletion after 24 hours. A daily scheduled cleanup
          removes them. Storage or database outages can delay that cleanup.
        </p>
        <p className="legalBody">
          Cheers, comments, private saves, reposts and quote posts are tied to
          your stable Social profile. Saves are private and have no public
          count. Comments and quote-post text enter the same kind of private
          queue, go to OpenAI for omni moderation, and stay held until a usable
          decision returns. In-app notifications store the people and source
          records involved, not a copy of protected post or comment text.
        </p>
        <p className="legalBody">
          Blocks remove interactions from both people&rsquo;s Social reads.
          Feature requests keep an append-only staff status and response
          history. Reports from readers join a private review queue and do not hide content.
          A named staff member must hide or restore a comment or quote,
          and that decision keeps a private audit record.
        </p>
        <p className="legalBody">
          Social edits keep revision numbers, changed-field names and content
          digests for conflict handling and abuse review. A private removal
          audit keeps the media ID, post, actor, detachment action and retention
          deadline. A removed photo stops being delivered. Detached photo files
          enter a 30-day deletion queue. A scheduled server cleanup removes
          the private file and its media row after that date. Signed photo links expire after three minutes.
        </p>
        <p className="legalBody">
          A Recommendation is your short opinion that one pub suits one kind of
          weather. Writing one needs a signed-in account, a claimed public
          handle and a completed private profile. We store your public PUBMAXX
          handle, the pub, the single condition you picked from warm, clear
          skies, raining, cold and windy, the reason you wrote, the time our
          server took it, and your account&rsquo;s stable private profile key.
          The server derives the handle and private key from your authenticated
          account and ignores any handle sent by the browser. The private key
          is used for rate limits and audit provenance and is never shown.
          A visible Recommendation counts on the public contributor record
          under its public handle. Historic Recommendations written under an
          unlinked, self-asserted handle can remain visible. They are excluded
          only while their stored handle does not resolve to a public profile.
          They stay unlinked and excluded from identity-backed counts. Writing
          another under the same handle for
          the same pub and condition replaces the one you already had. The
          weather never writes a Recommendation. It only decides which of the
          ones people wrote match right now.
        </p>

        <h3 className="legalH3">Visit Reports</h3>
        <p className="legalBody">
          A Visit Report records what you noticed on one dated pub visit.
          Writing one needs a signed-in account, a claimed public handle and a
          completed private profile. We store your public handle, the pub, the
          visit date, the observations and note you chose, and the time our
          server took it. The server derives your handle from your authenticated
          account and ignores any handle sent by the browser. To limit abuse, we
          use your account&rsquo;s stable private profile key together with a salted
          hash of your IP address. We never store the raw address. Historic
          Visit Reports written under an unlinked, self-asserted handle keep
          that attribution and can remain visible.
        </p>

        <h3 className="legalH3">Crowd occupancy reports</h3>
        <p className="legalBody">
          A crowd occupancy report is linked to your signed-in account. We
          store the pub, the level you tapped, the time, and your account id.
          It is deleted with the account.
        </p>
        <p className="legalBody">
          Any reader can flag a crowd occupancy report. We store the report the
          flag is about, a salted hash of the reader&rsquo;s IP address and,
          when one is sent, a short written reason. We never store the raw
          address. Flags join a private review queue and never hide a reading on
          their own. A named staff member must hide or restore it. Hiding stops
          the reading being shown and never deletes the row. Flags leave with
          the report they are about.
        </p>

        <h3 className="legalH3">Price trust milestones</h3>
        <p className="legalBody">
          When two independent logs first make a drink price trusted at a pub,
          we store an account-linked milestone and credit the accounts in that
          first cluster. A later agreeing log does not earn a second credit. A
          moderator hide writes an append-only audit reversal and removes the
          visible credit. If the remaining logs still qualify, we write one
          replacement milestone. Your personal credit is deleted with the
          account.
        </p>

        <h3 className="legalH3">Community price submissions</h3>
        <p className="legalBody">
          Logging tonight&rsquo;s price needs a signed-in account, a claimed
          handle and completed private profile. We store the venue, drink
          category, price and time, plus the account&rsquo;s stable private
          profile key and current public handle. The server derives both contribution
          identifiers from the authenticated account and ignores
          any handle sent by the browser. A newly accepted price therefore
          counts under that account&rsquo;s handle on the public contributor
          record.
        </p>
        <p className="legalBody">
          The private profile key exists so one account can replace its own
          earlier entry instead of stacking duplicates, and can&rsquo;t confirm
          itself by changing devices or handles. Legacy contributions made
          under a self-declared handle stay historic and cannot be claimed by
          first touch. Older rows that had no handle remain anonymous. Reader
          reports about a price still use a salted hash for
          abuse controls; we never store the raw IP address.
        </p>

        <h3 className="legalH3">Public contributor record</h3>
        <p className="legalBody">
          The public contributor record ranks existing public profiles by
          contributions tied to that identity: visible prices posted, Visit
          Reports written and Recommendations made, added together across all
          time. Named Visit Reports and Recommendations that don&rsquo;t resolve to
          an existing public profile can remain visible on their posts but are
          excluded from this identity-backed ranking. It shows the combined
          total and each of those three counts. Hidden or taken-down
          contributions don&rsquo;t count. Older price logs with no handle never
          appear under a name.
        </p>
        <p className="legalBody">
          We also keep whether a price was corroborated, whether a contribution
          survived moderation and whether a price was later contradicted. Those
          signals are kept so the record can be made more useful later without
          losing its history. They don&rsquo;t change today&rsquo;s ranking, which is
          based only on how many identity-backed, visible contributions a
          profile has made.
        </p>

        <h3 className="legalH3">Community venue reports</h3>
        <p className="legalBody">
          A signed-in account with a claimed handle can also report what they
          saw about a pub: rough or posh character, entrance and toilet access
          separately, door policy, and whether people were eating. We store the
          venue, answer and time, plus the same stable private profile key used
          for community prices. It lets your newer answer replace your older
          one and keeps one account from confirming itself.
          Venue reports don&rsquo;t enter the public contributor record, and the
          private key is never shown.
        </p>

        <h3 className="legalH3">Location</h3>
        <p className="legalBody">
          &ldquo;Find my pint&rdquo; asks your browser for your location and
          ranks nearby pubs there, so those coordinates never leave your
          device. Viewer coordinates never leave your device at full precision.
          Other location features work like this:
        </p>
        <ul className="legalList">
          <li>
            <strong>What&rsquo;s on:</strong>{" "}sharing location on the map or
            Tonight rounds your point to three decimal places, roughly 70 to
            110 metres in London, before sending it to our
            {" "}<code>/api/whats-on</code> route so it can rank listings near you.
          </li>
          <li>
            <strong>Conditions and getting home:</strong>{" "}Tonight rounds your
            point to three decimal places, roughly 70 to 110 metres in London,
            before sending it to our <code>/api/tonight-conditions</code>,
            <code>/api/last-train</code> and <code>/api/tfl-disruption</code>
            routes. Today uses the same rounding for last-train and disruption
            requests. These answer nearby conditions, your nearest station and
            relevant transport disruption. The last-train route passes the
            rounded point to Transport for London&rsquo;s public StopPoint API.
          </li>
          <li>
            <strong>Getting to a pub:</strong>{" "}sharing location for travel
            times in a map venue sheet rounds your point to three decimal places
            before posting it to our <code>/api/citymcp/journey</code> route.
            Our server forwards that approximate origin to CityMCP for journey
            options. If you then tap Maps, your browser sends the same rounded
            origin to Google Maps for directions.
          </li>
          <li>
            <strong>Buses near a pub:</strong>{" "}opening nearby bus departures
            sends the pub&rsquo;s public map coordinates to our
            {" "}<code>/api/nearby-bus-departures</code> route. Our server passes
            that pub location, not your location, to Transport for
            London&rsquo;s public StopPoint API to find nearby stops and live
            departures.
          </li>
          <li>
            <strong>Remembered areas:</strong>{" "}Tonight can turn an area choice
            saved in your browser into that public area&rsquo;s coarse centre and
            send the centre to <code>/api/whats-on</code>. Today rounds the same
            kind of centre before sending it to
            {" "}<code>/api/tfl-disruption</code>. The saved choice itself isn&rsquo;t
            uploaded.
          </li>
        </ul>
        <p className="legalBody">
          Say no and the app falls back to picking an area or lets you open a
          venue without your location.
        </p>

        <h3 className="legalH3">Analytics, only with consent</h3>
        <p className="legalBody">
          Usage analytics are off by default. A small prompt asks on your first
          visit, with Allow and No thanks both one tap. The browser remembers
          that choice so the prompt doesn&rsquo;t return on every visit.
          If you allow analytics, you can turn them back off later under
          <strong> Optional usage analytics</strong>{" "}in your PUBMAXX
          account settings. While they&rsquo;re on:
        </p>
        <ul className="legalList">
          <li>
            We create a persistent device identifier in your browser so page
            loads and later visits from that browser count as the same device.
            PostHog uses it for unique-user and retention analysis and keeps
            pseudonymous person and device records. We don&rsquo;t identify that
            record with your PUBMAXX account, handle or email.
          </li>
          <li>
            Page visits and events include browser and version, operating
            system, device type, screen and viewport size, the referring page,
            recognised campaign parameters and coarse app paths. The browser
            SDK also sends Web Vitals so we can measure loading and interaction
            performance. No account, handle, email, message content, free text
            or precise location is attached.
          </li>
          <li>
            Product actions still come from a closed, named list, such as a plan
            being accepted, with allow-listed simple values. Our server
            re-checks every product event and its browser context against the
            same rules and drops anything it doesn&rsquo;t recognise.
          </li>
          <li>
            For crash reporting, the browser analytics SDK sends the crash type
            with the same standard device context and the same coarse app path
            as a page visit, so we can tell two different faults apart. Error
            messages and stack traces are redacted before they leave your
            browser. Session recording, autocapture, heatmaps, click tracking
            and surveys are all disabled.
          </li>
          <li>
            Analytics requests go through pubmaxxing.com rather than straight to
            the provider. The first-party browser proxy doesn&rsquo;t forward
            cookies or sign-in headers. For named product events, the server
            passes the request user agent and raw IP address to PostHog along
            with the validated referrer and screen context. PUBMAXX doesn&rsquo;t
            put that raw IP address in its own logs or database; its own rate
            limit keeps only a salted hash.
          </li>
          <li>
            If your browser sends a Do Not Track signal we skip analytics
            regardless, and the server honours the same signal.
          </li>
          <li>
            Turning consent off deletes the browser analytics identifier and
            stops PostHog page visits, product events and the hosting
            provider&rsquo;s pageview counter.
          </li>
        </ul>

        <h3 className="legalH3">Things that aren&rsquo;t about you</h3>
        <p className="legalBody">
          Pub locations, opening hours, heritage facts, scraped and sourced
          prices, and the weather all come from public data. None of it&rsquo;s
          personal data, and requests for it are made by our server, not by
          your browser.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="crews">
        <h2 id="crews" className="legalH2">Social Crews</h2>
        <p className="legalBody">
          A Social Crew uses its linked Planned Night title as its name. We
          store its visibility, owner, and roster. Visibility is private,
          friends-only, or open. Roster data includes each member&rsquo;s account,
          role, join time and current state.
          The owner, and active members who remain Mutual with the owner, can
          read the full roster and Crew-bound Plan, including its stops, night
          details, actions and ending.
        </p>
        <p className="legalBody">
          A private Crew is readable only by the owner and active members who
          remain Mutual with the owner. Friends visibility lets current Mutuals
          of the owner read a limited preview with the Planned Night title,
          phase, area, start time and their own Join Request state. That preview
          does not show the roster or Crew-bound Plan details. A block in either
          direction closes the read. While a plan is open, anyone can see its
          title, the pub or place it starts at, its start time, how many people
          are in it, and your handle as host. Close the plan and it drops out of
          the public list.
        </p>
        <p className="legalBody">
          Each invitation records its sender member, recipient account, expiry
          and state. A Join Request records the requester account. The owner and
          cohosts can see who asked while it is pending. A pending request
          expires at its deadline, and its final state, decision time and
          deciding member remain as decision history.
        </p>
        <p className="legalBody">
          Private Crew write receipts record the actor account, action,
          idempotency key, content digest and returned result. They exist for
          safe retries and audit only. These write receipts are never public.
        </p>
        <p className="legalBody">
          Crew and roster records stay with the Crew-bound Plan. A left or
          removed member keeps a terminal membership row as history rather than
          disappearing. Invitations and Join Requests keep their final states
          until the Crew-bound Plan is deleted. Pending rows become expired
          rather than being rewritten as accepted or declined. Private write
          receipts stay until an account deletion request is carried out,
          unless a legal or security hold needs a narrower record for longer.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="why">
        <h2 id="why" className="legalH2">Why we&rsquo;re allowed to</h2>
        <p className="legalBody">
          In UK GDPR terms, in plain language:
        </p>
        <ul className="legalList">
          <li>
            <strong>Because you asked us to (contract).</strong>{" "}Holding your
            account, your plans, your messages and your saved nights is the
            service you signed up for.
          </li>
          <li>
            <strong>Because it&rsquo;s a fair thing to do (legitimate
            interests).</strong>{" "}Keeping community prices and venue reports
            with their dates, private profile keys or legacy device tokens,
            rate-limiting writes, and keeping server logs is how the map stays
            honest and the site stays up. We&rsquo;ve kept it to the minimum
            that works.
          </li>
          <li>
            <strong>Because you said yes (consent).</strong>{" "}Usage analytics
            and push notifications are consent-only, and you can withdraw
            consent at any time without losing the rest of the app.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="cookies">
        <h2 id="cookies" className="legalH2">Cookies and what sits on your device</h2>
        <p className="legalBody">
          We don&rsquo;t use advertising or cross-site tracking cookies, and
          there&rsquo;s no ad network on the site. What we do keep in your own
          browser storage:
        </p>
        <ul className="legalList">
          <li>
            A sign-in session, if you signed in, so you stay signed in. It lives
            in your browser and refreshes in the background. A first-party
            sign-in cookie also keeps a session renewal token and your sign-in
            email address on this device for up to 30 days, renewed while you
            use the site, so clearing browser storage does not sign you out.
            Signing out removes it.
          </li>
          <li>
            Your analytics choice, either allowed or denied, so we don&rsquo;t ask on
            every visit. Until you tap Allow, no analytics identifier exists.
            After you allow it, the persistent device identifier is kept in
            browser storage and a first-party cookie so later visits remain one
            device. Withdrawing consent removes that local analytics identity
            and stops new collection.
          </li>
          <li>
            Preferences and app state: theme, your device night profile, your
            remembered area, what you&rsquo;ve already been shown once. We
            don&rsquo;t upload those stored values as a bundle. An area choice
            can be turned in your browser into a coarse centre used for the
            requests described under Location. Your device night profile stays
            on your device unless you sign in and choose to bring it to your
            account.
          </li>
        </ul>
        <p className="legalBody">
          Because nothing non-essential is set before you agree to it, the first
          visit choice is a small prompt rather than a wall in front of the map.
          Your account keeps the later control.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="third">
        <h2 id="third" className="legalH2">Who else touches it</h2>
        <p className="legalBody">
          We keep the list short on purpose. Each of these acts as a processor
          for us, is only reached when you actively use the feature, or is named
          as a planned processor that receives nothing today.
        </p>
        <dl className="legalRows">
          <div className="legalRow">
            <dt>Supabase</dt>
            <dd>
              Database, sign-in and file storage, on their EU region. Holds your
              account, your posts and your community price and venue report rows.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Clerk</dt>
            <dd>
              Optional sign-in for Clerk controls. Clerk keeps its own session
              and user ID. PUBMAXX joins that ID to a private product account
              on our server. It does not provide Social access, and it does not
              turn a Clerk session into a Supabase account.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Yoti</dt>
            <dd>
              No current PUBMAXX access flow. A future stronger assurance tier
              would need a separate provider review. PUBMAXX does not currently
              send data to Yoti or receive a result from it.
            </dd>
          </div>
          <div className="legalRow">
            <dt>OpenAI</dt>
            <dd>
              Social post text goes to OpenAI for omni moderation after the
              post enters our moderation queue. It stays held until OpenAI
              returns a decision. We don&rsquo;t send the Social account ID,
              handle, area or venue with that text. Normalised Social photos and
              profile pictures go to OpenAI through short-lived signed links for
              the same moderation decision. A profile picture is scanned before
              it is publicly addressable; a Social post stays held until a
              usable decision returns.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Vercel</dt>
            <dd>
              Hosting and CDN. Serves every page, and keeps short-lived request
              logs that include IP addresses. Also runs the pageview counter
              that stays disabled until you consent to analytics.
            </dd>
          </div>
          <div className="legalRow">
            <dt>PostHog (EU)</dt>
            <dd>
              Product analytics, EU project, consent-gated, with pseudonymous
              person and device records for unique-user and retention analysis.
              It receives the analytics categories listed above, including the
              raw IP on named product events. There are no session recordings
              and no identify calls tying events to your account.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Map tile hosts</dt>
            <dd>
              OpenFreeMap and CARTO serve the base map straight to your browser,
              so they see your IP address while you pan the map. Map data is
              &copy; OpenStreetMap contributors.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Transport for London</dt>
            <dd>
              When you ask for last-train help, our server sends your coordinates
              rounded to three decimal places to TfL&rsquo;s public StopPoint API
              at <code>api.tfl.gov.uk</code> to find your nearest station. It also
              fetches live arrivals, timetables and line-status information.
              Opening nearby buses on a pub sheet sends that pub&rsquo;s public
              map coordinates, not your location, to find nearby stops and live
              departures.
            </dd>
          </div>
          <div className="legalRow">
            <dt>CityMCP</dt>
            <dd>
              When you share location for travel times to a pub, our server sends
              your origin rounded to three decimal places, with the selected
              venue, to CityMCP London at <code>citymcp.com</code> for journey
              options.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Google Maps</dt>
            <dd>
              If you tap Maps after sharing location in a venue sheet, the
              directions link gives <code>google.com</code> your origin rounded
              to three decimal places and the selected venue. Other Google map
              links include the venue or search only, not your shared location.
            </dd>
          </div>
          <div className="legalRow">
            <dt>AI features</dt>
            <dd>
              If you ask The Landlord about a pub, or talk to Pub Pal, the text
              or audio of that request goes to the model provider that answers
              it (OpenRouter, and ElevenLabs for voice) and nothing else about
              you goes with it.
            </dd>
          </div>
          <div className="legalRow">
            <dt>Email and push</dt>
            <dd>
              Supabase sends account magic links and stores an optional contact
              address when you ask PUBMAXX to cover an area. There is no
              marketing list or email digest. If you turn notifications on,
              PUBMAXX stores your browser&rsquo;s push subscription, the endpoint
              plus its keys, so it can send you the notification; the
              subscription itself belongs to your own browser&rsquo;s push service.
              We keep that stored row until the push service reports it dead or
              you ask us to remove it.
              The separate Step Out weekly nudge is off by default. If you turn
              it on, we store that preference against your account, bind it to
              the same web push subscription, and may send at most one
              place-bound push a week about a Wanted pub near your night patch,
              an open Soft Plan, or a sourced deal. Turning it off withdraws the
              preference and removes the bound subscription.
            </dd>
          </div>
        </dl>
        <p className="legalBody">
          We don&rsquo;t sell personal data, and we don&rsquo;t share it with
          advertisers or data brokers. We&rsquo;ll only hand something over to
          authorities if the law tells us to.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="keep">
        <h2 id="keep" className="legalH2">How long we keep it</h2>
        <ul className="legalList">
          <li>
            <strong>Your account and what you posted:</strong>{" "}until you delete
            it, or ask us to. Ask, and we&rsquo;ll delete the account and the
            personal content attached to it within 30 days.
          </li>
          <li>
            <strong>Social account records:</strong>{" "}the private product account
            link stays with the Social account until deletion. The date of birth
            used for the 18+ gate stays in your private identity record until you
            delete your profile.
          </li>
          <li>
            <strong>Social Crews:</strong>{" "}the Crew, membership history,
            invitations and Join Requests stay with the Crew-bound Plan until
            that Plan is deleted. Private write receipts stay for safe retries
            and audit until the actor&rsquo;s account deletion request is carried
            out, unless a legal or security hold applies.
          </li>
          <li>
            <strong>Crowd occupancy reports:</strong>{" "}linked to your account
            and deleted with it.
          </li>
          <li>
            <strong>Price trust milestones:</strong>{" "}your personal credit is
            linked to your account and deleted with it. Append-only audit
            reversals stay with the pub&rsquo;s milestone record and do not
            name you.
          </li>
          <li>
            <strong>Community prices and venue reports:</strong>{" "}the report
            itself stays, so later readers can see what people said and when.
            Each row records the venue, either a drink and its price or one
            venue answer from a fixed list, the date and the private profile
            key. Price attribution stays with the row while it is up
            and counts on the public contributor record. Legacy rows may
            instead contain an unreversible device token or no public handle.
          </li>
          <li>
            <strong>Recommendations:</strong>{" "}a Recommendation keeps your
            handle and private profile key for as long as it is up. The handle
            attributes the opinion publicly; the private key stays hidden and
            supports rate limits and audit provenance. Writing another under
            the same handle for the same pub and condition replaces the one you
            already had. There is no one-tap delete for a single Recommendation
            yet, so ask us and we&rsquo;ll take it down, the same as anything
            else you posted.
          </li>
          <li>
            <strong>Hidden or reported content:</strong>{" "}a detached Social
            photo stops being delivered immediately and enters the 30-day
            deletion queue.
          </li>
          <li>
            <strong>Analytics events:</strong>{" "}PostHog deletes analytics
            events 12 months after collection. It deletes pseudonymous person
            and device records 12 months after their last activity. These
            records carry no account identity, so they can&rsquo;t be traced
            back to you after the fact, which also means we can&rsquo;t pick
            your events out to delete them individually.
          </li>
          <li>
            <strong>Rate-limit records:</strong>{" "}durable limiter rows are
            keyed to salted hashes, never raw IP addresses. Each row expires at
            the end of its limiter window and is deleted the next time the
            durable limiter runs. The longest current window is seven days.
          </li>
          <li>
            <strong>Area requests:</strong>{" "}the area demand signal stays so we
            can plan coverage. An optional contact address stays until you ask
            us to delete it at{" "}
            <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>.
          </li>
          <li>
            <strong>Legacy pending digest addresses:</strong>{" "}addresses in
            legacy <code>public.email_subscribers</code> rows remain stored. We
            do not confirm or mail them. Ask us to delete yours at{" "}
            <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>.
          </li>
          <li>
            <strong>Push subscriptions:</strong>{" "}if you turned notifications
            on, the stored subscription row stays until your browser&rsquo;s
            push service reports it dead or you ask us to remove it. A Step Out
            opt-in preference and its last-sent stamp stay until you turn the
            nudge off or delete your account.
          </li>
          <li>
            <strong>Referral records:</strong>{" "}the private invite code,
            account-to-account edge, first accepted contribution marker and
            milestone records stay until either account is deleted. Ordinary
            product writes can only append that history. A confirmed account
            deletion removes the private referral data tied to that account.
            We retain only a one-way hash of the deleted account ID in the
            referral system so an existing session can&rsquo;t recreate those
            records.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="rights">
        <h2 id="rights" className="legalH2">Your rights</h2>
        <p className="legalBody">
          Under UK GDPR you can ask us to show you what we hold about you,
          correct it, delete it, hand it over in a portable form, restrict what
          we do with it, or object to it. You can also withdraw analytics
          consent whenever you like, in the app, without asking us.
        </p>
        <p className="legalBody">
          Email{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>{" "}
          and say what you want. We&rsquo;ll reply within 30 days, and it
          doesn&rsquo;t cost anything. If we can&rsquo;t confirm that the account
          is yours we&rsquo;ll say so rather than hand your data to someone else.
        </p>
        <p className="legalBody">
          If you think we&rsquo;ve got it wrong, you can complain to the
          Information Commissioner&rsquo;s Office at{" "}
          <a
            href="https://ico.org.uk"
            target="_blank"
            rel="noreferrer"
            className="legalLink"
          >
            ico.org.uk
          </a>
          . We&rsquo;d rather you told us first so we can fix it.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="age">
        <h2 id="age" className="legalH2">Age and access</h2>
        <p className="legalBody">
          The map and existing contribution tools don&rsquo;t use age to block an
          account. Social is live by default and may return to preview during an
          emergency rollback. Full access needs a signed-in account, a claimed
          handle and an 18+ answer. The date of birth you gave at onboarding
          decides when it is present. For an existing account where it was not
          recorded, one self-assertion can answer the access question. New accounts
          must provide date of birth at onboarding. We do not run a separate hosted
          age check.
          Pubs remain responsible for deciding who they serve.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="changes">
        <h2 id="changes" className="legalH2">If this changes</h2>
        <p className="legalBody">
          When what the app does changes, this page changes with it and the date
          at the top moves. If a change is significant, like a new processor or a
          new category of data, we&rsquo;ll say so in the app rather than
          quietly editing the text.
        </p>
      </section>

      <section className="legalSection legalContact" aria-labelledby="contact">
        <h2 id="contact" className="legalH2">Get in touch</h2>
        <p className="legalBody">
          Privacy questions, data requests, or anything you think this page gets
          wrong:
        </p>
        <p className="legalBody">
          <a href={CONTACT_MAILTO} className="legalLink legalContactEmail">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="legalBody">
          See also our <Link href="/terms" className="legalLink">terms of use</Link>{" "}
          and <Link href="/about" className="legalLink">our story</Link>.
        </p>
      </section>
    </main>
  );
}
