/**
 * Whether Clerk may expose a visible account control.
 *
 * Clerk remains secondary until it can establish the Supabase session that
 * owns PUBMAXX identity. `clerkIntegrationConfigured` is the safe boolean the
 * server derives after checking both Clerk keys. It contains no secret data.
 */
export function isClerkProductSessionAvailable(
  productUser: unknown,
  clerkIntegrationConfigured: boolean,
): boolean {
  return Boolean(productUser) && clerkIntegrationConfigured;
}
