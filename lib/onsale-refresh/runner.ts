/**
 * The on-sale refresh run (P1: shadow proposals only).
 *
 * For every on-sale event with Meta campaigns: plan the day (R1), gather
 * the campaign's facts (load.ts), build the proposal (rules.ts), store it
 * with its lines and inputs, expire the previous proposal's unanswered
 * lines, and post to ads_automation. Nothing here writes to Meta. A dry
 * run computes everything and writes nothing, Slack included.
 *
 * The purchase line (per-event purchases record, E1–E4) is read once per
 * event before the proposals are built: the pixel on the delivering ad
 * sets, the show's own domain, and the pixel's purchases on it. Those are
 * Meta reads (counted in `metaCalls`) and one public CIRQLIN page read
 * per crqln.com link; clients.meta_pixel_id is read and never written.
 *
 * Killswitch: ENABLE_ONSALE_REFRESH must be exactly "1" for the cron;
 * the dry-run script passes it. Unset = the route answers 200 with
 * skippedReason "killswitch".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";
import { buildEventInputs, driveForRefresh, loadAux, loadInsights, loadOnSaleEvents, type EventInputs, type EventRow } from "./load.ts";
import { ONSALE_PHASE, type PhaseConfig } from "./phase-config.ts";
import { loadPurchaseReads, type RefreshGraph } from "./purchase-read.ts";
import type { PurchaseRead } from "./purchases.ts";
import { buildProposal, type CampaignInput, type Proposal } from "./rules.ts";
import { planRun, todayLondon, type CycleKind, type RunKind } from "./schedule.ts";
import { pixelSlackMessage, slackMessage } from "./slack.ts";

type Db = Pick<SupabaseClient, "from">;

export const ONSALE_REFRESH_ENV = "ENABLE_ONSALE_REFRESH";

export function isOnsaleRefreshEnabled(env: Record<string, string | undefined>): boolean {
  return env[ONSALE_REFRESH_ENV] === "1";
}

export type ProposalRecord = {
  proposalId: string | null;
  event: EventRow;
  input: CampaignInput;
  proposal: Proposal;
  written: boolean;
  slack: NotifyResult | { sent: false; reason: "dry_run" | "not_ready" };
};

export type RefreshResult =
  | { ok: true; skippedReason: "killswitch" }
  | {
      ok: boolean;
      dryRun: boolean;
      day: string;
      events: number;
      proposals: ProposalRecord[];
      skipped: { eventCode: string | null; reason: string }[];
      driveCalls: number;
      /** Meta reads made for the purchase line (ad-set pixels, pixel names, the domain breakdown). Never a write. */
      metaCalls: number;
      /** Public CIRQLIN page reads (one per crqln.com link). */
      cirqlinReads: number;
      /** HE1: every on-sale event's purchase read, whether or not it got a proposal. */
      purchaseReads: { eventId: string; eventCode: string | null; eventName: string; read: PurchaseRead }[];
      errors: string[];
    };

export type RunRefreshInput = {
  env: Record<string, string | undefined>;
  db: Db;
  now?: Date;
  /** Compute everything, write nothing. */
  dryRun?: boolean;
  /** A hand-started shadow run for this day (reads the data to the day before). */
  shadowDay?: string;
  /** Only these event codes. */
  eventCodes?: readonly string[];
  config?: PhaseConfig;
  /** The operator who owns the rows. Tests pass one; the cron looks it up. */
  userId?: string;
  notify?: (opts: NotifyOptions) => Promise<NotifyResult>;
  /** Meta read access for the purchase line. Null or absent = the line says it was not read. Getters must not retry. */
  graph?: RefreshGraph | null;
  graphReason?: string;
  /** The CIRQLIN page read; tests inject one. */
  fetchImpl?: typeof fetch;
  /** HE1's table: read the domain breakdown of every resolved pixel, not only where an own-domain show needs it. */
  everyPixel?: boolean;
  /** Tests: injected facts. */
  loaders?: Partial<{
    events: typeof loadOnSaleEvents;
    insights: typeof loadInsights;
    aux: typeof loadAux;
    inputs: typeof buildEventInputs;
    purchases: typeof loadPurchaseReads;
  }>;
  appUrl?: string;
};

export async function runOnsaleRefresh(input: RunRefreshInput): Promise<RefreshResult> {
  const dryRun = input.dryRun === true;
  if (!dryRun && !isOnsaleRefreshEnabled(input.env)) return { ok: true, skippedReason: "killswitch" };
  const now = input.now ?? new Date();
  const config = input.config ?? ONSALE_PHASE;
  const day = input.shadowDay ?? todayLondon(now);
  const shadow = Boolean(input.shadowDay);
  const loaders = { events: loadOnSaleEvents, insights: loadInsights, aux: loadAux, inputs: buildEventInputs, purchases: loadPurchaseReads, ...input.loaders };
  const errors: string[] = [];
  const skipped: { eventCode: string | null; reason: string }[] = [];

  let events = await loaders.events(input.db, day);
  if (input.eventCodes?.length) {
    const wanted = new Set(input.eventCodes.map((code) => code.trim().toLowerCase()));
    events = events.filter((event) => wanted.has((event.event_code ?? "").toLowerCase()));
  }
  if (!events.length) return { ok: true, dryRun, day, events: 0, proposals: [], skipped, driveCalls: 0, metaCalls: 0, cirqlinReads: 0, purchaseReads: [], errors };

  // F3: every row, ordered by (date, meta_ad_id) and deduped, so the spend to date is the event's all-time spend.
  const [raw, aux] = await Promise.all([
    loaders.insights(input.db),
    loaders.aux(input.db, events.map((event) => event.id), [...new Set(events.map((event) => event.client_id).filter((id): id is string => Boolean(id)))]),
  ]);
  const { drive, reason: driveReason } = driveForRefresh(input.env);
  if (driveReason) skipped.push({ eventCode: null, reason: `Drive: ${driveReason} — no add lines this run` });

  // E1–E4: each event's purchase read, before any proposal. A failure here costs the purchase line its count, never the run.
  let purchases: Awaited<ReturnType<typeof loadPurchaseReads>> = { reads: new Map(), metaCalls: 0, cirqlinReads: 0, notes: [] };
  try {
    purchases = await loaders.purchases({
      db: input.db,
      events: events.map((event) => ({ id: event.id, event_code: event.event_code, client_id: event.client_id, event_date: event.event_date, signup_url: event.signup_url ?? null, ticket_url: event.ticket_url ?? null })),
      raw,
      day,
      shadow,
      config,
      graph: input.graph ?? null,
      graphReason: input.graphReason,
      fetchImpl: input.fetchImpl,
      now,
      everyPixel: input.everyPixel,
    });
  } catch (err) {
    skipped.push({ eventCode: null, reason: `Purchase read failed: ${err instanceof Error ? err.message : String(err)} — the purchase line says it was not read` });
  }
  for (const note of purchases.notes) skipped.push({ eventCode: null, reason: `Purchase read: ${note}` });
  const purchaseReads = events.flatMap((event) => {
    const read = purchases.reads.get(event.id);
    return read ? [{ eventId: event.id, eventCode: event.event_code, eventName: event.name, read }] : [];
  });

  const proposals: ProposalRecord[] = [];
  let driveCalls = 0;
  let userId = input.userId ?? null;
  for (const event of events) {
    let inputs: EventInputs;
    try {
      inputs = await loaders.inputs({ event, day, shadow, config, raw, aux, drive, purchases: purchases.reads.get(event.id) });
    } catch (err) {
      errors.push(`${event.event_code ?? event.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    driveCalls += inputs.driveCalls;
    if (inputs.plan.showWeek) {
      skipped.push({ eventCode: event.event_code, reason: "show week: the refresh stops, the show-week burst takes over" });
      continue;
    }
    if (!inputs.campaigns.length) {
      skipped.push({ eventCode: event.event_code, reason: "no Meta campaign spent in the window" });
      continue;
    }
    for (const campaign of inputs.campaigns) {
      if (!campaign.adSets.some((set) => set.delivering)) {
        const lastDay = campaign.adSets.map((set) => set.lastDay).sort().at(-1);
        skipped.push({ eventCode: event.event_code, reason: `${campaign.campaignKey}: stopped — no spend since ${lastDay ?? "the window"}` });
        continue;
      }
      const proposal = buildProposal(campaign, config);
      const record: ProposalRecord = { proposalId: null, event, input: campaign, proposal, written: false, slack: { sent: false, reason: "dry_run" } };
      if (!dryRun) {
        try {
          userId ??= await loadOwner(input.db, event);
          record.proposalId = await writeProposal(input.db, { userId, event, campaign, proposal });
          record.written = true;
          if (input.notify) {
            record.slack = await input.notify(
              slackMessage(
                { proposalId: record.proposalId, eventName: event.name, eventCode: event.event_code, eventId: event.id, campaignKey: campaign.campaignKey, plan: campaign.plan, mode: "shadow", proposal },
                input.appUrl ?? input.env.NEXT_PUBLIC_APP_URL ?? "https://app.offpixel.co.uk",
              ),
            );
            if (record.slack.sent) await input.db.from("onsale_refresh_proposals").update({ slack_posted_at: now.toISOString() }).eq("id", record.proposalId);
          } else {
            record.slack = { sent: false, reason: "not_ready" };
          }
        } catch (err) {
          errors.push(`${event.event_code ?? event.id} · ${campaign.campaignKey}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      proposals.push(record);
    }
    // E4: the pixel mismatch goes to Slack once per event (deduped on the event and the pixel pair) until the two match.
    const stored = proposals.find((record) => record.event.id === event.id && record.written);
    const pixelLines = stored?.proposal.why.pixel ?? [];
    const pixel = stored?.input.purchases?.pixel;
    if (!dryRun && input.notify && stored && pixel?.stored && !pixel.matches && pixelLines.length) {
      try {
        await input.notify(pixelSlackMessage({ eventId: event.id, eventName: event.name, eventCode: event.event_code, lines: pixelLines, pixelId: pixel.id, storedPixelId: pixel.stored }));
      } catch (err) {
        errors.push(`${event.event_code ?? event.id} · pixel line: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const result: RefreshResult = { ok: errors.length === 0, dryRun, day, events: events.length, proposals, skipped, driveCalls, metaCalls: purchases.metaCalls, cirqlinReads: purchases.cirqlinReads, purchaseReads, errors };
  console.log(
    `[onsale-refresh] done ok=${result.ok} dry_run=${dryRun} day=${day} events=${events.length} proposals=${proposals.length} lines=${proposals.reduce((n, p) => n + p.proposal.lines.length, 0)} drive_calls=${driveCalls} meta_calls=${purchases.metaCalls} cirqlin_reads=${purchases.cirqlinReads} errors=${errors.length}`,
  );
  return result;
}

/** The event's owner (events.user_id), the row owner the RLS policies read. */
async function loadOwner(db: Db, event: EventRow): Promise<string> {
  const { data, error } = await db.from("events").select("user_id").eq("id", event.id).maybeSingle();
  if (error) throw new Error(`events owner: ${error.message}`);
  const userId = (data as { user_id?: string | null } | null)?.user_id;
  if (!userId) throw new Error(`event ${event.event_code ?? event.id} has no owner`);
  return userId;
}

/** Insert the proposal and its lines; expire the previous proposal's unanswered lines for the campaign. */
export async function writeProposal(db: Db, args: { userId: string; event: EventRow; campaign: CampaignInput; proposal: Proposal }): Promise<string> {
  const { campaign, proposal } = args;
  const inserted = await db
    .from("onsale_refresh_proposals")
    .upsert(
      {
        user_id: args.userId,
        event_id: args.event.id,
        campaign_key: campaign.campaignKey,
        campaign_ids: campaign.campaignIds,
        run_kind: campaign.plan.runKind,
        run_day: campaign.plan.day,
        cycle_monday: campaign.plan.cycleMonday,
        cycle_kind: campaign.plan.cycleKind,
        window_start: campaign.plan.window.start,
        window_end: campaign.plan.window.end,
        mode: "shadow",
        objective: proposal.objective,
        why: proposal.why,
        blockers: proposal.blockers,
        enough_data: proposal.enoughData,
        not_enough_data: proposal.notEnoughData,
        next_check: campaign.plan.nextCheck,
        campaign_summary: proposal.campaignSummary,
        inputs: inputsSnapshot(campaign),
        watch: proposal.watch,
        notes: proposal.notes,
      },
      { onConflict: "event_id,campaign_key,run_kind,window_end" },
    )
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(`onsale_refresh_proposals: ${inserted.error?.message ?? "no row"}`);
  const proposalId = (inserted.data as { id: string }).id;
  // Idempotent per campaign and window: replace this proposal's lines.
  const cleared = await db.from("onsale_refresh_lines").delete().eq("proposal_id", proposalId);
  if (cleared.error) throw new Error(`onsale_refresh_lines clear: ${cleared.error.message}`);
  if (proposal.lines.length) {
    const rows = proposal.lines.map((line, position) => ({
      proposal_id: proposalId,
      user_id: args.userId,
      position: position + 1,
      kind: line.kind,
      rule_id: line.ruleId,
      title: line.title,
      detail: line.detail,
      write_text: line.writeText,
      narrow: line.narrow,
      target: line.target,
      evidence: line.evidence,
      write: line.write,
      adds_spend: line.addsSpend,
      blocked_reason: line.blockedReason,
      supply: line.supply,
      state: "to_review",
    }));
    const written = await db.from("onsale_refresh_lines").insert(rows);
    if (written.error) throw new Error(`onsale_refresh_lines: ${written.error.message}`);
  }
  // R4: unanswered lines of earlier proposals for this campaign expire at the next refresh.
  const earlier = await db.from("onsale_refresh_proposals").select("id").eq("event_id", args.event.id).eq("campaign_key", campaign.campaignKey).neq("id", proposalId);
  if (earlier.error) throw new Error(`earlier proposals: ${earlier.error.message}`);
  const ids = ((earlier.data ?? []) as { id: string }[]).map((row) => row.id);
  if (ids.length) {
    const expired = await db.from("onsale_refresh_lines").update({ state: "expired" }).in("proposal_id", ids).eq("state", "to_review");
    if (expired.error) throw new Error(`expire lines: ${expired.error.message}`);
  }
  return proposalId;
}

type PendingRow = {
  id: string;
  event_id: string;
  campaign_key: string;
  run_kind: RunKind;
  run_day: string;
  cycle_monday: string;
  cycle_kind: CycleKind;
  window_start: string;
  window_end: string;
  mode: "shadow" | "live";
  objective: Proposal["objective"];
  why: Proposal["why"];
  blockers: Proposal["blockers"];
  enough_data: boolean;
  not_enough_data: string | null;
  campaign_summary: string | null;
  watch: Proposal["watch"];
  notes: Proposal["notes"];
  inputs: { purchases?: { pixel?: { id?: string; stored?: string | null; matches?: boolean } | null } } | null;
  events: { id: string; name: string; event_code: string | null; event_date: string | null } | null;
};

/**
 * F2: post the proposals the Monday run could not (notify() returned
 * outside_business_hours at 06:00, so slack_posted_at stayed null). Runs
 * as `?post=pending` at 10:05 London. One post per proposal, deduped on
 * the proposal id; a proposal older than `maxAgeDays` is left alone.
 */
export async function postPendingProposals(args: {
  db: Db;
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  now?: Date;
  appUrl?: string;
  env?: Record<string, string | undefined>;
  config?: PhaseConfig;
  maxAgeDays?: number;
}): Promise<{ ok: boolean; pending: number; posted: string[]; skipped: { proposalId: string; reason: string }[]; errors: string[] }> {
  const now = args.now ?? new Date();
  const config = args.config ?? ONSALE_PHASE;
  const sinceDay = new Date(now.getTime() - (args.maxAgeDays ?? 10) * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await args.db
    .from("onsale_refresh_proposals")
    .select("id, event_id, campaign_key, run_kind, run_day, cycle_monday, cycle_kind, window_start, window_end, mode, objective, why, blockers, enough_data, not_enough_data, campaign_summary, watch, notes, inputs, events:events!inner(id, name, event_code, event_date)")
    .is("slack_posted_at", null)
    .gte("run_day", sinceDay)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`onsale_refresh_proposals pending: ${error.message}`);
  const rows = (data ?? []) as unknown as PendingRow[];
  const posted: string[] = [];
  const skipped: { proposalId: string; reason: string }[] = [];
  const errors: string[] = [];
  const appUrl = args.appUrl ?? args.env?.NEXT_PUBLIC_APP_URL ?? "https://app.offpixel.co.uk";
  const pixelPosted = new Set<string>();
  for (const row of rows) {
    if (!row.events) {
      skipped.push({ proposalId: row.id, reason: "no event" });
      continue;
    }
    try {
      const lines = await args.db.from("onsale_refresh_lines").select("kind").eq("proposal_id", row.id).order("position", { ascending: true });
      if (lines.error) throw new Error(`onsale_refresh_lines: ${lines.error.message}`);
      const plan = planRun({ day: row.run_day, eventDate: row.events.event_date, config, shadow: row.run_kind === "shadow" });
      const proposal: Proposal = {
        objective: row.objective,
        why: row.why,
        blockers: row.blockers ?? [],
        enoughData: row.enough_data,
        notEnoughData: row.not_enough_data,
        lines: ((lines.data ?? []) as { kind: Proposal["lines"][number]["kind"] }[]).map((line) => ({ kind: line.kind }) as unknown as Proposal["lines"][number]),
        watch: row.watch ?? { creatives: [], audiences: [] },
        notes: row.notes ?? { pauses: "", drops: "", adds: "" },
        campaignSummary: row.campaign_summary ?? "",
      };
      const result = await args.notify(
        slackMessage({ proposalId: row.id, eventName: row.events.name, eventCode: row.events.event_code, eventId: row.events.id, campaignKey: row.campaign_key, plan, mode: row.mode, proposal }, appUrl),
      );
      if (result.sent) {
        const marked = await args.db.from("onsale_refresh_proposals").update({ slack_posted_at: now.toISOString() }).eq("id", row.id);
        if (marked.error) throw new Error(`slack_posted_at: ${marked.error.message}`);
        posted.push(row.id);
        // E4: the pixel line the 06:00 run could not post either; once per event, deduped on the pixel pair.
        const pixel = row.inputs?.purchases?.pixel;
        if (row.why.pixel?.length && pixel?.id && pixel.stored && pixel.matches === false && !pixelPosted.has(row.events.id)) {
          pixelPosted.add(row.events.id);
          await args.notify(pixelSlackMessage({ eventId: row.events.id, eventName: row.events.name, eventCode: row.events.event_code, lines: row.why.pixel, pixelId: pixel.id, storedPixelId: pixel.stored ?? null }));
        }
      } else {
        skipped.push({ proposalId: row.id, reason: result.reason ?? "not_sent" });
      }
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`[onsale-refresh] post=pending pending=${rows.length} posted=${posted.length} skipped=${skipped.length} errors=${errors.length}`);
  return { ok: errors.length === 0, pending: rows.length, posted, skipped, errors };
}

/** The figures a line's evidence was read from, without the Drive listing. */
export function inputsSnapshot(campaign: CampaignInput): Record<string, unknown> {
  return {
    campaignIds: campaign.campaignIds,
    resultEvent: campaign.resultEvent,
    window: campaign.plan.window,
    week: { spend: campaign.weekSpend, results: campaign.weekResults },
    sinceOnSale: { spend: campaign.totalSpend, results: campaign.totalResults, firstSpendDay: campaign.totalFirstDay, ic: campaign.sinceOnSale.ic, purchases: campaign.sinceOnSale.purchases, fromDay: campaign.sinceOnSale.fromDay },
    last14: campaign.last14,
    budgetGbp: campaign.budgetGbp,
    spendToDateGbp: Math.round(campaign.spendToDateGbp * 100) / 100,
    ticketingLinked: campaign.ticketingLinked,
    // E1–E4: the purchase read as evidence. attributedPurchases is any show's on the pixel (C2), never this show's.
    purchases: campaign.purchases
      ? {
          state: campaign.purchases.state,
          pixel: campaign.purchases.pixel,
          pixelName: campaign.purchases.pixelName,
          otherPixels: campaign.purchases.otherPixels,
          domain: campaign.purchases.domain,
          domainVia: campaign.purchases.domainVia,
          domainKind: campaign.purchases.domainKind,
          sharedWith: campaign.purchases.sharedWith,
          ticketSite: campaign.purchases.ticketSite,
          landsOn: campaign.purchases.landsOn,
          onDomain: campaign.purchases.onDomain,
          pixelWide: campaign.purchases.pixelWide,
          historyDays: campaign.purchases.historyDays,
          attributedPurchases: { count: campaign.last14.purchases, scope: "any_show_on_pixel" },
          ticketsSold14: campaign.purchases.ticketsSold14,
          notRead: campaign.purchases.notRead,
        }
      : null,
    adSets: campaign.adSets,
    creatives: campaign.ads.map((ad) => ({ adId: ad.adId, adsetId: ad.adsetId, name: ad.name, weekSpend: ad.weekSpend, weekResults: ad.weekResults, totalSpend: ad.totalSpend, totalResults: ad.totalResults, convertScore: ad.convertScore, significant: ad.significant, firstDay: ad.firstDay })),
    supply: campaign.supply.map((file) => ({ fileId: file.fileId, name: file.name, path: file.path, mix: file.mix, alreadyInCampaign: file.alreadyInCampaign, matchedBy: file.matchedBy })),
    claims: campaign.claims.map((claim) => claim.id),
  };
}

/** cron_runs rows_written for the route: proposals stored. */
export function refreshRunLog(body: Record<string, unknown>): { rows: number; detail: Record<string, unknown> } {
  const proposals = Array.isArray(body.proposals) ? (body.proposals as { written?: boolean; proposal?: { lines?: unknown[] } }[]) : [];
  return {
    rows: proposals.filter((row) => row.written).length + (Array.isArray(body.posted) ? body.posted.length : 0),
    detail: { events: body.events ?? 0, lines: proposals.reduce((n, row) => n + (row.proposal?.lines?.length ?? 0), 0), driveCalls: body.driveCalls ?? 0, metaCalls: body.metaCalls ?? 0, cirqlinReads: body.cirqlinReads ?? 0, pending: body.pending ?? 0, posted: Array.isArray(body.posted) ? body.posted.length : 0, errors: Array.isArray(body.errors) ? body.errors.length : 0 },
  };
}
