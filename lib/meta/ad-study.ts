/**
 * A Meta A/B test (ad study) on two existing campaigns (the connector's
 * create_split_test, M3b).
 *
 * POST /{business_id}/ad_studies with type SPLIT_TEST and two 50 % cells,
 * one campaign each: the shape #1321's retargeting layout test
 * (lib/retargeting/test.ts studyPayload) sends, made general here so #1321
 * can rebase on it. The business is the ad account's (GET
 * /act_{id}?fields=business). Every create is on meta_write_idempotency as
 * `ad_study_create`, `{ required: true }`, keyed on the ask.
 *
 * Pure apart from the passed-in Graph calls.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

export const MIN_STUDY_DAYS = 1;
export const MAX_STUDY_DAYS = 90;

export function studyPayload(args: { name: string; description?: string; campaignA: string; campaignB: string; start: Date; end: Date }): Record<string, unknown> {
  return {
    name: args.name,
    description: args.description ?? "Cost per result, two campaigns at 50 % each.",
    type: "SPLIT_TEST",
    start_time: Math.floor(args.start.getTime() / 1000),
    end_time: Math.floor(args.end.getTime() / 1000),
    cells: JSON.stringify([
      { name: "A", treatment_percentage: 50, campaigns: [args.campaignA] },
      { name: "B", treatment_percentage: 50, campaigns: [args.campaignB] },
    ]),
  };
}

export type AdStudyGraph = {
  /** POST /{businessId}/ad_studies; returns the study id. */
  createAdStudy(businessId: string, payload: Record<string, unknown>): Promise<string>;
};

export async function writeAdStudy(args: {
  ledger: MetaWriteContext;
  graph: AdStudyGraph;
  businessId: string;
  payload: Record<string, unknown>;
  key: string;
}): Promise<string> {
  if (!/^\d+$/.test(args.businessId)) throw new Error("not a business id");
  return withMetaWriteIdempotency(
    args.ledger,
    "ad_study_create",
    { business_id: args.businessId, cells: args.payload.cells, key: args.key },
    () => args.graph.createAdStudy(args.businessId, args.payload),
    { required: true },
  );
}

/** The campaigns a list of studies (GET /{business}/ad_studies?fields=end_time,cells{campaigns{id}}) holds while still running at `now`. */
export function campaignsInRunningStudies(
  studies: ReadonlyArray<{ id: string; end_time?: string | number | null; cells?: { data?: Array<{ campaigns?: { data?: Array<{ id: string }> } }> } }>,
  now: Date,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of studies) {
    const end = s.end_time == null ? null : typeof s.end_time === "number" ? s.end_time * 1000 : Date.parse(String(s.end_time));
    if (end != null && Number.isFinite(end) && end <= now.getTime()) continue;
    for (const cell of s.cells?.data ?? []) for (const c of cell.campaigns?.data ?? []) out.set(c.id, s.id);
  }
  return out;
}
