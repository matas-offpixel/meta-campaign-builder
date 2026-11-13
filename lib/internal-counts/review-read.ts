/**
 * lib/internal-counts/review-read.ts
 *
 * Reads the review list for the signed-in operator (RLS: own rows only)
 * and shapes it with R1's words. Internal only (D11): nothing under the
 * share or client-admin routes imports this (guarded by a test).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { pageAll } from "../db/paged-read.ts";
import { PROPOSED_COUNT_ALIASES, UMBRELLA_EVENT_CODES } from "./aliases.ts";
import { checkedItemView, dayMonth, openItemView, type ItemFacts } from "./review-words.ts";
import type { EventOption, InternalCountsView } from "./view-types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

const CHECKED_SHOWN = 30;

const FLASH: Record<string, string> = {
  "upload=no_file": "Choose a PDF to upload.",
  "upload=too_large": "That PDF is over 10 MB.",
  "upload=not_pdf": "That file isn't a PDF.",
  "upload=already_read": "That PDF was uploaded before. Nothing new was written.",
  "upload=duplicate": "That sheet was already read from an email. Nothing new was written.",
  "upload=unreadable": "That PDF couldn't be read as an Internal Counts sheet. It's on the list below.",
  "action=incomplete": "Choose an event, or type a figure, first.",
  "action=failed": "That didn't go through. Nothing was changed.",
};

export function flashFor(params: Record<string, string | undefined>): string | null {
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    const text = FLASH[`${k}=${v}`];
    if (text) return text;
  }
  if (params.upload === "processed") {
    return `Uploaded. ${params.written ?? 0} shows stored, ${params.held ?? 0} held.`;
  }
  return null;
}

interface ItemRow {
  id: string;
  report_id: string;
  block_id: string | null;
  kind: string;
  show_name: string | null;
  detail: Record<string, unknown>;
  resolution: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface ReportRow {
  id: string;
  subject: string;
  sender: string | null;
  received_at: string;
  sheet_date: string | null;
  subject_date: string | null;
  gmail_message_id: string;
  pdf_filename: string | null;
}

interface EventRow {
  id: string;
  event_code: string | null;
  name: string | null;
  event_date: string | null;
  client_id: string | null;
}

async function readItems(sb: Db, open: boolean): Promise<ItemRow[]> {
  const cols = "id,report_id,block_id,kind,show_name,detail,resolution,resolved_by_name,resolved_at,created_at";
  if (open) {
    return pageAll<ItemRow>(
      (from, to) =>
        sb
          .from("internal_count_review_items")
          .select(cols)
          .is("resolved_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      ["id"],
      "internal_count_review_items",
    );
  }
  const { data, error } = await sb
    .from("internal_count_review_items")
    .select(cols)
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(CHECKED_SHOWN);
  if (error) throw new Error(`internal_count_review_items read failed: ${error.message}`);
  return (data ?? []) as ItemRow[];
}

/** Events to choose from: the clients the counts are about (matched names and the 12 Nov proposals), from 120 days back. */
async function eventOptions(sb: Db, blockEventIds: string[]): Promise<{ options: EventOption[]; byId: Map<string, EventRow>; byCode: Map<string, EventRow> }> {
  const seeds = await sb
    .from("events")
    .select("id,event_code,name,event_date,client_id")
    .or(
      [
        `event_code.in.(${Object.values(PROPOSED_COUNT_ALIASES).map((c) => `"${c}"`).join(",")})`,
        ...(blockEventIds.length ? [`id.in.(${blockEventIds.join(",")})`] : []),
      ].join(","),
    );
  const clientIds = [...new Set(((seeds.data ?? []) as EventRow[]).map((e) => e.client_id).filter((c): c is string => !!c))];
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const events = clientIds.length
    ? await pageAll<EventRow>(
        (from, to) =>
          sb
            .from("events")
            .select("id,event_code,name,event_date,client_id")
            .in("client_id", clientIds)
            .gte("event_date", since)
            .order("event_date", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        ["id"],
        "events",
      )
    : [];
  const all = [...events, ...((seeds.data ?? []) as EventRow[])];
  const byId = new Map(all.map((e) => [e.id, e]));
  const byCode = new Map(all.filter((e) => e.event_code).map((e) => [e.event_code!, e]));
  const options = events
    .filter((e) => !UMBRELLA_EVENT_CODES.has(e.event_code ?? ""))
    .map((e) => ({ id: e.id, label: `${e.name ?? e.event_code} · ${e.event_date ? dayMonth(e.event_date) : "no date"}` }));
  return { options, byId, byCode };
}

export async function readReviewList(
  sb: Db,
  input: { gmail: InternalCountsView["gmail"]; mailbox: string | null; flash: string | null },
): Promise<InternalCountsView> {
  const inbox = input.mailbox;
  const open = await readItems(sb, true);
  const checked = await readItems(sb, false);
  const items = [...open, ...checked];
  const reportIds = [...new Set(items.map((i) => i.report_id))];
  const blockIds = [...new Set(items.map((i) => i.block_id).filter((b): b is string => !!b))];
  const reports = new Map<string, ReportRow>();
  const blockEvent = new Map<string, string | null>();
  if (reportIds.length) {
    const { data } = await sb
      .from("internal_count_reports")
      .select("id,subject,sender,received_at,sheet_date,subject_date,gmail_message_id,pdf_filename")
      .in("id", reportIds);
    for (const r of (data ?? []) as ReportRow[]) reports.set(r.id, r);
  }
  if (blockIds.length) {
    const { data } = await sb.from("internal_count_blocks").select("id,event_id").in("id", blockIds);
    for (const b of (data ?? []) as Array<{ id: string; event_id: string | null }>) blockEvent.set(b.id, b.event_id);
  }
  const { options, byId, byCode } = await eventOptions(
    sb,
    [...blockEvent.values()].filter((e): e is string => !!e),
  );
  const facts = (i: ItemRow): ItemFacts | null => {
    const r = reports.get(i.report_id);
    if (!r) return null;
    const eventId = i.block_id ? blockEvent.get(i.block_id) : null;
    const closest = i.detail.closest as { eventCode: string } | null | undefined;
    const detail = closest ? { ...i.detail, closest: { ...closest, id: byCode.get(closest.eventCode)?.id } } : i.detail;
    return {
      id: i.id,
      kind: i.kind,
      showName: i.show_name,
      eventName: eventId ? (byId.get(eventId)?.name ?? null) : null,
      detail,
      report: {
        subject: r.subject,
        sender: r.sender,
        receivedAt: r.received_at,
        sheetDate: r.sheet_date,
        subjectDate: r.subject_date,
        gmailMessageId: r.gmail_message_id,
        pdfFilename: r.pdf_filename,
      },
      inbox,
    };
  };
  return {
    inbox,
    gmail: input.gmail,
    flash: input.flash,
    open: open.flatMap((i) => {
      const f = facts(i);
      return f ? [openItemView(f)] : [];
    }),
    checked: checked.flatMap((i) => {
      const f = facts(i);
      return f && i.resolved_at ? [checkedItemView(f, i.resolved_by_name, i.resolved_at, i.resolution ?? "")] : [];
    }),
    events: options,
  };
}
