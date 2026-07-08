/**
 * lib/d2c/metrics/mailchimp.ts
 *
 * Mailchimp campaign report → normalised D2CSendMetrics (Goal 4).
 * Endpoint: GET /3.0/reports/{campaign_id}
 *   https://mailchimp.com/developer/marketing/api/reports/
 *
 * Relative imports only (testable seam — feedback_node_test_react_server_no_dom).
 */

import { mailchimpJson } from "../mailchimp/client.ts";
import type { D2CSendMetrics } from "./types.ts";

/** Subset of the documented /reports/{id} response we read. */
export interface MailchimpReport {
  emails_sent?: number;
  opens?: { opens_total?: number; unique_opens?: number; open_rate?: number };
  clicks?: { clicks_total?: number; unique_clicks?: number; click_rate?: number };
  bounces?: { hard_bounces?: number; soft_bounces?: number; syntax_errors?: number };
  unsubscribed?: number;
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Map a raw Mailchimp report into the normalised metrics shape. Pure. */
export function mapMailchimpReport(
  report: MailchimpReport,
  nowIso: string,
): D2CSendMetrics {
  const attempted = n(report.emails_sent);
  const totalBounces =
    n(report.bounces?.hard_bounces) +
    n(report.bounces?.soft_bounces) +
    n(report.bounces?.syntax_errors);
  return {
    fetched_at: nowIso,
    provider: "mailchimp",
    attempted,
    delivered: Math.max(0, attempted - totalBounces),
    opens: {
      unique: n(report.opens?.unique_opens),
      total: n(report.opens?.opens_total),
      rate: n(report.opens?.open_rate),
    },
    clicks: {
      unique: n(report.clicks?.unique_clicks),
      total: n(report.clicks?.clicks_total),
      rate: n(report.clicks?.click_rate),
    },
    bounces: totalBounces,
    unsubscribes: n(report.unsubscribed),
    raw: report,
  };
}

/**
 * Fetch a Mailchimp campaign report and normalise it. Returns null when the
 * campaign has not fired yet (Mailchimp 404s the report until send completes).
 */
export async function fetchMailchimpMetrics(
  serverPrefix: string,
  apiKey: string,
  campaignId: string,
  opts?: { nowIso?: string },
): Promise<D2CSendMetrics> {
  const report = await mailchimpJson<MailchimpReport>(
    serverPrefix,
    apiKey,
    `/3.0/reports/${encodeURIComponent(campaignId)}`,
    { method: "GET" },
  );
  return mapMailchimpReport(report, opts?.nowIso ?? new Date().toISOString());
}
