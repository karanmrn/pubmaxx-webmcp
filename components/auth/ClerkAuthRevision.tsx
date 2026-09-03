"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";

import {
  setProviderAuthState,
  setProviderIdentity,
} from "@/lib/authProviderRevision";

/** Publish Clerk account transitions to AuthProvider's opaque account seam. */
export default function ClerkAuthRevision(): null {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded) {
      setProviderAuthState("clerk", "unresolved");
      return;
    }
    setProviderAuthState("clerk", user?.id ? "authenticated" : "signed-out");
    setProviderIdentity("clerk", user?.id ?? null);
  }, [isLoaded, user?.id]);

  return null;
}
