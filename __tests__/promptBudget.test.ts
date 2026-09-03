import { describe, expect, it } from "vitest";

import {
  claimPromptBudget,
  hasPromptBudgetFor,
  promptBudgetHolder,
  releasePromptBudget,
} from "@/lib/promptBudget";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function makeDecidedConsentStorage(): Storage {
  const storage = makeMemoryStorage();
  storage.setItem("pubmaxx:analytics-consent:v1", "denied");
  return storage;
}

describe("promptBudget (one surface per session)", () => {
  it("starts free", () => {
    const s = makeMemoryStorage();
    const consent = makeDecidedConsentStorage();
    expect(promptBudgetHolder(s)).toBeNull();
    expect(hasPromptBudgetFor("a2hs", s, consent)).toBe(true);
    expect(hasPromptBudgetFor("first-run-tour", s, consent)).toBe(true);
  });

  it("first claim wins; a second surface is blocked", () => {
    const s = makeMemoryStorage();
    const consent = makeDecidedConsentStorage();
    expect(claimPromptBudget("first-run-tour", s, consent)).toBe(true);
    expect(promptBudgetHolder(s)).toBe("first-run-tour");
    // A2HS can no longer show this session.
    expect(hasPromptBudgetFor("a2hs", s, consent)).toBe(false);
    expect(claimPromptBudget("a2hs", s, consent)).toBe(false);
    // Holder unchanged.
    expect(promptBudgetHolder(s)).toBe("first-run-tour");
  });

  it("claim is idempotent for the holder", () => {
    const s = makeMemoryStorage();
    const consent = makeDecidedConsentStorage();
    expect(claimPromptBudget("a2hs", s, consent)).toBe(true);
    expect(claimPromptBudget("a2hs", s, consent)).toBe(true);
    expect(hasPromptBudgetFor("a2hs", s, consent)).toBe(true);
  });

  it("only the holder can release; then another surface may claim", () => {
    const s = makeMemoryStorage();
    const consent = makeDecidedConsentStorage();
    claimPromptBudget("a2hs", s, consent);
    // A non-holder release is a no-op.
    releasePromptBudget("first-run-tour", s);
    expect(promptBudgetHolder(s)).toBe("a2hs");
    // The holder releases the wasted moment.
    releasePromptBudget("a2hs", s);
    expect(promptBudgetHolder(s)).toBeNull();
    expect(claimPromptBudget("identity-nudge", s, consent)).toBe(true);
    expect(promptBudgetHolder(s)).toBe("identity-nudge");
  });

  it("empty surface never claims", () => {
    const s = makeMemoryStorage();
    expect(claimPromptBudget("", s)).toBe(false);
    expect(promptBudgetHolder(s)).toBeNull();
  });

  it("keeps consent priority when consent storage is unavailable", () => {
    expect(hasPromptBudgetFor("analytics-consent")).toBe(true);
    expect(hasPromptBudgetFor("a2hs")).toBe(false);
    expect(claimPromptBudget("a2hs")).toBe(false);
  });

  it("keeps consent priority when reading consent storage throws", () => {
    const session = makeMemoryStorage();
    const unreadable = makeMemoryStorage();
    unreadable.getItem = () => {
      throw new Error("storage unavailable");
    };

    expect(hasPromptBudgetFor("analytics-consent", session, unreadable)).toBe(true);
    expect(hasPromptBudgetFor("first-run-tour", session, unreadable)).toBe(false);
    expect(claimPromptBudget("first-run-tour", session, unreadable)).toBe(false);
    expect(promptBudgetHolder(session)).toBeNull();
  });

  it("reserves the first prompt moment for an undecided analytics choice", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();

    expect(hasPromptBudgetFor("analytics-consent", session, local)).toBe(true);
    expect(hasPromptBudgetFor("first-run-tour", session, local)).toBe(false);
    expect(claimPromptBudget("first-run-tour", session, local)).toBe(false);
    expect(promptBudgetHolder(session)).toBeNull();

    expect(claimPromptBudget("analytics-consent", session, local)).toBe(true);
    expect(promptBudgetHolder(session)).toBe("analytics-consent");
    expect(claimPromptBudget("first-run-tour", session, local)).toBe(false);
  });

  it.each(["granted", "denied"])(
    "lets other prompts compete in later sessions after analytics is %s",
    (decision) => {
      const session = makeMemoryStorage();
      const local = makeMemoryStorage();
      local.setItem("pubmaxx:analytics-consent:v1", decision);

      expect(hasPromptBudgetFor("first-run-tour", session, local)).toBe(true);
      expect(claimPromptBudget("first-run-tour", session, local)).toBe(true);
    },
  );
});
