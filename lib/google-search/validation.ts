/**
 * lib/google-search/validation.ts
 *
 * Pure validation helpers for the Google Search wizard. Two surfaces:
 *
 * 1. Per-step blocking checks (`validateGoogleSearchStep`) — gates the
 *    Continue button in each step. Returns the messages the wizard
 *    footer shows beneath the action bar.
 * 2. Plan-wide hard/soft validation (`validateGoogleSearchPlan`) —
 *    renders in the Review step. Hard errors block push; soft warnings
 *    flag concerns but allow push.
 *
 * Char limits + minimums come from `GOOGLE_SEARCH_LIMITS` so this module
 * and the xlsx parser agree.
 */

import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchPlanTree,
  type GoogleSearchAdGroupNode,
  type GoogleSearchCampaignNode,
  type RsaDescription,
  type RsaHeadline,
} from "./types.ts";

export type GoogleSearchValidationSeverity = "error" | "warning";

export interface GoogleSearchValidationIssue {
  severity: GoogleSearchValidationSeverity;
  message: string;
  /** Stable code so the UI can render badges, filter, or group. */
  code: string;
  /** Optional human-readable scope (e.g. "Campaign C1 → Brand ad group"). */
  scope?: string;
}

// ─── Per-step gating ──────────────────────────────────────────────────

export type GoogleSearchWizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const GOOGLE_SEARCH_WIZARD_STEPS = [
  { label: "Plan Setup", description: "Event + Google Ads account" },
  { label: "Campaigns", description: "Define campaigns" },
  { label: "Ad Groups & Keywords", description: "Per campaign" },
  { label: "Negatives", description: "Plan + campaign-scoped" },
  { label: "Ad Copy", description: "RSA headlines + descriptions" },
  { label: "Targeting & Budget", description: "Geo, devices, budget" },
  { label: "Review", description: "Pre-push checklist" },
  { label: "Push", description: "Send to Google Ads" },
] as const;

export function validateGoogleSearchStep(
  step: GoogleSearchWizardStep,
  tree: GoogleSearchPlanTree,
): GoogleSearchValidationIssue[] {
  switch (step) {
    case 0:
      return validatePlanSetup(tree);
    case 1:
      return validateCampaigns(tree);
    case 2:
      return validateKeywords(tree);
    case 3:
      return [];
    case 4:
      return validateAllRsas(tree);
    case 5:
      return validateBudget(tree);
    case 6:
      return validateGoogleSearchPlan(tree).filter((i) => i.severity === "error");
    case 7:
      return validateGoogleSearchPlan(tree).filter((i) => i.severity === "error");
    default:
      return [];
  }
}

function validatePlanSetup(tree: GoogleSearchPlanTree): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [];
  if (!tree.plan.name?.trim()) {
    issues.push({ severity: "error", code: "plan_name_missing", message: "Plan name is required." });
  }
  if (!tree.plan.google_ads_account_id) {
    issues.push({
      severity: "error",
      code: "google_ads_account_missing",
      message: "Pick a Google Ads account before continuing.",
    });
  }
  return issues;
}

function validateCampaigns(tree: GoogleSearchPlanTree): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [];
  if (tree.campaigns.length === 0) {
    issues.push({
      severity: "error",
      code: "no_campaigns",
      message: "Add at least one campaign.",
    });
  }
  for (const c of tree.campaigns) {
    if (!c.name?.trim()) {
      issues.push({
        severity: "error",
        code: "campaign_name_missing",
        message: "Every campaign needs a name.",
        scope: c.name ?? "(unnamed)",
      });
    }
  }
  return issues;
}

function validateKeywords(tree: GoogleSearchPlanTree): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [];
  for (const c of tree.campaigns) {
    if (c.ad_groups.length === 0) {
      issues.push({
        severity: "error",
        code: "campaign_no_ad_groups",
        message: `Campaign "${c.name}" has no ad groups.`,
        scope: c.name,
      });
      continue;
    }
    const totalKeywords = c.ad_groups.reduce((s, ag) => s + ag.keywords.length, 0);
    if (totalKeywords === 0) {
      issues.push({
        severity: "error",
        code: "campaign_no_keywords",
        message: `Campaign "${c.name}" has no keywords.`,
        scope: c.name,
      });
    }
  }
  return issues;
}

function validateAllRsas(tree: GoogleSearchPlanTree): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [];
  for (const c of tree.campaigns) {
    for (const ag of c.ad_groups) {
      issues.push(...validateAdGroupRsas(c, ag));
    }
  }
  return issues;
}

function validateAdGroupRsas(
  campaign: GoogleSearchCampaignNode,
  adGroup: GoogleSearchAdGroupNode,
): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [];
  const scope = `${campaign.name} → ${adGroup.name}`;
  if (adGroup.rsas.length === 0) {
    issues.push({
      severity: "error",
      code: "ad_group_no_rsa",
      message: `${scope}: no RSA copy.`,
      scope,
    });
    return issues;
  }
  for (const rsa of adGroup.rsas) {
    if (rsa.headlines.length < GOOGLE_SEARCH_LIMITS.MIN_HEADLINES_PER_RSA) {
      issues.push({
        severity: "error",
        code: "rsa_too_few_headlines",
        message: `${scope}: RSA has ${rsa.headlines.length} headlines (Google requires at least ${GOOGLE_SEARCH_LIMITS.MIN_HEADLINES_PER_RSA}).`,
        scope,
      });
    }
    if (rsa.descriptions.length < GOOGLE_SEARCH_LIMITS.MIN_DESCRIPTIONS_PER_RSA) {
      issues.push({
        severity: "error",
        code: "rsa_too_few_descriptions",
        message: `${scope}: RSA has ${rsa.descriptions.length} descriptions (Google requires at least ${GOOGLE_SEARCH_LIMITS.MIN_DESCRIPTIONS_PER_RSA}).`,
        scope,
      });
    }
    for (const h of rsa.headlines) {
      if (rsaTextLength(h) > GOOGLE_SEARCH_LIMITS.HEADLINE_MAX_CHARS) {
        issues.push({
          severity: "error",
          code: "headline_too_long",
          message: `${scope}: headline "${truncate(h.text)}" is ${h.text.length} chars (max ${GOOGLE_SEARCH_LIMITS.HEADLINE_MAX_CHARS}).`,
          scope,
        });
      }
    }
    for (const d of rsa.descriptions) {
      if (rsaTextLength(d) > GOOGLE_SEARCH_LIMITS.DESCRIPTION_MAX_CHARS) {
        issues.push({
          severity: "error",
          code: "description_too_long",
          message: `${scope}: description "${truncate(d.text)}" is ${d.text.length} chars (max ${GOOGLE_SEARCH_LIMITS.DESCRIPTION_MAX_CHARS}).`,
          scope,
        });
      }
    }
  }
  return issues;
}

function validateBudget(tree: GoogleSearchPlanTree): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [];
  const total = tree.plan.total_budget;
  if (total == null || total <= 0) return issues;
  const allocated = tree.campaigns.reduce((s, c) => s + (c.monthly_budget ?? 0), 0);
  if (allocated > total + 0.01) {
    issues.push({
      severity: "error",
      code: "budget_over_allocated",
      message: `Campaign budgets sum to £${allocated.toFixed(2)} which exceeds the plan total of £${total.toFixed(2)}.`,
    });
  }
  return issues;
}

// ─── Plan-wide hard + soft validation (Review step) ───────────────────

export function validateGoogleSearchPlan(
  tree: GoogleSearchPlanTree,
): GoogleSearchValidationIssue[] {
  const issues: GoogleSearchValidationIssue[] = [
    ...validatePlanSetup(tree),
    ...validateCampaigns(tree),
    ...validateKeywords(tree),
    ...validateAllRsas(tree),
    ...validateBudget(tree),
    ...softWarnings(tree),
  ];
  return dedupe(issues);
}

function softWarnings(tree: GoogleSearchPlanTree): GoogleSearchValidationIssue[] {
  const warnings: GoogleSearchValidationIssue[] = [];
  const planNegativeSet = new Set(
    tree.plan_negatives.map((n) => normaliseKeyword(n.keyword)),
  );

  for (const c of tree.campaigns) {
    const campaignNegativeSet = new Set([
      ...planNegativeSet,
      ...c.negatives.map((n) => normaliseKeyword(n.keyword)),
    ]);

    if (campaignNegativeSet.size === 0) {
      warnings.push({
        severity: "warning",
        code: "campaign_no_negatives",
        message: `Campaign "${c.name}" has no negatives — consider adding generic noise filters (e.g. "free", "stream").`,
        scope: c.name,
      });
    }

    for (const ag of c.ad_groups) {
      for (const k of ag.keywords) {
        if (campaignNegativeSet.has(normaliseKeyword(k.keyword))) {
          warnings.push({
            severity: "warning",
            code: "keyword_cannibalised_by_negative",
            message: `${c.name} → ${ag.name}: keyword "${k.keyword}" is also a negative — it will never serve.`,
            scope: `${c.name} → ${ag.name}`,
          });
        }
      }
    }
  }

  const total = tree.plan.total_budget;
  if (total != null && total > 0) {
    const allocated = tree.campaigns.reduce((s, c) => s + (c.monthly_budget ?? 0), 0);
    if (allocated > 0 && allocated < total * 0.5) {
      warnings.push({
        severity: "warning",
        code: "budget_under_allocated",
        message: `Campaign budgets sum to £${allocated.toFixed(2)} which is under 50% of the plan total of £${total.toFixed(2)}.`,
      });
    }
  }

  return warnings;
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function rsaTextLength(slot: RsaHeadline | RsaDescription): number {
  return [...slot.text].length;
}

function normaliseKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function truncate(value: string, max = 24): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function dedupe(issues: GoogleSearchValidationIssue[]): GoogleSearchValidationIssue[] {
  const seen = new Set<string>();
  const out: GoogleSearchValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}::${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function hasHardErrors(issues: GoogleSearchValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
