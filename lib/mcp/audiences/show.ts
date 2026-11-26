/**
 * lib/mcp/audiences/show.ts — the M3c tools' shared reads (database only).
 *
 *   - audienceEvent: the event by code, the caller's own (events.user_id), with
 *     its ad account (events.meta_ad_account_id, else its venue's, the
 *     customer-list rule: never the client's or a draft's), its client and
 *     its links.
 *   - clientBusiness: the client's Business Manager (client_business_managers,
 *     the BM tool's connections, linked by client_id or, since 276, a
 *     client_business_manager_links row: one BM can serve several clients). One linked → it; more
 *     than one → the one that owns the event's ad account, else ambiguous.
 *   - oldestDraft: the event's oldest draft, the write ledger's draft for a
 *     write that isn't a campaign's (the customer-list sync's precedent).
 *   - requestsToday: the business's page_access_request rows in the last 24
 *     hours (rolling, not a London day), counted over every event of every
 *     client linked to it; a failed request isn't one Meta received.
 *
 * Relative imports only (node:test).
 */
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { businessClientLinks } from "../../bm/client-links.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { ToolInputError, type Db, type ToolContext } from "../tool-types.ts";
import { clientNameOf, loadEventByCode, normaliseCode } from "../tools/shared.ts";
import type { McpAudienceDeps } from "./types.ts";
import { AUD_WORDS } from "./words.ts";

export interface AudienceEvent {
  id: string;
  code: string;
  name: string | null;
  clientId: string | null;
  clientName: string | null;
  adAccountId: string | null;
  tag: string | null;
  ticketUrl: string | null;
  signupUrl: string | null;
  campaignIds: string[];
}

export function requireAudienceDeps(ctx: ToolContext): McpAudienceDeps {
  if (!ctx.audiences) throw new ToolInputError(AUD_WORDS.readFailed, { refused: "audiences_unwired" });
  return ctx.audiences;
}

export async function audienceEvent(ctx: ToolContext, codeArg: unknown): Promise<AudienceEvent> {
  let code: string;
  try {
    code = normaliseCode(codeArg);
  } catch {
    throw new ToolInputError(EVENT_WORDS.refusedCode, { refused: "bad_code" });
  }
  const found = await loadEventByCode(ctx.db, code);
  if (!found) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
  const row = await ctx.db
    .from("events")
    .select("id, user_id, meta_ad_account_id, venue_id, mailchimp_tag, ticket_url, signup_url, meta_campaign_id")
    .eq("id", found.primary.id)
    .maybeSingle();
  if (row.error || !row.data) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
  const e = row.data as { user_id: string | null; meta_ad_account_id: string | null; venue_id: string | null; mailchimp_tag: string | null; ticket_url: string | null; signup_url: string | null; meta_campaign_id: string | null };
  if (e.user_id !== ctx.userId) throw new ToolInputError(EVENT_WORDS.refusedOtherAccount, { code, refused: "not_owner" });
  let account = normalizeAdAccountId(e.meta_ad_account_id);
  if (!account && e.venue_id) {
    const venue = await ctx.db.from("venues").select("meta_ad_account_id").eq("id", e.venue_id).maybeSingle();
    account = normalizeAdAccountId((venue.data as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id ?? null);
  }
  return {
    id: found.primary.id,
    code: found.primary.event_code ?? code,
    name: found.primary.name,
    clientId: found.primary.client_id,
    clientName: clientNameOf(found.primary),
    adAccountId: account,
    tag: e.mailchimp_tag?.trim() || null,
    ticketUrl: e.ticket_url,
    signupUrl: e.signup_url,
    campaignIds: (e.meta_campaign_id ?? "").replace(/ /g, "").split(",").filter(Boolean),
  };
}

export interface ClientBusiness {
  id: string;
  name: string;
}

export type ClientBusinessResult = { kind: "one"; business: ClientBusiness } | { kind: "none" } | { kind: "many"; n: number };

export async function clientBusiness(db: Db, deps: McpAudienceDeps, userId: string, clientId: string, adAccountId: string | null): Promise<ClientBusinessResult> {
  const businessIds = [...new Set((await businessClientLinks(db, { clientIds: [clientId] })).map((l) => l.business_id))];
  if (businessIds.length === 0) return { kind: "none" };
  const res = await db.from("client_business_managers").select("business_id, business_name").in("business_id", businessIds);
  if (res.error) throw new Error(`client_business_managers: ${res.error.message}`);
  const rows = ((res.data ?? []) as { business_id: string; business_name: string | null }[]).map((r) => ({ id: String(r.business_id), name: r.business_name?.trim() || String(r.business_id) }));
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "one", business: rows[0]! };
  const owner = adAccountId ? await deps.accountBusiness(userId, adAccountId).catch(() => null) : null;
  const hit = owner ? rows.find((r) => r.id === owner.id) : undefined;
  return hit ? { kind: "one", business: hit } : { kind: "many", n: rows.length };
}

export async function oldestDraft(db: Db, eventId: string): Promise<string | null> {
  const res = await db.from("campaign_drafts").select("id, created_at").eq("event_id", eventId).order("created_at", { ascending: true }).limit(1);
  if (res.error) throw new Error(`campaign_drafts: ${res.error.message}`);
  return ((res.data ?? []) as { id: string }[])[0]?.id ?? null;
}

/**
 * The business's access requests Meta received in the 24 hours to `now`,
 * counted per business: every event of every client linked to it (276: one
 * BM can serve several clients). A client linked to two BMs counts against
 * both, so the cap can only bite early, never late.
 */
export async function requestsToday(db: Db, businessId: string, now: Date): Promise<number> {
  const clientIds = [...new Set((await businessClientLinks(db, { businessIds: [businessId] })).map((l) => l.client_id))];
  if (clientIds.length === 0) return 0;
  const events = await db.from("events").select("id").in("client_id", clientIds);
  if (events.error) throw new Error(`events: ${events.error.message}`);
  const eventIds = ((events.data ?? []) as { id: string }[]).map((r) => r.id);
  if (eventIds.length === 0) return 0;
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  let n = 0;
  for (let i = 0; i < eventIds.length; i += 200) {
    const rows = await db
      .from("meta_write_idempotency")
      .select("id, op_status")
      .eq("op_kind", "page_access_request")
      .gte("created_at", since)
      .in("event_id", eventIds.slice(i, i + 200));
    if (rows.error) throw new Error(`meta_write_idempotency: ${rows.error.message}`);
    n += ((rows.data ?? []) as { op_status: string }[]).filter((r) => r.op_status !== "failed").length;
  }
  return n;
}
