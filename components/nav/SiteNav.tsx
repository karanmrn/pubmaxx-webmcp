"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CirclePlus } from "lucide-react";
import { useSyncExternalStore } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import SiteNavMore from "@/components/nav/SiteNavMore";
import SignInButton from "@/components/auth/SignInButton";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { useCommandPalette } from "@/components/command/CommandPaletteProvider";
import {
  PRIMARY_NAV_ITEMS,
  momentHref,
  navPathMatches,
  nowTabHref,
  serverNowTabHref,
  subscribeNowTabHref,
} from "@/components/nav/navigationModel";
import { useSocialSurfaceName } from "@/lib/useSocialFriendsLaunch";

import "./siteNav.css";
import "./siteNavMoment.css";

// Shared app-wide top navigation. One bar, used on every APP page (map, feed,
// discover, crawls, profile, borough, admin) so navigation never duplicates or
// drifts page-to-page.
//
// The mobile fix: at ≤640px the app already renders a fixed bottom tab bar
// (MobileTabBar: Now/Map/Out/Social/You). Repeating the full link list up
// top there caused the old `.appNav` pill to overflow the viewport (Admin +
// theme toggle clipped off-screen) on /map. So on mobile this renders a COMPACT
// bar — just the wordmark + theme toggle + sign-in — and hides the full link
// list (see siteNav.css @media ≤640px). On desktop the full links + active
// state show. Nothing may horizontally overflow at 390px.
//
// No effects: usePathname() marks the active link, which keeps this clear of
// react-hooks/set-state-in-effect. `active` can also be passed explicitly by the
// host page; the pathname is the fallback so a nav always lights the right tab.

type NavKey =
  | "home"
  | "now"
  | "today"
  | "map"
  | "pubs"
  | "drop"
  | "out"
  | "tonight"
  | "historic"
  | "feed"
  | "discover"
  | "social"
  | "crawls"
  | "profile"
  | "borough";

type NavLink = {
  key: NavKey;
  href: string;
  label: string;
  /** Path prefixes that should mark this link active (defaults to href). */
  match: string[];
};

// Consumer nav only. Staff moderation lives at /admin (URL + token) and is
// intentionally absent from every public nav so demos never look like an
// admin console.
const LINKS: NavLink[] = PRIMARY_NAV_ITEMS.map((item) => ({
  ...item,
  key: (item.key === "you" ? "profile" : item.key) as NavKey,
}));

function matchesPath(pathname: string, link: NavLink): boolean {
  return navPathMatches(pathname, link.match);
}

function primaryKeyForLegacyActive(active?: NavKey): NavKey | undefined {
  if (active === "feed" || active === "discover" || active === "crawls") return "social";
  if (active === "today" || active === "tonight") return "now";
  // Borough pages are data/discovery, not Social. There is no primary tab for
  // them, so they light nothing on the desktop nav rather than wrongly lighting
  // Social (the mobile tab bar already excludes /borough from its match set).
  if (active === "borough" || active === "home") return undefined;
  if (active === "pubs" || active === "historic") return undefined;
  return active;
}

export default function SiteNav({
  active,
}: {
  active?: NavKey;
}): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const primaryActive = primaryKeyForLegacyActive(active);
  // Imperative handle onto the global ⌘K palette (feature N1) — the button below
  // opens it for pointer users who won't reach for the shortcut.
  const { open: openCommandPalette } = useCommandPalette();
  // Constant server snapshot, then the clock after mount — a prerendered,
  // CDN-held document must not hydrate against a Now href that has since moved.
  const nowHref = useSyncExternalStore(
    subscribeNowTabHref,
    nowTabHref,
    serverNowTabHref,
  );
  const socialSurfaceLabel = useSocialSurfaceName();
  const links = LINKS
    .map((link) => {
      if (link.key === "social") return { ...link, label: socialSurfaceLabel };
      if (link.key === "now") return { ...link, href: nowHref };
      return link;
    });

  // The map is full-bleed with an overflow-hidden shell, so the bar floats
  // (fixed) over it. Every other page keeps the bar in normal flow.
  // City maps live under /map/[city] — treat those as map too.
  const isMap =
    active === "map" || pathname === "/map" || pathname.startsWith("/map/");

  // Active state is the filled pill only (.siteNavLink.isActive) — same single
  // signal as the mobile tab bar. The gliding brass underline was removed so
  // desktop does not double-encode "here".
  const activeKey = links.find((link) =>
    primaryActive ? primaryActive === link.key : matchesPath(pathname, link),
  )?.key;

  return (
    <nav
      className={isMap ? "siteNavBar siteNavBarFloating" : "siteNavBar"}
      role="navigation"
      aria-label="Site navigation"
    >
      {/* Wordmark: the compact-mobile anchor + the desktop home affordance. */}
      <Link prefetch={false} href="/" className="siteNavBrand" aria-label="Open PUBMAXX landing page">
        <PubmaxxWordmark />
      </Link>

      {/* Full link list — hidden on mobile (the bottom tab bar covers it). */}
      <ul className="siteNavLinks">
        {links.map((link) => {
          const isActive = link.key === activeKey;
          return (
            <li key={link.key} className="siteNavItem">
              <Link prefetch={false}
                href={link.href}
                className={isActive ? "siteNavLink isActive" : "siteNavLink"}
                aria-current={isActive ? "page" : undefined}
                aria-label={link.label}
                title={link.label}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="siteNavActions">
        {/* D2.2: secondary destinations (Plan/Near/Historic/Pal). Desktop
            only — siteNav.css hides .siteNavMore at ≤640 so mobile is unchanged. */}
        <SiteNavMore />
        {/* Moment compose (desktop). On phones the bottom tab bar's raised
            centre FAB owns this; the top bar has no such affordance, so desktop
            users reach /moment here. Carries the same returnTo the mobile FAB
            uses (momentHref) so composing returns to the current page. Hidden
            ≤640px in siteNavMoment.css — the FAB covers mobile. */}
        <Link prefetch={false}
          href={momentHref(pathname)}
          className="siteNavMoment"
          aria-label="Share a Moment"
          title="Share a Moment"
        >
          <CirclePlus size={18} aria-hidden="true" />
        </Link>
        {/* ⌘K command-palette affordance (feature N1). Unobtrusive hint button;
            hidden on phones (the bottom tab bar owns nav and there's no keyboard
            shortcut there). Label stays "⌘K" — Windows/Linux users still get the
            same palette via Ctrl+K. */}
        <button
          type="button"
          className="siteNavCmdk"
          onClick={openCommandPalette}
          aria-label="Open command palette"
          title="Search & jump to a page (⌘K / Ctrl+K)"
        >
          <kbd className="siteNavCmdkKbd" aria-hidden="true">
            ⌘K
          </kbd>
        </button>
        {/* Notification bell (story 34) — unread-count badge + link to /activity.
            Shows on mobile too (the compact bar keeps the bell + toggle + sign-in). */}
        <NotificationBell />
        {/* E4: 1:1 messaging inbox link — unread-count badge + link to /messages.
            Same ambient island shape as the bell; shows on mobile too. */}
        <MessagesLink />
        <ThemeToggle />
        {/* Compact host: a single "Sign in" disclosure below the width where
            the two full provider buttons genuinely fit (auth.css ≥1680px), so
            they can never crowd the link row into clipped fragments. */}
        <SignInButton compact />
      </div>
    </nav>
  );
}
