import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ContributionGateDialog,
  type ContributionGateDialogMode,
} from "@/components/identity/ContributionGateDialog";

function render(mode: ContributionGateDialogMode): string {
  return renderToStaticMarkup(
    createElement(ContributionGateDialog, {
      mode,
      error: null,
      onClose: () => {},
    }),
  );
}

describe("contribution identity gate", () => {
  it("offers sign-in when no account is available", () => {
    expect(render("sign_in_required")).toContain("Sign in to contribute");
  });

  it("routes incomplete accounts back to handle setup", () => {
    const html = render("onboarding_required");
    expect(html).toContain("Finish account setup");
    expect(html).toContain("Finish setup");
    expect(html).toContain('href="/u/you"');
    expect(html).toContain(
      "Choose a public handle and add your date of birth before contributing. The setup dialog collects both together.",
    );
  });

  it("contains no age collection or age restriction state", () => {
    const html = `${render("sign_in_required")}${render("onboarding_required")}`;
    expect(html).not.toContain('type="date"');
    expect(html).not.toMatch(/18 or over|under 18|age confirmation/i);
  });
});
