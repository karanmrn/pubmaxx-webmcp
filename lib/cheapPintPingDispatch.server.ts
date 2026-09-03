import "server-only";

import {
  canSendCheapPint,
  cheapPintPrefView,
  isCheapPintPingWindow,
} from "@/lib/cheapPintPing";
import { sendCheapPintPing } from "@/lib/pushSender";
import {
  accountIdForOwnerActor,
  selectCheapPintPing,
} from "@/lib/cheapPintPingSelect.server";
import { cheapPintPingStore, type StepOutNudgePref } from "@/lib/stepOutNudgeStore";

export type CheapPintPingDispatchSummary = {
  considered: number;
  sent: number;
  skippedWindow: number;
  skippedNotReady: number;
  skippedNoGroundedPint: number;
  skippedNoAccount: number;
  pruned: number;
  errors: number;
};

export type CheapPintPingDispatchDeps = {
  listSendReady: () => Promise<StepOutNudgePref[]>;
  resolveAccountId: (ownerActor: string) => Promise<string | null>;
  selectPayload: (
    ownerActor: string,
    accountId: string,
    now: Date,
  ) => ReturnType<typeof selectCheapPintPing>;
  send: (
    token: string,
    payload: NonNullable<Awaited<ReturnType<typeof selectCheapPintPing>>>,
  ) => Promise<{ sent: number; pruned: number; errors: number }>;
  markSent: (ownerActor: string, sentAt: string) => Promise<void>;
};

export function defaultCheapPintPingDispatchDeps(): CheapPintPingDispatchDeps {
  return {
    listSendReady: () => cheapPintPingStore().listCheapPintSendReady(),
    resolveAccountId: accountIdForOwnerActor,
    selectPayload: (ownerActor, accountId, now) => {
      void now; // Signature carries dispatch clock; selection reads live index.
      return selectCheapPintPing(ownerActor, accountId);
    },
    send: async (token, payload) => {
      const result = await sendCheapPintPing(token, payload);
      return {
        sent: result.sent,
        pruned: result.pruned,
        errors: result.errors,
      };
    },
    markSent: (ownerActor, sentAt) =>
      cheapPintPingStore().markCheapPintSent(ownerActor, sentAt),
  };
}

const BATCH_SIZE = 25;

export async function dispatchCheapPintPings(
  now: Date = new Date(),
  deps: CheapPintPingDispatchDeps = defaultCheapPintPingDispatchDeps(),
): Promise<CheapPintPingDispatchSummary> {
  const summary: CheapPintPingDispatchSummary = {
    considered: 0,
    sent: 0,
    skippedWindow: 0,
    skippedNotReady: 0,
    skippedNoGroundedPint: 0,
    skippedNoAccount: 0,
    pruned: 0,
    errors: 0,
  };

  if (!isCheapPintPingWindow(now)) {
    summary.skippedWindow = 1;
    return summary;
  }

  const ready = await deps.listSendReady();
  for (let i = 0; i < ready.length; i += BATCH_SIZE) {
    const batch = ready.slice(i, i + BATCH_SIZE);
    for (const pref of batch) {
      summary.considered += 1;
      const view = cheapPintPrefView(pref);
      if (!canSendCheapPint(view, now)) {
        summary.skippedNotReady += 1;
        continue;
      }
      if (!pref.subscriptionToken) {
        summary.skippedNotReady += 1;
        continue;
      }
      const accountId = await deps.resolveAccountId(pref.ownerActor);
      if (!accountId) {
        summary.skippedNoAccount += 1;
        continue;
      }
      const payload = await deps.selectPayload(pref.ownerActor, accountId, now);
      if (!payload) {
        summary.skippedNoGroundedPint += 1;
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
