// Trigger a client-side .ics download via a blob URL. Kept tiny + SSR-guarded.
export function downloadIcs(filename: string, contents: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Defer cleanup to the next tick: revoking the blob URL synchronously after
  // click() aborts the download in Firefox and some Edge builds, which start
  // fetching the blob asynchronously.
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
