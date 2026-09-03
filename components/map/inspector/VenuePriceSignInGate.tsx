"use client";

import { useEffect } from "react";

import SignInButton from "@/components/auth/SignInButton";
import { trackEvent } from "@/lib/analytics";

export default function VenuePriceSignInGate({
  venueName,
  loading,
}: {
  venueName: string;
  loading: boolean;
}) {
  useEffect(() => {
    if (!loading) {
      trackEvent("contribution_gate", { step: "sign_in_required" });
    }
  }, [loading]);

  return (
    <section
      className="venuePriceSignInGate"
      role="region"
      aria-labelledby="venuePriceSignInTitle"
    >
      <h3 id="venuePriceSignInTitle" tabIndex={-1}>
        {loading ? "Checking your account" : "Sign in to add a price"}
      </h3>
      {loading ? (
        <p>Checking whether you&rsquo;re signed in.</p>
      ) : (
        <>
          <p>
            You need an account to add a price. Sign in here and we&rsquo;ll
            bring you back to {venueName}.
          </p>
          <SignInButton />
        </>
      )}
    </section>
  );
}
