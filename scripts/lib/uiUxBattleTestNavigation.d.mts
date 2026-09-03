import type { Page } from "playwright";

export type AuditedOrigin = {
  name: string;
  url: string;
};

export type AuditedRoute = {
  name: string;
  path: string;
  readySelector: string;
  pendingSelectors?: string[];
  pendingTexts?: string[];
  waitForAuthResolution?: boolean;
  waitForPaintedMap?: boolean;
  settlementTimeoutMs?: number;
};

export type AuditNavigationResult = {
  cls: number | null;
  clsSupported: boolean;
  clsBudget: number;
};

export type AuditedFlow = {
  name: string;
  route: string;
  dependencies: string[];
  desktopOnly?: boolean;
  allowedNotApplicableResults?: Array<Record<string, unknown>>;
};

export const AUDITED_ORIGINS: AuditedOrigin[];
export const AUDITED_ROUTES: AuditedRoute[];
export const AUDITED_FLOWS: AuditedFlow[];
export const UI_UX_CLS_BUDGET: number;
export function selectAuditedOrigins(filter?: string): AuditedOrigin[];
export function selectAuditedRoutes(filter?: string): AuditedRoute[];
export function selectAuditedFlows(routes: AuditedRoute[]): AuditedFlow[];
export function configureAuditedFlowsForRunMode(
  flows: AuditedFlow[],
  options?: { frozenLiveBaseline?: boolean },
): AuditedFlow[];
export function waitForAuditedRouteSettlement(
  page: Page,
  route: AuditedRoute,
  timeout?: number,
): Promise<AuditNavigationResult>;
export function navigateToAuditedRoute(
  page: Page,
  originUrl: string,
  route: AuditedRoute,
  timeout?: number,
): Promise<AuditNavigationResult>;
