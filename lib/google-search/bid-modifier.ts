/**
 * lib/google-search/bid-modifier.ts
 *
 * Utilities for parsing geo bid-modifier inputs from the wizard UI.
 *
 * The bid modifier field accepts strings like "+20", "20", or "-10"
 * (meaning +20%, +20%, or -10% bid adjustment). We use `type="text"`
 * rather than `type="number"` for this input because browsers discard
 * the "+" prefix in number inputs, returning `e.target.value = ""`
 * even though the user typed "+20" — causing the value to silently
 * become `null` on every autosave.
 */

/**
 * Parses a user-entered bid modifier string like "+20", "20", or "-10"
 * into a numeric percentage (20 or -10). Returns `null` for empty,
 * partial ("+"), or non-numeric input.
 */
export function parseBidModifierInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "+" || trimmed === "-") return null;
  // Strip a leading "+" — Number() handles "-" natively.
  const n = parseFloat(trimmed.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}
