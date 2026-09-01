/**
 * Pure helpers for task #120 PR C — the UI that arms Optimisation Strategy
 * automation. Maps the three-state control onto the two existing draft
 * columns. Does not change evaluate.ts / apply.ts or the three-of-three
 * write gate.
 *
 *   Off     → enabled=false, live=false
 *   Shadow  → enabled=true,  live=false   ("log what the rules would do")
 *   Live    → enabled=true,  live=true    (requires confirmLive on the write)
 *
 * Shadow-first is NOT enforced: Off → Live is allowed when confirmLive is true.
 */

export type AutomationArm = "off" | "shadow" | "live";

export type AutomationFlags = {
  enabled: boolean;
  live: boolean;
};

export function flagsFromArm(arm: AutomationArm): AutomationFlags {
  if (arm === "live") return { enabled: true, live: true };
  if (arm === "shadow") return { enabled: true, live: false };
  return { enabled: false, live: false };
}

/**
 * live=true without enabled is still dry-run (`not_enabled`). Surface that
 * as Off so the control never implies Live is armed.
 */
export function armFromFlags(enabled: boolean, live: boolean): AutomationArm {
  if (enabled && live) return "live";
  if (enabled) return "shadow";
  return "off";
}

export type AutomationFlagWrite =
  | { ok: true; enabled: boolean; live: boolean; arm: AutomationArm }
  | { ok: false; error: string; code: "confirm_required" | "invalid" };

/**
 * Parse a POST body. `live` is only set true when `confirmLive === true`.
 * Off / Shadow write `live: false` without a confirm (disarming is not Live).
 */
export function parseAutomationFlagWrite(body: unknown): AutomationFlagWrite {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body", code: "invalid" };
  }
  const raw = body as { arm?: unknown; confirmLive?: unknown };
  if (raw.arm !== "off" && raw.arm !== "shadow" && raw.arm !== "live") {
    return { ok: false, error: "arm must be off, shadow, or live", code: "invalid" };
  }
  const arm = raw.arm;
  if (arm === "live") {
    if (raw.confirmLive !== true) {
      return {
        ok: false,
        error: "Switching to Live requires confirmLive: true",
        code: "confirm_required",
      };
    }
    return { ok: true, arm, ...flagsFromArm("live") };
  }
  return { ok: true, arm, ...flagsFromArm(arm) };
}

export type AutomationChannelView = "meta" | "tiktok" | "google";

export type DecisionRowInput = {
  decided_at: string;
  metric: string | null;
  metric_value: number | string | null;
  rule_matched: string | null;
  action_recommended: string | null;
  budget_before_pence: number | null;
  budget_after_pence: number | null;
  applied: boolean | null;
  dry_run: boolean | null;
  reason_text: string | null;
  channel?: string | null;
  scope?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  meta_response_json?: unknown;
};

export type AutomationScopeView = "ad_set" | "campaign";

export type DecisionRowView = {
  decidedAt: string;
  metric: string;
  metricValue: number | null;
  ruleMatched: string;
  action: string;
  budgetBeforePence: number | null;
  budgetAfterPence: number | null;
  applied: boolean;
  dryRun: boolean;
  reasonText: string;
  kind: "applied" | "dry_run";
  channel: AutomationChannelView;
  scope: AutomationScopeView;
};

function resolveDecisionScope(row: DecisionRowInput): AutomationScopeView {
  if (row.scope === "campaign" || row.scope === "ad_set") return row.scope;
  if (row.campaign_id && row.adset_id && row.campaign_id === row.adset_id) {
    return "campaign";
  }
  return "ad_set";
}

function resolveDecisionChannel(row: DecisionRowInput): AutomationChannelView {
  if (row.channel === "tiktok" || row.channel === "google" || row.channel === "meta") {
    return row.channel;
  }
  const json = row.meta_response_json;
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const nested = (json as { channel?: unknown }).channel;
    if (nested === "tiktok" || nested === "google" || nested === "meta") return nested;
  }
  return "meta";
}

function asNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function presentDecisionRow(row: DecisionRowInput): DecisionRowView {
  const applied = row.applied === true;
  const dryRun = row.dry_run !== false && !applied;
  return {
    decidedAt: row.decided_at,
    metric: row.metric ?? "",
    metricValue: asNumber(row.metric_value),
    ruleMatched: row.rule_matched ?? "",
    action: row.action_recommended ?? "",
    budgetBeforePence: asNumber(row.budget_before_pence),
    budgetAfterPence: asNumber(row.budget_after_pence),
    applied,
    dryRun,
    reasonText: row.reason_text ?? "",
    kind: applied ? "applied" : "dry_run",
    channel: resolveDecisionChannel(row),
    scope: resolveDecisionScope(row),
  };
}

export function formatPenceAsMajor(
  pence: number | null,
  currencySymbol: string,
): string {
  if (pence == null) return "—";
  return `${currencySymbol}${(pence / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function currencySymbol(currency: string): string {
  if (currency === "GBP") return "£";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return currency;
}
