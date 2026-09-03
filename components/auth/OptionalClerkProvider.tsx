"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import type { ClerkProvider } from "@clerk/nextjs";

import { AuthProvider } from "@/components/auth/AuthProvider";

type OptionalClerkProviderProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
  clerkIntegrationConfigured: boolean;
  children?: ReactNode;
};

type ConfiguredClerkTreeProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
  children: ReactNode;
};

type ConfiguredClerkTreeComponent = (props: ConfiguredClerkTreeProps) => React.JSX.Element;

/**
 * Loads Clerk after first paint. Children and AuthProvider are never behind
 * React.lazy/Suspense, so cold opens keep map, nav and tab bar visible while the
 * optional Clerk chunk downloads.
 */
export default function OptionalClerkProvider({
  appearance,
  clerkIntegrationConfigured,
  children,
}: OptionalClerkProviderProps): React.JSX.Element {
  const [ClerkTree, setClerkTree] = useState<ConfiguredClerkTreeComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@/components/auth/ConfiguredClerkTree").then((mod) => {
      if (!cancelled) setClerkTree(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const product = ClerkTree ? (
    <ClerkTree appearance={appearance}>{children}</ClerkTree>
  ) : (
    children
  );

  return (
    <AuthProvider clerkIntegrationConfigured={clerkIntegrationConfigured}>
      {product}
    </AuthProvider>
  );
}
