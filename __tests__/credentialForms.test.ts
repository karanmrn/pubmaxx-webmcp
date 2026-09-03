import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const handleSignInSource = readFileSync(
  join(process.cwd(), "components/auth/HandlePasswordSignIn.tsx"),
  "utf8",
);
const accountPasswordSource = readFileSync(
  join(process.cwd(), "components/auth/SetAccountPassword.tsx"),
  "utf8",
);

describe("browser credential form contracts", () => {
  it("uses recognisable login form semantics and keeps successful values mounted", () => {
    expect(handleSignInSource).toMatch(
      /<form[\s\S]*method="post"[\s\S]*autoComplete="on"[\s\S]*onSubmit={onSubmit}/,
    );
    expect(handleSignInSource).toContain('name="username"');
    expect(handleSignInSource).toContain('autoComplete="username"');
    expect(handleSignInSource).toContain('name="password"');
    expect(handleSignInSource).toContain('autoComplete="current-password"');
    expect(handleSignInSource).toContain("event.preventDefault();");
    expect(handleSignInSource).toMatch(/fetch\("\/api\/auth\/handle-password",\s*\{\s*method: "POST"/);
    expect(handleSignInSource).toMatch(/<button[\s\S]*type="submit"/);
    expect(handleSignInSource).not.toContain('setPassword("");\n      setOpen(false);');
  });

  it("uses recognisable creation and change password semantics", () => {
    expect(accountPasswordSource).toMatch(
      /<form[\s\S]*method="post"[\s\S]*autoComplete="on"[\s\S]*onSubmit={onSubmit}/,
    );
    expect(accountPasswordSource).toContain('name="current-password"');
    expect(accountPasswordSource).toContain('autoComplete="current-password"');
    expect(accountPasswordSource).toContain('name="new-password"');
    expect(accountPasswordSource).toContain('autoComplete="new-password"');
    expect(accountPasswordSource).toMatch(/<button[\s\S]*type="submit"/);
  });
});
