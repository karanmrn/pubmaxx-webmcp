import type { LaunchOptions, Locator, Page } from "playwright";

export const UI_UX_CHROMIUM_ARGS: string[];
export const UI_UX_PAGE_SCREENSHOT_OPTIONS: { fullPage: false };
export const UI_UX_MOTION_POLICY: {
  readonly live: "reduce";
  readonly local: "no-preference";
};
export function assertUiUxCurrentFocus(locator: Locator, label: string): Promise<void>;
export function assertUiUxVisibleFocusIndicator(locator: Locator, label: string): Promise<void>;
export function hasResolvedUnconfiguredAuth(page: Page): Promise<boolean>;
export function uiUxChromiumLaunchOptions(channel?: string): LaunchOptions;
export function isLocalUiUxAuditOrigin(originUrl: string): boolean;
export function uiUxAuditContextOptions(originUrl: string): {
  reducedMotion?: "reduce";
};
export function uiUxChromiumProjectUse(channel?: string): {
  channel?: "chrome";
  launchOptions: { args?: string[] };
};
