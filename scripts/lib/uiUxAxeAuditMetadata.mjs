export function validateUiUxAxeColorScheme(value) {
  if (value !== "light" && value !== "dark") {
    throw new Error("UI_UX_AXE_COLOR_SCHEME must be light or dark");
  }
  return value;
}

export function buildUiUxAxeAuditDocument(origin, colorScheme, results) {
  return { origin, colorScheme, results };
}
