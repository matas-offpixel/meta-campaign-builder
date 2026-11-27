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
import type { AudienceSkip, FunnelBuild, FunnelProgress } from "../../retargeting/funnel-apply.ts";
import { buildRunning, RF_STOP_WORDS } from "../../retargeting/build-lock.ts";
import { FUNNEL_TIER_LABEL } from "../../retargeting/funnel.ts";
import { claudePlanLines, doneLine, isPresale, planHead, similarReturnLine, similarSkipLine, skipLine, skipReason, skipReasonWords, type SkipReason } from "../../retargeting/funnel-plan.ts";
import { fill } from "../../retargeting/funnel-words.ts";
import { funnelSourcesOf, genreWords } from "../../retargeting/funnel-view.ts";
import { adviseExisting, foldFirstLine, geoNotReadLine, untickLine } from "../../retargeting/show-campaigns.ts";
import type { RetargetingRecord } from "../../retargeting/runner.ts";
import { HELD_CLIENTS, HELD_CLIENT_IDS, heldLine, heldRefusal } from "../../retargeting/held.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import type { McpRetargetingDeps } from "../retargeting/types.ts";
import { TIME_WORDS } from "../retargeting/time-words.ts";
import { destinationKey, DESTINATION_WORDS, validateDestination, type Destination } from "../../retargeting/destination.ts";
import { normaliseCode } from "./shared.ts";
import { creativesKey, identityKey, SHOW_CREATIVE_WORDS, type ShowCreatives, type ShowIdentity } from "../../retargeting/show-creatives.ts";
import { checkDriveAds, creativesInput, isTimedOut, identityInput, liveAdIdsInput, parseShowAds, resolveIdentity, selectLiveAds, uploadDriveAds, wantsShowAds, type LiveAdsChoice, type ParsedShowAds } from "../retargeting/show-ads.ts";
import { SHOW_CREATIVE_R2 } from "../../retargeting/show-creatives.ts";
import { requireMetaScope } from "./live-read.ts";
import { adSetsMadeOf, checkoutRefusal, checkoutSeenOf, OPTIMISE_ON_VALUES, optimisationLines, resolveOptimisation, type Optimisation, type OptimiseOn } from "../../retargeting/optimise-on.ts";

const MAX_CODES = 60;

/** Matas, 27 Nov: every ad's website URL and URL parameters. Design's words (27 Nov), word for word, the destination re-ruled with #1410's list (claude.rt.input.destination); straight marks, as tool descriptions keep them. */
const destinationInput = z
  .object({
    link: z.string().min(8).max(2000).describe("The https:// web address every ad in both campaigns links to."),
    url_tags: z.string().max(2000).optional().describe("Meta's URL parameters for every ad, with no leading ?, e.g. utm_source=meta&utm_campaign={{campaign.name}}. Kept exactly as written: Meta fills in {{campaign.name}}, {{adset.name}} and {{ad.name}}."),
  })
  .optional()
  .describe("Optional, one show only: one destination for every ad in both campaigns, copied or from Drive. It sets only the link and URL parameters; copy, media and the Page come from the ads, creatives and identity. Once ads are made it can't be changed.");

/** The destination checked, or its refusal (nothing read, nothing made). */
function destinationOf(args: Record<string, unknown>, extra: Record<string, unknown> = {}): Destination | null {
  const checked = validateDestination(args.destination as { link: string; url_tags?: string } | undefined);
  if (!checked.ok) throw new ToolInputError(checked.reason, { ...extra, refused: "bad_destination" });
  return checked.destination;
}

/** PENDING DESIGN (27 Nov): what an on-sale show's ad sets optimise on (claude.rt.input.optimise_on). */
const optimiseOnInput = z
  .enum(OPTIMISE_ON_VALUES)
  .optional()
  .describe('Optional: what the on-sale ad sets in both campaigns optimise on, "purchase" or "initiate_checkout". Default: initiate_checkout for an Electric show (NX, ES, EBR), purchase for every other client. A presale show always optimises on CompleteRegistration, and ad sets already made keep their event.');

const reasonOf = (reason: string) => reason.replace(/\.$/, "");

/** What Claude is told: the 27 Nov list's claude.rt.* rows. `held` carries the plan's own held sentence. */
export const RT_CLAUDE_WORDS = {
  notWired: fill("claude.rt.not_wired"),
  readFailed: fill("claude.rt.read_failed"),
  refusedSkip: (code: string, reason: SkipReason, detail?: string | null, cause?: "no_show_date" | "no_signal_path" | null) => fill("claude.rt.refused.skip", { code, reason: skipReasonWords(reason, detail, cause) }),
  held: (why: string) => `Refused: ${why} Nothing was changed.`,
  alreadyLive: (code: string) => fill("claude.rt.noop.live", { code }),
  alreadyPaused: (code: string) => fill("claude.rt.noop.paused", { code }),
  failed: (reason: string) => fill("claude.rt.failed", { reason: reasonOf(reason) }),
  failedPartly: (reason: string) => fill("claude.rt.failed.partly", { reason: reasonOf(reason) }),
  stepsNotScheduled: fill("claude.rt.steps_unscheduled"),
  tooMany: fill("claude.rt.too_many", { n: MAX_CODES }),
  metaRefused: fill("claude.rt.meta_refused"),
  // PENDING DESIGN (27 Nov, speed over design until Saturday): a source left out of the build; its tier is built without it.
  sourceSkipped: (name: string, reason: AudienceSkip) => `Left out: ${name}. ${SOURCE_SKIP_WHY[reason]} Its tier is built without it.`,
} as const;

/** PENDING DESIGN: why a source was left out (rf-build-meta-error words TSV). */
const SOURCE_SKIP_WHY: Record<AudienceSkip, string> = {
  nothing: "There’s nothing to build it from.",
  refused: "Meta didn’t take it.",
  unsure: "Meta’s audience list couldn’t be read to check for an existing copy, so it wasn’t made (no duplicate). Asking again tries it.",
  threw: "It couldn’t be made this time. Asking again tries it.",
};

/** RF9's skip for a show the read planned; archived is found before the read. */
export function recordSkip(record: RetargetingRecord): SkipReason | null {
  const input = record.input!;
  return skipReason({
    archived: false,
    built: record.plan.state === "running",
    runDay: input.runDay,
    showDay: input.eventDate,
    // Fix 7: the pixel the funnel uses, the ads' or the fallback.
    pixelId: input.sources.pixelId ?? input.read?.pixel?.id ?? input.fallbackPixel?.id ?? null,
    hasTicketLink: input.sources.links.some((link) => link.kind === "ticket"),
    hasSignupLink: input.sources.links.some((link) => link.kind === "landing"),
    presale: isPresale(input),
    plan: record.plan.funnel ?? null,
    // Fix 6: a show the read didn't propose says why, never "no prospecting budget" by default.
    state: record.plan.state,
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

/** Explicit codes whose client is held (Matas, 27 Nov; lib/retargeting/held.ts): code (upper case) → the client's name. */
async function heldCodes(ctx: ToolContext, codes: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!HELD_CLIENT_IDS.size || !codes.length) return out;
  const res = await ctx.db.from("events").select("event_code, client_id").in("event_code", [...codes]);
  for (const row of (res.error ? [] : (res.data ?? [])) as { event_code: string | null; client_id: string | null }[]) {
    if (row.event_code && row.client_id && HELD_CLIENT_IDS.has(row.client_id)) out.set(row.event_code.toUpperCase(), HELD_CLIENTS.find((c) => c.id === row.client_id)!.name);
  }
  return out;
}

/** Explicit codes whose client is archived (the read leaves them out, as every cron does). */
async function archivedCodes(ctx: ToolContext, codes: readonly string[]): Promise<Set<string>> {
  const res = await ctx.db.from("events").select("event_code, client:clients(status)").in("event_code", [...codes]);
  if (res.error) return new Set();
  const rows = (res.data ?? []) as { event_code: string | null; client: { status?: string | null } | { status?: string | null }[] | null }[];
  const status = (row: (typeof rows)[number]) => (Array.isArray(row.client) ? row.client[0]?.status : row.client?.status) ?? null;
  return new Set(rows.filter((row) => row.event_code && status(row) === "archived").map((row) => row.event_code!.toUpperCase()));
}

type ShowLines = { code: string; skipped: SkipReason | "not_on_sale" | "not_finished" | null; lines: string[] };

/** TC8: the plan's lines for one show — both campaigns, matched Pages, access, Similar skipped, presale sign-ups, existing prospecting, the next stretch. */
function linesFor(record: RetargetingRecord, asked: OptimiseOn | null = null, alone = false): ShowLines {
  const code = record.eventCode ?? record.eventId;
  const input = record.input;
  if (!input) return { code, skipped: "not_on_sale", lines: [skipLine(code, "not_on_sale")] };
  const skip = recordSkip(record);
  // Matas, 27 Nov: one "Optimises on" line for a show to build, or (asked for alone) one built and carrying on.
  const optimises = (opt: Optimisation) => optimisationLines(code, opt, checkoutSeenOf(input.pixelHosts));
  if (skip === "built" && input.funnelBuilt && alone) {
    const built = input.funnelBuilt;
    const plan = record.plan.funnel;
    const back = plan && built.tiers.similar === 0 && !plan.similarSkip && plan.specs.some((spec) => spec.tier === "similar");
    const opt = resolveOptimisation({ code, presale: isPresale(input), asked, stored: built.optimiseOn ?? null, madeOn: built.optimisedOn ?? null, adSetsMade: built.adSetsMade ?? Object.values(built.tiers).some((minor) => minor > 0) });
    return { code, skipped: skip, lines: [skipLine(code, skip, record.plan.view.notProposed, record.plan.cause), ...(back ? [similarReturnLine({ nextDay: plan.steps[0]?.day ?? null, refused: built.similarRefused ?? null })] : []), ...optimises(opt)] };
  }
  if (skip) {
    // Matas, 27 Nov: a built show without Similar whose group is confirmed now — Similar comes back at the next step.
    const plan = record.plan.funnel;
    const built = input.funnelBuilt;
    const back = skip === "built" && plan && built && built.tiers.similar === 0 && !plan.similarSkip && plan.specs.some((spec) => spec.tier === "similar");
    return { code, skipped: skip, lines: [skipLine(code, skip, record.plan.view.notProposed, record.plan.cause), ...(back ? [similarReturnLine({ nextDay: plan.steps[0]?.day ?? null, refused: built.similarRefused ?? null })] : [])] };
  }
  const plan = record.plan.funnel!;
  const wider = record.plan.wider;
  if (!wider) return { code, skipped: "no_budget", lines: [skipLine(code, "no_budget")] };
  const presale = isPresale(input);
  const signups = input.signups && input.signups.state === "on" ? input.signups.count : null;
  // TC8: each existing prospecting campaign as keep, pause or fold into Wider (pausing and folding only after Matas says yes).
  const existing = adviseExisting(input.campaigns ?? []).map((row) => ({ name: row.name, action: row.advice }));
  const build = record.plan.build && record.plan.build.kind === "retargeting_funnel_create" ? record.plan.build : null;
  const opt = resolveOptimisation({ code, presale, asked, stored: build?.optimiseOn ?? null, adSetsMade: false });
  return {
    code,
    skipped: null,
    lines: [...claudePlanLines(plan, funnelSourcesOf(input.sources, input.accounts), { wider, pages: input.matchedPages ?? null, genre: genreWords(input.genreFamily ?? null), presale, presaleSignups: presale ? signups : null, existing, fallbackPixel: input.fallbackPixel ?? null }), ...optimises(opt)],
  };
}

/** claude.rt.untick: "Use as a suggestion" still on after create. */
/** A show's lines, then its reads that ran out of time (the connector's limits, Matas 27 Nov). */
function showLinesOf(record: RetargetingRecord, asked: OptimiseOn | null = null, alone = false): ShowLines {
  const show = linesFor(record, asked, alone);
  return record.notRead?.length ? { ...show, lines: [...show.lines, TIME_WORDS.notRead(record.notRead)] } : show;
}

export function suggestionOnLine(adSetName: string): string {
  return fill("claude.rt.untick", { adset: adSetName });
}

/** Where a show's ads would run: its ad account, its client, its draft and how many live ads it copies. */
function adsTarget(record: RetargetingRecord): { adAccountId: string | null; draftId: string | null; copied: number } {
  const build = record.plan.build && record.plan.build.kind === "retargeting_funnel_create" ? record.plan.build : null;
  return { adAccountId: build?.adAccountId ?? record.input?.where?.adAccountId ?? null, draftId: build?.draftId ?? record.input?.where?.draftId ?? null, copied: build?.ads.length ?? record.input?.ads.length ?? 0 };
}

/** The lineup artists' Facebook Pages (id → name) and every campaign id the read knows for the show (for live_ad_ids). */
function showAdsContext(build: FunnelBuild | null, record: RetargetingRecord): { lineup: Map<string, string>; campaignIds: string[] } {
  const accounts = build?.sources.accounts ?? [];
  const lineup = new Map(accounts.filter((row) => row.kind === "lineup" && row.platform === "facebook").map((row) => [row.pageId, row.name] as const));
  const campaignIds = [...new Set([...(build?.campaignIds ?? []), ...(build?.videoCampaignIds ?? []), ...(record.input?.where?.campaignIds ?? []), ...(record.input?.campaigns ?? []).map((row) => row.id)])];
  return { lineup, campaignIds };
}

async function clientIdOf(ctx: ToolContext, eventId: string): Promise<string | null> {
  const res = await ctx.db.from("events").select("client_id").eq("id", eventId).maybeSingle();
  return ((res.data as { client_id: string | null } | null)?.client_id ?? null) as string | null;
}

/**
 * plan_retargeting's ads line for one show (Matas, 27 Nov): how many ads, from
 * which folder, run from which Page. Reads only (the Page list, the Drive
 * checks), each within 10 s; a refusal is the same one create_show_campaigns
 * would give. Null: copied ads with their own Pages (nothing to say).
 */
async function adsLine(ctx: ToolContext, record: RetargetingRecord, parsed: ParsedShowAds): Promise<string | null> {
  const code = record.eventCode ?? record.eventId;
  const target = adsTarget(record);
  if (!target.adAccountId) return null;
  let identity: ShowIdentity | null;
  try {
    identity = await resolveIdentity(ctx, { code, adAccountId: target.adAccountId, clientId: await clientIdOf(ctx, record.eventId), given: parsed.identity, drive: Boolean(parsed.creatives) });
  } catch (err) {
    // A plan is read only: a Page list that couldn't be read is a line, not a refusal (create refuses).
    if (isTimedOut(err) || (err instanceof ToolInputError && err.summary?.refused === "pages_unread")) return SHOW_CREATIVE_WORDS.notRead("pages");
    throw err;
  }
  if (!identity) return null;
  // The copied ads (Matas, 27 Nov): the ids given, else every live ad without creatives; one per creative, artist ads kept on their Page.
  const build = record.plan.build && record.plan.build.kind === "retargeting_funnel_create" ? record.plan.build : null;
  let copies: LiveAdsChoice = { ads: [], kept: [] };
  if (parsed.liveAdIds || !parsed.creatives) {
    const { lineup, campaignIds } = showAdsContext(build, record);
    try {
      copies = await selectLiveAds(ctx, { code, adAccountId: target.adAccountId, given: parsed.liveAdIds, liveAds: build?.ads ?? record.input?.ads ?? [], campaignIds, lineup, identity, destination: false });
    } catch (err) {
      if (isTimedOut(err) || (err instanceof ToolInputError && err.summary?.refused === "live_unread" && !parsed.liveAdIds)) return SHOW_CREATIVE_R2["claude.rt.ads.not_read.live"];
      throw err;
    }
  }
  if (!parsed.creatives) return SHOW_CREATIVE_WORDS.line({ code, newAds: null, copied: copies.ads.length || target.copied, folders: [], identity, kept: copies.kept });
  try {
    const check = await checkDriveAds(ctx, { eventId: record.eventId, draftId: target.draftId, creatives: parsed.creatives, identity });
    return SHOW_CREATIVE_WORDS.line({ code, newAds: check.planned.length, copied: copies.ads.length, folders: check.folders, identity, withLive: Boolean(parsed.liveAdIds), kept: copies.kept });
  } catch (err) {
    if (isTimedOut(err)) return SHOW_CREATIVE_WORDS.notRead("drive");
    throw err;
  }
}

/** Design's tool descriptions for #1399 (27 Nov), word for word, with #1410's claude.rt.desc.plan.ads and claude.rt.desc.create.ads; straight apostrophes and quotes, as tool descriptions keep them. */
export const PLAN_DESCRIPTION =
  "Read only. For one event code, a list of codes, or \"live\" (every show on sale or in presale, of a non-archived client): what each show's two campaigns, \"{code} · Wider\" and \"{code} · Retargeting\", would be today. Per show: the stretch and share; Wider's lifetime, end date and £ a day; Retargeting's £ a day and its split (Similar, Cold, Warm, Hot); audiences made, to make and missing advertiser access; the venue, promoter and lineup Pages it matched. With one code, the destination and the ads: the show's live ads or the Drive creatives given, and the Page they run from (an Electric show's city Page by default). Then, when they apply: Similar skipped and why, presale sign-ups left out, each existing prospecting campaign as keep, pause or fold into Wider, and the next stretch as a scheduled change. A show that can't be built is one skipped line with the reason. Nothing is sent to Meta or saved.";
export const CREATE_DESCRIPTION =
  "Makes one show's two campaigns as plan_retargeting plans them: \"{code} · Wider\" (Advantage+ audience, lifetime budget) and \"{code} · Retargeting\" (Similar, Cold, Warm and Hot, daily budgets), the missing audiences, and the ads: the show's live ads with its current copy, or the Drive creatives given, run from identity's Page (an Electric show's city Page by default). mode paused makes both paused and moves nothing. mode live checks the show's ceiling, switches both on and schedules each later stretch step (Retargeting up, Wider's remaining lifetime down). It's refused while the show's existing prospecting still runs; pausing or folding that is Matas's yes, and this tool never does it. Asked again, it carries on from what's made; a paused build asked as live goes live. Needs Matas's yes in this chat: ask him the show, paused or live, Wider's lifetime and Retargeting's £ a day, then pass approval with your question (asked) and his reply word for word (answer).";

export const planRetargetingTool: McpTool = {
  name: "plan_retargeting",
  title: "Plan each show's two campaigns",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  // Design's words (27 Nov), word for word.
  description: PLAN_DESCRIPTION,
  inputSchema: {
    events: z.union([z.literal("live"), z.string().min(2).max(40), z.array(z.string().min(2).max(40)).max(MAX_CODES)]).describe('An event code, a list of codes, or "live".'),
    destination: destinationInput,
    creatives: creativesInput,
    identity: identityInput,
    live_ad_ids: liveAdIdsInput,
    optimise_on: optimiseOnInput,
  },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const deps = requireRetargeting(ctx);
    let codes = codesOf(args.events);
    const destination = destinationOf(args);
    if (destination && codes?.length !== 1) throw new ToolInputError(DESTINATION_WORDS.oneShow, { refused: "destination_one_show" });
    const showAds = parseShowAds(args);
    if (wantsShowAds(showAds) && codes?.length !== 1) throw new ToolInputError(SHOW_CREATIVE_WORDS.oneShow, { refused: "show_ads_one_show" });
    // Held clients (Matas, 27 Nov): one held show is refused; in a list, held shows are left out with the line at the top.
    const held = codes ? await heldCodes(ctx, codes) : new Map<string, string>();
    if (codes && held.size && held.size === codes.length) throw new ToolInputError(heldRefusal([...held.values()][0]!), { refused: "held" });
    if (codes) codes = codes.filter((code) => !held.has(code.toUpperCase()));
    const archived = codes ? await archivedCodes(ctx, codes) : new Set<string>();
    let read: Awaited<ReturnType<McpRetargetingDeps["read"]>>;
    try {
      read = await deps.read({ userId: ctx.userId, codes: codes ? codes.filter((code) => !archived.has(code.toUpperCase())) : null, now: ctx.now });
    } catch {
      throw new ToolInputError(RT_CLAUDE_WORDS.readFailed, { refused: "read_failed" });
    }
    // The destination, after a show's plan (the show to build only).
    const asked = (args.optimise_on as OptimiseOn | undefined) ?? null;
    const shows: ShowLines[] = read.records.map((record) => showLinesOf(record, asked, codes?.length === 1)).map((show) => (destination && !show.skipped ? { ...show, lines: [...show.lines, DESTINATION_WORDS.line(destination)] } : show));
    // The ads line, after the destination's (one show only): its Drive ads or copied ads, and the Page they run from.
    if (codes?.length === 1) {
      for (const show of shows) {
        if (show.skipped) continue;
        const record = read.records.find((row) => (row.eventCode ?? row.eventId) === show.code)!;
        const line = await adsLine(ctx, record, showAds);
        if (!line) continue;
        // Right after the destination line; a show's "not read in time" line still closes its lines.
        const at = destination ? show.lines.indexOf(DESTINATION_WORDS.line(destination)) + 1 : record.notRead?.length ? show.lines.length - 1 : show.lines.length;
        show.lines.splice(at, 0, line);
      }
    }
    // The connector's limits: a show not finished in time is said, never waited for; one asked for alone says so on its own line.
    const unfinished = (read.unfinished ?? []).map((row) => row.eventCode ?? row.eventId);
    const alone = codes?.length === 1;
    for (const code of unfinished) shows.push({ code, skipped: "not_finished", lines: alone ? [TIME_WORDS.unfinishedOne(code)] : [] });
    for (const code of codes ?? []) {
      if (archived.has(code.toUpperCase())) shows.push({ code, skipped: "archived", lines: [skipLine(code, "archived")] });
      else if (!shows.some((row) => row.code.toUpperCase() === code.toUpperCase())) shows.push({ code, skipped: "not_on_sale", lines: [skipLine(code, "not_on_sale")] });
    }
    const build = shows.filter((row) => !row.skipped);
    const skipped = shows.filter((row) => row.skipped && row.skipped !== "not_finished");
    const left = shows.filter((row) => row.skipped === "not_finished");
    const ordered = [...build, ...skipped, ...left];
    const heldNames = codes ? [...new Set(held.values())] : HELD_CLIENTS.map((row) => row.name);
    const lines = [
      ...(heldNames.length ? [heldLine(heldNames)] : []),
      ...(codes ? [] : [planHead({ shows: shows.length, build: build.length, skipped: skipped.length })]),
      ...(left.length && !alone ? [TIME_WORDS.unfinishedMany(left.map((row) => row.code))] : []),
      ...(read.notRead?.length ? [TIME_WORDS.notRead(read.notRead)] : []),
      ...ordered.flatMap((row) => row.lines),
    ];
    return {
      data: { message: lines.join("\n"), shows: ordered.map((row) => ({ code: row.code, skipped: row.skipped, lines: row.lines })) },
      summary: { scope: codes ? "codes" : "live", shows: shows.length, toBuild: build.length, skipped: skipped.length, unfinished: left.length, notRead: read.notRead ?? [], reasons: Object.fromEntries([...new Set(skipped.map((row) => row.skipped))].map((reason) => [reason, skipped.filter((row) => row.skipped === reason).length])), metaGets: read.metaGets },
    };
  },
};

type BuildRow = { build: FunnelBuild | null; mode: "paused" | "live" | null; state: string; progress: FunnelProgress | null; meta_campaign_id: string | null; ad_account_id: string | null; updated_at?: string | null };

/** The whole call fits well inside the client's wait (~230 s): the build is given until 190 s after the call started, and starts no step in its last 25 s. */
export const CREATE_DEADLINE_MS = 190_000;

async function buildRowOf(ctx: ToolContext, eventId: string): Promise<BuildRow | null> {
  const res = await ctx.db.from("retargeting_builds").select("build, mode, state, progress, meta_campaign_id, ad_account_id, updated_at").eq("event_id", eventId).maybeSingle();
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
  // Design's words (27 Nov), word for word.
  description: CREATE_DESCRIPTION,
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    mode: z.enum(["paused", "live"]).describe("paused or live."),
    approval: approvalInput,
    destination: destinationInput,
    creatives: creativesInput,
    identity: identityInput,
    live_ad_ids: liveAdIdsInput,
    optimise_on: optimiseOnInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const startedAt = Date.now();
    const deps = requireRetargeting(ctx);
    const [code] = codesOf(args.event)!;
    const live = args.mode === "live";
    const destination = destinationOf(args, { code });
    const showAds = parseShowAds(args);
    const held = await heldCodes(ctx, [code!]);
    if (held.size) throw new ToolInputError(heldRefusal([...held.values()][0]!), { code, refused: "held" });
    const archived = await archivedCodes(ctx, [code!]);
    if (archived.size) throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(code!, "archived"), { code, refused: "archived" });
    let read: Awaited<ReturnType<McpRetargetingDeps["read"]>>;
    try {
      read = await deps.read({ userId: ctx.userId, codes: [code!], now: ctx.now });
    } catch {
      throw new ToolInputError(RT_CLAUDE_WORDS.readFailed, { code, refused: "read_failed" });
    }
    // The connector's limits: a show not read in full in time makes nothing (its build would be planned on partial reads).
    if ((read.unfinished ?? []).some((row) => (row.eventCode ?? "").toUpperCase() === code!.toUpperCase())) throw new ToolInputError(TIME_WORDS.refused(code!), { code, refused: "not_read_in_time", unfinished: true });
    const record = read.records.find((row) => (row.eventCode ?? "").toUpperCase() === code!.toUpperCase());
    if (record && (record.notRead?.length || read.notRead?.length)) throw new ToolInputError(TIME_WORDS.refused(code!), { code, refused: "not_read_in_time", notRead: [...(read.notRead ?? []), ...(record.notRead ?? [])] });
    if (!record?.input) throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(code!, "not_on_sale"), { code, refused: "not_on_sale" });
    const eventId = record.eventId;
    const owner = await ctx.db.from("events").select("user_id, client_id, client:clients(name)").eq("id", eventId).maybeSingle();
    const ownerRow = owner.data as { user_id: string | null; client_id: string | null; client: { name?: string | null } | { name?: string | null }[] | null } | null;
    if (owner.error || !ownerRow) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code!), { code, refused: "event_not_found" });
    if (ownerRow.user_id !== ctx.userId) throw new ToolInputError(EVENT_WORDS.refusedOtherAccount, { code, refused: "not_owner" });
    const clientName = (Array.isArray(ownerRow.client) ? ownerRow.client[0]?.name : ownerRow.client?.name) ?? null;
    const base = { code, eventId, mode: args.mode };

    // A build already started: carry on from it (paused → live, or a failed try).
    const row = await buildRowOf(ctx, eventId);
    // One build per event: while one runs, a second is refused before anything is sent (applyFunnel checks again as it starts writing).
    if (row && buildRunning({ state: row.state, updatedAt: row.updated_at ?? null }, Date.now())) throw new ToolInputError(RF_STOP_WORDS.busy(code!), { ...base, refused: "already_building" });
    let build: FunnelBuild;
    const storedBuild: FunnelBuild | null = row?.build && row.build.kind === "retargeting_funnel_create" ? row.build : null;
    const adsMade = (row?.progress?.ads?.length ?? 0) > 0 || (row?.progress?.wider?.ads?.length ?? 0) > 0;
    // Asked again: the creatives and identity it was made with carry on; other ones are refused once ads are made.
    const storedCreatives: ShowCreatives | null = storedBuild?.creatives ?? null;
    const storedIdentity: ShowIdentity | null = storedBuild?.identity ?? null;
    const wantCreatives = showAds.creatives ?? storedCreatives?.input ?? null;
    const storedCopy = storedBuild?.copyAds ?? null;
    if (storedBuild && adsMade && creativesKey(wantCreatives) !== (storedCreatives?.key ?? "")) throw new ToolInputError(SHOW_CREATIVE_WORDS.madeWithOther(code!, "creatives", SHOW_CREATIVE_WORDS.madeFrom(storedCreatives, storedCopy?.length ?? 0)), { ...base, refused: "creatives_differ" });
    const wantLive = showAds.liveAdIds ?? storedCopy?.map((ad) => ad.adId) ?? null;
    if (storedBuild && adsMade && (wantLive ?? []).join(",") !== (storedCopy ?? []).map((ad) => ad.adId).join(",")) throw new ToolInputError(SHOW_CREATIVE_WORDS.madeWithOther(code!, "creatives", SHOW_CREATIVE_WORDS.madeFrom(storedCreatives, storedCopy?.length ?? 0)), { ...base, refused: "live_ads_differ" });
    if (storedBuild && adsMade && showAds.identity && identityKey(showAds.identity) !== identityKey(storedIdentity)) throw new ToolInputError(SHOW_CREATIVE_WORDS.madeWithOther(code!, "identity", SHOW_CREATIVE_WORDS.madeOnPage(storedIdentity)), { ...base, refused: "identity_differs" });
    if (row && storedBuild) {
      // Asked again: the destination it was made with carries on. Another one is taken only while no ad is made; ads that are made stay as they are.
      const stored = storedBuild.destination ?? null;
      let resumed: FunnelBuild = storedBuild;
      if (destination && destinationKey(destination) !== destinationKey(stored)) {
        if (adsMade) throw new ToolInputError(DESTINATION_WORDS.madeWithOther(code!, stored), { ...base, refused: "destination_differs" });
        resumed = { ...storedBuild, destination };
      }
      if (row.progress?.active) {
        return { data: { message: RT_CLAUDE_WORDS.alreadyLive(code!), changed: false, campaign_id: row.meta_campaign_id }, eventId, clientId: ownerRow.client_id, summary: { ...base, noop: "already_live" } };
      }
      if (!live && row.state === "paused") {
        return { data: { message: RT_CLAUDE_WORDS.alreadyPaused(code!), changed: false, campaign_id: row.meta_campaign_id }, eventId, clientId: ownerRow.client_id, summary: { ...base, noop: "already_paused" } };
      }
      build = resumed;
    } else {
      const skip = recordSkip(record);
      if (skip) throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(code!, skip, record.plan.view.notProposed, record.plan.cause), { ...base, refused: skip });
      if (record.plan.held) throw new ToolInputError(RT_CLAUDE_WORDS.held(record.plan.held), { ...base, refused: "held" });
      if (!record.plan.build || record.plan.build.kind !== "retargeting_funnel_create") throw new ToolInputError(RT_CLAUDE_WORDS.refusedSkip(code!, "no_budget"), { ...base, refused: "no_build" });
      build = destination ? { ...record.plan.build, destination } : record.plan.build;
    }
    // Matas, 27 Nov: what the ad sets optimise on. Ad sets already made keep theirs; InitiateCheckout only on a pixel that has it (this read's 28 days).
    const asked = (args.optimise_on as OptimiseOn | undefined) ?? null;
    const optimisation = resolveOptimisation({ code: code!, presale: build.presale === true, asked, stored: build.optimiseOn ?? null, madeOn: row?.progress?.optimisedOn ?? null, adSetsMade: adSetsMadeOf(row?.progress) });
    const checkout = checkoutSeenOf(record.input.pixelHosts);
    const noCheckout = checkoutRefusal(code!, optimisation, checkout);
    if (noCheckout) throw new ToolInputError(noCheckout, { ...base, refused: checkout === "none" ? "no_checkout" : "checkout_unread", optimisedOn: optimisation.event });
    build = { ...build, optimiseOn: optimisation.event === "INITIATED_CHECKOUT" ? "initiate_checkout" : optimisation.event === "PURCHASE" ? "purchase" : null, checkout };
    // The Page the ads run from, and the ads from Drive (Matas, 27 Nov): checked on the ad account before anything is sent.
    const adAccountForAds = build.adAccountId;
    // A build whose ads are made keeps the identity it was made with (none, for one made before this); a new one takes the Electric default.
    const carried = storedBuild && (adsMade || storedIdentity) ? storedIdentity : null;
    let identity: ShowIdentity | null = null;
    let driveFolders: string[] = [];
    let copies: LiveAdsChoice | null = null;
    let reuseCreatives = Boolean(storedCreatives && wantCreatives && storedCreatives.key === creativesKey(wantCreatives));
    if (adAccountForAds && !(storedBuild && adsMade && !carried && !showAds.identity)) {
      try {
        identity = await resolveIdentity(ctx, { code: code!, adAccountId: adAccountForAds, clientId: ownerRow.client_id, given: showAds.identity, carried, drive: Boolean(wantCreatives) });
        if (wantCreatives && !reuseCreatives) driveFolders = (await checkDriveAds(ctx, { eventId, draftId: build.draftId, creatives: wantCreatives, identity: identity! })).folders;
        // The copied ads (Matas, 27 Nov): the ids given (or carried on), else every live ad without creatives, read once; one per creative.
        if (wantLive || (identity && !wantCreatives)) {
          const { lineup, campaignIds } = showAdsContext(build, record);
          copies = await selectLiveAds(ctx, { code: code!, adAccountId: adAccountForAds, given: wantLive, liveAds: build.ads, campaignIds, lineup, identity, destination: Boolean(build.destination) });
        }
      } catch (err) {
        if (isTimedOut(err)) throw new ToolInputError(TIME_WORDS.refused(code!), { ...base, refused: "not_read_in_time", what: (err as Error).message });
        if (err instanceof ToolInputError) throw new ToolInputError(err.message, { ...base, ...(err.summary ?? {}) });
        throw err;
      }
    }
    build = { ...build, identity, creatives: reuseCreatives ? storedCreatives : null, copyAds: wantLive && copies ? copies.ads : (storedCopy ?? null) };
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

    // The Drive files go to Meta only now, after the yes and every check (the Storage copy and the ad account's library; no campaign yet).
    if (wantCreatives && !reuseCreatives && identity) {
      let up: Awaited<ReturnType<typeof uploadDriveAds>>;
      try {
        up = await uploadDriveAds(ctx, { eventId, draftId: build.draftId, adAccountId: build.adAccountId, creatives: wantCreatives, identity, folders: driveFolders });
      } catch (err) {
        if (err instanceof ToolInputError) throw new ToolInputError(err.message, { ...base, ...(err.summary ?? {}) });
        throw new ToolInputError(RT_CLAUDE_WORDS.failed(SHOW_CREATIVE_WORDS.uploadFailed(wantCreatives.fileIds.length + wantCreatives.pairs.length)), { ...base, refused: "upload_threw" });
      }
      if (!up.ok) throw new ToolInputError(RT_CLAUDE_WORDS.failed(up.reason), { ...base, ...up.summary });
      build = { ...build, creatives: up.creatives };
      reuseCreatives = true;
    }

    let created: Awaited<ReturnType<McpRetargetingDeps["create"]>>;
    try {
      created = await deps.create({ userId: ctx.userId, eventId, clientId: ownerRow.client_id, clientName, approval, build, mode: live ? "live" : "paused", today: ctx.today, deadlineAt: startedAt + CREATE_DEADLINE_MS });
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
    const summary = { ...base, ...ids, optimisedOn: optimisation.event, ...(optimisation.kept ? { optimisationKept: true } : {}), ...(identity ? { pageId: identity.pageId, igId: identity.igId, identitySource: identity.source } : {}), ...(build.creatives ? { driveAds: build.creatives.ads.length } : {}), ...(build.copyAds ? { copiedAds: build.copyAds.map((ad) => ad.adId) } : {}), step: out.step ?? null, specKey: out.specKey ?? null, ...(progress.skipped?.length ? { skipped: progress.skipped.map((row) => ({ key: row.key, reason: row.reason })) } : {}), ...(out.error ? { error: "meta_or_store", reason: out.reason, ...(out.metaError ? { metaError: { code: out.metaError.code, subcode: out.metaError.subcode, type: out.metaError.type, fbtraceId: out.metaError.fbtraceId, message: out.metaError.message.slice(0, 300) } } : {}) } : {}) };
    const sourcesSkipped = (progress.skipped ?? []).map((row) => RT_CLAUDE_WORDS.sourceSkipped(row.name, row.reason));
    const tiersNotMade = (progress.tiersNotMade ?? []).map((tier) => RF_STOP_WORDS.tierNotMade(code!, FUNNEL_TIER_LABEL[tier]));
    // Stopped before the client's wait ran out: what's made is kept, and asking again carries on.
    if (out.state === "failed" && out.step === "time") {
      return { data: { message: [out.reason ?? RF_STOP_WORDS.time(code!), ...sourcesSkipped, ...tiersNotMade].join("\n"), finished: false, ...ids, ads_manager: link }, eventId, clientId: ownerRow.client_id, summary: { ...summary, stopped: "time" } };
    }
    if (out.state === "failed") {
      const reason = out.reason ?? RT_CLAUDE_WORDS.readFailed;
      // The ceiling's own refusal is the MCP's (it ends "Nothing was sent to Meta."); busy and no-tier are said as they are.
      const said = out.step === "ceiling" || out.step === "busy" || out.step === "tiers" || out.step === "checkout" ? reason : progress.campaignId ? RT_CLAUDE_WORDS.failedPartly(reason) : RT_CLAUDE_WORDS.failed(reason);
      throw new ToolInputError([said, ...sourcesSkipped, ...tiersNotMade].join("\n"), { ...summary, refused: out.step ?? "failed" }, { ...ids, ads_manager: link });
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
    const copiedCount = build.copyAds?.length ?? (build.creatives ? 0 : (copies?.ads.length || build.ads.length));
    const adsWords = identity ? [SHOW_CREATIVE_WORDS.line({ code: code!, newAds: build.creatives?.ads.length ?? null, copied: copiedCount, folders: build.creatives?.folders ?? [], identity, withLive: Boolean(build.copyAds?.length && build.creatives), kept: copies?.kept ?? [] })] : [];
    const message = [doneLine({ code: code!, live, adSets, made: ids.audiences_made }), ...optimisationLines(code!, optimisation, "seen"), ...adsWords, ...sourcesSkipped, ...tiersNotMade, ...similarSkipped, ...(live && out.step === "schedule" ? [RT_CLAUDE_WORDS.stepsNotScheduled] : []), ...settings].join("\n");
    return { data: { message, ...ids, ads_manager: link }, eventId, clientId: ownerRow.client_id, summary: { ...summary, takenMinor: taken } };
  },
};
