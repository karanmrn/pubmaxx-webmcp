"use client";

// Switch account, for anybody who runs more than one.
//
// A STANDARD control, never a per-person one: it appears the moment a second
// account signs in on the device and it is offered on the same terms to
// everybody, because status buys belonging here and never a capability
// (lib/foundingMembers.ts says the same about a number).
//
// WHAT A TAP DOES: `switchAccount` mints a session from that account's own
// stored refresh token and installs it, so the ordinary auth event performs the
// one atomic device-identity swap (lib/deviceAccountSwitch.ts). Nothing in this
// component writes a handle, an owner stamp, or the resume cookie.
//
// A ROW IS NOT A PROMISE OF A DOOR. A stored refresh token GoTrue has refused is
// deleted on the spot, and its account keeps its row reading "Signed out": the
// list may say "we cannot let you back in silently", and may never say an
// account was never here.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import HandleAvatar from "@/components/profile/HandleAvatar";
import {
  loadPublicProfileCard,
  type PublicProfileCard,
} from "@/components/auth/publicProfileCard";
import type { DeviceAccountRecord } from "@/lib/deviceAccountSessions";
import { deviceAccountLabel } from "@/lib/deviceAccountSessions";
import type { DeviceAccountSwitchOutcome } from "@/lib/deviceAccountSwitch";
import { displayHandle } from "@/lib/handleDisplay";

const SWITCH_FAILED =
  "We could not switch account just now. Try again in a moment.";

export default function AccountSwitcher({
  accounts,
  addAccountHref,
  open,
  onToggle,
  onSwitch,
  onNavigate,
  disabled = false,
}: {
  /** The accounts this device holds, minus the one already active. */
  accounts: readonly DeviceAccountRecord[];
  /** The normal sign-in page, told where to come back to. */
  addAccountHref: string;
  /** Held by the card, so this stays a list and its state has one owner. */
  open: boolean;
  onToggle: () => void;
  onSwitch: (userId: string) => Promise<DeviceAccountSwitchOutcome>;
  onNavigate?: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, PublicProfileCard>>({});

  // Faces and names only once somebody opens the list. The nav renders on every
  // page, and none of them owe a request for a list nobody looked at.
  useEffect(() => {
    if (!open) return;
    const wanted = accounts
      .map((account) => account.handle)
      .filter((handle): handle is string => typeof handle === "string" && handle !== "")
      .filter((handle) => !(handle in cards));
    if (wanted.length === 0) return;
    const controller = new AbortController();
    void (async () => {
      const found = await Promise.all(
        wanted.map(
          async (handle) =>
            [handle, await loadPublicProfileCard(handle, controller.signal)] as const,
        ),
      );
      if (controller.signal.aborted) return;
      setCards((previous) => {
        const next = { ...previous };
        // A read that answered nothing still records an entry, so the effect
        // asks once rather than retrying on every render.
        for (const [handle, card] of found) next[handle] = card ?? {};
        return next;
      });
    })();
    return () => controller.abort();
  }, [accounts, cards, open]);

  const switchTo = useCallback(
    async (userId: string) => {
      if (busyUserId) return;
      setBusyUserId(userId);
      setError(null);
      const outcome = await onSwitch(userId);
      // A landed switch replaces the session under this menu, so the component
      // is about to be re-rendered by the new account. Only a refusal has
      // anything left to say here.
      if (outcome.status === "unavailable") setError(SWITCH_FAILED);
      setBusyUserId(null);
    },
    [busyUserId, onSwitch],
  );

  return (
    <div className="authSwitcher">
      <button
        type="button"
        className="authSwitcherToggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        Switch account
        {/* The rows above this one navigate. A chevron is what says this one
            opens in place, and it is the same affordance the site's own More
            control uses. */}
        <ChevronDown
          className="authSwitcherChevron"
          size={16}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <>
          <ul className="authSwitcherList">
            {accounts.map((account) => (
              <li key={account.userId}>
                {account.refreshToken ? (
                  <button
                    type="button"
                    className="authSwitcherRow"
                    onClick={() => void switchTo(account.userId)}
                    disabled={disabled || busyUserId !== null}
                  >
                    <AccountRowFace
                      account={account}
                      card={account.handle ? cards[account.handle] : undefined}
                    />
                    {busyUserId === account.userId ? (
                      <span className="authSwitcherState">Switching</span>
                    ) : null}
                  </button>
                ) : (
                  <Link
                    href={addAccountHref}
                    className="authSwitcherRow"
                    onClick={onNavigate}
                  >
                    <AccountRowFace
                      account={account}
                      card={account.handle ? cards[account.handle] : undefined}
                    />
                    <span className="authSwitcherState">Signed out</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Link
            href={addAccountHref}
            className="authSwitcherAdd"
            onClick={onNavigate}
          >
            Add account
          </Link>
          {error ? (
            <p className="authError authSwitcherError" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The face, the name and the handle of one remembered account. */
function AccountRowFace({
  account,
  card,
}: {
  account: DeviceAccountRecord;
  card: PublicProfileCard | undefined;
}): React.JSX.Element {
  const name = card?.displayName || deviceAccountLabel(account);
  return (
    <>
      <HandleAvatar
        handle={account.handle ?? ""}
        {...(card?.avatarUrl ? { avatarUrl: card.avatarUrl } : {})}
        displayName={name}
        className="authSwitcherAvatar authAccountAvatarFallback"
        imageClassName="authSwitcherAvatar"
        size={32}
      />
      <span className="authSwitcherRowText">
        <span className="authSwitcherName">{name}</span>
        {account.handle ? (
          <span className="authSwitcherHandle">{displayHandle(account.handle)}</span>
        ) : null}
      </span>
    </>
  );
}
