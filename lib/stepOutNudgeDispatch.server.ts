import "server-only";

// Batched Step Out weekly send. Skips users with nothing owed and users inside
// the per-subscription frequency window. Counts only — never logs tokens.

import { sendStepOutNudge } from "@/lib/pushSender";
import { canSendStepOutNudge, type StepOutNudgePayload } from "@/lib/stepOutNudge";
import {
  accountIdForOwnerActor,
  selectOwedStepOutNudge,
} from "@/lib/stepOutNudgeSelect.server";
import {
  stepOutNudgeStore,
  type StepOutNudgePref,
} from "@/lib/stepOutNudgeStore";

export type StepOutNudgeDispatchSummary = {
  considered: number;
  sent: number;
  skippedFrequency: number;
  skippedNothingOwed: number;
  skippedNoAccount: number;
  pruned: number;
  errors: number;
};

export type StepOutNudgeDispatchDeps = {
  listEnabled: () => Promise<StepOutNudgePref[]>;
  resolveAccountId: (ownerActor: string) => Promise<string | null>;
  selectPayload: (
    ownerActor: string,
    accountId: string,
    now: Date,
  ) => Promise<StepOutNudgePayload | null>;
  send: (
    token: string,
    payload: StepOutNudgePayload,
  ) => Promise<{ sent: number; pruned: number; errors: number }>;
  markSent: (ownerActor: string, sentAt: string) => Promise<void>;
};

export function defaultStepOutNudgeDispatchDeps(): StepOutNudgeDispatchDeps {
  return {
    listEnabled: () => stepOutNudgeStore().listEnabled(),
    resolveAccountId: accountIdForOwnerActor,
    selectPayload: selectOwedStepOutNudge,
    send: async (token, payload) => {
      const result = await sendStepOutNudge(token, payload);
      return {
        sent: result.sent,
        pruned: result.pruned,
        errors: result.errors,
      };
    },
    markSent: (ownerActor, sentAt) => stepOutNudgeStore().markSent(ownerActor, sentAt),
  };
}

const BATCH_SIZE = 25;

/**
 * Walk every opted-in subscription, select an owed place-bound payload, and
 * send at most one push per week. Never invents filler.
 */
export async function dispatchStepOutNudges(
  now: Date = new Date(),
  deps: StepOutNudgeDispatchDeps = defaultStepOutNudgeDispatchDeps(),
): Promise<StepOutNudgeDispatchSummary> {
  const summary: StepOutNudgeDispatchSummary = {
    considered: 0,
    sent: 0,
    skippedFrequency: 0,
    skippedNothingOwed: 0,
    skippedNoAccount: 0,
    pruned: 0,
    errors: 0,
  };

  const enabled = await deps.listEnabled();
  for (let i = 0; i < enabled.length; i += BATCH_SIZE) {
    const batch = enabled.slice(i, i + BATCH_SIZE);
    for (const pref of batch) {
      summary.considered += 1;
      if (!pref.subscriptionToken) {
        summary.skippedNothingOwed += 1;
        continue;
      }
      if (!canSendStepOutNudge(pref.lastSentAt, now)) {
        summary.skippedFrequency += 1;
        continue;
      }
      const accountId = await deps.resolveAccountId(pref.ownerActor);
      if (!accountId) {
        summary.skippedNoAccount += 1;
        continue;
      }
      const payload = await deps.selectPayload(pref.ownerActor, accountId, now);
      if (!payload) {
        summary.skippedNothingOwed += 1;
        continue;
      }
      try {
        const result = await deps.send(pref.subscriptionToken, payload);
        summary.sent += result.sent;
        summary.pruned += result.pruned;
        summary.errors += result.errors;
        if (result.sent > 0) {
          await deps.markSent(pref.ownerActor, now.toISOString());
        }
      } catch {
        summary.errors += 1;
      }
    }
  }

  return summary;
}
