import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import MomentImageEditor from "@/components/moment/MomentImageEditor";

describe("MomentImageEditor privacy boundary", () => {
  it("renders a first-party crop surface without an external runtime", () => {
    const source = new File(["photo"], "night.jpg", { type: "image/jpeg" });
    const markup = renderToStaticMarkup(createElement(MomentImageEditor, {
      file: source,
      openerRef: createRef<HTMLElement>(),
      onSave: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Edit photo"');
    expect(markup).toContain("Use photo");
    expect(markup).not.toContain("cdn.unlayer.com");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<iframe");
  });

  it("offers crop, filter, text, and draw without another provider", () => {
    const source = new File(["photo"], "night.jpg", { type: "image/jpeg" });
    const markup = renderToStaticMarkup(createElement(MomentImageEditor, {
      file: source,
      openerRef: createRef<HTMLElement>(),
      onSave: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    }));

    expect(markup).toContain(">Crop<");
    expect(markup).toContain(">Filter<");
    expect(markup).toContain(">Text<");
    expect(markup).toContain(">Draw<");
  });

  it("uses a lowercase noun in moment crop instructions", () => {
    const source = new File(["photo"], "night.jpg", { type: "image/jpeg" });
    const markup = renderToStaticMarkup(createElement(MomentImageEditor, {
      file: source,
      openerRef: createRef<HTMLElement>(),
      onSave: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    }));

    expect(markup).toContain(
      'aria-label="Reposition your moment photo. Drag it, or nudge it with the arrow keys."',
    );
  });

  it("keeps the phone editor clear of the bottom safe area", () => {
    const css = readFileSync(
      resolve(process.cwd(), "components/moment/moment.css"),
      "utf8",
    );

    expect(css).toContain("padding-bottom: max(8px, env(safe-area-inset-bottom));");
    expect(css).toContain("padding-bottom: max(12px, env(safe-area-inset-bottom));");
    expect(css).toContain(
      "max-height: calc(100svh - 8px - max(8px, env(safe-area-inset-bottom)));",
    );
    expect(css).toContain(
      "max-height: calc(100svh - 24px - max(24px, env(safe-area-inset-bottom)));",
    );
  });

  it("keeps the modal locked while the shared cropper exports", () => {
    const cropper = readFileSync(
      resolve(process.cwd(), "components/profile/ProfileImageCropper.tsx"),
      "utf8",
    );
    const editor = readFileSync(
      resolve(process.cwd(), "components/moment/MomentImageEditor.tsx"),
      "utf8",
    );

    expect(cropper).toContain("onBusyChange?.(true)");
    expect(cropper).toContain("onBusyChange?.(false)");
    expect(cropper).toContain("busyLabel");
    expect(editor).toContain("onBusyChange={setSaving}");
    expect(editor).toContain("busy={saving}");
    expect(editor).toContain('busyLabel="Preparing…"');
  });
});
