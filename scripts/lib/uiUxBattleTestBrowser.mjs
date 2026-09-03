export const UI_UX_CHROMIUM_ARGS = Object.freeze([
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
]);

export const UI_UX_PAGE_SCREENSHOT_OPTIONS = Object.freeze({
  fullPage: false,
});

export const UI_UX_MOTION_POLICY = Object.freeze({
  live: "reduce",
  local: "no-preference",
});

export async function assertUiUxCurrentFocus(locator, label) {
  const active = await locator.evaluate((element) => document.activeElement === element);
  if (!active) {
    throw new Error(`${label} did not receive product autofocus`);
  }
}

export async function assertUiUxVisibleFocusIndicator(locator, label) {
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  const outlineVisible = focus.outlineStyle !== "none" && focus.outlineWidth !== "0px";
  const shadowVisible = focus.boxShadow !== "none";
  if (!focus.focusVisible || (!outlineVisible && !shadowVisible)) {
    throw new Error(`${label} has no visible keyboard focus indicator`);
  }
}

export async function hasResolvedUnconfiguredAuth(page) {
  return await page.locator(
    '[data-auth-resolved="true"][data-auth-configured="false"]',
  ).count() > 0;
}

export function uiUxChromiumLaunchOptions(channel) {
  if (channel !== undefined && channel !== "chrome") {
    throw new Error("UI_UX_BROWSER_CHANNEL must be chrome when set");
  }
  return {
    headless: true,
    ...(channel ? { channel } : {}),
    args: UI_UX_CHROMIUM_ARGS,
  };
}

export function isLocalUiUxAuditOrigin(originUrl) {
  const hostname = new URL(originUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function uiUxAuditContextOptions(originUrl) {
  const policy = isLocalUiUxAuditOrigin(originUrl)
    ? UI_UX_MOTION_POLICY.local
    : UI_UX_MOTION_POLICY.live;
  return policy === "reduce" ? { reducedMotion: "reduce" } : {};
}

export function uiUxChromiumProjectUse(channel) {
  const options = uiUxChromiumLaunchOptions(channel);
  return {
    ...(options.channel ? { channel: options.channel } : {}),
    launchOptions: { args: options.args },
  };
}
