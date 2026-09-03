/** Navigate one validated internal path inside the remote native WebView. */
export function navigateNativeBrowser(path: string): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== path) window.location.assign(path);
}
