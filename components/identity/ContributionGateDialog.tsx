"use client";

import Link from "next/link";
import {
  useCallback,
  useReducer,
  useState,
  type SetStateAction,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import type { AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { trackEvent } from "@/lib/analytics";

import "./contributionGate.css";

export type ContributionGateDialogMode =
  | "sign_in_required"
  | "onboarding_required";

type ContributionGateDialogProps = {
  mode: ContributionGateDialogMode;
  error: string | null;
  onClose: () => void;
};

export function ContributionGateDialog({
  mode,
  error,
  onClose,
}: ContributionGateDialogProps): React.JSX.Element {
  // A blocking dialog owes a keyboard way out. This one had a close button and
  // nothing else, so a reader who reached it with the keyboard had to tab to
  // the end of the dialog to leave.
  useDismissOnEscape(true, onClose);
  return (
    <div className="contributionGateBackdrop" role="presentation">
      <section
        className="contributionGate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contribution-gate-title"
      >
        {mode === "sign_in_required" ? (
          <>
            <p className="contributionGateEyebrow">Account needed</p>
            <h2 id="contribution-gate-title">Sign in to contribute</h2>
            <p>
              Contributions show your public handle, so you need an account
              first. Email sign-in works even when Google and Apple are
              unavailable.
            </p>
            <SignInButton />
          </>
        ) : (
          <>
            <p className="contributionGateEyebrow">Profile needed</p>
            <h2 id="contribution-gate-title">Finish account setup</h2>
            <p>
              Choose a public handle and add your date of birth before
              contributing. The setup dialog collects both together.
            </p>
            <Link
              className="contributionGatePrimary"
              href={HANDLE_CLAIM_NEXT}
              onClick={onClose}
            >
              Finish setup
            </Link>
          </>
        )}
        {error ? (
          <p className="contributionGateError" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="contributionGateClose"
          onClick={onClose}
        >
          Not now
        </button>
      </section>
    </div>
  );
}

export type ContributionActionResult =
  | void
  | Readonly<{
      status: ContributionGateDialogMode;
      error?: string;
    }>;

type PendingContribution = (
  auth: AccountAuthSnapshot,
) => ContributionActionResult | Promise<ContributionActionResult>;

export type AccountScopedDrafts<T> = Readonly<Record<string, T>>;

export function readAccountScopedDraft<T>(
  drafts: AccountScopedDrafts<T>,
  accountId: string | null,
  createDraft: () => T,
): T | null {
  if (!accountId) return null;
  return drafts[accountId] ?? createDraft();
}

export function writeAccountScopedDraft<T>(
  drafts: AccountScopedDrafts<T>,
  accountId: string | null,
  createDraft: () => T,
  next: SetStateAction<T>,
): AccountScopedDrafts<T> {
  if (!accountId) return drafts;
  const current = readAccountScopedDraft(drafts, accountId, createDraft);
  if (!current) return drafts;
  return {
    ...drafts,
    [accountId]:
      typeof next === "function"
        ? (next as (value: T) => T)(current)
        : next,
  };
}

export function useAccountScopedDraft<T>(
  accountId: string | null,
  createDraft: () => T,
): readonly [T | null, (next: SetStateAction<T>) => void, () => void] {
  const [drafts, setDrafts] = useState<AccountScopedDrafts<T>>({});
  const draft = readAccountScopedDraft(drafts, accountId, createDraft);
  const setDraft = useCallback(
    (next: SetStateAction<T>) => {
      setDrafts((current) =>
        writeAccountScopedDraft(current, accountId, createDraft, next),
      );
    },
    [accountId, createDraft],
  );
  const clearDraft = useCallback(() => {
    if (!accountId) return;
    setDrafts((current) => {
      if (!(accountId in current)) return current;
      const next = { ...current };
      delete next[accountId];
      return next;
    });
  }, [accountId]);
  return [draft, setDraft, clearDraft];
}

export type ContributionGateState = {
  userId: string | null;
  mode: ContributionGateDialogMode | null;
  error: string | null;
};

type ContributionGateStateAction =
  | { type: "account_changed"; userId: string | null }
  | { type: "clear"; userId: string | null }
  | {
      type: "show";
      userId: string | null;
      mode: ContributionGateDialogMode;
      error: string | null;
    };

export function contributionGateReducer(
  state: ContributionGateState,
  action: ContributionGateStateAction,
): ContributionGateState {
  if (action.type === "account_changed" || action.type === "clear") {
    return { userId: action.userId, mode: null, error: null };
  }
  if (action.userId !== state.userId) return state;
  return {
    userId: action.userId,
    mode: action.mode,
    error: action.error,
  };
}

export function useContributionGate(): {
  requestContribution: (action: PendingContribution) => Promise<void>;
  contributionGateDialog: React.JSX.Element | null;
} {
  const {
    user,
    contributionAuth,
    invalidateContributionAuth,
  } = useAuth();
  const userId = user?.id ?? null;
  const [gate, dispatch] = useReducer(contributionGateReducer, {
    userId,
    mode: null,
    error: null,
  });
  if (gate.userId !== userId) {
    dispatch({ type: "account_changed", userId });
  }

  const resetGate = useCallback((nextUserId: string | null) => {
    dispatch({ type: "clear", userId: nextUserId });
  }, []);

  const requestContribution = useCallback(
    async (action: PendingContribution) => {
      dispatch({ type: "clear", userId });
      if (!user || !contributionAuth) {
        trackEvent("contribution_gate", { step: "sign_in_required" });
        dispatch({
          type: "show",
          userId,
          mode: "sign_in_required",
          error: null,
        });
        return;
      }
      const result = await action(contributionAuth);
      if (!result) return;
      if (result.status === "sign_in_required") {
        invalidateContributionAuth(contributionAuth);
      }
      trackEvent("contribution_gate", { step: result.status });
      dispatch({
        type: "show",
        userId,
        mode: result.status,
        error:
          result.status === "sign_in_required" && user
            ? "Your sign-in expired. Sign out, then sign in again."
            : errorMessageFrom(result, "That action could not be completed."),
      });
    },
    [contributionAuth, invalidateContributionAuth, user, userId],
  );

  return {
    requestContribution,
    contributionGateDialog:
      gate.userId === userId && gate.mode ? (
        <ContributionGateDialog
          key={gate.mode}
          mode={gate.mode}
          error={gate.error}
          onClose={() => resetGate(userId)}
        />
      ) : null,
  };
}
