/**
 * True only when missing durable services must fail closed. Vercel Preview
 * uses NODE_ENV=production too, so VERCEL_ENV is authoritative when present.
 */
export function isDeployedProduction(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return true;
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  return process.env.NODE_ENV === "production";
}
