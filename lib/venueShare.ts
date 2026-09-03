export type ShareFeedback = {
  venueId: string;
  tone: "ok" | "error";
  text: string;
};

export function isUserCancelledShare(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
