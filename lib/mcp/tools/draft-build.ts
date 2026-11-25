/**
 * lib/mcp/tools/draft-build.ts — M2b: set_draft_objective,
 * set_draft_ad_sets, set_draft_identity, set_draft_copy,
 * remove_draft_creatives, set_draft_schedule, duplicate_draft.
 *
 * M2's rules, every one: scope mcp:draft, status 'draft' only, the guarded
 * write in lib/mcp/drafts/write.ts (updated_at from get_draft), one
 * mcp_actions row with before → after (counts, ids and fields, never copy),
 * the launch checks after every write, and no Meta call except the page
 * list's GET (set_draft_identity). Each tool makes the wizard's own change
 * for its field, through the wizard's helper:
 *
 *   - set_draft_objective: the Campaign step's objective cards
 *     (lib/wizard/objective-change.ts), and the Budget step's Advantage+
 *     clear when the new objective can't run it (clearUnsupportedAdvantagePlus).
 *   - set_draft_ad_sets: Step 5's row edits (enable, budget, name, age,
 *     Advantage+), "+ Blank ad set" (appendBlankAdSet) for add_broad, and the
 *     Assign step's Assign all. Enabled ad sets under £8 a day are refused
 *     unless override with a reason, which goes into mcp_actions.
 *   - set_draft_identity: launch checks' "Use the live ads' page"
 *     (takeIdentity) for every ad, with the page checked against the
 *     account's page list (the picker's promote_pages).
 *   - set_draft_copy: the creative step's primary texts, headline,
 *     description and CTA (CTA_OPTIONS); artist-voice copy refused (M2's rule).
 *   - remove_draft_creatives: the creative step's delete, and the ads'
 *     assignments with them.
 *   - set_draft_schedule: the Schedule card's start and end (London), without
 *     touching budgets (set_draft_budget also splits the amount).
 *   - duplicate_draft: the library's Duplicate (buildDuplicatedCampaign,
 *     same event), a new draft.
 */
import { z } from "zod";
import { buildDuplicatedCampaign } from "../../campaign-event.ts";
import { takeIdentity } from "../../launch-guard/check.ts";
import { isAdvantageAudienceSupportedForObjective } from "../../meta/advantage-plus-compat.ts";
import { buildPromotedObject } from "../../meta/adset.ts";
import { CTA_OPTIONS } from "../../mock-data.ts";
import { zonedLocalToUtc } from "../../time.ts";
import type { AdSetSuggestion, CampaignDraft, CampaignObjective, CTAType } from "../../types.ts";
import { MAX_ADSET_NAME_LENGTH, UK_NATIONWIDE_FALLBACK, appendBlankAdSet, clearUnsupportedAdvantagePlus } from "../../wizard/adset-suggestions.ts";
import { assignAllCreatives, assignmentCounts, forAdSets, withoutCreatives } from "../../wizard/assignments.ts";
import { generateSuggestions } from "../../wizard/generate-adset-suggestions.ts";
import { patchBudgetSchedule } from "../../wizard/budget-schedule-update.ts";
import { objectiveChangePatch, stampRulesObjective, OBJECTIVE_LABELS } from "../../wizard/objective-change.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { changes, checksSummary, launchChecksFor, requireDraftScope } from "../drafts/common.ts";
import { DRAFT_REFUSALS, assertDraftId, insertDraft, loadWritableDraft, migratedDraft, readDraftRow } from "../drafts/write.ts";
import { artistVoiceCaptions, norm } from "./draft-drive.ts";
import { draftArgs, finish, localOf, round2 } from "./draft-edit.ts";

// ─── set_draft_objective ────────────────────────────────────────────────────

const OBJECTIVES = ["registration", "purchase", "initiate_checkout", "traffic", "awareness"] as const;

/** The pixel event launch sends for this objective and goal (buildPromotedObject), or why none. */
function promotedEventOf(draft: CampaignDraft): string {
  const pixel = draft.settings.metaPixelId || draft.settings.pixelId || "";
  const po = buildPromotedObject(draft.settings.optimisationGoal, draft.settings.objective, pixel || undefined);
  if (po?.custom_event_type) return po.custom_event_type;
  return pixel ? "none (this goal optimises without a pixel event)" : "none (no pixel on this draft)";
}

export const setDraftObjectiveTool: McpTool = {
  name: "set_draft_objective",
  title: "Set a draft's objective",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Changes a draft's campaign objective, as the Campaign step's objective cards do: the optimisation goal becomes the objective's first goal, the name follows only while it is still the suggested \"[CODE] Objective\" name, and the pixel event launch sends follows the objective (registration → COMPLETE_REGISTRATION, purchase → PURCHASE).",
    "If the new objective can't run Advantage+ Audience (awareness), every ad set's Advantage+ is cleared, as the Budget step does. Nothing reaches Meta.",
    'Example: set_draft_objective({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", objective: "registration" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    objective: z.enum(OBJECTIVES).describe("registration, purchase, initiate_checkout, traffic or awareness."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const objective = String(args.objective ?? "") as CampaignObjective;
    if (!(OBJECTIVES as readonly string[]).includes(objective)) throw new ToolInputError(`objective is one of ${OBJECTIVES.join(", ")}.`, { refused: "bad_objective" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const before = { objective: draft.settings.objective, goal: draft.settings.optimisationGoal, name: draft.settings.campaignName, event: promotedEventOf(draft) };
    const settings = { ...draft.settings, ...objectiveChangePatch(draft.settings, objective) };
    const strategy = stampRulesObjective(draft.optimisationStrategy) ?? draft.optimisationStrategy;
    let adSets = draft.adSetSuggestions;
    let advantageCleared = 0;
    if (!isAdvantageAudienceSupportedForObjective(settings.objective, settings.optimisationGoal)) {
      const suggested = adSets.filter((r) => r.sourceType === "custom_group" && draft.audiences.customAudienceGroups.some((g) => g.id === r.sourceId && g.suggestionsOnly));
      if (suggested.length) {
        throw new ToolInputError(
          `${OBJECTIVE_LABELS[objective]} can't run Advantage+ Audience, and ${suggested.map((r) => r.name).join(", ")} only run on Advantage+ suggestions. Remove those ad sets first. Nothing was saved.`,
          { draftId: loaded.row.id, refused: "suggestions_only" },
        );
      }
      const cleared = clearUnsupportedAdvantagePlus(adSets);
      adSets = cleared.suggestions;
      advantageCleared = cleared.clearedCount;
    }
    const next: CampaignDraft = { ...draft, settings, optimisationStrategy: strategy, adSetSuggestions: adSets };
    const after = { objective: settings.objective, goal: settings.optimisationGoal, name: settings.campaignName, event: promotedEventOf(next) };
    const diff = changes([
      ["objective", before.objective, after.objective],
      ["optimisationGoal", before.goal, after.goal],
      ["campaignName", before.name, after.name],
      ["promotedEvent", before.event, after.event],
    ]);
    return finish(ctx, loaded, next, () => ({
      data: {
        objective: `${after.objective} (${OBJECTIVE_LABELS[after.objective]})`,
        optimisationGoal: after.goal,
        promotedEvent: after.event,
        name: after.name,
        nameFollowed: before.name !== after.name,
        advantagePlusCleared: advantageCleared,
        changes: diff,
      },
      summary: {
        fieldsChanged: diff.map((c) => c.field).concat(advantageCleared ? ["adSetSuggestions.advantagePlus"] : []),
        before: { objective: before.objective, goal: before.goal, promotedEvent: before.event },
        after: { objective: after.objective, goal: after.goal, promotedEvent: after.event },
        nameFollowed: before.name !== after.name,
        advantagePlusCleared: advantageCleared,
      },
    }));
  },
};

// ─── set_draft_ad_sets ──────────────────────────────────────────────────────

/** The 25 Nov floor (ad set structure analysis §2, §6): no enabled ad set under £8 a day. */
export const AD_SET_FLOOR_GBP = 8;

const adSetChange = z
  .object({
    ad_set_id: z.string().min(1).max(120).optional().describe("The ad set (an id from get_draft's adSets)."),
    enabled: z.boolean().optional(),
    budget_per_day: z.number().min(0).max(100_000).optional().describe("GBP a day (daily drafts)."),
    budget_lifetime: z.number().min(0).max(1_000_000).optional().describe("GBP for the whole run (lifetime drafts)."),
    name: z.string().min(1).max(MAX_ADSET_NAME_LENGTH).optional(),
    age_min: z.number().int().min(13).max(65).optional(),
    age_max: z.number().int().min(13).max(65).optional(),
    advantage_plus: z.boolean().optional().describe("Advantage+ Audience (the audience becomes a suggestion)."),
    add_broad: z
      .object({
        suggestion_group_id: z.string().min(1).max(120).optional().describe("A page, custom or interest group id (get_draft audiences.groups) to give Meta as Advantage+ suggestions. Leave out for a blank broad ad set."),
      })
      .optional()
      .describe("Add a broad Advantage+ ad set on the draft's locations. The other fields of this change (name, budget, ages) apply to it."),
  })
  .describe("One ad set edit (ad_set_id + fields), or add_broad.");

type AdSetChange = z.infer<typeof adSetChange>;

function findGroup(draft: CampaignDraft, id: string): { kind: "page" | "custom" | "interest"; name: string } | null {
  const a = draft.audiences;
  const pg = a.pageGroups.find((g) => g.id === id);
  if (pg) return { kind: "page", name: pg.name };
  const cg = a.customAudienceGroups.find((g) => g.id === id);
  if (cg) return { kind: "custom", name: cg.name };
  const ig = a.interestGroups.find((g) => g.id === id);
  if (ig) return { kind: "interest", name: ig.name };
  return null;
}

const SOURCE_OF = { page: "page_group", custom: "custom_group", interest: "interest_group" } as const;

/** Scheduled days (the Schedule card's Duration), or 0 when start or end isn't set. */
export function scheduledDays(draft: CampaignDraft): number {
  const bs = draft.budgetSchedule;
  const tz = bs.timezone || "Europe/London";
  const start = bs.startDate ? zonedLocalToUtc(bs.startDate, tz) : null;
  const end = bs.endDate ? zonedLocalToUtc(bs.endDate, tz) : null;
  if (!start || !end || end.getTime() <= start.getTime()) return 0;
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
}

/** An ad set's money a day: its daily budget, or its lifetime share over the scheduled days (null when the days aren't known). */
export function perDayOf(row: AdSetSuggestion, type: "daily" | "lifetime", days: number): number | null {
  if (type === "daily") return row.budgetPerDay ?? 0;
  return days > 0 ? round2((row.budgetLifetime ?? 0) / days) : null;
}

export const setDraftAdSetsTool: McpTool = {
  name: "set_draft_ad_sets",
  title: "Edit a draft's ad sets",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Edits a draft's ad sets as Step 5 does: enable or disable, budget (budget_per_day on daily drafts, budget_lifetime on lifetime ones), rename, ages, Advantage+. Changes apply in order and save together.",
    "add_broad adds a broad Advantage+ ad set on the draft's locations: blank (no audience), or with one audience group as Advantage+ suggestions (suggestion_group_id). assign_all puts every ad in every enabled ad set (the Assign step's Assign all); an ad set needs ads to launch.",
    `Any enabled ad set under £${AD_SET_FLOOR_GBP} a day is refused (small ad sets cost more per result and often return nothing), unless override is true with override_reason, which is logged. Budgets on the campaign (CBO) aren't checked.`,
    'Example: set_draft_ad_sets({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", changes: [{ ad_set_id: "as_ig_123", budget_per_day: 9 }, { ad_set_id: "as_pg_9", enabled: false }, { add_broad: {}, name: "Broad", budget_per_day: 15 }], assign_all: true }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    changes: z.array(adSetChange).max(60).optional(),
    assign_all: z.boolean().optional().describe("After the changes, every ad in every enabled ad set (the Assign step's Assign all)."),
    override: z.boolean().optional().describe(`Allow enabled ad sets under £${AD_SET_FLOOR_GBP} a day. Needs override_reason.`),
    override_reason: z.string().min(5).max(300).optional().describe("Why the floor is overridden. Logged with the change."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const list = (Array.isArray(args.changes) ? args.changes : []) as AdSetChange[];
    const assignAll = args.assign_all === true;
    if (list.length === 0 && !assignAll) throw new ToolInputError("Give changes or assign_all.", { refused: "nothing_to_do" });
    const override = args.override === true;
    const reason = typeof args.override_reason === "string" ? args.override_reason.trim() : "";
    if (override && reason.length < 5) throw new ToolInputError("override needs override_reason: why this ad set runs under the floor.", { refused: "override_without_reason" });

    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const bs = draft.budgetSchedule;
    const type = bs.budgetType;
    const onCampaign = bs.budgetLevel === "campaign";
    const advantageOk = isAdvantageAudienceSupportedForObjective(draft.settings.objective, draft.settings.optimisationGoal);
    const refuse = (msg: string, refused: string, extra: Record<string, unknown> = {}) => new ToolInputError(`${msg} Nothing was saved.`, { draftId: loaded.row.id, refused, ...extra });

    let rows = [...draft.adSetSuggestions];
    const touched = new Set<string>();
    const added: string[] = [];
    let stamp = ctx.now.getTime();
    for (const ch of list) {
      const fields = { ...ch };
      if (fields.budget_per_day != null && fields.budget_lifetime != null) throw refuse("Give budget_per_day or budget_lifetime, not both.", "two_budgets");
      if (onCampaign && (fields.budget_per_day != null || fields.budget_lifetime != null)) throw refuse("This draft's budget is on the campaign, so ad sets have no budget of their own. Use set_draft_budget.", "budget_on_campaign");
      if (fields.budget_per_day != null && type === "lifetime") throw refuse("This draft's budget is lifetime: give budget_lifetime (GBP for the run).", "daily_on_lifetime");
      if (fields.budget_lifetime != null && type === "daily") throw refuse("This draft's budget is daily: give budget_per_day.", "lifetime_on_daily");

      let id: string;
      if (fields.add_broad) {
        if (fields.ad_set_id) throw refuse("add_broad makes a new ad set: leave ad_set_id out.", "bad_change");
        if (!advantageOk) throw refuse(`${OBJECTIVE_LABELS[draft.settings.objective]} campaigns can't run Advantage+ Audience, so there's no broad ad set.`, "advantage_unsupported");
        const gid = fields.add_broad.suggestion_group_id;
        stamp += 1;
        if (!gid) {
          rows = appendBlankAdSet(rows, bs, bs.locationGroups ?? []);
          const row = rows[rows.length - 1]!;
          id = `as_blank_${stamp}`;
          rows[rows.length - 1] = { ...row, id, name: fields.name ?? "Broad", nameSource: "operator" };
        } else {
          const group = findGroup(draft, gid);
          if (!group) throw refuse(`There's no audience group ${gid} on this draft.`, "unknown_group");
          // Generate's row for that one group, as a broad Advantage+ copy.
          const only = { ...draft.audiences, pageGroups: [], customAudienceGroups: [], interestGroups: [], savedAudiences: { audienceIds: [] }, selectedPagesLookalikeGroups: [] } as CampaignDraft["audiences"];
          if (group.kind === "page") only.pageGroups = draft.audiences.pageGroups.filter((g) => g.id === gid).map((g) => ({ ...g, lookalike: false }));
          // Generate skips a suggestions-only group; this row is Advantage+, so the group may seed it.
          if (group.kind === "custom") only.customAudienceGroups = draft.audiences.customAudienceGroups.filter((g) => g.id === gid).map((g) => ({ ...g, lookalike: false, suggestionsOnly: false }));
          if (group.kind === "interest") only.interestGroups = draft.audiences.interestGroups.filter((g) => g.id === gid);
          const gen = generateSuggestions(only, 0, bs.locationGroups ?? [], UK_NATIONWIDE_FALLBACK).find((r) => r.sourceType === SOURCE_OF[group.kind]);
          if (!gen) throw refuse(`Group ${group.name} has no audiences in it, so it can't be a suggestion.`, "empty_group");
          const base = appendBlankAdSet(rows, bs, bs.locationGroups ?? []).at(-1)!;
          id = `as_broad_${stamp}`;
          rows = [
            ...rows,
            {
              ...gen,
              id,
              name: (fields.name ?? `Broad + ${group.name}`).slice(0, MAX_ADSET_NAME_LENGTH),
              nameSource: "operator",
              advantagePlus: true,
              enabled: true,
              locationTier: undefined,
              budgetPerDay: base.budgetPerDay,
              ...(type === "lifetime" ? { budgetLifetime: base.budgetLifetime } : {}),
            },
          ];
        }
        added.push(id);
      } else {
        if (!fields.ad_set_id) throw refuse("Each change names an ad_set_id from get_draft, or is add_broad.", "bad_change");
        id = fields.ad_set_id;
        if (!rows.some((r) => r.id === id)) throw refuse(`There's no ad set ${id} on this draft.`, "unknown_ad_set");
      }
      const at = rows.findIndex((r) => r.id === id);
      const row = rows[at]!;
      const patch: Partial<AdSetSuggestion> = {};
      if (fields.enabled != null) patch.enabled = fields.enabled;
      if (fields.budget_per_day != null) patch.budgetPerDay = round2(fields.budget_per_day);
      if (fields.budget_lifetime != null) patch.budgetLifetime = round2(fields.budget_lifetime);
      if (fields.name != null && !fields.add_broad) Object.assign(patch, { name: fields.name.trim().slice(0, MAX_ADSET_NAME_LENGTH), nameSource: "operator" as const });
      if (fields.age_min != null) patch.ageMin = fields.age_min;
      if (fields.age_max != null) patch.ageMax = fields.age_max;
      if (fields.advantage_plus != null) {
        if (row.sourceType === "blank" && !fields.advantage_plus) throw refuse("A blank ad set always runs Advantage+ Audience: there's no audience to hold it to.", "blank_is_advantage");
        const sourceGroup = row.sourceType === "custom_group" ? draft.audiences.customAudienceGroups.find((g) => g.id === row.sourceId) : undefined;
        if (!fields.advantage_plus && sourceGroup?.suggestionsOnly) throw refuse(`${row.name} runs on ${sourceGroup.name}, which is Advantage+ suggestions only: it can't be targeted directly.`, "suggestions_only");
        if (fields.advantage_plus && !advantageOk) throw refuse(`${OBJECTIVE_LABELS[draft.settings.objective]} campaigns can't run Advantage+ Audience.`, "advantage_unsupported");
        patch.advantagePlus = fields.advantage_plus;
      }
      const next = { ...row, ...patch };
      if (next.ageMin > next.ageMax) throw refuse(`${next.name}: age_min (${next.ageMin}) is above age_max (${next.ageMax}).`, "bad_ages");
      rows[at] = next;
      touched.add(id);
    }

    // The floor, on the whole draft as it would be saved.
    const days = scheduledDays(draft);
    const under = onCampaign
      ? []
      : rows
          .filter((r) => r.enabled)
          .map((r) => ({ id: r.id, name: r.name, perDay: perDayOf(r, type, days) }))
          .filter((r): r is { id: string; name: string; perDay: number } => r.perDay != null && r.perDay < AD_SET_FLOOR_GBP);
    const unknownDays = !onCampaign && type === "lifetime" && days === 0;
    if (under.length > 0 && !override) {
      throw new ToolInputError(
        `${under.length === 1 ? "1 enabled ad set is" : `${under.length} enabled ad sets are`} under £${AD_SET_FLOOR_GBP} a day: ${under.map((u) => `${u.name} £${u.perDay.toFixed(2)}`).join(", ")}. Raise them, disable them, or give override with override_reason. Nothing was saved.`,
        { draftId: loaded.row.id, refused: "under_floor", floorGbp: AD_SET_FLOOR_GBP, adSets: under.map((u) => ({ id: u.id, perDay: u.perDay })) },
        { underFloor: under },
      );
    }
    const floorOverride = under.length > 0 ? { reason, floorGbp: AD_SET_FLOOR_GBP, adSets: under.map((u) => ({ id: u.id, name: u.name, perDay: u.perDay })) } : null;

    const assignments = assignAll ? assignAllCreatives(rows, draft.creatives) : forAdSets(draft.creativeAssignments, rows);
    const next: CampaignDraft = { ...draft, adSetSuggestions: rows, creativeAssignments: assignments };
    const enabled = rows.filter((r) => r.enabled);
    const total = round2(enabled.reduce((s, r) => s + (perDayOf(r, type, days) ?? 0), 0));
    const counts = assignmentCounts(assignments, rows);
    return finish(ctx, loaded, next, () => ({
      data: {
        adSets: rows.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          source: r.sourceType,
          advantagePlus: r.sourceType === "blank" || r.advantagePlus,
          perDayGbp: perDayOf(r, type, days),
          ...(type === "lifetime" ? { lifetimeGbp: r.budgetLifetime ?? 0 } : {}),
          ages: `${r.ageMin}-${r.ageMax}`,
          ads: (assignments[r.id] ?? []).length,
        })),
        added,
        enabled: enabled.length,
        totalPerDayGbp: onCampaign ? null : total,
        budgetsOn: onCampaign ? "campaign" : "ad sets",
        assignments: counts,
        floorOverride,
        ...(unknownDays ? { note: "This lifetime draft has no end date, so the £8-a-day floor couldn't be checked. Set the schedule." } : {}),
      },
      summary: {
        fieldsChanged: ["adSetSuggestions", ...(assignAll ? ["creativeAssignments"] : [])],
        before: { adSets: draft.adSetSuggestions.length, enabled: draft.adSetSuggestions.filter((r) => r.enabled).length },
        after: { adSets: rows.length, enabled: enabled.length, totalPerDayGbp: onCampaign ? null : total },
        touched: [...touched],
        added,
        assignments: counts,
        floorOverride,
      },
    }));
  },
};

// ─── set_draft_identity ─────────────────────────────────────────────────────

export const setDraftIdentityTool: McpTool = {
  name: "set_draft_identity",
  title: "Set the page and Instagram a draft's ads run from",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Sets the Facebook page (and Instagram) a draft runs from: on the draft's settings and on every ad, as the launch checks' \"Use the live ads' page\" does. keep_page_ids leaves ads on those pages (an artist's page) as they are.",
    "The page must be one the draft's ad account can run ads from (the page picker's list, read from Meta with one GET); any other is refused. Without instagram_actor_id the ads take the page's linked Instagram when Meta has one, else none.",
    'Example: set_draft_identity({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", page_id: "769954239540040" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    page_id: z.string().regex(/^\d{5,25}$/).describe("The Facebook page id."),
    instagram_actor_id: z.string().regex(/^\d{5,25}$/).optional().describe("The Instagram account id. Default: the page's linked one."),
    keep_page_ids: z.array(z.string().regex(/^\d{5,25}$/)).max(20).optional().describe("Ads on these pages keep their page and Instagram."),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const pageId = String(args.page_id ?? "");
    const igArg = typeof args.instagram_actor_id === "string" ? args.instagram_actor_id : null;
    const keep = new Set((Array.isArray(args.keep_page_ids) ? args.keep_page_ids : []).map(String));
    if (keep.has(pageId)) throw new ToolInputError("page_id can't also be in keep_page_ids.", { refused: "bad_keep" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const account = draft.settings.metaAdAccountId || draft.settings.adAccountId || loaded.row.ad_account_id || "";
    if (!account) throw new ToolInputError("This draft has no ad account, so its pages can't be checked. Set the ad account first.", { draftId: loaded.row.id, refused: "no_account" });

    let list: Awaited<ReturnType<typeof deps.pagesForAccount>>;
    try {
      list = await deps.pagesForAccount({ userId: ctx.userId, adAccountId: account });
    } catch {
      throw new ToolInputError("Meta's page list didn't answer, so the page couldn't be checked. Nothing was saved. Try again.", { draftId: loaded.row.id, refused: "page_list_failed" });
    }
    const page = list.pages.find((p) => p.id === pageId);
    if (!page) {
      throw new ToolInputError(
        `Page ${pageId} isn't one ${account} can run ads from${list.truncated ? " (in the first pages of its list)" : ""}. Nothing was saved.`,
        { draftId: loaded.row.id, refused: "page_not_usable", pages: list.pages.length, metaGets: list.metaGets },
        { pages: list.pages.slice(0, 30).map((p) => ({ id: p.id, name: p.name })), metaGets: list.metaGets },
      );
    }
    const ig = igArg ?? page.instagramId ?? "";

    // Every page the draft runs from, except those kept: settings' and the ads'.
    const oldPages = new Set(
      [draft.settings.metaPageId, ...draft.creatives.map((c) => c.identity?.pageId)].filter((p): p is string => Boolean(p) && !keep.has(p!)),
    );
    let next: CampaignDraft = draft;
    for (const from of oldPages) if (from !== pageId) next = takeIdentity(next, "page", from, pageId);
    // Ads with no page yet take it too.
    const moved = new Set<string>();
    next = {
      ...next,
      settings: { ...next.settings, metaPageId: pageId, metaIGAccountId: ig || undefined, channelDefaultsApplied: undefined },
      creatives: next.creatives.map((c) => {
        const was = draft.creatives.find((d) => d.id === c.id)!;
        if (was.identity?.pageId && keep.has(was.identity.pageId)) return c;
        moved.add(c.id);
        // takeIdentity's Instagram rule: both ids together.
        return { ...c, identity: { ...(c.identity ?? { pageId, instagramAccountId: "" }), pageId, instagramAccountId: ig, instagramActorId: ig } };
      }),
    };
    const kept = draft.creatives.length - moved.size;
    return finish(ctx, loaded, next, () => ({
      data: {
        page: { id: page.id, name: page.name },
        instagram: ig || null,
        instagramFrom: igArg ? "given" : page.instagramId ? "the page's linked Instagram" : "none: the page has no linked Instagram",
        ads: moved.size,
        keptOnTheirPage: kept,
        replacedPages: [...oldPages].filter((p) => p !== pageId),
        metaGets: list.metaGets,
      },
      summary: {
        fieldsChanged: ["settings.metaPageId", "settings.metaIGAccountId", "creatives.identity"],
        before: { page: draft.settings.metaPageId ?? null, ig: draft.settings.metaIGAccountId ?? null, adPages: [...new Set(draft.creatives.map((c) => c.identity?.pageId).filter(Boolean))] },
        after: { page: pageId, ig: ig || null },
        ads: moved.size,
        kept,
        metaGets: list.metaGets,
      },
    }));
  },
};

// ─── set_draft_copy ─────────────────────────────────────────────────────────

const CTAS = CTA_OPTIONS.map((o) => o.value) as [CTAType, ...CTAType[]];

export const setDraftCopyTool: McpTool = {
  name: "set_draft_copy",
  title: "Set a draft's ad copy",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Sets ad copy on every ad, or the ads in ad_ids (creative ids from get_draft): primary_texts (1 to 5 variants, replacing the ad's), headline, description and cta. Only the fields given change.",
    `cta is one of the creative step's: ${CTA_OPTIONS.map((o) => `${o.value} (${o.label})`).join(", ")}. Artist-voice copy (one of the event's artist_first_person captions in the Lab) is refused until caption approvals exist.`,
    'Example: set_draft_copy({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", primary_texts: ["Enzo Siragusa. Electric Brixton. Sign up for presale."], headline: "Enzo Siragusa · Electric Brixton", cta: "sign_up" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    primary_texts: z.array(z.string().min(1).max(2200)).min(1).max(5).optional(),
    headline: z.string().max(255).optional(),
    description: z.string().max(255).optional(),
    cta: z.enum(CTAS).optional(),
    ad_ids: z.array(z.string().min(1).max(80)).max(200).optional().describe("Only these ads. Leave out for every ad."),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const texts = Array.isArray(args.primary_texts) ? (args.primary_texts as string[]).map((t) => t.trim()).filter(Boolean) : null;
    const headline = typeof args.headline === "string" ? args.headline.trim() : null;
    const description = typeof args.description === "string" ? args.description.trim() : null;
    const cta = args.cta == null ? null : (String(args.cta) as CTAType);
    if (cta && !CTAS.includes(cta)) throw new ToolInputError(`cta is one of ${CTAS.join(", ")}.`, { refused: "bad_cta" });
    if (!texts?.length && headline == null && description == null && !cta) throw new ToolInputError("Give primary_texts, headline, description or cta.", { refused: "nothing_to_do" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    if (draft.creatives.length === 0) throw new ToolInputError("This draft has no ads yet, so there's no copy to set.", { draftId: loaded.row.id, refused: "no_ads" });
    const ids = Array.isArray(args.ad_ids) ? (args.ad_ids as string[]) : null;
    if (ids) {
      const unknown = ids.filter((id) => !draft.creatives.some((c) => c.id === id));
      if (unknown.length) throw new ToolInputError(`These ad ids aren't in this draft: ${unknown.slice(0, 10).join(", ")}.`, { draftId: loaded.row.id, refused: "unknown_ads" });
    }
    const eventId = draft.settings.eventId || loaded.row.event_id;
    const copy = [...(texts ?? []), headline, description].filter((t): t is string => Boolean(t && norm(t)));
    if (eventId && copy.length) {
      const voices = await artistVoiceCaptions(ctx, eventId);
      if (copy.some((t) => voices.some((v) => norm(t) === v || norm(t).includes(v)))) {
        throw new ToolInputError("This copy is an artist-voice caption. Artist-voice copy can't be added from here until the artist team's OK can be recorded (R8).", { draftId: loaded.row.id, refused: "artist_voice" });
      }
    }
    const touched = draft.creatives.filter((c) => !ids || ids.includes(c.id));
    const next: CampaignDraft = {
      ...draft,
      creatives: draft.creatives.map((c) => {
        if (ids && !ids.includes(c.id)) return c;
        return {
          ...c,
          ...(texts?.length ? { captions: texts.map((text) => ({ id: deps.newId(), text })) } : {}),
          ...(headline != null ? { headline } : {}),
          ...(description != null ? { description } : {}),
          ...(cta ? { cta } : {}),
        };
      }),
    };
    const fields = [texts?.length ? "captions" : null, headline != null ? "headline" : null, description != null ? "description" : null, cta ? "cta" : null].filter((f): f is string => Boolean(f));
    return finish(ctx, loaded, next, () => ({
      data: { ads: touched.length, fields, primaryTexts: texts?.length ?? null, cta: cta ?? null },
      summary: {
        fieldsChanged: fields.map((f) => `creatives.${f}`),
        ads: touched.length,
        adIds: touched.map((c) => c.id),
        // Lengths only: copy stays out of the log.
        after: { primaryTexts: texts?.length ?? null, headlineChars: headline?.length ?? null, descriptionChars: description?.length ?? null, cta },
      },
    }));
  },
};

// ─── remove_draft_creatives ─────────────────────────────────────────────────

export const removeDraftCreativesTool: McpTool = {
  name: "remove_draft_creatives",
  title: "Remove ads from a draft",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Removes ads from a draft, as the creative step's delete does, and takes them out of every ad set's assignments. Give creative_ids to remove those, or all_except to keep only those (all_except: [] removes every ad). Files stay in Storage; nothing reaches Meta.",
    'Example: remove_draft_creatives({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", all_except: [] }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    creative_ids: z.array(z.string().min(1).max(80)).min(1).max(200).optional(),
    all_except: z.array(z.string().min(1).max(80)).max(200).optional().describe("Keep only these ads; [] removes every ad."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const given = Array.isArray(args.creative_ids) ? (args.creative_ids as string[]) : null;
    const except = Array.isArray(args.all_except) ? (args.all_except as string[]) : null;
    if ((given ? 1 : 0) + (except ? 1 : 0) !== 1) throw new ToolInputError("Give creative_ids or all_except, one of them.", { refused: "bad_args" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const known = new Set(draft.creatives.map((c) => c.id));
    const named = given ?? except ?? [];
    const unknown = named.filter((id) => !known.has(id));
    if (unknown.length) throw new ToolInputError(`These ad ids aren't in this draft: ${unknown.slice(0, 10).join(", ")}. Nothing was saved.`, { draftId: loaded.row.id, refused: "unknown_ads" });
    const remove = new Set(given ?? draft.creatives.map((c) => c.id).filter((id) => !except!.includes(id)));
    if (remove.size === 0) throw new ToolInputError("Nothing to remove: every ad is kept.", { draftId: loaded.row.id, refused: "nothing_to_do" });
    const next: CampaignDraft = { ...draft, creatives: draft.creatives.filter((c) => !remove.has(c.id)), creativeAssignments: withoutCreatives(draft.creativeAssignments, remove) };
    return finish(ctx, loaded, next, () => ({
      data: { removed: [...remove].length, left: next.creatives.length, removedNames: draft.creatives.filter((c) => remove.has(c.id)).map((c) => c.name).slice(0, 40) },
      summary: {
        fieldsChanged: ["creatives", "creativeAssignments"],
        before: { creatives: draft.creatives.length },
        after: { creatives: next.creatives.length },
        removedIds: [...remove],
      },
    }));
  },
};

// ─── set_draft_schedule ─────────────────────────────────────────────────────

export const setDraftScheduleTool: McpTool = {
  name: "set_draft_schedule",
  title: "Set a draft's start and end",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Sets a draft's start and end, as the Schedule card does, without touching any budget (set_draft_budget also re-splits the amount over the ad sets; this doesn't). London time: YYYY-MM-DD or YYYY-MM-DDTHH:mm; a day alone starts at 00:00 and ends at 23:59.",
    "A start in the past and an end before the start are refused. Returns the days and each ad set's money a day on lifetime drafts.",
    'Example: set_draft_schedule({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", start: "2026-12-01T10:00", end: "2026-12-14" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    start: z.string().min(10).max(16).describe("YYYY-MM-DD or YYYY-MM-DDTHH:mm, London time, not in the past."),
    end: z.string().min(10).max(16).describe("YYYY-MM-DD or YYYY-MM-DDTHH:mm, after the start."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const start = localOf(args.start, "start");
    const end = localOf(args.end, "end");
    if (!start) throw new ToolInputError("Give start as YYYY-MM-DD or YYYY-MM-DDTHH:mm.", { refused: "bad_start" });
    if (!end) throw new ToolInputError("Give end as YYYY-MM-DD or YYYY-MM-DDTHH:mm.", { refused: "bad_end" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const bs = draft.budgetSchedule;
    const tz = bs.timezone || "Europe/London";
    const startAt = zonedLocalToUtc(start, tz);
    const endAt = zonedLocalToUtc(end, tz);
    if (!startAt || !endAt) throw new ToolInputError("Give start and end as YYYY-MM-DD or YYYY-MM-DDTHH:mm.", { refused: "bad_dates" });
    if (startAt.getTime() < ctx.now.getTime()) throw new ToolInputError(`The start (${start}, ${tz}) is in the past. Give a start from now on.`, { draftId: loaded.row.id, refused: "start_in_past" });
    if (endAt.getTime() <= startAt.getTime()) throw new ToolInputError(`The end (${end}) is before the start (${start}).`, { draftId: loaded.row.id, refused: "end_before_start" });
    const nextBs = patchBudgetSchedule(bs, { startDate: start, startDateSource: "operator", endDate: end, endDateSource: "operator", endDatePhase: undefined });
    const next: CampaignDraft = { ...draft, budgetSchedule: nextBs };
    const days = scheduledDays(next);
    const diff = changes([
      ["startDate", bs.startDate, start],
      ["endDate", bs.endDate, end],
    ]);
    const lifetime = bs.budgetType === "lifetime" && bs.budgetLevel !== "campaign";
    return finish(ctx, loaded, next, () => ({
      data: {
        start,
        end,
        timezone: tz,
        days,
        changes: diff,
        ...(lifetime ? { adSetsPerDayGbp: draft.adSetSuggestions.filter((r) => r.enabled).map((r) => ({ id: r.id, name: r.name, perDayGbp: perDayOf(r, "lifetime", days) })) } : {}),
      },
      summary: { fieldsChanged: diff.map((c) => c.field), before: { start: bs.startDate || null, end: bs.endDate || null }, after: { start, end, days } },
    }));
  },
};

// ─── duplicate_draft ────────────────────────────────────────────────────────

export const duplicateDraftTool: McpTool = {
  name: "duplicate_draft",
  title: "Duplicate a draft",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Copies a draft (any status) as a new draft for the same event, as the library's Duplicate does: everything is kept, the name gets \"(Copy)\" unless name is given, and the copy has no launch record. For a test's second arm. Nothing launches.",
    "Returns the new draft's id and updated_at, and its launch checks.",
    'Example: duplicate_draft({ draft_id: "3f2c…-uuid", name: "[ES27-ENZOSIRAGUSA] Teaser · B condensed" }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft to copy (a UUID from get_drafts)."),
    name: z.string().min(1).max(200).optional().describe("The copy's campaign name. Default: the source's name + (Copy)."),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const id = assertDraftId(args.draft_id);
    const row = await readDraftRow(ctx.db, id);
    if (!row || !row.draft_json) throw new ToolInputError(DRAFT_REFUSALS.notFound(id), { sourceDraftId: id, refused: "not_found" });
    if (row.user_id !== ctx.userId) throw new ToolInputError(DRAFT_REFUSALS.notYours, { sourceDraftId: id, refused: "not_owner" });
    const source = migratedDraft(ctx, row);
    const eventId = source.settings.eventId || row.event_id;
    if (!eventId) throw new ToolInputError("This draft has no event, and Duplicate keeps the copy on its event. Set the event in the app first.", { sourceDraftId: id, refused: "no_event" });
    const ev = await ctx.db.from("events").select("id, event_code, client_id, name, venue_city, venue_name, event_date").eq("id", eventId).maybeSingle();
    if (ev.error || !ev.data) throw new ToolInputError("Can't find this draft's event.", { sourceDraftId: id, refused: "event_not_found" });
    const copy = buildDuplicatedCampaign(source, ev.data as { id: string }, ctx.now.toISOString(), deps.newId());
    const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : null;
    const draft: CampaignDraft = name ? { ...copy, settings: { ...copy.settings, campaignName: name } } : copy;
    const saved = await insertDraft(ctx, draft);
    const checks = await launchChecksFor(ctx, draft);
    return {
      data: { draft_id: saved.id, updated_at: saved.updatedAt, status: "draft", name: draft.settings.campaignName, from: id, launchChecks: checks },
      eventId,
      clientId: row.client_id,
      summary: {
        sourceDraftId: id,
        draftId: saved.id,
        before: null,
        after: { status: "draft", creatives: draft.creatives.length, adSets: draft.adSetSuggestions.length },
        fieldsChanged: ["new draft"],
        ...checksSummary(checks),
      },
    };
  },
};
