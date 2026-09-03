import "server-only";

import {
  defaultMessagePhotoServeDeps,
  type MessagePhotoServeDeps,
} from "@/lib/messagePhotoServe.server";

let testDeps: Partial<MessagePhotoServeDeps> | null = null;

/** Test seam for the private photo reader. */
export function __setMessagePhotoServeRouteDepsForTest(
  deps: Partial<MessagePhotoServeDeps> | null,
): void {
  testDeps = deps;
}

export function messagePhotoServeRouteDeps(): MessagePhotoServeDeps {
  return { ...defaultMessagePhotoServeDeps, ...testDeps };
}
