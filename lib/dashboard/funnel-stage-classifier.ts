export type FunnelStage = "TOFU" | "MOFU" | "BOFU";

export interface FunnelStageCampaignLike {
  name: string | null | undefined;
  objective?: string | null;
  funnel_stage?: FunnelStage | null;
  funnelStage?: FunnelStage | null;
}

const VALID_STAGES = new Set<FunnelStage>(["TOFU", "MOFU", "BOFU"]);

const BOFU_NAME_HINT =
  /PRESALE|PRE[\s_-]?SALE|HOT[\s._-]?DATA|RETARGET|CONVERSION/i;
const MOFU_NAME_HINT = /MOFU|4THEFANS|PAGE[\s._-]?FAN|VIEW.*CONTENT/i;
const TOFU_NAME_HINT = /TOFU|AWARENESS|INTEREST|LOOKALIKE|ADVANTAGE\+/i;

const BOFU_OBJECTIVES = new Set([
  "CONVERSIONS",
  "LEAD_GENERATION",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
]);
const MOFU_OBJECTIVES = new Set([
  "LANDING_PAGE_VIEWS",
  "TRAFFIC",
  "OUTCOME_TRAFFIC",
]);
const TOFU_OBJECTIVES = new Set([
  "REACH",
  "AWARENESS",
  "BRAND_AWARENESS",
  "OUTCOME_AWARENESS",
]);

export function classifyCampaignFunnelStage(
  campaign: FunnelStageCampaignLike,
): FunnelStage {
  const manual = normalizeStage(campaign.funnel_stage ?? campaign.funnelStage);
  if (manual) return manual;

  const name = (campaign.name ?? "").toUpperCase();
  if (BOFU_NAME_HINT.test(name)) return "BOFU";
  if (MOFU_NAME_HINT.test(name)) return "MOFU";
  if (TOFU_NAME_HINT.test(name)) return "TOFU";

  const objective = (campaign.objective ?? "").toUpperCase();
  if (BOFU_OBJECTIVES.has(objective)) return "BOFU";
  if (MOFU_OBJECTIVES.has(objective)) return "MOFU";
  if (TOFU_OBJECTIVES.has(objective)) return "TOFU";

  return "MOFU";
}

function normalizeStage(value: string | null | undefined): FunnelStage | null {
  const stage = value?.toUpperCase();
  return stage && VALID_STAGES.has(stage as FunnelStage)
    ? (stage as FunnelStage)
    : null;
}
