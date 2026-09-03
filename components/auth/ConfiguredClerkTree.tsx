"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps, ReactNode } from "react";

import ClerkAuthRevision from "@/components/auth/ClerkAuthRevision";

type ConfiguredClerkTreeProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
  children: ReactNode;
};

/** Clerk chrome only. AuthProvider stays outside so product UI paints first. */
export default function ConfiguredClerkTree({
  appearance,
  children,
}: ConfiguredClerkTreeProps): React.JSX.Element {
  return (
    <ClerkProvider appearance={appearance}>
      <ClerkAuthRevision />
      {children}
    </ClerkProvider>
  );
}
