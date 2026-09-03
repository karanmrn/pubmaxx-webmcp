import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasUnsavedUserInput,
  recoverDeploymentSkew,
} from "@/lib/deploymentSkewRecovery";
import { subscribeToReconnectRecovery } from "@/lib/useReconnectRecovery";

type StorageTarget = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type VisibilityTarget = EventTarget & {
  visibilityState: DocumentVisibilityState;
};

type WindowTarget = EventTarget & {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

function makeWindow(): WindowTarget {
  return Object.assign(new EventTarget() as WindowTarget, {
    setTimeout,
    clearTimeout,
  });
}

function makeDocument(): VisibilityTarget {
  const target = new EventTarget() as VisibilityTarget;
  target.visibilityState = "hidden";
  return target;
}

function makeStorage(initial: Record<string, string> = {}): StorageTarget {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("deployment skew recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads exactly once when a visible wake finds a newer deployment", async () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const storage = makeStorage();
    const check = () => recoverDeploymentSkew({
      clientDeploymentId: "build-a",
      currentDeploymentId: "build-b",
      storage,
      isDirty: () => false,
      reload,
    });
    const stop = subscribeToReconnectRecovery(check, {
      windowTarget,
      documentTarget,
      events: ["visible"],
      debounceMs: 0,
    });

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not reload when the deployment marker is unchanged", () => {
    const reload = vi.fn();

    const result = recoverDeploymentSkew({
      clientDeploymentId: "build-a",
      currentDeploymentId: "build-a",
      storage: makeStorage(),
      isDirty: () => false,
      reload,
    });

    expect(result).toBe("same");
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload again after the deployment guard is set", () => {
    const reload = vi.fn();
    const storage = makeStorage();
    const first = recoverDeploymentSkew({
      clientDeploymentId: "build-a",
      currentDeploymentId: "build-b",
      storage,
      isDirty: () => false,
      reload,
    });
    const second = recoverDeploymentSkew({
      clientDeploymentId: "build-a",
      currentDeploymentId: "build-b",
      storage,
      isDirty: () => false,
      reload,
    });

    expect(first).toBe("reloaded");
    expect(second).toBe("guarded");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("defers a reload while user input is dirty", () => {
    const reload = vi.fn();
    const storage = makeStorage();

    const result = recoverDeploymentSkew({
      clientDeploymentId: "build-a",
      currentDeploymentId: "build-b",
      storage,
      isDirty: () => true,
      reload,
    });

    expect(result).toBe("deferred");
    expect(reload).not.toHaveBeenCalled();
    expect(
      storage.getItem("pubmax:deployment-skew-reloaded:v1:build-b"),
    ).toBeNull();
  });

  it("treats changed form controls as dirty", () => {
    const input = {
      tagName: "INPUT",
      type: "text",
      value: "typed pint note",
      defaultValue: "",
    };
    const documentTarget = {
      querySelectorAll: () => [input] as unknown as NodeListOf<Element>,
    };

    expect(hasUnsavedUserInput(documentTarget)).toBe(true);
  });
});
