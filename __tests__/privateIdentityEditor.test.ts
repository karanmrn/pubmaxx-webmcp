import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivateIdentityEditorForm } from "@/components/identity/PrivateIdentityEditor";
import { genderFromLegacySex } from "@/lib/privateIdentity";
import { loadPrivateIdentity } from "@/lib/privateIdentityClient";

const formProps = {
  email: "",
  fullName: "",
  fullNameError: "",
  gender: "" as const,
  genderSelfDescribed: "",
  dateOfBirth: "",
  saving: false,
  saveEnabled: true,
  message: "",
  onRetryLoad: null,
  onFullNameChange: () => {},
  onGenderChange: () => {},
  onGenderSelfDescribedChange: () => {},
  onDateOfBirthChange: () => {},
  onSubmit: () => {},
};

describe("private identity editor", () => {
  it("waits for identity resolution before loading private account details", () => {
    const editorSource = readFileSync(
      join(process.cwd(), "components/identity/PrivateIdentityEditor.tsx"),
      "utf8",
    );
    expect(editorSource).toContain("identityResolved");
    expect(editorSource).toMatch(/if \(!auth \|\| !identityResolved\)/);
  });

  it("exposes the personal fields and states the privacy boundary", () => {
    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, formProps),
    );

    expect(html).toContain("Name");
    expect(html).toContain("Date of birth");
    expect(html).toContain('type="date"');
    expect(html).toContain("Gender");
    expect(html).toContain("Self-described");
    expect(html).toContain("Prefer not to say");
    // Defect 4: one Gender field. The legacy sex question never renders.
    expect(html).not.toContain("<label>Sex");
    expect(html).toContain("Only your handle is public");
    expect(html).toContain("stay private");
  });

  it("shows a sensible Gender for an account with only a legacy sex answer", () => {
    expect(genderFromLegacySex("female")).toBe("woman");
    expect(genderFromLegacySex("male")).toBe("man");
    expect(genderFromLegacySex("prefer_not_to_say")).toBe("prefer_not_to_say");
    // "intersex" names no gender; the field stays visibly unset.
    expect(genderFromLegacySex("intersex")).toBe("");
    expect(genderFromLegacySex("")).toBe("");

    // The editor applies the mapping only when no gender is stored, and the
    // save path never writes sex back.
    const editorSource = readFileSync(
      join(process.cwd(), "components/identity/PrivateIdentityEditor.tsx"),
      "utf8",
    );
    expect(editorSource).toContain(
      "setGender(result.gender || genderFromLegacySex(result.sex))",
    );
    expect(editorSource).not.toContain("sex,");
    expect(editorSource).not.toContain("onSexChange");
  });

  it("shows the sign-in email read-only with its explanation", () => {
    const withEmail = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        email: "person@example.com",
      }),
    );
    expect(withEmail).toContain("person@example.com");
    expect(withEmail).toContain('readOnly=""');
    expect(withEmail).toContain("Your sign-in address");

    const withoutEmail = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, formProps),
    );
    expect(withoutEmail).not.toContain("Your sign-in address");
  });

  it("offers the self-describe line only for a self-described gender", () => {
    const closed = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        gender: "woman" as const,
      }),
    );
    expect(closed).not.toContain("Your words");

    const open = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        gender: "self_described" as const,
        genderSelfDescribed: "genderfluid",
      }),
    );
    expect(open).toContain("Your words");
    expect(open).toContain("genderfluid");
  });

  it("puts the required Name field first and surfaces its inline error", () => {
    // Defect 3: names are not optional on this form and must be findable -
    // the first field of the private details editor, labelled plainly.
    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, formProps),
    );
    const firstLabel = html.indexOf("<label>Name");
    expect(firstLabel).toBeGreaterThan(-1);
    expect(firstLabel).toBe(html.indexOf("<label>"));
    expect(html).not.toContain("Name <small>Optional</small>");

    const withError = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        fullNameError: "Add your name.",
      }),
    );
    expect(withError).toContain("Add your name.");
    expect(withError).toContain('role="alert"');
    expect(withError).toContain('aria-invalid="true"');
  });

  it("requires a name only when saving this form, never at onboarding", () => {
    const editorSource = readFileSync(
      join(process.cwd(), "components/identity/PrivateIdentityEditor.tsx"),
      "utf8",
    );
    expect(editorSource).toContain('setFullNameError("Add your name.")');
    // The gate is client-side in save(); the API keeps accepting nameless
    // onboarding claims (AccountOnboarding is untouched).
    const onboardingSource = readFileSync(
      join(process.cwd(), "components/identity/AccountOnboarding.tsx"),
      "utf8",
    );
    expect(onboardingSource).not.toContain("Add your name.");
  });

  it("keeps save disabled and offers retry after a failed load", async () => {
    const auth = { userId: "user-a", accessToken: "token-a" };
    const result = await loadPrivateIdentity(
      auth,
      async () =>
        new Response(
          JSON.stringify({ error: "Private details are unavailable." }),
          { status: 503 },
        ),
    );
    expect(result).toEqual({
      status: "unavailable",
      error: "Private details are unavailable.",
    });
    if (result.status !== "unavailable") {
      throw new Error("Expected unavailable private identity state.");
    }

    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        saveEnabled: false,
        message: result.error,
        onRetryLoad: () => {},
      }),
    );
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain("Try again");
  });

  it("loads every private field for the owner", async () => {
    const auth = { userId: "user-a", accessToken: "token-a" };
    const result = await loadPrivateIdentity(
      auth,
      async () =>
        new Response(
          JSON.stringify({
            complete: true,
            handle: "night_person",
            fullName: "Full Name",
            sex: "female",
            gender: "self_described",
            genderSelfDescribed: "genderfluid",
            dateOfBirth: "1990-01-01",
          }),
          { status: 200 },
        ),
    );
    expect(result).toEqual({
      status: "ready",
      fullName: "Full Name",
      sex: "female",
      gender: "self_described",
      genderSelfDescribed: "genderfluid",
      dateOfBirth: "1990-01-01",
    });
  });
});
