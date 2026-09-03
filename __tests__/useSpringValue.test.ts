// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpringValue, type SpringValueController } from "@/lib/useSpringValue";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("useSpringValue", () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: SpringValueController | null;
  let frameCallbacks: FrameRequestCallback[];

  function Harness() {
    controller = useSpringValue(600, { response: 0.34, dampingRatio: 1 });
    return null;
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    controller = null;
    frameCallbacks = [];
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls onRest when a busy browser returns one delayed frame", () => {
    const onRest = vi.fn();
    act(() => root.render(createElement(Harness)));

    act(() => controller!.animateTo(0, { onRest }));
    expect(frameCallbacks).toHaveLength(1);

    act(() => frameCallbacks.shift()!(0));
    expect(onRest).not.toHaveBeenCalled();
    expect(frameCallbacks).toHaveLength(1);

    act(() => frameCallbacks.shift()!(5_000));
    expect(onRest).toHaveBeenCalledOnce();
    expect(controller!.value).toBe(0);
    expect(controller!.running).toBe(false);
  });
});
