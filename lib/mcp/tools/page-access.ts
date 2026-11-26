/**
 * lib/mcp/tools/page-access.ts — artists' Page access from the client's
 * Business Manager (M3c, scope mcp:meta, Matas only).
 *
 * Matas, 26 Nov: "do it from the clients business manager so data and access
 * stays with them".
 *
 *   - request_page_access(event, page_ids, tasks = ADVERTISE + ANALYZE,
 *     approval): POST /{client_business_id}/client_pages as Matas
 *     (McpAudienceDeps.requestPage → lib/meta/page-access-request.ts, ledger
 *     page_access_request). Refused, nothing sent: no approval; no Business
 *     Manager linked to the client (or more than one and none owns the
 *     event's ad account); the linked one is Off/Pixel's (944651277948334 or
 *     237857750137825, refused again in the helper); Matas's token lacks pages_manage_metadata;
 *     Matas isn't an admin there; a Page already shared with or already
 *     asked for from that business; more than 5 requests in 24 hours from
 *     that business. A request spends nothing, so no ceiling. Switched off
 *     with M3b until Today lists connector changes.
 *   - pending_access(client) (reads): GET /{client_business_id}/pending_client_pages.
 *
 * Instagram has no documented create: audience_sources gives the manual
 * Business Suite step instead.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { ACCESS } from "../audiences/access.ts";

const { DEFAULT_PAGE_REQUEST_TASKS, OFF_PIXEL_BUSINESS_IDS, PAGE_REQUESTS_PER_DAY, PAGE_REQUEST_TASKS } = ACCESS;
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { liveChangesOn } from "../live/shipped.ts";
import { LIVE_ROWS } from "../live/words.ts";
import { callKey } from "../live/resolve.ts";
import { audienceEvent, clientBusiness, oldestDraft, requestsToday, requireAudienceDeps, type ClientBusiness } from "../audiences/show.ts";
import { AUD_TOOL_WORDS, AUD_WORDS } from "../audiences/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { requireMetaScope } from "./live-read.ts";

const PAGE_ID = /^\d{5,32}$/;
export const MAX_PAGES_PER_CALL = 5;

function businessOrRefuse(result: Awaited<ReturnType<typeof clientBusiness>>, client: string): ClientBusiness {
  if (result.kind === "none") throw new ToolInputError(AUD_WORDS.noBusiness(client), { refused: "no_business" });
  if (result.kind === "many") throw new ToolInputError(AUD_WORDS.manyBusinesses(client, result.n), { refused: "many_businesses", n: result.n });
  if (OFF_PIXEL_BUSINESS_IDS.includes(result.business.id.trim())) throw new ToolInputError(AUD_WORDS.offPixelBusiness, { refused: "off_pixel_business" });
  return result.business;
}

export const requestPageAccessTool: McpTool = {
  name: "request_page_access",
  title: "Ask artists' Pages for access from the client's Business Manager",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: AUD_WORDS.sentFailed("the Page", "?"),
  description: AUD_TOOL_WORDS.requestPageAccess,
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code: its client's Business Manager asks."),
    page_ids: z.array(z.string().max(40)).max(20).describe("1 to 5 Facebook Page ids, from audience_sources."),
    tasks: z.array(z.string().max(40)).max(5).optional().describe("Default ADVERTISE and ANALYZE."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    if (!liveChangesOn(ctx)) throw new ToolInputError(LIVE_ROWS.refusedSwitch, { refused: "switch_off", switch: "m3b_not_shipped" });
    const deps = requireAudienceDeps(ctx);
    const pageIds = Array.isArray(args.page_ids) ? [...new Set((args.page_ids as unknown[]).map((v) => (typeof v === "string" ? v.trim() : String(v ?? ""))))] : [];
    if (pageIds.length === 0 || pageIds.length > MAX_PAGES_PER_CALL || pageIds.some((id) => !PAGE_ID.test(id))) throw new ToolInputError(AUD_WORDS.badPages, { refused: "bad_pages" });
    const tasks = Array.isArray(args.tasks) && args.tasks.length ? [...new Set((args.tasks as unknown[]).map(String))] : [...DEFAULT_PAGE_REQUEST_TASKS];
    if (tasks.some((t) => !(PAGE_REQUEST_TASKS as readonly string[]).includes(t))) throw new ToolInputError(AUD_WORDS.badTasks, { refused: "bad_tasks" });

    const event = await audienceEvent(ctx, args.event);
    if (!event.clientId) throw new ToolInputError(AUD_WORDS.noClient(event.code), { code: event.code, refused: "no_client" });
    const client = event.clientName ?? event.code;
    const business = businessOrRefuse(await clientBusiness(ctx.db, deps, ctx.userId, event.clientId, event.adAccountId), client);
    const base = { code: event.code, business: business.id, pages: pageIds, tasks };

    const perms = await deps.tokenPermissions(ctx.userId).catch(() => undefined);
    if (perms === undefined) throw new ToolInputError(AUD_WORDS.readFailed, { ...base, refused: "meta_unread" });
    if (perms === null) throw new ToolInputError(AUD_WORDS.noToken, { ...base, refused: "no_token" });
    if (!perms.has("pages_manage_metadata")) throw new ToolInputError(AUD_WORDS.noMetadata, { ...base, refused: "no_pages_manage_metadata" });

    let role: string | null;
    let shared: Set<string>;
    let pending: Awaited<ReturnType<typeof deps.pendingPages>>;
    try {
      role = await deps.businessRole(ctx.userId, business.id);
      shared = role === "ADMIN" ? await deps.businessPages(ctx.userId, business.id) : new Set();
      pending = role === "ADMIN" ? await deps.pendingPages(ctx.userId, business.id) : [];
    } catch {
      throw new ToolInputError(AUD_WORDS.readFailed, { ...base, refused: "meta_unread" });
    }
    if (role !== "ADMIN") throw new ToolInputError(AUD_WORDS.notAdmin(business.name), { ...base, refused: "not_admin", role });
    const already = pageIds.filter((id) => shared.has(id));
    if (already.length) throw new ToolInputError(AUD_WORDS.alreadyShared(already, business.name), { ...base, refused: "already_shared", already });
    const waiting = pageIds.filter((id) => pending.some((p) => p.pageId === id));
    if (waiting.length) throw new ToolInputError(AUD_WORDS.alreadyPending(waiting, business.name), { ...base, refused: "already_pending", waiting });

    const sent = await requestsToday(ctx.db, business.id, ctx.now);
    if (sent + pageIds.length > PAGE_REQUESTS_PER_DAY) throw new ToolInputError(AUD_WORDS.overCap(business.name, sent, pageIds.length), { ...base, refused: "daily_cap", sent });
    const draftId = await oldestDraft(ctx.db, event.id);
    if (!draftId) throw new ToolInputError(AUD_WORDS.noDraft(event.code), { ...base, refused: "no_draft" });

    const named = await ctx.db.from("artists").select("name, meta_page_id, meta_page_name").in("meta_page_id", pageIds);
    const nameOf = new Map(((named.error ? [] : named.data ?? []) as { name: string; meta_page_id: string; meta_page_name: string | null }[]).map((r) => [r.meta_page_id, r.meta_page_name?.trim() || r.name]));
    const key = callKey("request_page_access", args, approval);
    const lines: string[] = [];
    let ok = 0;
    const failed: string[] = [];
    for (const pageId of pageIds) {
      try {
        await deps.requestPage({ userId: ctx.userId, businessId: business.id, pageId, tasks, ledger: { draftId, eventId: event.id }, key });
        ok += 1;
        lines.push(AUD_WORDS.sent(nameOf.get(pageId) ?? pageId, pageId, tasks, business.name));
      } catch {
        failed.push(pageId);
        lines.push(AUD_WORDS.sentFailed(nameOf.get(pageId) ?? pageId, pageId));
      }
    }
    if (ok === 0) throw new ToolInputError(lines.join("\n"), { ...base, refused: "meta_failed", failed });
    return {
      data: { message: AUD_WORDS.sentDone(ok, business.name, PAGE_REQUESTS_PER_DAY - sent - ok), lines },
      eventId: event.id,
      clientId: event.clientId,
      summary: { ...base, sent: ok, failed, key },
    };
  },
};

/** A client of the caller's, by id or exact name. */
async function ownClient(ctx: ToolContext, raw: unknown): Promise<{ id: string; name: string }> {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) throw new ToolInputError(AUD_WORDS.unknownClient("?"), { refused: "bad_client" });
  const q = /^[0-9a-f-]{36}$/i.test(v) ? ctx.db.from("clients").select("id, name, user_id").eq("id", v) : ctx.db.from("clients").select("id, name, user_id").ilike("name", v);
  const res = await q;
  const rows = ((res.error ? [] : res.data ?? []) as { id: string; name: string; user_id: string | null }[]).filter((r) => r.user_id === ctx.userId);
  if (rows.length !== 1) throw new ToolInputError(AUD_WORDS.unknownClient(v), { refused: "unknown_client", n: rows.length });
  return { id: rows[0]!.id, name: rows[0]!.name };
}

export const pendingAccessTool: McpTool = {
  name: "pending_access",
  title: "Page access requests still waiting",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  failedText: AUD_WORDS.readFailed,
  description: AUD_TOOL_WORDS.pendingAccess,
  inputSchema: { client: z.string().min(1).max(200).describe("The client, by name or id.") },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const deps = requireAudienceDeps(ctx);
    const client = await ownClient(ctx, args.client);
    const business = businessOrRefuse(await clientBusiness(ctx.db, deps, ctx.userId, client.id, null), client.name);
    let rows: Awaited<ReturnType<typeof deps.pendingPages>>;
    try {
      rows = await deps.pendingPages(ctx.userId, business.id);
    } catch {
      throw new ToolInputError(AUD_WORDS.readFailed, { business: business.id, refused: "meta_unread" });
    }
    return {
      data: { message: rows.length ? AUD_WORDS.pendingLine(business.name, rows.length) : AUD_WORDS.pendingNone(business.name), businessManager: business, requests: rows },
      clientId: client.id,
      summary: { business: business.id, pending: rows.length },
    };
  },
};
