import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { updateScheduledSendStatus } from "../../db/d2c.ts";
import { mailchimpJson } from "../mailchimp/client.ts";
import { searchListTags, getSegmentById } from "../../mailchimp/client.ts";
import { birdJson } from "../bird/client.ts";
import {
  resolveAutorespContext,
  fireAutorespToMember,
  type AutorespContext,
} from "./fire.ts";
import { parseBirdContacts } from "./bird-contacts.ts";
import { mergeAutorespResultJsonb } from "./helpers.ts";
import type { D2CScheduledSend } from "../types.ts";

/**
 * lib/d2c/autoresp/backfill.ts
 *
 * Resumable "fire for existing tagged members" backfill (Goal 7). Each tick
 * processes ONE chunk for ONE send and advances a cursor stored on
 * `result_jsonb.autoresp_backfill`, so a large audience is drained across many
 * cron ticks without a long-running request. Dedup (d2c_autoresp_fires) makes
 * every chunk idempotent — re-running never double-fires.
 *
 * Email backfill (Mailchimp) pages the tag's segment members by email and fires
 * each through the shared fire path (member-of-1 ephemeral segment). WhatsApp
 * backfill (Bird) reads the list contacts in one page and fires each; Bird
 * pagination is unverified for this PR so a single large page is used (flagged).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export type BackfillStatus = "pending" | "running" | "done" | "failed";

export interface BackfillState {
  status: BackfillStatus;
  provider: "mailchimp" | "bird";
  cursor: number;
  processed: number;
  total: number | null;
  fired: number;
  skipped: number;
  started_at: string;
  updated_at: string;
  error?: string;
}

const MAILCHIMP_CHUNK = 100;
const BIRD_PAGE = 1000;

export function initialBackfillState(
  provider: "mailchimp" | "bird",
  nowIso: string,
): BackfillState {
  return {
    status: "pending",
    provider,
    cursor: 0,
    processed: 0,
    total: null,
    fired: 0,
    skipped: 0,
    started_at: nowIso,
    updated_at: nowIso,
  };
}

export function readBackfillState(resultJsonb: unknown): BackfillState | null {
  if (!resultJsonb || typeof resultJsonb !== "object") return null;
  const raw = (resultJsonb as Record<string, unknown>).autoresp_backfill;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  if (
    status !== "pending" &&
    status !== "running" &&
    status !== "done" &&
    status !== "failed"
  ) {
    return null;
  }
  return {
    status,
    provider: o.provider === "bird" ? "bird" : "mailchimp",
    cursor: typeof o.cursor === "number" ? o.cursor : 0,
    processed: typeof o.processed === "number" ? o.processed : 0,
    total: typeof o.total === "number" ? o.total : null,
    fired: typeof o.fired === "number" ? o.fired : 0,
    skipped: typeof o.skipped === "number" ? o.skipped : 0,
    started_at: typeof o.started_at === "string" ? o.started_at : new Date().toISOString(),
    updated_at: typeof o.updated_at === "string" ? o.updated_at : new Date().toISOString(),
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

async function persist(
  admin: AnySupabaseClient,
  send: D2CScheduledSend,
  state: BackfillState,
): Promise<void> {
  await updateScheduledSendStatus(admin, send.id, {
    resultJsonb: mergeAutorespResultJsonb(send.result_jsonb, { backfill: state }),
  });
}

/**
 * Advance the backfill by one chunk for a send. Returns the updated state. Safe
 * to call every cron tick; no-ops when already done/failed.
 */
export async function runBackfillChunk(
  admin: AnySupabaseClient,
  send: D2CScheduledSend,
): Promise<BackfillState> {
  const prev = readBackfillState(send.result_jsonb);
  const nowIso = new Date().toISOString();
  if (!prev) {
    const seeded = initialBackfillState(send.channel === "email" ? "mailchimp" : "bird", nowIso);
    await persist(admin, send, seeded);
    return seeded;
  }
  if (prev.status === "done" || prev.status === "failed") return prev;

  const ctx = await resolveAutorespContext(admin, send);
  if (!ctx) {
    const failed: BackfillState = { ...prev, status: "failed", error: "no_context", updated_at: nowIso };
    await persist(admin, send, failed);
    return failed;
  }

  try {
    const next =
      ctx.provider === "mailchimp"
        ? await mailchimpChunk(admin, ctx, prev, nowIso)
        : await birdChunk(admin, ctx, prev, nowIso);
    await persist(admin, send, next);
    return next;
  } catch (e) {
    const failed: BackfillState = {
      ...prev,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      updated_at: nowIso,
    };
    await persist(admin, send, failed);
    return failed;
  }
}

interface MembersPage {
  members?: Array<{ email_address?: string }>;
  total_items?: number;
}

async function mailchimpChunk(
  admin: AnySupabaseClient,
  ctx: AutorespContext,
  prev: BackfillState,
  nowIso: string,
): Promise<BackfillState> {
  const creds = ctx.connection.credentials as Record<string, unknown>;
  const apiKey = typeof creds.api_key === "string" ? creds.api_key.trim() : "";
  const serverPrefix = typeof creds.server_prefix === "string" ? creds.server_prefix.trim() : "";
  const listId = ctx.listId;
  const tag = typeof ctx.audience.tag === "string" ? ctx.audience.tag.trim() : "";
  if (!apiKey || !serverPrefix || !listId || !tag) {
    return { ...prev, status: "failed", error: "missing_creds_list_or_tag", updated_at: nowIso };
  }

  // Resolve the tag → segment id once (segment id === tag id in Mailchimp).
  const search = await searchListTags(serverPrefix, listId, apiKey, tag);
  const wanted = tag.toLowerCase();
  const tagMatch = (search.tags ?? []).find((t) => (t.name ?? "").trim().toLowerCase() === wanted);
  if (!tagMatch) {
    return { ...prev, status: "failed", error: `tag_not_found:${tag}`, updated_at: nowIso };
  }
  const seg = await getSegmentById(serverPrefix, listId, tagMatch.id, apiKey);
  const total = seg.member_count ?? 0;

  const page = await mailchimpJson<MembersPage>(
    serverPrefix,
    apiKey,
    `/3.0/lists/${listId}/segments/${tagMatch.id}/members?fields=members.email_address,total_items&count=${MAILCHIMP_CHUNK}&offset=${prev.cursor}`,
    { method: "GET" },
  );
  const emails = (page.members ?? [])
    .map((m) => (m.email_address ?? "").trim().toLowerCase())
    .filter((e) => e.length > 0);

  let fired = prev.fired;
  let skipped = prev.skipped;
  for (const email of emails) {
    const res = await fireAutorespToMember(admin, ctx, email);
    if (res.outcome === "fired") fired += 1;
    else skipped += 1;
  }

  const cursor = prev.cursor + emails.length;
  const processed = prev.processed + emails.length;
  const done = emails.length < MAILCHIMP_CHUNK || cursor >= total;
  return {
    ...prev,
    status: done ? "done" : "running",
    cursor,
    processed,
    total,
    fired,
    skipped,
    updated_at: nowIso,
  };
}

async function birdChunk(
  admin: AnySupabaseClient,
  ctx: AutorespContext,
  prev: BackfillState,
  nowIso: string,
): Promise<BackfillState> {
  const creds = ctx.connection.credentials as Record<string, unknown>;
  const apiKey = typeof creds.api_key === "string" ? creds.api_key.trim() : "";
  const wsId =
    (typeof creds.workspace_id === "string" ? creds.workspace_id.trim() : "") ||
    ctx.connection.external_account_id ||
    "";
  const tag = typeof ctx.audience.tag === "string" ? ctx.audience.tag.trim() : "";
  if (!apiKey || !wsId || !tag) {
    return { ...prev, status: "failed", error: "missing_creds_or_tag", updated_at: nowIso };
  }

  const listEnv = await birdJson<{ results?: Array<{ id?: string; name?: string }>; data?: Array<{ id?: string; name?: string }> }>(
    apiKey,
    `/workspaces/${wsId}/lists?limit=100&include_total=true`,
    { method: "GET" },
  );
  const lists = listEnv.results ?? listEnv.data ?? [];
  const wanted = tag.toLowerCase();
  const match = lists.find((l) => (l.name ?? "").trim().toLowerCase() === wanted);
  if (!match?.id) {
    return { ...prev, status: "failed", error: `list_not_found:${tag}`, updated_at: nowIso };
  }

  const contactsEnv = await birdJson<unknown>(
    apiKey,
    `/workspaces/${wsId}/lists/${match.id}/contacts?limit=${BIRD_PAGE}&include_total=true`,
    { method: "GET" },
  );
  const contacts = parseBirdContacts(contactsEnv);

  let fired = prev.fired;
  let skipped = prev.skipped;
  for (const c of contacts) {
    const res = await fireAutorespToMember(admin, ctx, c.phone);
    if (res.outcome === "fired") fired += 1;
    else skipped += 1;
  }

  // Single-page pass (Bird pagination unverified) — dedup makes re-runs safe.
  return {
    ...prev,
    status: "done",
    cursor: prev.cursor + contacts.length,
    processed: prev.processed + contacts.length,
    total: contacts.length,
    fired,
    skipped,
    updated_at: nowIso,
  };
}
