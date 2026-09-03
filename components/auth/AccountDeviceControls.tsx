"use client";

// What a person may do to the ACCOUNTS on this device: hop between them, add
// one, or leave.
//
// ONE component, because there are two account surfaces and they must not
// disagree. The nav card is desktop only (`.siteNavBar .authUser` is hidden at
// 640px), so a phone's account home is the signed-in card on /login; a second
// copy of these controls would have drifted from the first the day either
// changed.
//
// The SCOPE on the way out exists only when the device holds more than one
// account. With one, "this account" and "all accounts" are the same act and
// printing both would be a choice about nothing.

import { useState } from "react";

import AccountSwitcher from "@/components/auth/AccountSwitcher";
import type { SignOutScope } from "@/components/auth/AuthProvider";
import {
  deviceAccountSwitchTargets,
  deviceSignOutScopeOffered,
  type DeviceAccountRecord,
} from "@/lib/deviceAccountSessions";
import type { DeviceAccountSwitchOutcome } from "@/lib/deviceAccountSwitch";
import { displayHandle } from "@/lib/handleDisplay";

export default function AccountDeviceControls({
  handle,
  activeUserId = null,
  deviceAccounts = [],
  onSwitchAccount,
  addAccountHref = "/login",
  onSignOut,
  signOutDisabled = false,
  signOutClassName = "authSignOut",
  onNavigate,
}: {
  /** The active account's handle, so the way out names who is leaving. */
  handle: string | null;
  activeUserId?: string | null;
  deviceAccounts?: readonly DeviceAccountRecord[];
  /** Absent on a host that has not wired the switcher: the card is unchanged. */
  onSwitchAccount?: (userId: string) => Promise<DeviceAccountSwitchOutcome>;
  addAccountHref?: string;
  onSignOut: (scope: SignOutScope) => void;
  signOutDisabled?: boolean;
  signOutClassName?: string;
  onNavigate?: () => void;
}): React.JSX.Element {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // ONE derivation of the lane per surface, shared by the list and the scope, so
  // the two can never disagree about what this device holds.
  const switchTargets = deviceAccountSwitchTargets(deviceAccounts, activeUserId);
  const scopedSignOut = deviceSignOutScopeOffered(deviceAccounts, activeUserId);

  return (
    <>
      {onSwitchAccount ? (
        <AccountSwitcher
          accounts={switchTargets}
          addAccountHref={addAccountHref}
          open={switcherOpen}
          onToggle={() => setSwitcherOpen((wasOpen) => !wasOpen)}
          onSwitch={onSwitchAccount}
          {...(onNavigate ? { onNavigate } : {})}
          disabled={signOutDisabled}
        />
      ) : null}
      {scopedSignOut ? (
        <>
          <button
            type="button"
            className={signOutClassName}
            onClick={() => onSignOut("account")}
            disabled={signOutDisabled}
          >
            {handle ? `Sign out of ${displayHandle(handle)}` : "Sign out of this account"}
          </button>
          <button
            type="button"
            className={`${signOutClassName} authSignOutDevice`}
            onClick={() => onSignOut("device")}
            disabled={signOutDisabled}
          >
            Sign out of all accounts
          </button>
        </>
      ) : (
        <button
          type="button"
          className={signOutClassName}
          onClick={() => onSignOut("account")}
          disabled={signOutDisabled}
        >
          Sign out
        </button>
      )}
    </>
  );
}
