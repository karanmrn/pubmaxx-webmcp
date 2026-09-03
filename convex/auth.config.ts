import type { AuthConfig } from "convex/server";

const issuer = process.env.CONVEX_SUPABASE_JWT_ISSUER;
const jwks = process.env.CONVEX_SUPABASE_JWKS_URL;
const algorithm = process.env.CONVEX_SUPABASE_JWT_ALGORITHM;

const supportedAlgorithm =
  algorithm === "RS256" || algorithm === "ES256" ? algorithm : null;

// Empty providers are intentional in keyless development. Every PubMax public
// function still fails closed when getUserIdentity() returns null. A deployment
// must configure an asymmetric Supabase signing key before enabling this bridge;
// legacy HS256 secrets are deliberately unsupported by this adapter.
export default {
  providers:
    issuer && jwks && supportedAlgorithm
      ? [
          {
            type: "customJwt" as const,
            applicationID:
              process.env.CONVEX_SUPABASE_JWT_AUDIENCE ?? "authenticated",
            issuer,
            jwks,
            algorithm: supportedAlgorithm,
          },
        ]
      : [],
} satisfies AuthConfig;
