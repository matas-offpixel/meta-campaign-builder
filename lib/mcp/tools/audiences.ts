/**
 * lib/mcp/tools/audiences.ts — M3c's audience tools (scope mcp:meta, Matas only).
 *
 *   - list_audiences (reads): the custom audiences on an event's ad account,
 *     or on one ad account an event of his runs on: Meta's own and the app's
 *     (meta_custom_audiences), each with its name, subtype, retention, size
 *     band and delivery status.
 *   - audience_sources (reads): lib/mcp/audiences/sources.ts.
 *   - create_audiences (Matas's chat yes): up to 30 audiences through the
 *     Audience Builder's create (McpAudienceDeps.createAudience:
 *     createAudienceDraft then createMetaCustomAudience, behind
 *     OFFPIXEL_META_AUDIENCE_WRITES_ENABLED), each a meta_custom_audiences row
 *     with event_id and client_id. Idempotent twice over: an app row on the
 *     account with the same rule is used as it is (no Meta call), and the
 *     builder reuses an audience whose rule is already on the account
 *     (reuseOrCreateCustomAudience). Every spec is checked first; one that
 *     can't be built refuses the call and nothing is made.
 *
 * Creating an audience spends nothing, so there's no ceiling check. Like
 * M3b, create_audiences is switched off until Today lists connector changes
 * (lib/mcp/live/shipped.ts); the reads aren't.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { liveChangesOn } from "../live/shipped.ts";
import { LIVE_ROWS } from "../live/words.ts";
import { audienceEvent, clientBusiness, requireAudienceDeps, type AudienceEvent } from "../audiences/show.ts";
import { readSources } from "../audiences/sources.ts";
import { MAX_SPECS, SPEC_KINDS, buildSpec, findOnAccount, ruleKey } from "../audiences/specs.ts";
import { AUD_TOOL_WORDS, AUD_WORDS } from "../audiences/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { requireMetaScope } from "./live-read.ts";

async function eventWithAccount(ctx: ToolContext, code: unknown): Promise<AudienceEvent & { adAccountId: string }> {
  const event = await audienceEvent(ctx, code);
  if (!event.adAccountId) throw new ToolInputError(AUD_WORDS.noAccount(event.code), { code: event.code, refused: "no_ad_account" });
  return event as AudienceEvent & { adAccountId: string };
}

/** An ad account one of the caller's events runs on (the event's own, else its venue's). */
async function ownAccount(ctx: ToolContext, raw: unknown): Promise<string> {
  const account = typeof raw === "string" && /^(act_)?\d{5,32}$/.test(raw.trim()) ? normalizeAdAccountId(raw.trim()) : null;
  if (!account) throw new ToolInputError(AUD_WORDS.accountFormat, { refused: "bad_account" });
  const digits = account.replace(/^act_/, "");
  const rows = await ctx.db.from("events").select("id").eq("user_id", ctx.userId).in("meta_ad_account_id", [digits, account]).limit(1);
  if (rows.error || ((rows.data ?? []) as unknown[]).length === 0) throw new ToolInputError(AUD_WORDS.accountNotYours(account), { refused: "account_not_yours" });
  return account;
}

export const listAudiencesTool: McpTool = {
  name: "list_audiences",
  title: "List an ad account's audiences",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  failedText: AUD_WORDS.readFailed,
  description: AUD_TOOL_WORDS.listAudiences,
  inputSchema: {
    event: z.string().min(2).max(40).optional().describe("The event code; its ad account is read."),
    ad_account: z.string().min(5).max(40).optional().describe("Or an ad account (act_…) one of your events runs on."),
  },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const deps = requireAudienceDeps(ctx);
    let account: string;
    let eventId: string | null = null;
    let clientId: string | null = null;
    if (typeof args.event === "string" && args.event.trim()) {
      const event = await eventWithAccount(ctx, args.event);
      account = event.adAccountId;
      eventId = event.id;
      clientId = event.clientId;
    } else account = await ownAccount(ctx, args.ad_account);
    let read: Awaited<ReturnType<typeof deps.listAudiences>>;
    try {
      read = await deps.listAudiences(ctx.userId, account);
    } catch {
      throw new ToolInputError(AUD_WORDS.readFailed, { refused: "meta_unread", account });
    }
    const appRows = await ctx.db.from("meta_custom_audiences").select("id, meta_audience_id, event_id, status").in("meta_ad_account_id", [account, account.replace(/^act_/, "")]);
    const byMeta = new Map(((appRows.error ? [] : appRows.data ?? []) as { id: string; meta_audience_id: string | null; event_id: string | null; status: string }[]).filter((r) => r.meta_audience_id).map((r) => [r.meta_audience_id as string, r]));
    const audiences = read.audiences.map((a) => ({
      id: a.id,
      name: a.name,
      subtype: a.subtype,
      retention: AUD_WORDS.retention(a.retentionDays),
      size: AUD_WORDS.size(a.lower, a.upper),
      delivery: a.delivery,
      madeInOffPixel: byMeta.has(a.id),
    }));
    const app = audiences.filter((a) => a.madeInOffPixel).length;
    return {
      data: { message: AUD_WORDS.listed(account, audiences.length, app), ...(read.complete ? {} : { partial: AUD_WORDS.partial(audiences.length) }), adAccount: account, audiences },
      eventId,
      clientId,
      summary: { account, audiences: audiences.length, app, complete: read.complete, metaGets: read.metaGets },
    };
  },
};

export const audienceSourcesTool: McpTool = {
  name: "audience_sources",
  title: "What a show's audiences can be built from",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  failedText: AUD_WORDS.readFailed,
  description: AUD_TOOL_WORDS.audienceSources,
  inputSchema: { event: z.string().min(2).max(40).describe("The event code.") },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const deps = requireAudienceDeps(ctx);
    const event = await eventWithAccount(ctx, args.event);
    const business = event.clientId ? await clientBusiness(ctx.db, deps, ctx.userId, event.clientId, event.adAccountId) : ({ kind: "none" } as const);
    let read: Awaited<ReturnType<typeof readSources>>;
    try {
      read = await readSources(ctx, deps, event, business);
    } catch (e) {
      if (e instanceof ToolInputError) throw e;
      throw new ToolInputError(AUD_WORDS.readFailed, { code: event.code, refused: "meta_unread" });
    }
    const { metaGets, ...rest } = read;
    const { specContext: _unused, ...answer } = rest;
    void _unused;
    return {
      data: {
        code: event.code,
        adAccount: event.adAccountId,
        clientBusinessManager: business.kind === "one" ? { id: business.business.id, name: business.business.name } : null,
        ...answer,
      },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, pages: read.pages.length, instagram: read.instagram.length, pixel: read.pixel?.id ?? null, links: read.links.length, metaGets },
    };
  },
};

const specSchema = z
  .object({
    kind: z.enum(SPEC_KINDS).describe("What the audience is."),
    retention_days: z.number().int().optional().describe("Days back (pixel up to 180, the rest up to 365). Not for followers: they're all time."),
    url_contains: z.array(z.string().max(500)).max(20).optional().describe("pixel_visitors and pixel_event: link fragments, any of which a page's URL contains (from audience_sources' links)."),
    event: z.enum(["InitiateCheckout", "CompleteRegistration", "Purchase"]).optional().describe("pixel_event: the pixel event."),
    page_id: z.string().max(40).optional().describe("page_engagers, page_followers, video_viewers: a Facebook Page id from audience_sources."),
    ig_id: z.string().max(40).optional().describe("ig_engagers, ig_followers: an Instagram account id from audience_sources."),
    threshold: z.number().int().optional().describe("video_viewers: 75 or 95 (% watched)."),
    video_ids: z.array(z.string().max(40)).max(1000).optional().describe("video_viewers: the videos; default the show's ad videos from that Page."),
    origin_audience_id: z.string().max(40).optional().describe("lookalike: a custom audience on the account (from list_audiences); the lookalike is GB at 1 %."),
  })
  .passthrough();

export const createAudiencesTool: McpTool = {
  name: "create_audiences",
  title: "Make audiences on a show's ad account",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: AUD_WORDS.failedOne("the audiences"),
  description: AUD_TOOL_WORDS.createAudiences,
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    specs: z.array(specSchema).max(100).describe("1 to 30 audiences."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    requireMetaApproval(ctx, args);
    if (!liveChangesOn(ctx)) throw new ToolInputError(LIVE_ROWS.refusedSwitch, { refused: "switch_off", switch: "m3b_not_shipped" });
    const deps = requireAudienceDeps(ctx);
    if (!deps.audienceWrites()) throw new ToolInputError(LIVE_ROWS.refusedSwitch, { refused: "switch_off", switch: "OFFPIXEL_META_AUDIENCE_WRITES_ENABLED" });
    const specs = Array.isArray(args.specs) ? (args.specs as Record<string, unknown>[]) : [];
    if (specs.length === 0 || specs.length > MAX_SPECS) throw new ToolInputError(AUD_WORDS.noSpecs, { refused: "bad_specs", n: specs.length });
    const event = await eventWithAccount(ctx, args.event);
    if (!event.clientId) throw new ToolInputError(AUD_WORDS.noClient(event.code), { code: event.code, refused: "no_client" });
    const business = await clientBusiness(ctx.db, deps, ctx.userId, event.clientId, event.adAccountId);
    // The show's ad videos are read only when a video spec gives no video_ids (the walk is the slow read).
    const needVideos = specs.some((x) => x && x.kind === "video_viewers" && !(Array.isArray(x.video_ids) && x.video_ids.length));
    let read: Awaited<ReturnType<typeof readSources>>;
    try {
      read = await readSources(ctx, deps, event, business, { videos: needVideos });
    } catch {
      throw new ToolInputError(AUD_WORDS.readFailed, { code: event.code, refused: "meta_unread" });
    }
    const sc = read.specContext!;

    // Every spec checked before anything is made.
    const built = specs.map((s, i) => ({ i, r: buildSpec(s, sc) }));
    const bad = built.filter((b) => !b.r.ok);
    if (bad.length) {
      const lines = bad.map((b) => AUD_WORDS.badSpec(b.i + 1, (b.r as { why: string }).why));
      throw new ToolInputError([AUD_WORDS.refusedSpecs(bad.length), ...lines].join("\n"), { code: event.code, refused: "bad_specs", specs: bad.map((b) => b.i + 1) }, { refused: lines });
    }

    // App rows on the account with the same rule: used as they are.
    const have = await ctx.db
      .from("meta_custom_audiences")
      .select("id, name, audience_subtype, retention_days, source_id, source_meta, meta_audience_id, status")
      .in("meta_ad_account_id", [event.adAccountId, event.adAccountId.replace(/^act_/, "")])
      .eq("status", "ready");
    const byRule = new Map<string, { name: string; metaId: string }>();
    for (const r of (have.error ? [] : have.data ?? []) as { name: string; audience_subtype: string; retention_days: number; source_id: string; source_meta: Record<string, unknown>; meta_audience_id: string | null }[]) {
      if (!r.meta_audience_id) continue;
      const key = ruleKey({ audienceSubtype: r.audience_subtype as never, retentionDays: r.retention_days, sourceId: r.source_id, sourceMeta: r.source_meta, name: r.name });
      if (key && !byRule.has(key)) byRule.set(key, { name: r.name, metaId: r.meta_audience_id });
    }

    const lines: string[] = [];
    const results: { name: string; id: string | null; state: "made" | "reused" | "failed" }[] = [];
    const seen = new Map<string, { name: string; id: string | null }>();
    for (const { r } of built) {
      const insert = (r as { ok: true; insert: Parameters<typeof deps.createAudience>[0]["insert"] }).insert;
      const key = ruleKey(insert);
      const known = (key && byRule.get(key)) || null;
      if (known) {
        results.push({ name: known.name, id: known.metaId, state: "reused" });
        lines.push(AUD_WORDS.reused(known.name, known.metaId));
        continue;
      }
      if (key && seen.has(key)) continue; // the same rule twice in one call: made once.
      const onMeta = findOnAccount(insert, sc.listed);
      if (onMeta) {
        results.push({ name: onMeta.name ?? insert.name, id: onMeta.id, state: "reused" });
        lines.push(AUD_WORDS.reused(onMeta.name ?? insert.name, onMeta.id));
        if (key) seen.set(key, { name: onMeta.name ?? insert.name, id: onMeta.id });
        continue;
      }
      try {
        const made = await deps.createAudience({ userId: ctx.userId, insert });
        if (made.failed || !made.metaAudienceId) {
          results.push({ name: insert.name, id: null, state: "failed" });
          lines.push(AUD_WORDS.failedOne(insert.name));
        } else {
          results.push({ name: insert.name, id: made.metaAudienceId, state: made.reused ? "reused" : "made" });
          lines.push(made.reused ? AUD_WORDS.reused(insert.name, made.metaAudienceId) : AUD_WORDS.made(insert.name, made.metaAudienceId));
        }
      } catch {
        results.push({ name: insert.name, id: null, state: "failed" });
        lines.push(AUD_WORDS.failedOne(insert.name));
      }
      if (key) seen.set(key, { name: insert.name, id: results[results.length - 1]!.id });
    }
    const n = (s: string) => results.filter((x) => x.state === s).length;
    const madeIds = results.filter((x) => x.state === "made").map((x) => x.id).filter((v): v is string => Boolean(v));
    // Nothing made and Meta refused some: Today's "Failed · Meta didn’t take it, so nothing changed".
    if (madeIds.length === 0 && n("failed") > 0) throw new ToolInputError([AUD_WORDS.doneLine(0, n("reused"), n("failed")), ...lines].join("\n"), { code: event.code, account: event.adAccountId, refused: "meta_failed", asked: specs.length, reused: n("reused"), failed: n("failed") });
    return {
      data: { message: AUD_WORDS.doneLine(n("made"), n("reused"), n("failed")), lines, audiences: results },
      eventId: event.id,
      clientId: event.clientId,
      // Today's row (FC1, no Undo): what was asked, the ids made, and a no-op when everything was already there.
      summary: { code: event.code, account: event.adAccountId, asked: specs.length, made: n("made"), reused: n("reused"), failed: n("failed"), madeIds, ids: results.map((x) => x.id).filter(Boolean), ...(madeIds.length === 0 ? { noop: "all_reused" } : {}) },
    };
  },
};
