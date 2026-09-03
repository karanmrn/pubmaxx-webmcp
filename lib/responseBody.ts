/**
 * Let go of a response body you have decided not to read.
 *
 * THE DEFECT THIS EXISTS FOR: a Next route handler answers `Transfer-Encoding:
 * chunked` with no `Content-Length`, so the browser cannot know the body ended
 * until somebody drains it. A reader that sees a non-ok status and returns
 * leaves that stream open, and Chromium never reports the request finished. The
 * page keeps a connection that will never close: `networkidle` never arrives,
 * and the screenshot run that waits for it spends its whole budget on a 401
 * nobody wanted to read. A signed-out `/plan` did exactly that.
 *
 * Cancelling is the honest close: it tells the stream nobody is reading rather
 * than reading bytes we are about to drop. `body` is null on a bodyless answer
 * (204, HEAD) and on an already-cancelled one, and cancel can reject on a
 * connection that has already gone, so both are quiet.
 */
export function discardBody(response: Response): void {
  if (response.bodyUsed) return;
  void response.body?.cancel().catch(() => {
    // The stream is already gone. Nothing left to release.
  });
}
