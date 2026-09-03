import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import PasswordPolicyHint from "@/components/auth/PasswordPolicyHint";
import { PASSWORD_HINT } from "@/lib/passwordPolicy";

function render(value: string, id?: string): string {
  return renderToStaticMarkup(createElement(PasswordPolicyHint, { value, id }));
}

describe("PasswordPolicyHint", () => {
  it("shows the rules as a hint before anybody types", () => {
    const markup = render("");
    expect(markup).toContain(PASSWORD_HINT);
    expect(markup).not.toContain("<ul");
  });

  it("becomes a tick per rule from the first character", () => {
    const markup = render("p");
    expect(markup).not.toContain(PASSWORD_HINT);
    for (const rule of ["length", "capital", "number", "special"]) {
      expect(markup).toContain(`data-rule="${rule}"`);
    }
    expect(markup).toContain('data-met="no"');
    expect(markup).not.toContain('data-met="yes"');
  });

  it("ticks each rule as it is met, and all four when the password is good", () => {
    expect(render("pubmaxxx")).toContain('data-rule="length" data-met="yes"');
    expect(render("pubmaxxx")).toContain('data-rule="capital" data-met="no"');

    const good = render("Pubmaxx1!");
    expect(good).not.toContain('data-met="no"');
    expect(good.match(/data-met="yes"/g)).toHaveLength(4);
  });

  it("says the state in words, because a tick glyph is decoration", () => {
    const markup = render("Pubmaxxx");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("done");
    expect(markup).toContain("not yet");
  });

  it("takes the id the field points aria-describedby at", () => {
    expect(render("", "hint-1")).toContain('id="hint-1"');
  });
});

describe("the surfaces that use it", () => {
  const setPasswordSource = readFileSync(
    join(process.cwd(), "components/auth/SetAccountPassword.tsx"),
    "utf8",
  );

  it("describes the password field with the hint", () => {
    expect(setPasswordSource).toContain("PasswordPolicyHint");
    expect(setPasswordSource).toContain("aria-describedby={hintId}");
  });

  it("styles a met rule with more than colour", () => {
    const css = readFileSync(
      join(process.cwd(), "components/auth/passwordPolicyHint.css"),
      "utf8",
    );
    expect(css).toMatch(/\.passwordPolicyRules li\.isMet\s*\{[^}]*font-weight/);
  });
});
