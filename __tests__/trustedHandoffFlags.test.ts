import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createTrustedHandoffFlagsDTO,
  TRUSTED_HANDOFF_FLAG_KEYS,
  TRUSTED_HANDOFF_FLAGS_OFF,
  trustedHandoffFlagEnabled,
} from "@/lib/trustedHandoffFlags";
import {
  parseTrustedHandoffFlag,
  readTrustedHandoffFlag,
  readTrustedHandoffFlags,
  TRUSTED_HANDOFF_FLAG_DEFINITIONS,
} from "@/lib/trustedHandoffFlags.server";

const ALL_ON_ENV = Object.fromEntries(
  Object.values(TRUSTED_HANDOFF_FLAG_DEFINITIONS).map(({ env }) => [env, "1"]),
);

describe("trusted handoff flag parser", () => {
  it("enables only the exact value 1", () => {
    expect(parseTrustedHandoffFlag("1")).toBe(true);

    for (const value of [undefined, "", "0", " 1", "1 ", "true", "on", "01", "2"]) {
      expect(parseTrustedHandoffFlag(value)).toBe(false);
    }
  });

  it("treats unknown flag names as off", () => {
    expect(readTrustedHandoffFlag("unknown", ALL_ON_ENV)).toBe(false);
    expect(trustedHandoffFlagEnabled(readTrustedHandoffFlags(ALL_ON_ENV), "unknown")).toBe(false);
  });
});

describe("trusted handoff flag registry", () => {
  it("registers exactly five live rollout flags with ownership and removal metadata", () => {
    expect(TRUSTED_HANDOFF_FLAG_KEYS).toHaveLength(5);
    expect(Object.keys(TRUSTED_HANDOFF_FLAG_DEFINITIONS)).toEqual(TRUSTED_HANDOFF_FLAG_KEYS);
    expect(TRUSTED_HANDOFF_FLAG_KEYS).not.toContain("landingFindMyPint");
    expect(TRUSTED_HANDOFF_FLAG_KEYS).not.toContain("intentWrite");
    expect(TRUSTED_HANDOFF_FLAG_KEYS).not.toContain("intentRead");
    expect(TRUSTED_HANDOFF_FLAG_KEYS).not.toContain("anchoredGeneration");

    for (const definition of Object.values(TRUSTED_HANDOFF_FLAG_DEFINITIONS)) {
      expect(definition.env).toMatch(/^PUBMAX_/);
      expect(definition.ownerLane).toMatch(/^L\d{2}$/);
      expect(definition.removalCondition.length).toBeGreaterThan(20);
      expect(definition.offBehavior.length).toBeGreaterThan(20);
    }
  });

  it("keeps ordinary flags off while Social stays live by default", () => {
    expect(readTrustedHandoffFlags({})).toEqual({
      ...TRUSTED_HANDOFF_FLAGS_OFF,
      socialFriendsLaunch: true,
    });

    const malformed = Object.fromEntries(
      Object.values(TRUSTED_HANDOFF_FLAG_DEFINITIONS).map(({ env }) => [env, "true"]),
    );
    expect(readTrustedHandoffFlags(malformed)).toEqual({
      ...TRUSTED_HANDOFF_FLAGS_OFF,
      socialFriendsLaunch: true,
    });
  });

  it("reads a complete all-on snapshot", () => {
    expect(readTrustedHandoffFlags(ALL_ON_ENV)).toEqual({
      mapRouteTransfer: true,
      tonightGrouping: true,
      palHandoff: true,
      friendMemberRehydrationV2: true,
      socialFriendsLaunch: true,
    });
  });

  it("reads each flag independently without truthy coercion", () => {
    for (const key of TRUSTED_HANDOFF_FLAG_KEYS) {
      const envName = TRUSTED_HANDOFF_FLAG_DEFINITIONS[key].env;
      const flags = readTrustedHandoffFlags({ [envName]: "1" });

      for (const candidate of TRUSTED_HANDOFF_FLAG_KEYS) {
        const expected = candidate === key || (candidate === "socialFriendsLaunch" && key !== "socialFriendsLaunch");
        expect(flags[candidate], `${candidate} while ${key} is enabled`).toBe(expected);
      }
    }
  });

  it("returns the same immutable client DTO shape as the client constructor", () => {
    const serverFlags = readTrustedHandoffFlags(ALL_ON_ENV);
    const clientFlags = createTrustedHandoffFlagsDTO({ ...serverFlags });

    expect(serverFlags).toEqual(clientFlags);
    expect(Object.isFrozen(serverFlags)).toBe(true);
    expect(Object.isFrozen(clientFlags)).toBe(true);
  });

  it("never carries environment names or raw values into the client DTO", () => {
    const serialized = JSON.stringify(readTrustedHandoffFlags({
      ...ALL_ON_ENV,
      PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE: "secret-looking-raw-value",
    }));

    expect(serialized).not.toContain("PUBMAX_");
    expect(serialized).not.toContain("secret-looking-raw-value");
  });

  it("documents Tonight off as chain collapse retained and V2 behavior disabled", () => {
    const behavior = TRUSTED_HANDOFF_FLAG_DEFINITIONS.tonightGrouping.offBehavior;
    expect(behavior).toMatch(/retain schedule-safe chain duplicate collapse/i);
    expect(behavior).toMatch(/disable only V2 server locality, diversity/i);
  });
});
