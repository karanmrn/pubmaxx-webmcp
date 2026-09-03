"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import AccountDeviceControls from "@/components/auth/AccountDeviceControls";
import type { SignOutScope } from "@/components/auth/AuthProvider";
import HandleAvatar from "@/components/profile/HandleAvatar";
import type { DeviceAccountRecord } from "@/lib/deviceAccountSessions";
import type { DeviceAccountSwitchOutcome } from "@/lib/deviceAccountSwitch";
import { displayHandle, handleOnly } from "@/lib/handleDisplay";

/**
 * The signed-in account card in the nav.
 *
 * It names the person PUBMAXX knows: their face, their display name and their
 * @handle, then the three places they actually go. The email address is account
 * plumbing, so it sits last and quiet rather than standing in for a name. A
 * person with no claimed handle yet gets the same card pointed at /u/you, which
 * is where they claim one.
 *
 * When the device holds a second account it also holds the way between them, and
 * the way out gains a scope. Both live in `AccountDeviceControls`, which the
 * signed-in card on /login shares, because that page is the account home on a
 * phone (this card is hidden below 640px).
 */
export default function AccountMenu({
  id,
  menuRef,
  name,
  handle,
  email,
  avatarUrl,
  signOutDisabled,
  onSignOut,
  onNavigate,
  activeUserId = null,
  deviceAccounts = [],
  onSwitchAccount,
  addAccountHref = "/login",
  extraControls,
}: {
  id: string;
  menuRef?: React.Ref<HTMLDivElement>;
  name: string;
  handle: string | null;
  email?: string;
  avatarUrl?: string;
  signOutDisabled?: boolean;
  onSignOut: (scope: SignOutScope) => void;
  onNavigate?: () => void;
  /** The account this card is about, so the switcher can leave it out. */
  activeUserId?: string | null;
  /** Every account signed in on this device. Read once by the nav host. */
  deviceAccounts?: readonly DeviceAccountRecord[];
  onSwitchAccount?: (userId: string) => Promise<DeviceAccountSwitchOutcome>;
  addAccountHref?: string;
  extraControls?: ReactNode;
}): React.JSX.Element {
  const profilePath = handle ? `/u/${handleOnly(handle)}` : "/u/you";
  return (
    <div className="authMenu authAccountMenu" id={id} aria-label="Account options" ref={menuRef}>
      <div className="authAccountCard">
        <HandleAvatar
          handle={handle ?? ""}
          avatarUrl={avatarUrl}
          displayName={name}
          className="authAccountAvatar authAccountAvatarFallback"
          imageClassName="authAccountAvatar"
          size={44}
        />
        <span className="authAccountCardText">
          <span className="authAccountName">{name}</span>
          <span className="authAccountHandle">
            {handle ? displayHandle(handle) : "Claim your @handle"}
          </span>
        </span>
      </div>

      <nav className="authAccountLinks" aria-label="Your pages">
        <Link href={profilePath} onClick={onNavigate}>
          Your profile
        </Link>
        <Link href={`${profilePath}#wanted`} onClick={onNavigate}>
          Your Wanteds
        </Link>
        <Link href={`${profilePath}?edit=1`} onClick={onNavigate}>
          Edit profile
        </Link>
      </nav>

      {email ? <p className="authAccountEmail">{email}</p> : null}

      <AccountDeviceControls
        handle={handle}
        activeUserId={activeUserId}
        deviceAccounts={deviceAccounts}
        {...(onSwitchAccount ? { onSwitchAccount } : {})}
        addAccountHref={addAccountHref}
        onSignOut={onSignOut}
        signOutDisabled={Boolean(signOutDisabled)}
        {...(onNavigate ? { onNavigate } : {})}
      />
      {extraControls}
    </div>
  );
}
