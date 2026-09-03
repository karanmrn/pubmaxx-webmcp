export const GROUP_PREF_MAX_ATMOSPHERE_CHIPS = 1;

export const GROUP_PREF_BUDGET_BANDS = [
  { id: "under6", label: "Under GBP 6", summary: "under GBP 6 pints", rank: 0 },
  { id: "standard", label: "Standard", summary: "standard-price pints", rank: 1 },
  { id: "flexible", label: "Flexible", summary: "flexible budget", rank: 2 },
] as const;

export const GROUP_PREF_ATMOSPHERE_CHIPS = [
  { id: "cosy", label: "Cosy corners" },
  { id: "chatty", label: "Chatty tables" },
  { id: "lively", label: "Lively room" },
  { id: "music", label: "Music-led" },
  { id: "food", label: "Food nearby" },
] as const;

export type GroupPrefBudgetBand = typeof GROUP_PREF_BUDGET_BANDS[number]["id"];
export type GroupPrefAtmosphereChip = typeof GROUP_PREF_ATMOSPHERE_CHIPS[number]["id"];

export type MatePreference = {
  mateId: string;
  budgetBand: GroupPrefBudgetBand;
  atmosphereChips: GroupPrefAtmosphereChip[];
  zeroProof: boolean;
  accessibilityRequired: boolean;
  weatherShelterRequired: boolean;
  updatedAt?: string;
};

export type GroupPrefsHardConstraints = {
  budgetBand: GroupPrefBudgetBand | null;
  budgetLabel: string | null;
  zeroProofRequired: boolean;
  accessibilityRequired: boolean;
  weatherShelterRequired: boolean;
  sharedAtmosphereChips: GroupPrefAtmosphereChip[];
};

export type GroupPrefsOverlap = {
  mateCount: number;
  hardConstraints: GroupPrefsHardConstraints;
  softScore: number;
  scoreLabel: "No picks yet" | "First pick saved" | "Strong overlap" | "Some overlap" | "Light overlap";
  summaryLabels: string[];
  /** Must-have lines the planner may never silently relax. */
  mustHaveLabels: string[];
};

const BUDGET_BY_ID = new Map(GROUP_PREF_BUDGET_BANDS.map((band) => [band.id, band]));
const ATMOSPHERE_BY_ID = new Map(GROUP_PREF_ATMOSPHERE_CHIPS.map((chip) => [chip.id, chip]));
const ATMOSPHERE_ORDER = new Map(GROUP_PREF_ATMOSPHERE_CHIPS.map((chip, index) => [chip.id, index]));

function isBudgetBand(value: unknown): value is GroupPrefBudgetBand {
  return typeof value === "string" && BUDGET_BY_ID.has(value as GroupPrefBudgetBand);
}

function isAtmosphereChip(value: unknown): value is GroupPrefAtmosphereChip {
  return typeof value === "string" && ATMOSPHERE_BY_ID.has(value as GroupPrefAtmosphereChip);
}

function cleanAtmosphereChips(value: unknown): GroupPrefAtmosphereChip[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<GroupPrefAtmosphereChip>();
  for (const item of value) {
    if (!isAtmosphereChip(item) || seen.has(item)) continue;
    seen.add(item);
    if (seen.size >= GROUP_PREF_MAX_ATMOSPHERE_CHIPS) break;
  }
  return [...seen];
}

export function parseMatePreference(value: unknown): MatePreference | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const mateId = typeof row.mateId === "string" ? row.mateId.trim() : "";
  const atmosphereChips = cleanAtmosphereChips(row.atmosphereChips);
  if (!mateId || !isBudgetBand(row.budgetBand) || atmosphereChips.length === 0) return null;
  return {
    mateId,
    budgetBand: row.budgetBand,
    atmosphereChips,
    zeroProof: row.zeroProof === true,
    accessibilityRequired: row.accessibilityRequired === true,
    weatherShelterRequired: row.weatherShelterRequired === true,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
  };
}

export type GroupPrefWriteInput = {
  budgetBand: GroupPrefBudgetBand;
  atmosphereChip: GroupPrefAtmosphereChip;
  zeroProof: boolean;
  accessibilityRequired: boolean;
  weatherShelterRequired: boolean;
};

export function parseGroupPrefWriteInput(value: unknown): GroupPrefWriteInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isBudgetBand(row.budgetBand) || !isAtmosphereChip(row.atmosphereChip)) return null;
  return {
    budgetBand: row.budgetBand,
    atmosphereChip: row.atmosphereChip,
    zeroProof: row.zeroProof === true,
    accessibilityRequired: row.accessibilityRequired === true,
    weatherShelterRequired: row.weatherShelterRequired === true,
  };
}

function prefTime(pref: MatePreference): number {
  if (!pref.updatedAt) return 0;
  const time = new Date(pref.updatedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestMatePrefs(prefs: readonly MatePreference[]): MatePreference[] {
  const latest = new Map<string, MatePreference>();
  for (const candidate of prefs) {
    const pref = parseMatePreference(candidate);
    if (!pref) continue;
    const previous = latest.get(pref.mateId);
    if (!previous || prefTime(pref) >= prefTime(previous)) latest.set(pref.mateId, pref);
  }
  return [...latest.values()];
}

function labelForBudget(budgetBand: GroupPrefBudgetBand | null): string | null {
  return budgetBand ? BUDGET_BY_ID.get(budgetBand)?.summary ?? null : null;
}

function labelForAtmosphere(chip: GroupPrefAtmosphereChip): string {
  return ATMOSPHERE_BY_ID.get(chip)?.label ?? chip;
}

function scoreLabel(mateCount: number, score: number): GroupPrefsOverlap["scoreLabel"] {
  if (mateCount === 0) return "No picks yet";
  if (mateCount === 1) return "First pick saved";
  if (score >= 75) return "Strong overlap";
  if (score >= 50) return "Some overlap";
  return "Light overlap";
}

function mustHaveLabelsFor(hard: GroupPrefsHardConstraints): string[] {
  return [
    hard.budgetLabel ? `Budget: ${hard.budgetLabel}` : null,
    hard.zeroProofRequired ? "Zero-proof options needed" : null,
    hard.accessibilityRequired ? "Step-free access needed" : null,
    hard.weatherShelterRequired ? "Covered shelter needed" : null,
  ].filter((label): label is string => Boolean(label));
}

export function overlapGroupPrefs(prefs: readonly MatePreference[]): GroupPrefsOverlap {
  const latest = latestMatePrefs(prefs);
  if (latest.length === 0) {
    return {
      mateCount: 0,
      hardConstraints: {
        budgetBand: null,
        budgetLabel: null,
        zeroProofRequired: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
        sharedAtmosphereChips: [],
      },
      softScore: 0,
      scoreLabel: "No picks yet",
      summaryLabels: ["waiting on mate picks"],
      mustHaveLabels: [],
    };
  }

  const budgetRanks = latest.map((pref) => BUDGET_BY_ID.get(pref.budgetBand)?.rank ?? 0);
  const strictestRank = Math.min(...budgetRanks);
  const loosestRank = Math.max(...budgetRanks);
  const strictestBudget = GROUP_PREF_BUDGET_BANDS.find((band) => band.rank === strictestRank)?.id ?? null;
  const budgetLabel = labelForBudget(strictestBudget);
  const zeroProofRequired = latest.some((pref) => pref.zeroProof);
  const accessibilityRequired = latest.some((pref) => pref.accessibilityRequired);
  const weatherShelterRequired = latest.some((pref) => pref.weatherShelterRequired);
  const mixedZeroProof = latest.some((pref) => pref.zeroProof) && latest.some((pref) => !pref.zeroProof);

  const atmosphereCounts = new Map<GroupPrefAtmosphereChip, number>();
  for (const pref of latest) {
    for (const chip of pref.atmosphereChips) {
      atmosphereCounts.set(chip, (atmosphereCounts.get(chip) ?? 0) + 1);
    }
  }
  const sharedAtmosphereChips = [...atmosphereCounts.entries()]
    .filter(([, count]) => count === latest.length)
    .map(([chip]) => chip)
    .sort((a, b) => (ATMOSPHERE_ORDER.get(a) ?? 0) - (ATMOSPHERE_ORDER.get(b) ?? 0));
  const rankedAtmosphere = [...atmosphereCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (ATMOSPHERE_ORDER.get(a[0]) ?? 0) - (ATMOSPHERE_ORDER.get(b[0]) ?? 0));

  const budgetSpread = loosestRank - strictestRank;
  const budgetScore = 1 - (budgetSpread / (GROUP_PREF_BUDGET_BANDS.length - 1)) * 0.67;
  const zeroProofScore = mixedZeroProof ? 0.75 : 1;
  const atmosphereScore = sharedAtmosphereChips.length > 0
    ? 1
    : rankedAtmosphere.length > 0 ? rankedAtmosphere[0]![1] / latest.length : 0.5;
  const softScore = Math.max(0, Math.min(100, Math.round(((budgetScore + zeroProofScore + atmosphereScore) / 3) * 100)));
  const hardConstraints: GroupPrefsHardConstraints = {
    budgetBand: strictestBudget,
    budgetLabel,
    zeroProofRequired,
    accessibilityRequired,
    weatherShelterRequired,
    sharedAtmosphereChips,
  };
  const mustHaveLabels = mustHaveLabelsFor(hardConstraints);
  const summaryLabels = [
    ...mustHaveLabels,
    sharedAtmosphereChips.length > 0
      ? `Shared vibe: ${sharedAtmosphereChips.map(labelForAtmosphere).join(", ")}`
      : rankedAtmosphere[0] ? `Top vibe: ${labelForAtmosphere(rankedAtmosphere[0][0])} (${rankedAtmosphere[0][1]}/${latest.length})` : null,
  ].filter((label): label is string => Boolean(label));

  return {
    mateCount: latest.length,
    hardConstraints,
    softScore,
    scoreLabel: scoreLabel(latest.length, softScore),
    summaryLabels,
    mustHaveLabels,
  };
}
