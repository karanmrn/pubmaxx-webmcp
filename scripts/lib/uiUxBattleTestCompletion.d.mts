export type UiUxAuditFlowDefinition = {
  name: string;
  desktopOnly?: boolean;
  allowedNotApplicableResults?: Array<Record<string, unknown>>;
};

export type UiUxAuditPageRecord = {
  origin: string;
  viewport: string;
  routeName: string;
  cls?: number;
  reducedMotion?: boolean;
};

export type UiUxAuditFlowResult = {
  origin: string;
  viewport: string;
  name: string;
  status: string;
  [field: string]: unknown;
};

export type UiUxAuditCompletionInput = {
  originNames: string[];
  viewportNames: string[];
  routeNames: string[];
  flowDefinitions: Array<UiUxAuditFlowDefinition | undefined>;
  clsBudget?: number;
  motionPolicy: Record<string, string>;
  pages: UiUxAuditPageRecord[];
  flowResults: UiUxAuditFlowResult[];
};

export function isUiUxFlowApplicable(
  flow: UiUxAuditFlowDefinition,
  viewportName: string,
): boolean;
export function assertCompleteUiUxAudit(input: UiUxAuditCompletionInput): void;
