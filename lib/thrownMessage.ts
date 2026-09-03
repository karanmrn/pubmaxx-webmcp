/**
 * Name what was thrown. supabase-js rethrows a plain PostgrestError object
 * rather than an Error, so an `instanceof Error` read alone logs
 * "[object Object]" exactly when a database outage takes a lane down.
 */
export function thrownMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
