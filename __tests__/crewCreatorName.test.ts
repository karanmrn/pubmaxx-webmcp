import { describe, expect, it } from "vitest";

import { creatorNameFromAuthUser } from "@/lib/crew";

describe("creatorNameFromAuthUser", () => {
  it("prefers full_name then name then email local-part", () => {
    expect(creatorNameFromAuthUser({
      email: "karan@example.com",
      user_metadata: { full_name: "Karan M", name: "ignored" },
    })).toBe("Karan M");
    expect(creatorNameFromAuthUser({
      email: "karan@example.com",
      user_metadata: { name: "Karan" },
    })).toBe("Karan");
    expect(creatorNameFromAuthUser({
      email: "karan@example.com",
      user_metadata: {},
    })).toBe("karan");
    expect(creatorNameFromAuthUser({ email: null, user_metadata: null })).toBe("");
  });
});
