/**
 * lib/internal-counts/review-read.ts
 *
 * Reads the review list for the signed-in operator (RLS: own rows only)
 * and shapes it for components/internal-counts/review-list.tsx.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { InternalCountsView, RecentCountView, ReviewGroupView } from "./view-types.ts";
import { pageAll } from "../db/paged-read.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

const RECENT = 30;

const FLASH: Record<string, string> = {
  "gmail=connected": "Gmail connected. Counts are read hourly on weekdays.",
  "gmail=declined": "Gmail wasn't connected: the request was declined.",
  "gmail=wrong_scope": "Gmail wasn't connected: Google granted more or less than read-only mail.",
  "gmail=no_refresh_token": "Gmail wasn't connected: Google sent no lasting access. Remove the app's access in your Google account and connect again.",
  "gmail=not_configured": "Gmail connect isn't set up on this deployment.",
  "gmail=state_missing": "Gmail wasn't connected: the request expired. Try again.",
  "gmail=state_mismatch": "Gmail wasn't connected: the request expired. Try again.",
  "gmail=failed": "Gmail wasn't connected. Try again.",
  "upload=no_file": "Choose a PDF to upload.",
  "upload=too_large": "That PDF is over 10 MB.",
  "upload=not_pdf": "That file isn't a PDF.",
  "upload=already_read": "That PDF was uploaded before. Nothing new was written.",
  "upload=unreadable": "That PDF couldn't be read as an Internal Counts sheet. It's on the list below.",
};

export function flashFor(params: Record<string, string | undefined>): string | null {
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    const text = FLASH[`${k}=${v}`];
    if (text) return text;
  }
  if (params.upload === "processed") {
    return `Uploaded. ${params.written ?? 0} shows written, ${params.review ?? 0} to review.`;
  }
  if (params.rerun) {
    const [written, review] = params.rerun.split(":");
    return `Ran again. ${written} shows written, ${review} still to review.`;
  }
  return null;
}

interface ItemRow {
  id: string;
  report_id: string;
  kind: string;
  blocking: boolean;
  show_name: string | null;
  message: string;
  created_at: string;
}

interface ReportRow {
  id: string;
  subject: string;
  received_at: string;
  count_date: string | null;
}

export async function readReviewList(
  sb: Db,
  input: { gmailConfigured: boolean; flash: string | null },
): Promise<InternalCountsView> {
  const { data: conn } = await sb
    .from("gmail_connections")
    .select("email,last_pull_at,last_pull_error")
    .order("connected_at", { ascending: true })
    .limit(1);
  const items = await pageAll<ItemRow>(
    (from, to) =>
      sb
        .from("internal_count_review_items")
        .select("id,report_id,kind,blocking,show_name,message,created_at")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ["id"],
    "internal_count_review_items",
  );
  const { data: recentRows } = await sb
    .from("internal_count_reports")
    .select("id,subject,received_at,count_date")
    .order("received_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(RECENT);
  const reportIds = [...new Set([...items.map((i) => i.report_id), ...((recentRows ?? []) as ReportRow[]).map((r) => r.id)])];
  const reports = new Map<string, ReportRow>();
  const blocks = new Map<string, { written: number; inReview: number }>();
  if (reportIds.length) {
    const { data } = await sb.from("internal_count_reports").select("id,subject,received_at,count_date").in("id", reportIds);
    for (const r of (data ?? []) as ReportRow[]) reports.set(r.id, r);
    const blockRows = await pageAll<{ id: string; report_id: string; status: string }>(
      (from, to) =>
        sb.from("internal_count_blocks").select("id,report_id,status").in("report_id", reportIds).order("id", { ascending: true }).range(from, to),
      ["id"],
      "internal_count_blocks",
    );
    for (const b of blockRows) {
      const t = blocks.get(b.report_id) ?? { written: 0, inReview: 0 };
      if (b.status === "written") t.written++;
      else t.inReview++;
      blocks.set(b.report_id, t);
    }
  }
  return {
    gmailConfigured: input.gmailConfigured,
    gmail: conn?.[0]
      ? { email: conn[0].email, lastPullAt: conn[0].last_pull_at, lastPullError: conn[0].last_pull_error }
      : null,
    flash: input.flash,
    groups: groupItems(items, reports),
    recent: ((recentRows ?? []) as ReportRow[]).map(
      (r): RecentCountView => ({
        reportId: r.id,
        subject: r.subject,
        receivedAt: r.received_at,
        countDate: r.count_date,
        ...(blocks.get(r.id) ?? { written: 0, inReview: 0 }),
      }),
    ),
  };
}

function groupItems(items: ItemRow[], reports: Map<string, ReportRow>): ReviewGroupView[] {
  const groups = new Map<string, ReviewGroupView>();
  for (const i of items) {
    const report = reports.get(i.report_id);
    if (!report) continue;
    const g = groups.get(i.report_id) ?? { reportId: i.report_id, subject: report.subject, receivedAt: report.received_at, items: [] };
    g.items.push({ id: i.id, kind: i.kind, blocking: i.blocking, showName: i.show_name, message: i.message });
    groups.set(i.report_id, g);
  }
  for (const g of groups.values()) g.items.sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return [...groups.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}
