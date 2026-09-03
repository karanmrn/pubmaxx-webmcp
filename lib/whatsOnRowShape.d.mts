// Hand-maintained declarations for whatsOnRowShape.mjs (allowJs is false).
// Keep in sync with the runtime module.

export declare const WHATS_ON_KINDS: readonly string[];
export declare const WHATS_ON_CONFIDENCES: readonly string[];
export declare const WHATS_ON_LISTED_WINDOWS: readonly string[];

export declare function isWhatsOnKind(value: unknown): boolean;
export declare function isWhatsOnConfidence(value: unknown): boolean;
/** `<source label>|<sourceId>`, or null when the row names no provider id. */
export declare function eventIdentityKey(value: unknown): string | null;
export declare function isHttpUrl(value: unknown): value is string;
export declare function isValidIso(value: unknown): value is string;
export declare function isCalendarDate(value: unknown): value is string;
export declare function isValidObservedAt(value: unknown, now: number): value is string;
export declare function whatsOnRowProblems(value: unknown, now?: number): string[];
export declare function isValidWhatsOnRow(value: unknown, now?: number): boolean;
