import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AccountOnboardingForm,
  AccountOnboardingLoadError,
  canSubmitCheckedHandle,
} from "@/components/identity/AccountOnboarding";
import {
  checkAccountHandleAvailability,
  loadAccountOnboardingStatus,
} from "@/lib/accountOnboardingClient";

const noop = () => {};

function render(
  availability: "idle" | "checking" | "available" | "taken" | "reserved",
  dateOfBirth = "",
): string {
  return renderToStaticMarkup(
    createElement(AccountOnboardingForm, {
      handle: "night_owl",
      dateOfBirth,
      fullName: "",
      availability,
      busy: false,
      error: null,
      onHandleChange: noop,
      onDateOfBirthChange: noop,
      onFullNameChange: noop,
      onSubmit: noop,
    }),
  );
}

describe("account onboarding surface", () => {
  it("opens on a welcome, then asks handle, name and date of birth as one step", () => {
    const html = render("idle");
    expect(html).toContain("Welcome to PUBMAXX");
    expect(html).toContain("Let&#x27;s get you in");
    expect(html.indexOf("Your handle")).toBeLessThan(html.indexOf("Name"));
    expect(html.indexOf("Name")).toBeLessThan(html.indexOf("Date of birth"));
    expect(html).toContain('type="date"');
    expect(html).toContain("Only your handle is public");
    expect(html).toContain("product analytics and social features");
  });

  it("offers one action, never a second button that skips what was not demanded", () => {
    const html = render("available", "2000-02-03");
    expect(html).not.toContain("Skip optional details");
    expect(html.match(/<button/gu)).toHaveLength(1);
  });

  it("keeps private details that profile editing owns off the first arrival", () => {
    const html = render("idle");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Optional private details");
  });

  it("keeps submit disabled until the exact handle was checked as available", () => {
    expect(canSubmitCheckedHandle("night_owl", "night_owl", "available")).toBe(
      true,
    );
    expect(canSubmitCheckedHandle("night_owl_2", "night_owl", "available")).toBe(
      false,
    );
    expect(canSubmitCheckedHandle("night_owl", "night_owl", "checking")).toBe(
      false,
    );
    expect(render("checking")).toContain("Checking");
    expect(render("checking")).toContain("disabled");
  });

  it("enables handle claim only after date of birth is provided", () => {
    expect(render("available")).toContain('disabled="">Claim handle');
    const html = render("available", "2015-02-03");
    expect(html).toContain(">Claim handle</button>");
    expect(html).not.toContain('disabled="">Claim handle');
    expect(html).toContain('value="2015-02-03"');
  });

  it("uses different copy for a taken handle and a reserved handle", () => {
    expect(render("taken")).toContain("That handle is already taken.");
    expect(render("reserved")).toContain("That handle is not available.");
    expect(render("available")).toContain("Handle available.");
  });

  it("keeps failed availability checks distinct from taken handles", async () => {
    for (const status of [429, 503]) {
      const request = async () =>
        new Response(
          JSON.stringify({ error: "Handle availability is unavailable." }),
          { status },
        );
      await expect(
        checkAccountHandleAvailability("night_owl", request),
      ).resolves.toEqual({
        status: "unavailable",
        error: "Handle availability is unavailable.",
      });
    }
  });

  it("offers a retry when account status cannot be loaded", async () => {
    const request = async () =>
      new Response(
        JSON.stringify({ error: "Account details are unavailable right now." }),
        { status: 503 },
      );
    await expect(loadAccountOnboardingStatus(request)).resolves.toEqual({
      status: "unavailable",
      error: "Account details are unavailable right now.",
    });

    const html = renderToStaticMarkup(
      createElement(AccountOnboardingLoadError, {
        error: "Account details are unavailable right now.",
        onRetry: noop,
      }),
    );
    expect(html).toContain("Account details are unavailable right now.");
    expect(html).toContain("Try again");
  });

  it("uses honest offline copy without changing online fault copy", () => {
    const online = renderToStaticMarkup(
      createElement(AccountOnboardingLoadError, {
        error: "Account setup is unavailable right now.",
        onRetry: noop,
        offline: false,
      }),
    );
    expect(online).toContain("Account setup is unavailable right now.");
    expect(online).not.toContain("You look offline.");

    const offline = renderToStaticMarkup(
      createElement(AccountOnboardingLoadError, {
        error: "Account setup is unavailable right now.",
        onRetry: noop,
        offline: true,
      }),
    );
    expect(offline).toContain("You look offline. We will retry when you are back.");
    expect(offline).not.toContain("Account setup is unavailable right now.");
  });

  it("treats offline status load as unavailable, never as claimable", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(loadAccountOnboardingStatus(offline)).resolves.toEqual({
      status: "unavailable",
      error: "Account setup is unavailable right now.",
    });
  });

  it("keeps an aborted obsolete status read out of unavailable UI state", async () => {
    const interrupted = async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    await expect(loadAccountOnboardingStatus(interrupted)).resolves.toEqual({
      status: "interrupted",
    });
  });

  it("returns a server handle on complete and incomplete status reads", async () => {
    const complete = async () =>
      Response.json({ complete: true, handle: "night_owl" });
    await expect(loadAccountOnboardingStatus(complete)).resolves.toEqual({
      status: "complete",
      handle: "night_owl",
    });

    const incompleteOwned = async () =>
      Response.json({ complete: false, handle: "night_owl" });
    await expect(loadAccountOnboardingStatus(incompleteOwned)).resolves.toEqual({
      status: "incomplete",
      handle: "night_owl",
    });

    const fresh = async () => Response.json({ complete: false });
    await expect(loadAccountOnboardingStatus(fresh)).resolves.toEqual({
      status: "incomplete",
    });
  });

  it("has no arrival-path surface that greets an owned handle with a rename", () => {
    // DEFECT ZERO. An account that already owns a handle used to be met by a
    // blocking "You are @handle / Rename handle / Continue" dialog whenever the
    // onboarding read came back incomplete, which every handle claimed through
    // POST /api/identity/handle/claim always does: that route stores no date of
    // birth. Mounted at the app root, the dialog covered every tab, and only
    // React state ever dismissed it, so it returned on the next mount.
    const source = readFileSync(
      join(process.cwd(), "components/identity/AccountOnboarding.tsx"),
      "utf8",
    );
    expect(source).not.toContain("AccountOwnedIdentity");
    expect(source).not.toContain("You are @");
    expect(source).not.toContain("Rename handle");
    expect(source).not.toContain("identity/handle/rename");
    // A server-owned handle resolves the surface to nothing at all.
    expect(source).toContain('setStatus("complete")');

    const claim = render("idle");
    expect(claim).toContain("Claim handle");
  });

  it("ships a one-column phone sheet with full tap targets", () => {
    const css = readFileSync(
      join(process.cwd(), "components/identity/accountOnboarding.css"),
      "utf8",
    );
    expect(css).toMatch(/@media \(max-width: 520px\)/);
    expect(css).toMatch(
      /\.accountOnboardingPair,\s*\.accountOnboardingActions\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /\.accountOnboardingActions button\s*\{[^}]*min-height: 46px/,
    );
    expect(css).toMatch(/max-height: calc\(100dvh/);
    expect(css).toMatch(/overflow-y: auto/);
  });

  it("keeps identity gates above an open mobile venue sheet", () => {
    const onboardingCss = readFileSync(
      join(process.cwd(), "components/identity/accountOnboarding.css"),
      "utf8",
    );
    const contributionGateCss = readFileSync(
      join(process.cwd(), "components/identity/contributionGate.css"),
      "utf8",
    );
    expect(onboardingCss).toMatch(
      /\.accountOnboardingBackdrop\s*\{[^}]*z-index: calc\(var\(--z-overlay-top, 1300\) \+ 1\)/,
    );
    expect(contributionGateCss).toMatch(
      /\.contributionGateBackdrop\s*\{[^}]*z-index: calc\(var\(--z-overlay-top, 1300\) \+ 2\)/,
    );
  });
});
