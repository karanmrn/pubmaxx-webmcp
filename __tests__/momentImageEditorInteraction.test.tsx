// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MomentImageEditor from "@/components/moment/MomentImageEditor";
import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { profileImageCropTarget } from "@/lib/profileImagePicker";

let container: HTMLDivElement;
let root: Root | null = null;
let resolveExport: ((blob: Blob | null) => void) | null = null;

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

function wheelEvent(deltaY: number, clientX: number, clientY: number): Event {
  const event = new Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    deltaY: { value: deltaY },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function finishMount(): Promise<{
  frame: HTMLDivElement;
  image: HTMLImageElement;
  confirm: HTMLButtonElement;
  range: HTMLInputElement;
}> {
  await settle();

  const frame = container.querySelector<HTMLDivElement>(".profileCropFrame");
  const image = container.querySelector<HTMLImageElement>(".profileCropImage");
  const confirm = container.querySelector<HTMLButtonElement>(".profileCropConfirm");
  const range = container.querySelector<HTMLInputElement>('input[type="range"]');
  expect(frame).not.toBeNull();
  expect(image).not.toBeNull();
  expect(confirm).not.toBeNull();
  expect(range).not.toBeNull();

  Object.defineProperty(frame!, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 250,
      right: 200,
      bottom: 250,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperties(frame!, {
    setPointerCapture: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
  });
  Object.defineProperty(image!, "naturalWidth", { configurable: true, value: 400 });
  Object.defineProperty(image!, "naturalHeight", { configurable: true, value: 300 });

  await act(async () => {
    image!.dispatchEvent(new Event("load"));
  });

  expect(confirm!.disabled).toBe(false);
  return { frame: frame!, image: image!, confirm: confirm!, range: range! };
}

async function mountEditor(): ReturnType<typeof finishMount> {
  await act(async () => {
    root?.render(
      createElement(MomentImageEditor, {
        file: new File(["photo"], "night.jpg", { type: "image/jpeg" }),
        openerRef: { current: null },
        onSave: vi.fn(),
        onCancel: vi.fn(),
        onError: vi.fn(),
      }),
    );
  });
  return finishMount();
}

async function mountSharedCropper(
  onCropped: (file: File) => void,
  onBusyChange: (busy: boolean) => void,
): ReturnType<typeof finishMount> {
  await act(async () => {
    root?.render(
      createElement(ProfileImageCropper, {
        target: profileImageCropTarget("avatar"),
        file: new File(["photo"], "avatar.jpg", { type: "image/jpeg" }),
        onCancel: vi.fn(),
        onCropped,
        onBusyChange,
      }),
    );
  });
  return finishMount();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:moment-crop",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => ({
      drawImage: () => {},
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    writable: true,
    value: (callback: BlobCallback) => {
      resolveExport = callback;
    },
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (resolveExport) {
    const resolve = resolveExport;
    resolveExport = null;
    await act(async () => {
      resolve(new Blob(["cropped"], { type: "image/jpeg" }));
      await Promise.resolve();
    });
  }
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("MomentImageEditor crop export", () => {
  it("does not mutate crop position while local export is pending", async () => {
    const { frame, image, confirm } = await mountEditor();
    const before = image.style.transform;

    await act(async () => {
      confirm.click();
    });

    expect(confirm.disabled).toBe(true);
    await act(async () => {
      frame.dispatchEvent(pointerEvent("pointerdown", 1, 80, 100));
      frame.dispatchEvent(pointerEvent("pointermove", 1, 140, 160));
      frame.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(image.style.transform).toBe(before);
  });

  it("labels local export as preparation while it is pending", async () => {
    const { confirm } = await mountEditor();

    await act(async () => {
      confirm.click();
    });

    expect(confirm.textContent).toBe("Preparing…");
  });

  it("locks shared crop interactions until an unresolved export finishes", async () => {
    const busyChanges: boolean[] = [];
    const onCropped = vi.fn();

    const { frame, image, confirm, range } = await mountSharedCropper(
      onCropped,
      (busy: boolean) => busyChanges.push(busy),
    );
    const beforeTransform = image.style.transform;
    const beforeZoom = range.value;

    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });

    expect(busyChanges).toEqual([true]);
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toBe("Uploading…");
    expect(range.disabled).toBe(true);

    await act(async () => {
      frame.dispatchEvent(pointerEvent("pointerdown", 1, 80, 100));
      frame.dispatchEvent(pointerEvent("pointermove", 1, 140, 160));
      frame.dispatchEvent(wheelEvent(-120, 100, 120));
      frame.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }));
      range.focus();
      range.value = "50";
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(image.style.transform).toBe(beforeTransform);

    const resolve = resolveExport;
    expect(resolve).not.toBeNull();
    resolveExport = null;
    await act(async () => {
      resolve!(new Blob(["cropped"], { type: "image/jpeg" }));
      await Promise.resolve();
    });

    expect(busyChanges).toEqual([true, false]);
    expect(confirm.disabled).toBe(false);
    expect(confirm.textContent).toBe("Use photo");
    expect(range.disabled).toBe(false);
    expect(range.value).toBe(beforeZoom);
    expect(onCropped).toHaveBeenCalledOnce();
  });

  it("clears a failed export on retry and emits the successful crop", async () => {
    const onCropped = vi.fn();
    const { confirm } = await mountSharedCropper(onCropped, vi.fn());

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: () => null,
    });
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(onCropped).not.toHaveBeenCalled();

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: () => ({
        drawImage: () => {},
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
      }),
    });
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    const resolve = resolveExport;
    expect(resolve).not.toBeNull();
    resolveExport = null;
    await act(async () => {
      resolve!(new Blob(["cropped"], { type: "image/jpeg" }));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(onCropped).toHaveBeenCalledOnce();
    const [cropped] = onCropped.mock.calls[0] as [File];
    expect(cropped).toBeInstanceOf(File);
    expect(cropped.name).toBe("avatar.jpg");
    expect(cropped.type).toBe("image/jpeg");
  });
});
