import { describe, expect, it } from "vitest";

describe("Vitest deployment-environment isolation", () => {
  it("does not inherit deployment or durable-store credentials", () => {
    expect(process.env.VERCEL_ENV).toBeUndefined();
    expect(process.env.VERCEL).toBeUndefined();
    expect(process.env.SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
