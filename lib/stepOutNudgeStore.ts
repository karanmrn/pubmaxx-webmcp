// Step Out nudge preference store — dual backend (memory + Supabase).
// Opt-in default OFF. One row per owner actor; subscription_token binds the
// preference to an existing web-push registration (migration 0052 / push_tokens).
// last_sent_at is the per-subscription Step Out frequency stamp.
// cheap_pint_* columns (migration 0111) share the same token row.

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "step_out_nudge_prefs";
const MIGRATION_HINT = "apply migration 0094 and 0111";
const STORE_TAG = "step-out-nudge";

const SELECT_COLUMNS =
  "owner_actor, enabled, subscription_token, last_sent_at, created_at, updated_at, cheap_pint_qualified, cheap_pint_enabled, cheap_pint_declined, cheap_pint_sent_at";

export type StepOutNudgePref = {
  ownerActor: string;
  enabled: boolean;
  subscriptionToken: string | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  cheapPintQualified: boolean;
  cheapPintEnabled: boolean;
  cheapPintDeclined: boolean;
  cheapPintSentAt: string | null;
};

export type StepOutNudgePrefPut = {
  enabled: boolean;
  subscriptionToken?: string | null;
};

export type StepOutNudgeStore = {
  get(ownerActor: string): Promise<StepOutNudgePref | null>;
  put(ownerActor: string, input: StepOutNudgePrefPut): Promise<StepOutNudgePref>;
  withdraw(ownerActor: string): Promise<StepOutNudgePref>;
  markSent(ownerActor: string, sentAt: string): Promise<void>;
  listEnabled(): Promise<StepOutNudgePref[]>;
  qualifyCheapPint(ownerActor: string): Promise<StepOutNudgePref>;
  optInCheapPint(ownerActor: string, subscriptionToken: string): Promise<StepOutNudgePref>;
  declineCheapPint(ownerActor: string): Promise<StepOutNudgePref>;
  markCheapPintSent(ownerActor: string, sentAt: string): Promise<void>;
  listCheapPintSendReady(): Promise<StepOutNudgePref[]>;
};

type DbRow = {
  owner_actor: string;
  enabled: boolean;
  subscription_token: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
  cheap_pint_qualified?: boolean;
  cheap_pint_enabled?: boolean;
  cheap_pint_declined?: boolean;
  cheap_pint_sent_at?: string | null;
};

function toDTO(row: DbRow): StepOutNudgePref {
  return {
    ownerActor: row.owner_actor,
    enabled: Boolean(row.enabled),
    subscriptionToken: row.subscription_token,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cheapPintQualified: Boolean(row.cheap_pint_qualified),
    cheapPintEnabled: Boolean(row.cheap_pint_enabled),
    cheapPintDeclined: Boolean(row.cheap_pint_declined),
    cheapPintSentAt: row.cheap_pint_sent_at ?? null,
  };
}

function blankRow(ownerActor: string, now: string): StepOutNudgePref {
  return {
    ownerActor,
    enabled: false,
    subscriptionToken: null,
    lastSentAt: null,
    createdAt: now,
    updatedAt: now,
    cheapPintQualified: false,
    cheapPintEnabled: false,
    cheapPintDeclined: false,
    cheapPintSentAt: null,
  };
}

function keepsPushToken(row: StepOutNudgePref): boolean {
  return row.enabled || row.cheapPintEnabled;
}

const memoryPrefs = new Map<string, StepOutNudgePref>();

export function __resetStepOutNudgeStore(): void {
  memoryPrefs.clear();
}

export function __listMemoryStepOutNudgePrefs(): StepOutNudgePref[] {
  return [...memoryPrefs.values()];
}

function memoryPut(ownerActor: string, input: StepOutNudgePrefPut): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  let subscriptionToken =
    input.subscriptionToken === undefined
      ? (existing.subscriptionToken ?? null)
      : input.subscriptionToken;
  if (!input.enabled && !existing.cheapPintEnabled) {
    subscriptionToken = null;
  }
  let lastSentAt = existing.lastSentAt;
  if (
    input.enabled &&
    subscriptionToken &&
    subscriptionToken !== existing.subscriptionToken
  ) {
    lastSentAt = null;
  }
  const next: StepOutNudgePref = {
    ...existing,
    ownerActor,
    enabled: input.enabled,
    subscriptionToken,
    lastSentAt,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

function memoryQualifyCheapPint(ownerActor: string): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  if (existing.cheapPintDeclined || existing.cheapPintSentAt) return existing;
  const next: StepOutNudgePref = {
    ...existing,
    cheapPintQualified: true,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

function memoryOptInCheapPint(ownerActor: string, subscriptionToken: string): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  const next: StepOutNudgePref = {
    ...existing,
    cheapPintQualified: true,
    cheapPintEnabled: true,
    cheapPintDeclined: false,
    subscriptionToken,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

function memoryDeclineCheapPint(ownerActor: string): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  const next: StepOutNudgePref = {
    ...existing,
    cheapPintDeclined: true,
    cheapPintEnabled: false,
    subscriptionToken: keepsPushToken({ ...existing, cheapPintEnabled: false })
      ? existing.subscriptionToken
      : null,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

export const memoryStepOutNudgeStore: StepOutNudgeStore = {
  async get(ownerActor) {
    return memoryPrefs.get(ownerActor) ?? null;
  },
  async put(ownerActor, input) {
    return memoryPut(ownerActor, input);
  },
  async withdraw(ownerActor) {
    return memoryPut(ownerActor, { enabled: false });
  },
  async markSent(ownerActor, sentAt) {
    const existing = memoryPrefs.get(ownerActor);
    if (!existing) return;
    memoryPrefs.set(ownerActor, {
      ...existing,
      lastSentAt: sentAt,
      updatedAt: sentAt,
    });
  },
  async listEnabled() {
    return [...memoryPrefs.values()].filter(
      (row) => row.enabled && Boolean(row.subscriptionToken),
    );
  },
  async qualifyCheapPint(ownerActor) {
    return memoryQualifyCheapPint(ownerActor);
  },
  async optInCheapPint(ownerActor, subscriptionToken) {
    return memoryOptInCheapPint(ownerActor, subscriptionToken);
  },
  async declineCheapPint(ownerActor) {
    return memoryDeclineCheapPint(ownerActor);
  },
  async markCheapPintSent(ownerActor, sentAt) {
    const existing = memoryPrefs.get(ownerActor);
    if (!existing) return;
    memoryPrefs.set(ownerActor, {
      ...existing,
      cheapPintSentAt: sentAt,
      updatedAt: sentAt,
    });
  },
  async listCheapPintSendReady() {
    return [...memoryPrefs.values()].filter(
      (row) =>
        row.cheapPintQualified &&
        row.cheapPintEnabled &&
        !row.cheapPintDeclined &&
        !row.cheapPintSentAt &&
        Boolean(row.subscriptionToken),
    );
  },
};

const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

async function readRow(ownerActor: string): Promise<StepOutNudgePref | null> {
  const { data, error } = await admin()
    .from(TABLE)
    .select(SELECT_COLUMNS)
    .eq("owner_actor", ownerActor)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toDTO(data as DbRow) : null;
}

async function writeRow(row: Record<string, unknown>): Promise<StepOutNudgePref> {
  const { data, error } = await admin()
    .from(TABLE)
    .upsert(row, { onConflict: "owner_actor" })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toDTO(data as DbRow);
}

export const supabaseStepOutNudgeStore: StepOutNudgeStore = {
  async get(ownerActor) {
    return guard({
      context: "get",
      onSchemaMiss: async () => memoryStepOutNudgeStore.get(ownerActor),
      run: async () => readRow(ownerActor),
    });
  },

  async put(ownerActor, input) {
    return guard({
      context: "put",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.put(ownerActor, input),
        }),
      run: async () => {
        const now = new Date().toISOString();
        const existingDto = await readRow(ownerActor);

        let subscriptionToken =
          input.subscriptionToken === undefined
            ? (existingDto?.subscriptionToken ?? null)
            : input.subscriptionToken;
        if (!input.enabled && !existingDto?.cheapPintEnabled) {
          subscriptionToken = null;
        }
        let lastSentAt = existingDto?.lastSentAt ?? null;
        if (
          input.enabled &&
          subscriptionToken &&
          subscriptionToken !== existingDto?.subscriptionToken
        ) {
          lastSentAt = null;
        }
        return writeRow({
          owner_actor: ownerActor,
          enabled: input.enabled,
          subscription_token: subscriptionToken,
          last_sent_at: lastSentAt,
          updated_at: now,
          created_at: existingDto?.createdAt ?? now,
          cheap_pint_qualified: existingDto?.cheapPintQualified ?? false,
          cheap_pint_enabled: existingDto?.cheapPintEnabled ?? false,
          cheap_pint_declined: existingDto?.cheapPintDeclined ?? false,
          cheap_pint_sent_at: existingDto?.cheapPintSentAt ?? null,
        });
      },
    });
  },

  async withdraw(ownerActor) {
    return this.put(ownerActor, { enabled: false });
  },

  async markSent(ownerActor, sentAt) {
    return guard({
      context: "markSent",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.markSent(ownerActor, sentAt),
        }),
      run: async () => {
        const { error } = await admin()
          .from(TABLE)
          .update({ last_sent_at: sentAt, updated_at: sentAt })
          .eq("owner_actor", ownerActor)
          .eq("enabled", true);
        if (error) throw new Error(error.message);
      },
    });
  },

  async listEnabled() {
    return guard({
      context: "listEnabled",
      onSchemaMiss: async () => memoryStepOutNudgeStore.listEnabled(),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_COLUMNS)
          .eq("enabled", true)
          .not("subscription_token", "is", null);
        if (error) throw new Error(error.message);
        return (data ?? [])
          .map((row) => toDTO(row as DbRow))
          .filter((row) => Boolean(row.subscriptionToken));
      },
    });
  },

  async qualifyCheapPint(ownerActor) {
    return guard({
      context: "qualifyCheapPint",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.qualifyCheapPint(ownerActor),
        }),
      run: async () => {
        const now = new Date().toISOString();
        const existing = (await readRow(ownerActor)) ?? blankRow(ownerActor, now);
        if (existing.cheapPintDeclined || existing.cheapPintSentAt) return existing;
        return writeRow({
          owner_actor: ownerActor,
          enabled: existing.enabled,
          subscription_token: existing.subscriptionToken,
          last_sent_at: existing.lastSentAt,
          created_at: existing.createdAt,
          updated_at: now,
          cheap_pint_qualified: true,
          cheap_pint_enabled: existing.cheapPintEnabled,
          cheap_pint_declined: existing.cheapPintDeclined,
          cheap_pint_sent_at: existing.cheapPintSentAt,
        });
      },
    });
  },

  async optInCheapPint(ownerActor, subscriptionToken) {
    return guard({
      context: "optInCheapPint",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () =>
            memoryStepOutNudgeStore.optInCheapPint(ownerActor, subscriptionToken),
        }),
      run: async () => {
        const now = new Date().toISOString();
        const existing = (await readRow(ownerActor)) ?? blankRow(ownerActor, now);
        return writeRow({
          owner_actor: ownerActor,
          enabled: existing.enabled,
          subscription_token: subscriptionToken,
          last_sent_at: existing.lastSentAt,
          created_at: existing.createdAt,
          updated_at: now,
          cheap_pint_qualified: true,
          cheap_pint_enabled: true,
          cheap_pint_declined: false,
          cheap_pint_sent_at: existing.cheapPintSentAt,
        });
      },
    });
  },

  async declineCheapPint(ownerActor) {
    return guard({
      context: "declineCheapPint",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.declineCheapPint(ownerActor),
        }),
      run: async () => {
        const now = new Date().toISOString();
        const existing = (await readRow(ownerActor)) ?? blankRow(ownerActor, now);
        const tokenAfter = keepsPushToken({
          ...existing,
          cheapPintEnabled: false,
        })
          ? existing.subscriptionToken
          : null;
        return writeRow({
          owner_actor: ownerActor,
          enabled: existing.enabled,
          subscription_token: tokenAfter,
          last_sent_at: existing.lastSentAt,
          created_at: existing.createdAt,
          updated_at: now,
          cheap_pint_qualified: existing.cheapPintQualified,
          cheap_pint_enabled: false,
          cheap_pint_declined: true,
          cheap_pint_sent_at: existing.cheapPintSentAt,
        });
      },
    });
  },

  async markCheapPintSent(ownerActor, sentAt) {
    return guard({
      context: "markCheapPintSent",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.markCheapPintSent(ownerActor, sentAt),
        }),
      run: async () => {
        const { error } = await admin()
          .from(TABLE)
          .update({ cheap_pint_sent_at: sentAt, updated_at: sentAt })
          .eq("owner_actor", ownerActor)
          .eq("cheap_pint_enabled", true);
        if (error) throw new Error(error.message);
      },
    });
  },

  async listCheapPintSendReady() {
    return guard({
      context: "listCheapPintSendReady",
      onSchemaMiss: async () => memoryStepOutNudgeStore.listCheapPintSendReady(),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_COLUMNS)
          .eq("cheap_pint_qualified", true)
          .eq("cheap_pint_enabled", true)
          .eq("cheap_pint_declined", false)
          .is("cheap_pint_sent_at", null)
          .not("subscription_token", "is", null);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => toDTO(row as DbRow));
      },
    });
  },
};

export const stepOutNudgeStore = createDualBackendStore(
  memoryStepOutNudgeStore,
  supabaseStepOutNudgeStore,
);

export const cheapPintPingStore = stepOutNudgeStore;
