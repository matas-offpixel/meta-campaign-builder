/**
 * lib/mcp/tools/retargeting.ts — plan_retargeting and create_retargeting
 * (M3c, scope mcp:meta, Matas only), from the retargeting funnel
 * (docs/design-record/2026-11-26-retargeting-funnel.html, RF1–RF9).
 *
 * plan_retargeting(event | events[] | "live"): read only. The Retargeting
 * campaign's 08:00 read as a dry run (McpRetargetingDeps.read: Meta GETs and
 * database reads, nothing written), told as RF9's lines: per show its
 * stretch, share, £ a day per tier, where the money comes from, audiences
 * made / to make / missing access, then prospecting short, the accounts that
 * need access and the next stretch as a scheduled change. "live" is every
 * on-sale show of a non-archived client and opens with the counts; a show
 * that can't be built is one skipped line with its reason.
 *
 * create_show_campaigns(event, mode, approval) (was create_retargeting; Matas, 26 Nov): Matas's chat yes first, then
 * the show's plan from the same read, then the funnel's create path
 * (lib/retargeting/funnel-apply.ts: the Purchase create path with budgets
 * on the ad sets and its gates, every write on meta_write_idempotency keyed
 * on the event). paused makes everything paused and moves nothing; live is
 * spend-starting: the show's ceiling is checked, the money moves from
 * prospecting, it's switched on and the stretch steps are scheduled. A
 * paused build asked for again as live only moves the money, switches it on
 * and schedules the steps; asked again as paused, it does nothing.
 *
 * Claude gets names, counts, ids and links only. Relative imports only (node:test).
 */
import { z } from "zod";
import type { FunnelBuild, FunnelProgress } from "../../retargeting/funnel-apply.ts";
import { claudePlanLines, doneLine, isPresale, planHead, similarSkipLine, skipLine, skipReason, type SkipReason } from "../../retargeting/funnel-plan.ts";
import { funnelSourcesOf, genreWords } from "../../retargeting/funnel-view.ts";
import { adviseExisting, foldFirstLine, geoNotReadLine, untickLine } from "../../retargeting/show-campaigns.ts";
import type { RetargetingRecord } from "../../retargeting/runner.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import type { McpRetargetingDeps } from "../retargeting/types.ts";
import { normaliseCode } from "./shared.ts";
import { requireMetaScope } from "./live-read.ts";

const MAX_CODES = 60;

/** PENDING DESIGN: what Claude is told that no row in the 26 Nov list covers. */
export const RT_CLAUDE_WORDS = {
  notWired: "Refused: retargeting isn't wired on this deployment. Nothing was changed.",
  readFailed: "Refused: the shows couldn't be read just now. Nothing was changed.",
  notOnSale: "it isn't on sale",
  refusedSkip: (line: string) => `Refused: ${line} Nothing was changed.`,
  held: (why: string) => `Refused: ${why} Nothing was changed.`,
  alreadyLive: (code: string) => `${code} · Retargeting is already live. Nothing was changed.`,
  alreadyPaused: (code: string) => `${code} · Retargeting is already made and paused. Nothing was changed.`,
  failed: (reason: string) => `${reason.replace(/\.$/, "")}. Nothing was changed.`,
  failedPartly: (reason: string) => `${reason.replace(/\.$/, "")}. What's made so far is paused; ask again to carry on.`,
  stepsNotScheduled: "It's live, but the stretch steps couldn't be scheduled; ask again to schedule them.",
  tooMany: `Refused: give at most ${MAX_CODES} event codes, or "live". Nothing was changed.`,
  metaRefused: "Meta didn't take this.",
} as const;

/** RF9's skip for a show the read planned; archived is found before the read. */
export function recordSkip(record: RetargetingRecord): SkipReason | null {
  const input = record.input!;
  return skipReason({
    archived: false,
    built: record.plan.state === "running",
    runDay: input.runDay,
    showDay: input.eventDate,
    pixelId: input.read?.pixel?.id ?? null,
    hasTicketLink: input.sources.links.some((link) => link.kind === "ticket"),
    hasSignupLink: input.sources.links.some((link) => link.kind === "landing"),
    presale: isPresale(input),
    plan: record.plan.funnel ?? null,
  });
}

function requireRetargeting(ctx: ToolContext): McpRetargetingDeps {
  if (!ctx.retargeting) throw new ToolInputError(RT_CLAUDE_WORDS.notWired, { refused: "retargeting_unwired" });
  return ctx.retargeting;
}

function codesOf(value: unknown): string[] | null {
  if (value === "live") return null;
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || list.length > MAX_CODES) throw new ToolInputError(RT_CLAUDE_WORDS.tooMany, { refused: "bad_codes" });
  try {
    return [...new Set(list.map((code) => normaliseCode(code)))];
  } catch {
    throw new ToolInputError(EVENT_WORDS.refusedCode, { refused: "bad_code" });
  }
}

/** Explicit codes whose client is archived (the read leaves them out, as every cron does). */
async function archivedCodes(ctx: ToolContext, codes: readonly string[]): Promise<Set<string>> {
  const res = await ctx.db.from("events").select("event_code, client:clients(status)").in("event_code", [...codes]);
  if (res.error) return new Set();
  const rows = (res.data ?? []) as { event_code: string | null; client: { status?: string | null } | { status?: string | null }[] | null }[];
  const status = (row: (typeof rows)[number]) => (Array.isArray(row.client) ? row.client[0]?.status : row.client?.status) ?? null;
  return new Set(rows.filter((row) => row.event_code && status(row) === "archived").map((row) => row.event_code!.toUpperCase()));
}

type ShowLines = { code: string; skipped: SkipReason | "not_on_sale" | null; lines: string[] };

/** TC8: the plan's lines for one show — both campaigns, matched Pages, access, Similar skipped, presale sign-ups, existing prospecting, the next stretch. */
function linesFor(record: RetargetingRecord): ShowLines {
  const code = record.eventCode ?? record.eventId;
  const input = record.input;
  if (!input) return { code, skipped: "not_on_sale", lines: [`${code} · skipped: ${RT_CLAUDE_WORDS.notOnSale}.`] };
  const skip = recordSkip(record);
  if (skip) return { code, skipped: skip, lines: [skipLine(code, skip)] };
  const plan = record.plan.funnel!;
  const wider = record.plan.wider;
  if (!wider) return { code, skipped: "no_budget", lines: [skipLine(code, "no_budget")] };
  const presale = isPresale(input);
  const signups = input.signups && input.signups.state === "on" ? input.signups.count : null;
  // TC8: each existing prospecting campaign as keep, pause or fold into Wider (pausing and folding only after Matas says yes).
  const existing = adviseExisting(input.campaigns ?? []).map((row) => ({ name: row.name, action: row.advice }));
  return {
    code,
    skipped: null,
    lines: claudePlanLines(plan, funnelSourcesOf(input.sources, input.accounts), { wider, pages: input.matchedPages ?? null, genre: genreWords(input.genreFamily ?? null), presale, presaleSignups: presale ? signups : null, existing }),
  };
}

/** PENDING DESIGN: "Use as a suggestion" still on after create. */
export function suggestionOnLine(adSetName: string): string {
  return `Turn off 'Use as a suggestion' in Ads Manager for ${adSetName}.`;
}

export const planRetargetingTool: McpTool = {
  name: "plan_retargeting",
  title: "Plan each show's Retargeting campaign",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  // PENDING DESIGN: the description.
  description: [
    'Read only. For one event code, a list of codes, or "live" (every on-sale show of a non-archived client): what each show\'s "{code} · Retargeting" campaign would be today, as the funnel rules it.',
    "Per show: the stretch, its share of the show's daily spend and £ a day per tier (Cold, Warm, Hot), which prospecting budgets it takes from, and audiences made, to make and missing advertiser access; then, when they apply, prospecting short, the accounts that need access, and the next stretch as a scheduled change.",
    "A show that can't be built is one skipped line with the reason. Nothing is sent to Meta or saved.",
  ].join(" "),
  inputSchema: {
    events: z.union([z.literal("live"), z.string().min(2).max(40), z.array(z.string().min(2).max(40)).max(MAX_CODES)]).describe('An event code, a list of codes, or "live".'),
  },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const deps = requireRetargeting(ctx);
    const codes = codesOf(args.events);
    const archived = codes ? await archivedCodes(ctx, codes) : new Set<string>();
    let read: Awaited<ReturnType<McpRetargetingDeps["read"]>>;
    try {
      read = await deps.read({ userId: ctx.userId, codes: codes ? codes.filter((code) => !archived.has(code.toUpperCase())) : null, now: ctx.now });
    } catch {
      throw new ToolInputError(RT_CLAUDE_WORDS.readFailed, { refused: "read_failed" });
    }
    const shows: ShowLines[] = read.records.map(linesFor);
    for (const code of codes ?? []) {
      if (archived.has(code.toUpperCase())) shows.push({ code, skipped: "archived", lines: [skipLine(code, "archived")] });
      else if (!shows.some((row) => row.code.toUpperCase() === code.toUpperCase())) shows.push({ code, skipped: "not_on_sale", lines: [`${code} · skipped: ${RT_CLAUDE_WORDS.notOnSale}.`] });
    }
    const build = shows.filter((row) => !row.skipped);
    const skipped = shows.filter((row) => row.skipped);
    const ordered = [...build, ...skipped];
    const lines = [...(codes ? [] : [planHead({ shows: shows.length, build: build.length, skipped: skipped.length })]), ...ordered.flatMap((row) => row.lines)];
    return {
      data: { message: lines.join("\n"), shows: ordered.map((row) => ({ code: row.code, skipped: row.skipped, lines: row.lines })) },
      summary: { scope: codes ? "codes" : "live", shows: shows.length, toBuild: build.length, skipped: skipped.length, reasons: Object.fromEntries([...new Set(skipped.map((row) => row.skipped))].map((reason) => [reason, skipped.filter((row) => row.skipped === reason).length])), metaGets: read.metaGets },
    };
  },
};

type BuildRow = { build: FunnelBuild | null; mode: "paused" | "live" | null; state: string; progress: FunnelProgress | null; meta_campaign_id: string | null; ad_account_id: string | null };

async function buildRowOf(ctx: ToolContext, eventId: string): Promise<BuildRow | null> {
  const res = await ctx.db.from("retargeting_builds").select("build, mode, state, progress, meta_campaign_id, ad_account_id").eq("event_id", eventId).maybeSingle();
  if (res.error) throw new ToolInputError(RT_CLAUDE_WORDS.readFailed, { refused: "build_unreadable" });
  return (res.data as BuildRow | null) ?? null;
}

const made = (progress: FunnelProgress) => Object.keys(progress.audiences ?? {}).length;

export const createShowCampaignsTool: McpTool = {
  name: "create_show_campaigns",
  title: "Make a show's campaigns",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: RT_CLAUDE_WORDS.readFailed,
  // PENDING DESIGN: the description.
  description: [
    'Makes one show\'s "{code} · Retargeting" campaign as plan_retargeting plans it: the missing audiences, then Cold, Warm and Hot with their budgets and the show\'s live ads (with the show\'s current copy).',
    "mode paused makes it all paused and moves nothing. mode live takes the money from prospecting (largest first, never under £1.00 an ad set), checks the show's ceiling, switches it on and schedules each later stretch as a budget change. Asked again, it carries on from what's made; a paused one asked as live goes live.",
    "Needs Matas's yes in this chat: ask him the show, paused or live, £ a day and where it comes from, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    mode: z.enum(["paused", "live"]).describe("paused or live."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const deps = requireRetargeting(ctx);
    const [code] = codesOf(args.event)!;
    const live = args.mode === "live";
    const archived = await archivedCodes(ctx, [code!]);
    if (archived.size) throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(skipLine(code!, "archived")), { code, refused: "archived" });
    let read: Awaited<ReturnType<McpRetargetingDeps["read"]>>;
    try {
      read = await deps.read({ userId: ctx.userId, codes: [code!], now: ctx.now });
    } catch {
      throw new ToolInputError(RT_CLAUDE_WORDS.readFailed, { code, refused: "read_failed" });
    }
    const record = read.records.find((row) => (row.eventCode ?? "").toUpperCase() === code!.toUpperCase());
    if (!record?.input) throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(`${code} · skipped: ${RT_CLAUDE_WORDS.notOnSale}.`), { code, refused: "not_on_sale" });
    const eventId = record.eventId;
    const owner = await ctx.db.from("events").select("user_id, client_id, client:clients(name)").eq("id", eventId).maybeSingle();
    const ownerRow = owner.data as { user_id: string | null; client_id: string | null; client: { name?: string | null } | { name?: string | null }[] | null } | null;
    if (owner.error || !ownerRow) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code!), { code, refused: "event_not_found" });
    if (ownerRow.user_id !== ctx.userId) throw new ToolInputError(EVENT_WORDS.refusedOtherAccount, { code, refused: "not_owner" });
    const clientName = (Array.isArray(ownerRow.client) ? ownerRow.client[0]?.name : ownerRow.client?.name) ?? null;
    const base = { code, eventId, mode: args.mode };

    // A build already started: carry on from it (paused → live, or a failed try).
    const row = await buildRowOf(ctx, eventId);
    let build: FunnelBuild | null = null;
    if (row?.build && row.build.kind === "retargeting_funnel_create") {
      if (row.progress?.active) {
        return { data: { message: RT_CLAUDE_WORDS.alreadyLive(code!), changed: false, campaign_id: row.meta_campaign_id }, eventId, clientId: ownerRow.client_id, summary: { ...base, noop: "already_live" } };
      }
      if (!live && row.state === "paused") {
        return { data: { message: RT_CLAUDE_WORDS.alreadyPaused(code!), changed: false, campaign_id: row.meta_campaign_id }, eventId, clientId: ownerRow.client_id, summary: { ...base, noop: "already_paused" } };
      }
      build = row.build;
    } else {
      const skip = recordSkip(record);
      if (skip) throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(skipLine(code!, skip)), { ...base, refused: skip });
      if (record.plan.held) throw new ToolInputError(RT_CLAUDE_WORDS.held(record.plan.held), { ...base, refused: "held" });
      if (!record.plan.build || record.plan.build.kind !== "retargeting_funnel_create") throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(skipLine(code!, "no_budget")), { ...base, refused: "no_build" });
      build = record.plan.build;
    }
    // Two campaigns (staged): Wider folds the show's prospecting, so it goes live only once that's folded or paused (Matas's yes, through pause).
    if (live && build.wider && !row?.progress?.active) {
      const advice = adviseExisting(record.input.campaigns ?? []).filter((one) => one.advice !== "keep");
      let statuses: Record<string, string | null> = {};
      try {
        statuses = advice.length ? await deps.campaignStatuses({ userId: ctx.userId, ids: advice.map((one) => one.id) }) : {};
      } catch {
        throw new ToolInputError(RT_CLAUDE_WORDS.readFailed, { ...base, refused: "statuses_unread" });
      }
      const running = advice.filter((one) => statuses[one.id] === "ACTIVE" || statuses[one.id] == null);
      if (running.length) throw new ToolInputError(foldFirstLine(code!, running.map((one) => one.name)), { ...base, refused: "fold_first", running: running.map((one) => one.id) });
    }
    if (!build.draftId || !build.adAccountId) throw new ToolInputError(RT_CLAUDE_WORDS.held(record.plan.held ?? "Not one of this event's drafts on this account, so nothing is written to this campaign."), { ...base, refused: "no_draft" });

    let created: Awaited<ReturnType<McpRetargetingDeps["create"]>>;
    try {
      created = await deps.create({ userId: ctx.userId, eventId, clientId: ownerRow.client_id, clientName, approval, build, mode: live ? "live" : "paused", today: ctx.today });
    } catch {
      throw new ToolInputError(RT_CLAUDE_WORDS.failed(RT_CLAUDE_WORDS.metaRefused), { ...base, refused: "create_threw" });
    }
    const out = created.outcome;
    const progress = out.progress;
    const ids = {
      campaign_id: progress.campaignId ?? null,
      ad_set_ids: Object.fromEntries(Object.entries(progress.adSets ?? {}).flatMap(([tier, set]) => (set ? [[tier, set.id]] : []))),
      audiences_made: made(progress),
      ads: progress.ads?.length ?? 0,
      scheduled: progress.scheduled ?? [],
    };
    const link = created.adsManager;
    const summary = { ...base, ...ids, step: out.step ?? null, ...(out.error ? { error: "meta_or_store", reason: out.reason } : {}) };
    if (out.state === "failed") {
      const reason = out.reason ?? RT_CLAUDE_WORDS.readFailed;
      // The ceiling's own refusal is the MCP's (it ends "Nothing was sent to Meta.").
      const said = out.step === "ceiling" ? reason : progress.campaignId ? RT_CLAUDE_WORDS.failedPartly(reason) : RT_CLAUDE_WORDS.failed(reason);
      throw new ToolInputError(said, { ...summary, refused: out.step ?? "failed" }, { ...ids, ads_manager: link });
    }
    const taken = build.plan.take.reduce((sum, line) => sum + (line.beforeMinor - line.afterMinor), 0);
    // Matas, 26 Nov item 2: every ad set's settings as Meta holds them; anything still on is said per ad set.
    const readBack = progress.readBack ?? [];
    const settings = [
      ...readBack.filter((row) => row.read === false).map((row) => geoNotReadLine(row.name)),
      ...readBack.filter((row) => row.read !== false && !row.geoOff).map((row) => untickLine(row.name)),
      ...readBack.filter((row) => row.read !== false && !row.advantageOff).map((row) => suggestionOnLine(row.name)),
    ];
    const similarSkipped = progress.similarSkipped ? [similarSkipLine(progress.similarSkipped, { code: code!, genre: genreWords(build.spec?.genreFamily ?? null) })] : [];
    const adSets = Object.values(progress.adSets ?? {}).filter(Boolean).length + Object.values(progress.wider?.adSets ?? {}).filter(Boolean).length;
    const message = [doneLine({ code: code!, live, adSets, made: ids.audiences_made }), ...similarSkipped, ...(live && out.step === "schedule" ? [RT_CLAUDE_WORDS.stepsNotScheduled] : []), ...settings].join("\n");
    return { data: { message, ...ids, ads_manager: link }, eventId, clientId: ownerRow.client_id, summary: { ...summary, takenMinor: taken } };
  },
};
