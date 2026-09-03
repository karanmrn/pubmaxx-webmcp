import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";

import "../legal.css";

// /terms — plain-language terms of use. Server component, zero client JS.
// Sibling of /privacy: that page says what we do with data, this one says what
// each side is agreeing to. Same rule applies — describe the real product (free,
// no ads, private profile data, and community-sourced prices that are
// observations rather than offers), never invent guarantees or a company that
// doesn't exist yet.

const PAGE_TITLE = "Terms of use";
const PAGE_DESCRIPTION =
  "Plain-language terms covering what PUBMAXX is, what you can post, what map prices mean, and where our responsibility ends.";
const LAST_UPDATED = "6 August 2026";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/terms",
    siteName: metadataSiteName(),
    type: "website",
  },
};

export default function TermsPage() {
  return (
    <main id="main" className="legalPage">
      <header className="legalHead">
        <p className="legalEyebrow">Terms of use</p>
        <h1 className="legalTitle">The deal in plain English</h1>
        <p className="legalLede">
          PUBMAXX is free, carries no ads, and nobody can pay to rank. In return
          we ask you to use it honestly and not to treat a price on the map as a
          promise from the pub. That&rsquo;s most of it. The rest is below.
        </p>
        <p className="legalUpdated">Last updated {LAST_UPDATED}</p>
      </header>

      <section className="legalSection" aria-labelledby="who">
        <h2 id="who" className="legalH2">Who you&rsquo;re agreeing with</h2>
        <p className="legalBody">
          These terms are between you and Karan Manoharan, an individual based in
          London, UK, who runs pubmaxxing.com. Using the site means you accept
          them. If you don&rsquo;t, don&rsquo;t use it. Questions go to{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="what">
        <h2 id="what" className="legalH2">What PUBMAXX is</h2>
        <p className="legalBody">
          A map of pubs with prices on it, plus tools to plan a night with your
          mates. Prices come from three places: baseline records, prices logged
          by people standing in the pub, and old prices read out of dated,
          sourced archives. Baseline prices show their publisher when one is
          recorded and say when none is. That last lot is history. It is what a
          pint cost years ago, never a price for tonight, and it never moves the
          map. Heritage facts are cited, never invented. Nothing here is a
          booking service, and we&rsquo;re not the pub. We don&rsquo;t sell you
          drinks, take payment, or hold a table for you.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="age">
        <h2 id="age" className="legalH2">Age and alcohol</h2>
        <p className="legalBody">
          The map and existing contribution tools don&rsquo;t use age to block an
          account. Social is live by default and may return to preview during an
          emergency rollback. Full access needs a signed-in account, a claimed
          handle and an 18+ answer. The date of birth you gave at onboarding
          decides when it is present; otherwise, one recorded self-assertion can
          answer the access question. We do not run a separate hosted age check.
          Pubs decide who they serve. Nothing in the app is designed to encourage
          you to drink more. Know your limits, and know the facts at{" "}
          <a
            href="https://www.drinkaware.co.uk"
            target="_blank"
            rel="noreferrer"
            className="legalLink"
          >
            drinkaware.co.uk
          </a>
          . Getting home safely, and how much you drink on the way, is your call
          and your responsibility.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="account">
        <h2 id="account" className="legalH2">Your account</h2>
        <p className="legalBody">
          Browsing doesn&rsquo;t need an account or analytics. First visit asks
          you to tap Allow or No thanks for optional usage analytics. You
          get the same app either way. If you allow them, we use a persistent
          device identifier and collect browser, operating system and device type,
          screen size, referrer and campaign details, plus app performance and
          the closed product events described in our privacy notice. PostHog
          deletes analytics events 12 months after collection and pseudonymous
          person and device records 12 months after their last activity. Handle
          is needed to finish signup. Date of birth is needed to finish signup
          too. Full name, gender and sex are optional. We collect and store date
          of birth, full name, gender and sex as private details for existing
          account tools.
          Social adult access does not use full name, gender or sex.
          Date of birth stays until you delete your profile.
          Full name, gender and sex stay until you edit or clear them, or
          delete your profile. Deleting your profile removes these private identity fields and clears
          its editable public details, while keeping your
          authentication account, public handle and handle-keyed contribution
          history. Only your handle is public.
          Social uses a private product account tied to your Supabase sign-in
          and stable profile. PUBMAXX doesn&rsquo;t use your email or handle to join
          accounts.
          Social content returns to preview during an emergency rollback. Full
          access also needs a claimed handle and an 18+ answer. The date of birth
          you gave at onboarding decides when it is present; otherwise, one
          recorded self-assertion can answer the access question. We do not run a
          separate hosted age check. Your date of birth,
          documents and verification status aren&rsquo;t public profile fields or
          badges.
          Keep your sign-in to yourself, use a handle that isn&rsquo;t someone
          else&rsquo;s identity, and don&rsquo;t hand the account to anyone
          else. You can stop using it whenever you like, and ask us to delete
          your account and its private profile data. See the{" "}
          <Link href="/privacy" className="legalLink">privacy notice</Link>.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="crews">
        <h2 id="crews" className="legalH2">Social Crews</h2>
        <p className="legalBody">
          A Social Crew takes its name from the linked Planned Night title. Its
          owner chooses one visibility setting: private, friends-only, or open. While a
          plan is open, anyone can see its title, the pub or place it starts at,
          its start time, how many people are in it, and the host handle. Close
          the plan and it drops out of the public list. Active members
          who remain Mutual with the owner can read the roster and Crew-bound
          Plan. A private Crew stays with the owner and those active members.
          Friends visibility gives the owner&rsquo;s current Mutuals a limited
          preview, not the roster or full Plan.
        </p>
        <p className="legalBody">
          Owners and cohosts can invite eligible Mutuals and decide Join
          Requests. An invitation is for its named recipient and ends at its
          expiry. A request is for its requester. Blocks stop access in either
          direction. Do not invite people who do not want to join, share Crew
          details outside its visibility, or use another person&rsquo;s account.
        </p>
        <p className="legalBody">
          The owner controls visibility and ownership changes. The owner can
          change roles. The owner or a cohost can remove a non-owner member
          within their authority. Members can leave, but an owner must transfer
          ownership first.
          Leaving or removal doesn&rsquo;t erase the membership, invitation or
          decision history. Current members can still read Crew-bound Plan data
          under the Crew rules.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="posts">
        <h2 id="posts" className="legalH2">What you post</h2>
        <p className="legalBody">
          Social post text goes to OpenAI for omni moderation after we store
          it. The post stays held from feeds and direct reads until OpenAI
          returns a decision. If that check is unavailable or gives no usable
          decision, the post remains held. Social photos are resized, stripped
          of embedded metadata, kept private, and sent with the post text to
          OpenAI for moderation. Profile pictures use the same OpenAI omni
          moderation on owned storage bytes before they are publicly
          addressable; if that check fails, the upload is refused and your
          previous picture stays. Readers may report a profile picture; only a
          named staff member may hide or restore it, and hiding never deletes
          the stored file. Photo tags need the tagged person&rsquo;s approval
          and can be withdrawn. Signed photo delivery links are short lived.
        </p>
        <p className="legalBody">
          Comments and quote posts also stay held until an OpenAI moderation
          decision. Post authors choose who may comment and can lock comments
          later. Saves are private. Reposts and quotes never make their source
          visible to someone who cannot read it. Feature requests keep staff
          status and response history without becoming a vote. Social feeds
          stay chronological, not popularity-ranked, and no interaction can buy
          reach or change a pub or price ranking.
        </p>
        <p className="legalBody">
          Prices, notes, photos, plans, stories: you keep ownership of all
          of it. By posting it you give us permission to store it, show it in the
          app, and use it as part of the price and heritage data the map is built
          from, including in aggregate figures like the Pint Index. That
          permission is free of charge, worldwide, and lasts as long as the
          content is up; delete the content, or ask us to, and it ends, except
          for anonymous aggregate figures already published and copies other
          people saved.
        </p>
        <p className="legalBody">
          When you post, you&rsquo;re telling us that:
        </p>
        <ul className="legalList">
          <li>It&rsquo;s yours to post, or you have permission to post it.</li>
          <li>
            The price is one you actually saw, at that pub, for that drink,
            around now, not a guess, a memory from last year, or a joke.
          </li>
          <li>
            Photos don&rsquo;t show people who&rsquo;d rather not be on a public
            map.
          </li>
        </ul>
      </section>

      <section className="legalSection" aria-labelledby="use">
        <h2 id="use" className="legalH2">Using it fairly</h2>
        <p className="legalBody">Don&rsquo;t:</p>
        <ul className="legalList">
          <li>
            Log prices you didn&rsquo;t see, or spray a figure across venues to
            move the map. Submissions are rate-limited and a price only reaches
            the map once a second, independent person backs it up.
          </li>
          <li>
            Post anything illegal, hateful, harassing, or that exposes
            someone&rsquo;s private details.
          </li>
          <li>
            Scrape at a volume that costs us money, hammer the API, or try to get
            around rate limits, sign-in, or moderation.
          </li>
          <li>
            Use the app to advertise, spam, or push a venue up the list. Nobody
            pays to rank, and that includes doing it by hand.
          </li>
          <li>Impersonate someone else, or pretend to be us.</li>
        </ul>
        <p className="legalBody">
          We can hide or remove content, and suspend an account, when
          something&rsquo;s clearly broken these rules. If you think we&rsquo;ve
          got it wrong, email us and say so. We&rsquo;d rather fix it than
          argue about it.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="referrals">
        <h2 id="referrals" className="legalH2">Invites and referral milestones</h2>
        <p className="legalBody">
          You can share one account invite link. A referral counts only when
          someone follows it, signs up and makes a first accepted contribution.
          Self-referrals, second accounts made for yourself and circular
          referrals between two accounts don&rsquo;t count.
        </p>
        <p className="legalBody">
          A referral milestone is a mark of honour. Reaching one puts a line on
          your own account page and does nothing else. It buys no feature, no
          tier and no discount, and nothing on PUBMAXX is held back from anyone
          who has invited nobody.
        </p>
        <p className="legalBody">
          We record the private edge and the milestone. We do not record, and
          cannot grant, any paid feature from either.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="prices">
        <h2 id="prices" className="legalH2">How to read prices</h2>
        <p className="legalBody">
          A current price names and links its publisher when its record does.
          When no publisher is recorded for a price, we say so beside it.
          Prices logged by people carry the day they were seen. Other current
          prices share the date for their dataset. Pubs change prices, run happy
          hours, charge differently on a match day, and make mistakes. People
          logging prices can make mistakes too. A figure here is a good steer,
          not a quote, and the pub is under no obligation to honour it.
          <strong> Check at the bar.</strong>
        </p>
        <p className="legalBody">
          All of that is about the price a pub is charging now. Where we show
          what a pint used to cost, that figure is a dated record of the past,
          taken from a source we name and link. It says nothing about tonight,
          and we never let it stand in for the current price.
        </p>
        <p className="legalBody">
          Opening hours, transport times, heritage facts and weather come from
          third-party sources. We cite them and we don&rsquo;t make them up, but
          we can&rsquo;t promise they&rsquo;re current or complete.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="asis">
        <h2 id="asis" className="legalH2">The app comes as it is</h2>
        <p className="legalBody">
          PUBMAXX is free and comes as it is. We work on it constantly, which
          means features change, move, or disappear, and the site will sometimes
          be down. We don&rsquo;t promise it will be available, uninterrupted,
          error-free, or that any particular pub, price or feature will still be
          there tomorrow.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="liability">
        <h2 id="liability" className="legalH2">Where our responsibility ends</h2>
        <p className="legalBody">
          To the extent the law allows, we&rsquo;re not liable for what happens
          when you act on something you read here: a price that had changed, a
          pub that was shut, a route that took longer than you thought, or a
          night that went sideways. That includes lost money, lost time, and
          anything indirect.
        </p>
        <p className="legalBody">
          Nothing in these terms limits liability for death or personal injury
          caused by our negligence, for fraud, or for anything else the law
          doesn&rsquo;t let us exclude. If you&rsquo;re a consumer, your
          statutory rights under UK consumer law stand whatever this page says.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="changes">
        <h2 id="changes" className="legalH2">Changes and endings</h2>
        <p className="legalBody">
          We may update these terms as the app changes; the date at the top moves
          when we do, and carrying on using the site means you accept the update.
          You can stop using PUBMAXX at any time. We may suspend or end access
          where these terms are being broken, or if we stop running the service.
        </p>
        <p className="legalBody">
          These terms are governed by the law of England and Wales, and the
          courts of England and Wales have jurisdiction.
        </p>
      </section>

      <section className="legalSection legalContact" aria-labelledby="contact">
        <h2 id="contact" className="legalH2">Get in touch</h2>
        <p className="legalBody">
          Anything about these terms, a takedown, or a moderation decision:
        </p>
        <p className="legalBody">
          <a href={CONTACT_MAILTO} className="legalLink legalContactEmail">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="legalBody">
          See also our{" "}
          <Link href="/privacy" className="legalLink">privacy notice</Link> and{" "}
          <Link href="/about" className="legalLink">our story</Link>.
        </p>
      </section>
    </main>
  );
}
