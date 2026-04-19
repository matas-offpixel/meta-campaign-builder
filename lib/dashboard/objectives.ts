/**
 * Marketing-plan objective columns.
 *
 * The order here is the canonical column order of the daily-grid view
 * (Traffic, Conversion, Reach, Post engagement, TikTok, Google, Snap).
 * Persisted as keys inside ad_plan_days.objective_budgets jsonb; readers
 * default missing keys to 0.
 *
 * Pure constants — keep this file dependency-free so it can be imported
 * from server, browser, and pure helpers alike.
 */

export const OBJECTIVE_KEYS = [
  "traffic",
  "conversion",
  "reach",
  "post_engagement",
  "tiktok",
  "google",
  "snap",
] as const;

export type ObjectiveKey = (typeof OBJECTIVE_KEYS)[number];

/** Sparse map. Missing key reads as 0. Persisted to jsonb as-is. */
export type ObjectiveBudgets = Partial<Record<ObjectiveKey, number>>;

export const OBJECTIVE_LABEL: Record<ObjectiveKey, string> = {
  traffic: "Traffic",
  conversion: "Conversion",
  reach: "Reach",
  post_engagement: "Post eng.",
  tiktok: "TikTok",
  google: "Google",
  snap: "Snap",
};

/** Read a budget cell, defaulting absent keys to 0. */
export function readObjectiveBudget(
  budgets: ObjectiveBudgets | null | undefined,
  key: ObjectiveKey,
): number {
  return budgets?.[key] ?? 0;
}

/** Write a single objective without disturbing the rest. Returns a new map. */
export function writeObjectiveBudget(
  budgets: ObjectiveBudgets | null | undefined,
  key: ObjectiveKey,
  value: number,
): ObjectiveBudgets {
  const next: ObjectiveBudgets = { ...(budgets ?? {}) };
  if (value === 0) {
    // Drop the key — sparse storage keeps default-zero rows compact.
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}
