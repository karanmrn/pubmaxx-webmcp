// Tree fence for the profile photo picker, and the crop step it now opens.
//
// The founder could not choose a photo from his iPhone library. The cause was
// one attribute: `capture="environment"` on the avatar input. On iOS that is
// not a hint, it is an instruction to open the camera, and the sheet then
// carries no Photo Library entry at all. Nothing in the DOM says so and no
// automated browser reproduces it, because the sheet belongs to the operating
// system rather than to the page. So the fence is the source itself: a
// library/file picker may never carry that attribute, while the message camera
// target is the one deliberate capture exception.
//
// The rest of the file pins the things that made the fix work end to end: one
// accept list shared by both slots, a hidden input iOS will still open, and the
// upload path left exactly as it was so the safety scan still runs on what
// arrives.

import { createElement } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { profileImageCropTarget } from "@/lib/profileImagePicker";
import { profileImageSlotSpec, PROFILE_IMAGE_SLOTS } from "@/lib/profileImageSlots";

/**
 * Every surface a person chooses a photo from. The rule is about pickers, not
 * about profiles, so a pub photo wall's composer and a message composer are
 * swept by the same fence. Library and file targets must keep iOS library
 * access; only the message camera target may ask for capture.
 */
const PHOTO_SURFACE_DIRS = [
  "components/profile",
  "components/venue",
  "components/messages",
  "app/u",
] as const;

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

function tsxFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".tsx")) out.push(path);
    }
  };
  walk(root);
  return out;
}

type FileInput = {
  file: string;
  attributes: Map<string, string>;
};

/** Every `<input type="file">` on the swept surfaces, with its attributes. */
function fileInputs(): FileInput[] {
  const found: FileInput[] = [];
  for (const dir of PHOTO_SURFACE_DIRS) {
    for (const path of tsxFiles(dir)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          if (node.tagName.getText(source) === "input") {
            const attributes = new Map<string, string>();
            for (const attribute of node.attributes.properties) {
              if (!ts.isJsxAttribute(attribute)) continue;
              const name = attribute.name.getText(source);
              const initializer = attribute.initializer;
              attributes.set(
                name,
                initializer ? initializer.getText(source).replace(/^[{"]|[}"]$/g, "") : "true",
              );
            }
            if (attributes.get("type") === "file") {
              found.push({ file: path.slice(process.cwd().length + 1), attributes });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return found;
}

describe("a profile photo input asks for a photo, never for a camera", () => {
  const inputs = fileInputs();

  it("finds every picker, so the sweep is not passing on an empty list", () => {
    const ids = inputs.map((input) => input.attributes.get("id"));
    expect(ids).toContain("pe-avatar-file");
    expect(ids).toContain("pe-cover-file");
    expect(ids).toContain("venue-photo-file");
    expect(ids).toContain("message-photo-file");
  });

  it("keeps capture on camera-only target and off every library/file picker", () => {
    for (const input of inputs) {
      if (input.attributes.get("id") === "message-camera-file") {
        expect(input.attributes.get("capture")).toBe("environment");
        continue;
      }
      expect(
        input.attributes.has("capture"),
        `${input.file} puts a capture attribute on a library/file input, which hides the iOS photo library`,
      ).toBe(false);
    }
  });

  it("takes its accept list from the one shared constant", () => {
    for (const input of inputs) {
      expect(input.attributes.get("accept")).toBe("PROFILE_IMAGE_PICKER_ACCEPT");
    }
  });
});

describe("a hidden input is still one iOS will open", () => {
  const css = read("app/u/[handle]/profile.css");
  const rule = css.slice(
    css.indexOf(".profilePage .profileEditor input.profileEditorAvatarFile {"),
  ).split("}")[0];

  it("hides the input without taking it out of the layout", () => {
    // `display: none` and `visibility: hidden` inputs are unreliable targets for
    // a scripted click on iOS Safari. This one is a 1px transparent box, which
    // is not.
    expect(rule).toContain("opacity: 0");
    expect(rule).not.toContain("display: none");
    expect(rule).not.toContain("visibility: hidden");
  });

  it("opens the picker from a real tap on a visible button", () => {
    expect(read("components/profile/ProfileEditor.tsx")).toContain(
      "avatarInputRef.current?.click()",
    );
    // The backdrop is a rotation now, and its picker lives with the list.
    expect(read("components/profile/ProfileCoverPhotosEditor.tsx")).toContain(
      "inputRef.current?.click()",
    );
  });
});

describe("the crop step feeds the upload, and the upload is unchanged", () => {
  const source = read("components/profile/ProfileEditor.tsx");
  const covers = read("components/profile/ProfileCoverPhotosEditor.tsx");

  it("positions the photo before anything is sent", () => {
    // Choosing a file only holds it; the cropper's own confirm starts the POST.
    expect(source).toContain('choose("avatar", file)');
    expect(source).toMatch(/onCropped=\{\(file\) => uploadCropped\("avatar", file\)\}/);
    // The old shape sent whatever the picker returned, straight from onChange.
    expect(source).not.toMatch(/event\.target[\s\S]{0,120}uploadImage/);
    // Same two beats for every cover in the rotation: hold it, then upload the
    // cropper's own output.
    expect(covers).toContain("setPending(file)");
    expect(covers).toMatch(/onCropped=\{\(file\) => \{[\s\S]{0,160}void upload\(file\)/);
  });

  it("still posts one photo field to the slot's own route", () => {
    expect(source).toContain('form.append("photo", file)');
    expect(source).toContain(
      "authedActionFetch(`/api/profiles/${encodeURIComponent(handle)}/${slot}`, {",
    );
    expect(source).toContain('method: "POST"');
    expect(covers).toContain('form.append("photo", file)');
    expect(covers).toContain("`/api/profiles/${encodeURIComponent(handle)}/covers`");
  });

  it("leaves the server allow-list at the three types it stores", () => {
    // The crop re-encodes to JPEG, so widening the picker never widens this.
    // One list now, shared by every upload journey in the tree.
    const server = read("lib/uploadedImage.server.ts");
    expect(server).toContain('"image/jpeg",');
    expect(server).toContain('"image/png",');
    expect(server).toContain('"image/webp",');
    expect(server).not.toContain("heic");
    expect(read("lib/profileImageMedia.server.ts")).not.toContain("heic");
    expect(read("lib/venuePhotoMedia.server.ts")).not.toContain("heic");
    expect(read("lib/messagePhotoMedia.server.ts")).not.toContain("heic");
  });

  it("uses strict auth transport for both profile photo paths", () => {
    expect(source).toContain("authedActionFetch");
    expect(source).toContain("AuthActionSessionError");
    expect(source).not.toContain("getAccessToken");
    expect(covers).toContain("authedActionFetch");
    expect(covers).not.toContain("getAccessToken");
  });

  it("leaves the safety scan on the upload path exactly where it was", () => {
    // The scan is ADVISORY now (`lib/uploadedImageScan.server.ts` decides what
    // counts as a verdict), but it still runs on every upload: widening the
    // picker may never take the scan off the path.
    expect(read("lib/profileImageRoute.server.ts")).toContain("scanUploadedImage");
    expect(read("lib/profileCoverPhotoRoute.server.ts")).toContain("scanUploadedImage");
    expect(read("lib/uploadedImageScan.server.ts")).toContain("moderate");
  });
});

describe("the crop step a person sees", () => {
  function cropper(slot: (typeof PROFILE_IMAGE_SLOTS)[number]): string {
    return renderToStaticMarkup(
      createElement(ProfileImageCropper, {
        target: profileImageCropTarget(slot),
        file: new File([new Uint8Array([0xff, 0xd8, 0xff])], "IMG_0001.HEIC", {
          type: "image/heic",
        }),
        onCancel: () => {},
        onCropped: () => {},
      }),
    );
  }

  it("frames each slot in that slot's own shape", () => {
    expect(cropper("avatar")).toContain(
      `aspect-ratio:${profileImageSlotSpec("avatar").aspectRatio}`,
    );
    expect(cropper("cover")).toContain(
      `aspect-ratio:${profileImageSlotSpec("cover").aspectRatio}`,
    );
  });

  it("gives the frame a name and a keyboard, and the zoom a label", () => {
    const markup = cropper("avatar");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("arrow keys");
    expect(markup).toContain('for="pe-avatar-zoom"');
    expect(markup).toContain(">Zoom</label>");
    expect(markup).toContain('type="range"');
  });

  it("adds no visible title over the slot's own label", () => {
    // "Cover photo" followed by "Position your cover photo" is a subtitle
    // repeating its label, and it read as two headings stacked at 390px.
    expect(cropper("cover")).not.toContain("Position your");
    expect(cropper("cover")).not.toContain("profileCropTitle");
  });

  it("offers a way out as well as a way on", () => {
    const markup = cropper("cover");
    expect(markup).toContain("Use photo");
    expect(markup).toContain("profileCropCancel");
    expect(markup).toContain(">Cancel</button>");
  });

  it("will not confirm a photo it has not measured yet", () => {
    // Server render has no image and no frame, so the confirm cannot fire on a
    // transform that means nothing.
    expect(cropper("avatar")).toMatch(/class="profileCropConfirm"[^>]*disabled/);
  });
});
