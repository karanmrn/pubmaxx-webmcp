import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Defect 5: view mode and edit mode were indistinguishable - the /u/you editor
// toggled with no visible mode change. The editing state must be unmistakable:
// a named heading, a visually distinct surface, explicit Save and Cancel, a
// visible "Saved" confirmation, and a return to view mode on save.

const clientSource = readFileSync(
  join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
  "utf8",
);
const editorSource = readFileSync(
  join(process.cwd(), "components/profile/ProfileEditor.tsx"),
  "utf8",
);
const css = readFileSync(
  join(process.cwd(), "app/u/[handle]/profile.css"),
  "utf8",
);

describe("profile edit mode is unmistakable", () => {
  it("names the editing state and wraps it in its own surface", () => {
    expect(clientSource).toContain("Editing your profile");
    expect(clientSource).toContain('className="profileEditingSurface"');
    expect(clientSource).toContain('id="profile-editing"');
  });

  it("lands the reader on the editing surface when editing opens", () => {
    expect(clientSource).toContain("function openEditor()");
    expect(clientSource).toContain('getElementById("profile-editing")');
    expect(clientSource).toContain("scrollIntoView");
  });

  it("returns to view mode on save and says Saved", () => {
    // handleSaved closes the editor and raises the confirmation the reader
    // sees back in view mode; it clears itself instead of lingering.
    expect(clientSource).toContain("setEditing(false);\n    setSavedNotice(true);");
    expect(clientSource).toContain('className="profileSavedNotice" role="status"');
    expect(clientSource).toContain("setSavedNotice(false), 4_000");
  });

  it("keeps explicit Save and Cancel in the editor", () => {
    expect(editorSource).toContain("Save profile");
    expect(editorSource).toMatch(/className="profileEditorCancel"[\s\S]{0,200}Cancel/);
  });

  it("gives the editing surface a distinct treatment in the shipped CSS", () => {
    expect(css).toContain(".profilePage .profileEditingSurface {");
    expect(css).toMatch(/profileEditingSurface \{[^}]*border: 2px solid var\(--brass\)/);
    expect(css).toContain('.profilePage .profileEditToggle[aria-expanded="true"]');
    expect(css).toContain(".profilePage .profileSavedNotice {");
  });
});
