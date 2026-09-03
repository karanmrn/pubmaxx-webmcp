import "server-only";

import { parseFoundingMemberNumber } from "@/lib/foundingMembers";
import { identityHandleStore } from "@/lib/identityHandleStore";
import {
  cleanDateOfBirth,
  MAX_GENDER_SELF_DESCRIBED,
  PRIVATE_IDENTITY_GENDER_VALUES,
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentityGender,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";
import { profileStore } from "@/lib/profileStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";
import { cleanText } from "@/lib/textClean";

type PrivateIdentityRecord = {
  dateOfBirth: string;
  fullName?: string;
  sex?: PrivateIdentitySex;
  gender?: PrivateIdentityGender;
  genderSelfDescribed?: string;
  createdAt: string;
  updatedAt: string;
};

type PrivateIdentityDetailsInput = {
  fullName?: unknown;
  sex?: unknown;
  gender?: unknown;
  genderSelfDescribed?: unknown;
  /** Already validated by the route via cleanDateOfBirth. */
  dateOfBirth?: string;
};

type CompleteOnboardingInput = {
  userId: string;
  handle: string;
  dateOfBirth: unknown;
  fullName?: unknown;
  sex?: unknown;
};

type CompleteOnboardingResult =
  | {
      ok: true;
      profileId: string;
      handle: string;
      privateIdentity: PrivateIdentityRecord;
      /** Granted by the claim underneath, when the first hundred had room. */
      foundingMemberNumber?: number;
    }
  | {
      ok: false;
      code:
        | "invalid"
        | "reserved"
        | "taken"
        | "already_has_handle"
        | "storage";
      error: string;
    };

type PrivateIdentityStore = {
  read(userId: string, now?: number): Promise<PrivateIdentityRecord | null>;
  erase(userId: string): Promise<void>;
  updateDetails(
    userId: string,
    details: PrivateIdentityDetailsInput,
  ): Promise<PrivateIdentityRecord | null>;
  completeOnboarding(
    input: CompleteOnboardingInput,
  ): Promise<CompleteOnboardingResult>;
};

const TABLE = "private_account_identities";
const MAX_FULL_NAME = 100;
const sexValues = new Set<string>(PRIVATE_IDENTITY_SEX_VALUES);

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanFullName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return cleanText(value, MAX_FULL_NAME) || undefined;
}

function cleanSex(value: unknown): PrivateIdentitySex | undefined {
  return typeof value === "string" && sexValues.has(value)
    ? (value as PrivateIdentitySex)
    : undefined;
}

const genderValues = new Set<string>(PRIVATE_IDENTITY_GENDER_VALUES);

function cleanGender(value: unknown): PrivateIdentityGender | undefined {
  return typeof value === "string" && genderValues.has(value)
    ? (value as PrivateIdentityGender)
    : undefined;
}

// The self-described line only exists beside gender = "self_described"; the
// database CHECK enforces the same pairing.
function cleanGenderSelfDescribed(
  gender: PrivateIdentityGender | undefined,
  value: unknown,
): string | undefined {
  if (gender !== "self_described" || typeof value !== "string") return undefined;
  return cleanText(value, MAX_GENDER_SELF_DESCRIBED) || undefined;
}

function fromRow(row: Record<string, unknown>): PrivateIdentityRecord {
  return {
    dateOfBirth:
      typeof row.date_of_birth === "string" ? row.date_of_birth : "",
    ...(typeof row.full_name === "string" && row.full_name
      ? { fullName: row.full_name }
      : {}),
    ...(typeof row.sex === "string" && sexValues.has(row.sex)
      ? { sex: row.sex as PrivateIdentitySex }
      : {}),
    ...(typeof row.gender === "string" && genderValues.has(row.gender)
      ? { gender: row.gender as PrivateIdentityGender }
      : {}),
    ...(typeof row.gender_self_described === "string" && row.gender_self_described
      ? { genderSelfDescribed: row.gender_self_described }
      : {}),
    createdAt:
      typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    updatedAt:
      typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
  };
}

function claimError(
  code: unknown,
  error: unknown,
): Extract<CompleteOnboardingResult, { ok: false }> {
  const known =
    code === "invalid" ||
    code === "reserved" ||
    code === "taken" ||
    code === "already_has_handle"
      ? code
      : "storage";
  return {
    ok: false,
    code: known,
    error:
      typeof error === "string" && error
        ? error
        : "Profile storage is unavailable.",
  };
}

const memoryPrivateIdentities = new Map<string, PrivateIdentityRecord>();

export const memoryPrivateIdentityStore: PrivateIdentityStore = {
  async read(userId) {
    const key = cleanUserId(userId);
    return memoryPrivateIdentities.get(key) ?? null;
  },

  async erase(userId) {
    const key = cleanUserId(userId);
    if (key) memoryPrivateIdentities.delete(key);
  },

  async updateDetails(userId, details) {
    const key = cleanUserId(userId);
    const profile = key ? await profileStore().getByUserId(key) : null;
    const previous = (key ? memoryPrivateIdentities.get(key) : null) ?? null;
    if (!profile) return null;
    // A save CREATES the row. An account claimed through the early handle path
    // has no identity row, and refusing the save left the date of birth it was
    // typing with nowhere to go. The row still needs one, so a first save with
    // no date of birth is the only refusal left here.
    const dateOfBirth = details.dateOfBirth || previous?.dateOfBirth || "";
    if (!dateOfBirth) return null;
    const now = new Date().toISOString();
    const record: PrivateIdentityRecord = {
      ...(previous ?? {}),
      dateOfBirth,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    if ("fullName" in details) {
      const fullName = cleanFullName(details.fullName);
      if (fullName) record.fullName = fullName;
      else delete record.fullName;
    }
    if ("sex" in details) {
      const sex = cleanSex(details.sex);
      if (sex) record.sex = sex;
      else delete record.sex;
    }
    if ("gender" in details) {
      const gender = cleanGender(details.gender);
      if (gender) record.gender = gender;
      else delete record.gender;
      const selfDescribed = cleanGenderSelfDescribed(
        gender,
        details.genderSelfDescribed,
      );
      if (selfDescribed) record.genderSelfDescribed = selfDescribed;
      else delete record.genderSelfDescribed;
    }
    memoryPrivateIdentities.set(key, record);
    return record;
  },

  async completeOnboarding(input) {
    const userId = cleanUserId(input.userId);
    const dateOfBirth = cleanDateOfBirth(input.dateOfBirth);
    const assessment = assessPubmaxxHandle(input.handle);
    if (!userId) return claimError("storage", null);
    if (!dateOfBirth) {
      return {
        ok: false,
        code: "invalid",
        error: "Enter a valid date of birth.",
      };
    }
    if (!assessment.ok) return claimError(assessment.reason, assessment.error);
    const claimed = await identityHandleStore().claim(userId, assessment.handle);
    if (!claimed.ok) return claimError(claimed.code, claimed.error);

    const now = new Date().toISOString();
    const previous = memoryPrivateIdentities.get(userId);
    const privateIdentity: PrivateIdentityRecord = {
      ...(previous ?? {}),
      dateOfBirth: previous?.dateOfBirth || dateOfBirth,
      ...(cleanFullName(input.fullName)
        ? { fullName: cleanFullName(input.fullName) }
        : {}),
      ...(cleanSex(input.sex) ? { sex: cleanSex(input.sex) } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    memoryPrivateIdentities.set(userId, privateIdentity);
    return {
      ok: true,
      profileId: claimed.profileId,
      handle: claimed.handle,
      privateIdentity,
      ...(claimed.foundingMemberNumber === undefined
        ? {}
        : { foundingMemberNumber: claimed.foundingMemberNumber }),
    };
  },

};

export const supabasePrivateIdentityStore: PrivateIdentityStore = {
  async read(userId) {
    const key = cleanUserId(userId);
    if (!key) return null;
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .select("*")
      .eq("user_id", key)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async erase(userId) {
    const key = cleanUserId(userId);
    if (!key) return;
    const { error } = await requireSupabaseAdmin()
      .from(TABLE)
      .delete()
      .eq("user_id", key);
    if (error) throw new Error(error.message);
  },

  async updateDetails(userId, details) {
    const key = cleanUserId(userId);
    if (!key) return null;
    const profile = await profileStore().getByUserId(key);
    if (!profile) return null;
    const current = await this.read(key);
    // A save CREATES the row. Verified in production: @karan claimed a handle
    // through the early path, which stores no date of birth, so there was no
    // row here and the save that would have made one was refused by its own
    // absence. `date_of_birth` is NOT NULL, so a first save must carry one.
    const dateOfBirth = details.dateOfBirth || current?.dateOfBirth || "";
    if (!dateOfBirth) return null;
    const row: Record<string, unknown> = {
      user_id: key,
      date_of_birth: dateOfBirth,
      updated_at: new Date().toISOString(),
    };
    if ("fullName" in details) {
      row.full_name = cleanFullName(details.fullName) ?? null;
    }
    if ("sex" in details) {
      row.sex = cleanSex(details.sex) ?? null;
    }
    if ("gender" in details) {
      const gender = cleanGender(details.gender);
      row.gender = gender ?? null;
      row.gender_self_described =
        cleanGenderSelfDescribed(gender, details.genderSelfDescribed) ?? null;
    }
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .upsert(row, { onConflict: "user_id" })
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const updated = (data ?? [])[0];
    return updated ? fromRow(updated as Record<string, unknown>) : null;
  },

  async completeOnboarding(input) {
    const userId = cleanUserId(input.userId);
    const dateOfBirth = cleanDateOfBirth(input.dateOfBirth);
    const assessment = assessPubmaxxHandle(input.handle);
    if (!userId) return claimError("storage", null);
    if (!dateOfBirth) {
      return {
        ok: false,
        code: "invalid",
        error: "Enter a valid date of birth.",
      };
    }
    if (!assessment.ok) return claimError(assessment.reason, assessment.error);
    const { data, error } = await requireSupabaseAdmin().rpc(
      "complete_contributor_onboarding",
      {
        p_user_id: userId,
        p_handle: assessment.handle,
        p_date_of_birth: dateOfBirth,
        p_full_name: cleanFullName(input.fullName) ?? null,
        p_sex: cleanSex(input.sex) ?? null,
      },
    );
    if (error) return claimError("storage", null);
    const result =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    if (result.ok !== true) return claimError(result.code, result.error);
    const privateIdentity = await this.read(userId);
    if (!privateIdentity) return claimError("storage", null);
    // The onboarding RPC returns the claim's own jsonb verbatim, so the founding
    // number granted inside the claim's transaction rides out here.
    const founding = parseFoundingMemberNumber(result.founding_member_number);
    return {
      ok: true,
      profileId: String(result.profile_id),
      handle: String(result.handle),
      privateIdentity,
      ...(founding === null ? {} : { foundingMemberNumber: founding }),
    };
  },

};

export function privateIdentityStore(): PrivateIdentityStore {
  return selectStore(
    memoryPrivateIdentityStore,
    supabasePrivateIdentityStore,
  );
}

export function __resetMemoryPrivateIdentities(): void {
  memoryPrivateIdentities.clear();
}
