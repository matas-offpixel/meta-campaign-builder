/**
 * lib/mcp/tools/draft-edit.ts — set_draft_link, set_draft_locations,
 * set_draft_budget, apply_audience_template, archive_draft (M2).
 *
 * Each one is what the wizard does on the same field, through the same
 * helpers, saved with lib/mcp/drafts/write.ts (status draft only, guarded
 * on updated_at). After the write the launch checks run (runLaunchGuard)
 * and come back with the answer.
 *
 *   - set_draft_link: every ad's destinationUrl, as the creative step's
 *     Link field sets it. https only. link_not_event's words (RC3) when the
 *     URL is neither the event's signup page nor its ticket link.
 *   - set_draft_locations: Step 5's location picker (components/steps/
 *     budget-schedule.tsx): a searched city becomes a `manual_…` group
 *     (selectionFromGeoResult + clampCityRadius), a pin a manualPinGroup, the
 *     Leeds preset presetPinGroup; tiers through withGroupTier, tiered ad sets
 *     follow (followLocationTiers), and "Add to every ad set" is
 *     addLocationToEveryAdSet. A city search is Meta adgeolocation through
 *     the location-search route's logic (ctx.draft.geoSearch), GETs only.
 *     Key 811209 (Leeds, Kent) raises LP4's region line.
 *   - set_draft_budget: the Budget and Schedule cards: type (with
 *     convertAdSetBudgetsOnTypeChange, as the Daily / Lifetime switch),
 *     amount, then Distribute's even split over enabled ad sets when budgets
 *     are on the ad sets; start and end as typed dates (source "operator").
 *   - apply_audience_template: the Audience templates tab's Add to this
 *     draft, Reused audiences only (lib/mcp/drafts/templates.ts).
 *   - archive_draft: the library's Archive (status column only); the
 *     library's Unarchive brings it back. Never deletes.
 */
import { z } from "zod";
import { PIN_PRESETS, isPresetPinGroup, manualPinGroup, pinSelection, presetPinGroup, regionMismatchForCityKey, validatePinForm } from "../../meta/location-pins.ts";
import { selectionFromGeoResult, type LocationSearchHit } from "../../meta/location-search.ts";
import { clampCityRadius } from "../../meta/location-radius.ts";
import { groupTier, withGroupTier } from "../../meta/location-targeting.ts";
import { displayUrl } from "../../replicate/replicate.ts";
import { zonedLocalToUtc } from "../../time.ts";
import type { CampaignDraft, LocationSelection, LocationTargetingGroup, LocationTier } from "../../types.ts";
import { addLocationToEveryAdSet, adSetsTargetingLocation, convertAdSetBudgetsOnTypeChange, followLocationTiers } from "../../wizard/adset-suggestions.ts";
import { mapExcludedLocations, mapLocationGroups, patchBudgetSchedule } from "../../wizard/budget-schedule-update.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { changes, checksSummary, launchChecksFor, linkKey, requireDraftScope } from "../drafts/common.ts";
import { APPLY_WORDS, addReusedToDraft, applySentences, loadTemplatesFor, templateGroupId } from "../drafts/templates.ts";
import { followAudienceGroups, groupKey } from "../../wizard/follow-audience-groups.ts";
import { archiveDraftRow, loadWritableDraft, saveDraft, type WritableDraft } from "../drafts/write.ts";
import { NAME_WORDS } from "../meta/words.ts";

export const draftArgs = {
  draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
  updated_at: z.string().min(10).max(40).describe("The draft's updatedAt exactly as get_draft returned it. A draft changed since then is refused."),
};

/** RC3's link_not_event sentence (words-rc-2026-11-24.tsv rows link_not_event and link_not_event.one). */
export const LINK_NOT_EVENT_WORDS = {
  many: "Link isn’t this event’s page: {url} in {n} ads. The event’s page is {signup url}.",
  one: "Link isn’t this event’s page: {url} in 1 ad. The event’s page is {signup url}.",
} as const;

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

interface EventLinks {
  id: string;
  event_code: string | null;
  signup_url: string | null;
  ticket_url: string | null;
}

async function eventLinks(ctx: ToolContext, eventId: string | null | undefined): Promise<EventLinks | null> {
  if (!eventId) return null;
  const res = await ctx.db.from("events").select("id, event_code, signup_url, ticket_url").eq("id", eventId).maybeSingle();
  if (res.error || !res.data) return null;
  return res.data as EventLinks;
}

export async function finish(
  ctx: ToolContext,
  loaded: WritableDraft,
  next: CampaignDraft,
  build: (updatedAt: string) => { data: Record<string, unknown>; summary: Record<string, unknown> },
) {
  const saved = await saveDraft(ctx, loaded, next);
  const checks = await launchChecksFor(ctx, saved.draft);
  const { data, summary } = build(saved.updatedAt);
  return {
    data: { draft_id: loaded.row.id, updated_at: saved.updatedAt, ...data, launchChecks: checks },
    eventId: loaded.row.event_id,
    clientId: loaded.row.client_id,
    summary: { draftId: loaded.row.id, ...summary, ...checksSummary(checks) },
  };
}

// ─── set_draft_link ─────────────────────────────────────────────────────────

export const setDraftLinkTool: McpTool = {
  name: "set_draft_link",
  title: "Set a draft's ad link",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Sets where a draft's ads send people (each ad's link). Every ad by default, or only the ads in ad_ids (creative ids from get_draft).",
    "The URL must be https. If it isn't the event's signup page or ticket link, the answer carries a link_not_event warning; the link is still saved.",
    'Example: set_draft_link({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", url: "https://crqln.com/l/glitterbox-newcastle" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    url: z.string().min(9).max(2000).describe("The https link the ads send people to."),
    ad_ids: z.array(z.string().min(1).max(80)).max(200).optional().describe("Only these ads (creative ids from get_draft). Leave out for every ad."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    let url: URL;
    try {
      url = new URL(String(args.url ?? "").trim());
    } catch {
      throw new ToolInputError("Give the link as a full https URL.", { refused: "bad_url" });
    }
    if (url.protocol !== "https:") throw new ToolInputError("The link must start with https://.", { refused: "not_https" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const ids = Array.isArray(args.ad_ids) ? (args.ad_ids as string[]) : null;
    if (ids) {
      const known = new Set(draft.creatives.map((c) => c.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length) throw new ToolInputError(`These ad ids aren't in this draft: ${unknown.slice(0, 10).join(", ")}.`, { draftId: loaded.row.id, refused: "unknown_ads" });
    }
    if (draft.creatives.length === 0) throw new ToolInputError("This draft has no ads yet, so there's no link to set.", { draftId: loaded.row.id, refused: "no_ads" });
    const value = url.toString();
    const touched = draft.creatives.filter((c) => !ids || ids.includes(c.id));
    const before = touched.map((c) => linkKey(c.destinationUrl));
    const next: CampaignDraft = {
      ...draft,
      creatives: draft.creatives.map((c) => (!ids || ids.includes(c.id) ? { ...c, destinationUrl: value } : c)),
    };

    const ev = await eventLinks(ctx, draft.settings.eventId);
    const eventPages = [ev?.signup_url, ev?.ticket_url].map(linkKey).filter((k): k is string => Boolean(k));
    const warnings: Array<{ key: string; sentence: string }> = [];
    if (!eventPages.includes(linkKey(value) ?? "")) {
      const page = ev?.signup_url || ev?.ticket_url;
      const n = touched.length;
      warnings.push({
        key: "link_not_event",
        sentence: fill(n === 1 ? LINK_NOT_EVENT_WORDS.one : LINK_NOT_EVENT_WORDS.many, {
          url: displayUrl(value),
          n,
          "signup url": page ? displayUrl(page) : "not set",
        }),
      });
    }
    return finish(ctx, loaded, next, () => ({
      data: { ads: touched.length, link: displayUrl(value), warnings },
      summary: {
        fieldsChanged: ["creatives.destinationUrl"],
        ads: touched.length,
        before: { links: [...new Set(before.filter(Boolean))] },
        after: { link: linkKey(value) },
        warnings: warnings.map((w) => w.key),
      },
    }));
  },
};

// ─── set_draft_locations ────────────────────────────────────────────────────

const addItem = z
  .object({
    search: z.string().min(2).max(120).optional().describe('A place to search Meta for, e.g. "Manchester". With city_key, the hit with that key.'),
    city_key: z.string().regex(/^\d{1,12}$/).optional().describe("Meta's location key for the place (from an earlier answer's hits)."),
    radius_km: z.number().min(1).max(80).optional().describe("A city's radius in km (default 40)."),
    pin: z
      .object({
        name: z.string().min(1).max(80),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radius_km: z.number().min(1).max(80),
      })
      .optional()
      .describe("A point and a radius, where Meta has no city."),
    preset: z.enum(["leeds"]).optional().describe('"leeds": Leeds city centre, 80 km (Meta has no Leeds city in West Yorkshire).'),
    exclude: z.boolean().optional().describe("Add it to the exclusion list instead of the targeted locations."),
  })
  .describe("One of: search (+ city_key), pin, or preset.");

type AddItem = z.infer<typeof addItem>;

const SEARCH_TYPES = ["city", "region", "country"] as const;

function hitLabel(h: LocationSearchHit): string {
  return [h.name, h.region, h.country_name].filter(Boolean).join(", ");
}

function groupKind(g: LocationTargetingGroup): string {
  const s = g.selections[0];
  return s?.locationType ?? "location";
}

export const setDraftLocationsTool: McpTool = {
  name: "set_draft_locations",
  title: "Add or remove a draft's locations",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Adds or removes a draft's targeted locations, as Step 5's location picker does. Add a place by search (Meta's location search, a read), a pin (point + radius), or the Leeds preset.",
    "A search with more than one hit saves nothing and lists the hits with their city_key: call again with the one you mean. Meta key 811209 is Leeds in Kent, not West Yorkshire: the answer warns and points at the Leeds preset.",
    "tier tags the added locations primary or secondary (tiered ad sets follow). add_to_every_ad_set puts the added locations on every enabled ad set; every_ad_set does the same for locations already on the draft. remove takes location ids, Meta keys or names from get_draft.",
    'Example: set_draft_locations({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", add: [{ preset: "leeds" }, { search: "Manchester", city_key: "2513419" }], tier: "primary" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    add: z.array(addItem).max(20).optional(),
    remove: z.array(z.string().min(1).max(120)).max(50).optional().describe("Location ids, Meta keys or names to take off."),
    tier: z.enum(["primary", "secondary"]).optional().describe("Tag the added locations with this tier."),
    add_to_every_ad_set: z.boolean().optional().describe("Also put the added locations on every enabled ad set (Step 5's Add to every ad set)."),
    every_ad_set: z.array(z.string().min(1).max(120)).max(30).optional().describe("Locations already on the draft (ids, Meta keys or names from get_draft) to put on every enabled ad set, as Step 5's Add to every ad set."),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const adds = (Array.isArray(args.add) ? args.add : []) as AddItem[];
    const removes = (Array.isArray(args.remove) ? args.remove : []).map((r) => String(r).trim()).filter(Boolean);
    const tier = (args.tier === "primary" || args.tier === "secondary" ? args.tier : undefined) as LocationTier | undefined;
    const everyArg = (Array.isArray(args.every_ad_set) ? args.every_ad_set : []).map((r) => String(r).trim()).filter(Boolean);
    if (adds.length === 0 && removes.length === 0 && everyArg.length === 0) throw new ToolInputError("Give add, remove or every_ad_set.", { refused: "nothing_to_do" });
    for (const a of adds) {
      const kinds = [a.search || a.city_key ? 1 : 0, a.pin ? 1 : 0, a.preset ? 1 : 0].reduce((s, x) => s + x, 0);
      if (kinds !== 1) throw new ToolInputError("Each added location is one of: search (with city_key), pin, or preset.", { refused: "bad_add" });
      if (a.city_key && !a.search) throw new ToolInputError("Give search (the place's name) with city_key, so Meta's search can find that key.", { refused: "bad_add" });
    }
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const bs = draft.budgetSchedule;

    // Resolve every add first: a search with no single answer saves nothing.
    let metaGets = 0;
    let stamp = ctx.now.getTime();
    const addGroups: LocationTargetingGroup[] = [];
    const addExcluded: LocationSelection[] = [];
    const warnings: Array<{ key: string; sentence: string; fix?: string }> = [];
    const choices: Array<{ search: string; hits: Array<{ city_key: string; label: string; type: string }> }> = [];
    const skipped: string[] = [];
    const existing = bs.locationGroups ?? [];
    for (const a of adds) {
      stamp += 1;
      if (a.preset) {
        if (a.exclude) {
          const sel = presetPinGroup(a.preset, { mode: "exclude" }).selections[0]!;
          addExcluded.push({ ...sel, id: `${sel.id}_${stamp}` });
        } else if (existing.some((g) => isPresetPinGroup(g, a.preset!)) || addGroups.some((g) => isPresetPinGroup(g, a.preset!))) {
          skipped.push(`${PIN_PRESETS[a.preset].name} (pin) is already on this draft`);
        } else {
          addGroups.push(presetPinGroup(a.preset));
        }
        continue;
      }
      if (a.pin) {
        const checked = validatePinForm({ name: a.pin.name, latitude: String(a.pin.lat), longitude: String(a.pin.lng), radius: String(a.pin.radius_km) });
        if (!checked.pin) throw new ToolInputError("That pin isn't valid: a name, latitude -90 to 90, longitude -180 to 180, radius 1 to 80 km.", { refused: "bad_pin" });
        const input = { ...checked.pin, mode: a.exclude ? ("exclude" as const) : ("include" as const) };
        if (a.exclude) addExcluded.push(pinSelection(input, "search", `pin_${stamp}_exclude`));
        else addGroups.push(manualPinGroup(input, stamp));
        continue;
      }
      const query = String(a.search);
      let found: { hits: LocationSearchHit[]; metaGets: number };
      try {
        found = await deps.geoSearch({ userId: ctx.userId, query, types: SEARCH_TYPES });
      } catch {
        throw new ToolInputError("Meta's location search didn't answer, so nothing was saved. Try again.", { draftId: loaded.row.id, refused: "search_failed", metaGets });
      }
      metaGets += found.metaGets;
      const hits = found.hits;
      const hit = a.city_key ? hits.find((h) => h.key === a.city_key) : hits.length === 1 ? hits[0] : undefined;
      if (!hit) {
        choices.push({ search: query, hits: hits.slice(0, 10).map((h) => ({ city_key: h.key, label: hitLabel(h), type: h.type })) });
        continue;
      }
      const mode = a.exclude ? "exclude" : "include";
      const radius = hit.type === "city" ? clampCityRadius(a.radius_km ?? 40, "kilometer") : undefined;
      const selection = selectionFromGeoResult(hit, mode, radius, "kilometer", "search");
      if (!selection) continue;
      selection.id = `${hit.type}_${hit.key}_${mode}_${stamp}`;
      const mismatch = regionMismatchForCityKey(hit.key, query);
      if (mismatch) warnings.push({ key: "region_mismatch", sentence: mismatch.line, fix: mismatch.fix });
      if (mode === "exclude") {
        addExcluded.push(selection);
        continue;
      }
      if (existing.some((g) => g.selections.some((s) => s.locationKey && s.locationKey === hit.key && s.mode === "include"))) {
        skipped.push(`${selection.label} is already on this draft`);
        continue;
      }
      addGroups.push({
        id: `manual_${stamp}`,
        label: selection.label + (hit.type === "city" && radius ? ` (+${radius} km)` : ""),
        source: "manual",
        selections: [selection],
      });
    }
    if (choices.length > 0) {
      throw new ToolInputError(
        `Nothing was saved: ${choices.map((c) => `"${c.search}"`).join(", ")} didn't give one clear place. Call again with the city_key you mean.`,
        { draftId: loaded.row.id, refused: "choose_hit", metaGets, choices: choices.map((c) => ({ search: c.search, hits: c.hits.length })) },
        { choices, metaGets },
      );
    }

    const tiered = addGroups.map((g) => (tier ? withGroupTier(g, tier) : g));
    const matchGroup = (g: LocationTargetingGroup, r: string) => {
      const low = r.toLowerCase();
      if (g.id === r || g.label.toLowerCase() === low) return true;
      if (low === "leeds" && isPresetPinGroup(g, "leeds")) return true;
      return g.selections.some((sel) => sel.locationKey === r || sel.label.toLowerCase() === low);
    };
    const matchSel = (sel: LocationSelection, r: string) => sel.id === r || sel.locationKey === r || sel.label.toLowerCase() === r.toLowerCase();
    const matchesRemove = (g: LocationTargetingGroup) => removes.some((r) => matchGroup(g, r));
    const matchesRemoveSel = (sel: LocationSelection) => removes.some((r) => matchSel(sel, r));
    const pool = bs.excludedLocations ?? [];
    const removedGroups = existing.filter(matchesRemove);
    const removedExcluded = pool.filter(matchesRemoveSel);
    const unmatched = removes.filter((r) => !existing.some((g) => matchGroup(g, r)) && !pool.some((sel) => matchSel(sel, r)));
    if (unmatched.length) throw new ToolInputError(`These aren't on this draft: ${unmatched.slice(0, 10).join(", ")}. Nothing was saved.`, { draftId: loaded.row.id, refused: "unknown_remove" });

    let nextBs = mapLocationGroups(bs, (groups) => [...groups.filter((g) => !matchesRemove(g)), ...tiered]);
    nextBs = mapExcludedLocations(nextBs, (pool) => [...pool.filter((s) => !matchesRemoveSel(s)), ...addExcluded]);
    const groups = nextBs.locationGroups ?? [];
    let adSets = followLocationTiers(draft.adSetSuggestions, groups);
    if (args.add_to_every_ad_set === true) {
      for (const g of tiered) adSets = addLocationToEveryAdSet(adSets, g, groups, nextBs.excludedLocations ?? []);
    }
    const everyGroups = everyArg.map((r) => groups.find((g) => matchGroup(g, r)));
    const everyMissing = everyArg.filter((_, i) => !everyGroups[i]);
    if (everyMissing.length) throw new ToolInputError(`These aren't on this draft: ${everyMissing.slice(0, 10).join(", ")}. Nothing was saved.`, { draftId: loaded.row.id, refused: "unknown_every" });
    for (const g of everyGroups) adSets = addLocationToEveryAdSet(adSets, g!, groups, nextBs.excludedLocations ?? []);
    const next: CampaignDraft = { ...draft, budgetSchedule: nextBs, adSetSuggestions: adSets };
    const onNoAdSet = tiered.filter((g) => adSetsTargetingLocation(adSets, g.id).length === 0).map((g) => g.label);

    return finish(ctx, loaded, next, () => ({
      data: {
        added: tiered.map((g) => ({ id: g.id, label: g.label, kind: groupKind(g), tier: groupTier(g) ?? null, adSets: adSetsTargetingLocation(adSets, g.id).length })),
        excludedAdded: addExcluded.map((s) => ({ id: s.id, label: s.label })),
        removed: [...removedGroups.map((g) => g.label), ...removedExcluded.map((s) => s.label)],
        skipped,
        locations: groups.map((g) => ({ id: g.id, label: g.label, kind: groupKind(g), tier: groupTier(g) ?? null })),
        onNoAdSet: onNoAdSet.length ? { labels: onNoAdSet, note: "Not on any ad set yet. Call again with add_to_every_ad_set, or pick them per ad set in Step 5." } : null,
        warnings,
        metaGets,
      },
      summary: {
        everyAdSet: everyGroups.map((g) => g!.id),
        fieldsChanged: ["budgetSchedule.locationGroups", ...(addExcluded.length || removedExcluded.length ? ["budgetSchedule.excludedLocations"] : []), "adSetSuggestions.locations"],
        before: { locations: existing.length, excluded: pool.length },
        after: { locations: groups.length, excluded: (nextBs.excludedLocations ?? []).length },
        addedIds: tiered.map((g) => g.id),
        removedIds: removedGroups.map((g) => g.id),
        warnings: warnings.map((w) => w.key),
        metaGets,
      },
    }));
  },
};

// ─── set_draft_budget ───────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** "2026-12-01" → "2026-12-01T00:00" (start) or "…T23:59" (end); "YYYY-MM-DDTHH:mm" as given. */
export function localOf(value: unknown, edge: "start" | "end"): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (DAY_TIME.test(s)) return s;
  if (DAY.test(s)) return `${s}T${edge === "start" ? "00:00" : "23:59"}`;
  return null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const setDraftBudgetTool: McpTool = {
  name: "set_draft_budget",
  title: "Set a draft's budget and dates",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Sets a draft's budget (daily or lifetime, in GBP) and its start and end, as the Budget and Schedule cards do. Nothing spends: the draft isn't launched.",
    "level moves the budget between the ad sets and the campaign (CBO), as the card's level switch. When budgets sit on the ad sets, the amount is split evenly over the enabled ad sets (the card's Distribute); set each one after with set_draft_ad_sets. Dates are London time: YYYY-MM-DD or YYYY-MM-DDTHH:mm; a day alone starts at 00:00 and ends at 23:59.",
    "A start in the past and an end before the start are refused. Leave end out to keep the draft's current end; a lifetime budget needs an end. Returns the per-day equivalent.",
    'Example: set_draft_budget({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", type: "lifetime", amount_gbp: 300, start: "2026-12-01", end: "2026-12-14" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    type: z.enum(["lifetime", "daily"]),
    amount_gbp: z.number().positive().max(100_000).describe("The budget in GBP: per day for daily, the whole run for lifetime."),
    start: z.string().min(10).max(16).describe("YYYY-MM-DD or YYYY-MM-DDTHH:mm, London time, not in the past."),
    end: z.string().min(10).max(16).optional().describe("YYYY-MM-DD or YYYY-MM-DDTHH:mm, after the start. Leave out to keep the current end."),
    level: z.enum(["ad_set", "campaign"]).optional().describe("Where the budget sits, the Budget card's level switch: ad_set (each ad set its own) or campaign (CBO). Leave out to keep it."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const type = args.type === "lifetime" ? "lifetime" : args.type === "daily" ? "daily" : null;
    if (!type) throw new ToolInputError('type is "daily" or "lifetime".', { refused: "bad_type" });
    const amount = Number(args.amount_gbp);
    if (!Number.isFinite(amount) || amount <= 0) throw new ToolInputError("amount_gbp is a positive number of pounds.", { refused: "bad_amount" });
    const start = localOf(args.start, "start");
    if (!start) throw new ToolInputError("Give start as YYYY-MM-DD or YYYY-MM-DDTHH:mm.", { refused: "bad_start" });
    const endGiven = args.end != null && String(args.end).trim() !== "";
    const endArg = endGiven ? localOf(args.end, "end") : null;
    if (endGiven && !endArg) throw new ToolInputError("Give end as YYYY-MM-DD or YYYY-MM-DDTHH:mm.", { refused: "bad_end" });

    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const bs = draft.budgetSchedule;
    if ((bs.currency || "GBP") !== "GBP") throw new ToolInputError(`This draft's budget is in ${bs.currency}, not GBP. Change it in the app.`, { draftId: loaded.row.id, refused: "not_gbp" });
    const tz = bs.timezone || "Europe/London";
    const startAt = zonedLocalToUtc(start, tz);
    if (!startAt) throw new ToolInputError("Give start as YYYY-MM-DD or YYYY-MM-DDTHH:mm.", { refused: "bad_start" });
    if (startAt.getTime() < ctx.now.getTime()) throw new ToolInputError(`The start (${start}, ${tz}) is in the past. Give a start from now on.`, { draftId: loaded.row.id, refused: "start_in_past" });
    const end = endGiven ? endArg! : bs.endDate || "";
    const endAt = end ? zonedLocalToUtc(end, tz) : null;
    if (end && !endAt) throw new ToolInputError("The draft's current end can't be read. Give end.", { draftId: loaded.row.id, refused: "bad_end" });
    if (endAt && endAt.getTime() <= startAt.getTime()) throw new ToolInputError(`The end (${end}) is before the start (${start}).`, { draftId: loaded.row.id, refused: "end_before_start" });
    if (type === "lifetime" && !endAt) throw new ToolInputError("A lifetime budget needs an end date.", { draftId: loaded.row.id, refused: "lifetime_needs_end" });

    // The Schedule card's Duration (components/steps/budget-schedule.tsx).
    const days = endAt ? Math.ceil((endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    // The Budget card's level switch is the field alone (updateBs({ budgetLevel })).
    const level = args.level === "ad_set" || args.level === "campaign" ? args.level : bs.budgetLevel;
    let adSets = draft.adSetSuggestions;
    if (type !== bs.budgetType) adSets = convertAdSetBudgetsOnTypeChange(adSets, type, bs.budgetAmount, days > 0 ? days : 0);
    const enabled = adSets.filter((s) => s.enabled);
    const onAdSets = level !== "campaign" && enabled.length > 0;
    if (onAdSets) {
      // Distribute (the card's button): an even split over enabled ad sets.
      const perSet = Math.round((amount / enabled.length) * 100) / 100;
      adSets = adSets.map((s) => (!s.enabled ? s : type === "lifetime" ? { ...s, budgetLifetime: perSet } : { ...s, budgetPerDay: perSet }));
    }
    const nextBs = patchBudgetSchedule(bs, {
      budgetLevel: level,
      budgetType: type,
      budgetAmount: amount,
      startDate: start,
      startDateSource: "operator",
      endDate: end,
      ...(endGiven ? { endDateSource: "operator" as const, endDatePhase: undefined } : {}),
    });
    const next: CampaignDraft = { ...draft, budgetSchedule: nextBs, adSetSuggestions: adSets };
    const perDay = type === "daily" ? round2(amount) : days > 0 ? round2(amount / days) : null;
    const total = type === "lifetime" ? round2(amount) : days > 0 ? round2(amount * days) : null;
    const fieldDiff = changes([
      ["budgetLevel", bs.budgetLevel, level],
      ["budgetType", bs.budgetType, type],
      ["budgetAmount", bs.budgetAmount, amount],
      ["startDate", bs.startDate, start],
      ["endDate", bs.endDate, end],
    ]);
    return finish(ctx, loaded, next, () => ({
      data: {
        type,
        amount_gbp: round2(amount),
        start,
        end: end || null,
        timezone: tz,
        days: days || null,
        perDayGbp: perDay,
        totalGbp: total,
        budgetsOn: level === "campaign" ? "campaign" : "ad sets",
        adSetsSplit: onAdSets ? { adSets: enabled.length, eachGbp: Math.round((amount / enabled.length) * 100) / 100 } : null,
        changes: fieldDiff,
      },
      summary: {
        fieldsChanged: fieldDiff.map((c) => c.field).concat(onAdSets ? ["adSetSuggestions.budgets"] : []),
        before: { level: bs.budgetLevel, type: bs.budgetType, amount: bs.budgetAmount, start: bs.startDate || null, end: bs.endDate || null },
        after: { level, type, amount: round2(amount), start, end: end || null, perDay, days: days || null },
      },
    }));
  },
};

// ─── apply_audience_template ────────────────────────────────────────────────

// SWITCH(#1375): once #1375 merges, replace addReusedToDraft below with its apply
// (lib/audience-templates/apply.ts addTemplateToDraft) so this is the tab's own "Add to this draft".
const addTemplate = addReusedToDraft;

export const applyAudienceTemplateTool: McpTool = {
  name: "apply_audience_template",
  title: "Add an audience template to a draft",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Adds one of the client's audience templates to a draft, as the Audience templates tab's Add to this draft: the audiences already made in the draft's ad account go in by their Meta ids (one custom audience group and one interest group, both named after the template). Nothing is created and Meta isn't called.",
    "The rest are left out and counted, in Meta audiences: not made yet, held in another account, or video viewers that need this show's videos. Ad sets for the template's groups are added at the + Blank ad set budget; set them with set_draft_ad_sets. A template Matas hasn't confirmed is refused. Adding twice changes nothing.",
    'Example: apply_audience_template({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", template: "Techno" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    template: z.string().min(1).max(80).describe('The template\'s name, e.g. "Techno" or "House & disco".'),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const template = String(args.template ?? "").trim();
    const clientId = draft.settings.clientId || loaded.row.client_id;
    if (!clientId) throw new ToolInputError("This draft has no client, so it has no templates.", { draftId: loaded.row.id, refused: "no_client" });
    const account = draft.settings.metaAdAccountId || draft.settings.adAccountId || loaded.row.ad_account_id || "";
    const pixel = draft.settings.metaPixelId || draft.settings.pixelId || null;
    const found = await loadTemplatesFor(ctx.db, { clientId, adAccount: account, pixelId: pixel });
    const t = found.templates.find((x) => x.name.trim().toLowerCase() === template.toLowerCase());
    if (!t) {
      throw new ToolInputError(`No template called "${template}" for this client. Its templates: ${found.templates.map((x) => x.name).join(", ") || "none"}.`, {
        draftId: loaded.row.id,
        template,
        refused: "unknown_template",
      });
    }
    if (!(t.confirmedBy && t.confirmedAt)) {
      throw new ToolInputError(`${t.name}: ${APPLY_WORDS["templates.unconfirmed"]}. ${APPLY_WORDS["templates.unconfirmed.line"]}`, { draftId: loaded.row.id, template: t.name, refused: "unconfirmed" });
    }
    const resolved = found.resolve(t.name)!;
    const out = addTemplate(draft.audiences, t.name, resolved);
    const touched = new Set([groupKey("custom", templateGroupId(t.name)), groupKey("interest", templateGroupId(t.name))]);
    const follow = followAudienceGroups(draft.adSetSuggestions, out.audiences, draft.budgetSchedule.locationGroups ?? [], draft.budgetSchedule, touched);
    const next: CampaignDraft = { ...draft, audiences: out.audiences, adSetSuggestions: follow.adSets };
    const draftName = draft.settings.campaignName || "this draft";
    return finish(ctx, loaded, next, () => ({
      data: {
        template: t.name,
        sentences: applySentences(out, t.name, draftName, found.accountName),
        added: out.added,
        newAudienceIds: out.newIds,
        leftOut: out.leftOut,
        adSetsAdded: follow.added.map((a) => ({ id: a.id, name: a.name, budget: a.budgetLifetime ?? a.budgetPerDay })),
      },
      summary: {
        template: t.name,
        fieldsChanged: out.newIds.length || out.newInterests ? ["audiences", ...(follow.added.length ? ["adSetSuggestions"] : [])] : [],
        before: { customGroups: draft.audiences.customAudienceGroups.length, interestGroups: draft.audiences.interestGroups.length, adSets: draft.adSetSuggestions.length },
        after: { customGroups: out.audiences.customAudienceGroups.length, interestGroups: out.audiences.interestGroups.length, adSets: follow.adSets.length },
        added: out.added,
        newAudienceIds: out.newIds,
        leftOut: { notMade: out.leftOut.notMade, held: out.leftOut.held.reduce((s, h) => s + h.n, 0), needVideos: out.leftOut.needVideos },
      },
    }));
  },
};

// ─── archive_draft ──────────────────────────────────────────────────────────

export const archiveDraftTool: McpTool = {
  name: "archive_draft",
  title: "Archive a draft",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Moves a draft (status draft) to the library's Archived tab, as the library's Archive does. Nothing is deleted: Unarchive in the library brings it back unchanged.",
    'Example: archive_draft({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00" }).',
  ].join(" "),
  inputSchema: { ...draftArgs },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const saved = await archiveDraftRow(ctx, loaded);
    const checks = await launchChecksFor(ctx, loaded.draft);
    return {
      data: { draft_id: loaded.row.id, updated_at: saved.updatedAt, status: "archived", note: "Unarchive it in the library's Archived tab to bring it back.", launchChecks: checks },
      eventId: loaded.row.event_id,
      clientId: loaded.row.client_id,
      summary: { draftId: loaded.row.id, fieldsChanged: ["status"], before: { status: "draft" }, after: { status: "archived" }, ...checksSummary(checks) },
    };
  },
};

// ─── set_draft_name (M3a) ───────────────────────────────────────────────────

/** Meta's campaign name limit. */
export const MAX_CAMPAIGN_NAME_LENGTH = 400;

/**
 * The draft's name: the Campaign step's Campaign Name field
 * (settings.campaignName), which the library lists and the launch sends as
 * the Meta campaign's name. The library has no rename of its own; this is
 * the field Matas edits in the app. The code-in-name launch check runs after.
 */
export const setDraftNameTool: McpTool = {
  name: "set_draft_name",
  title: "Rename a draft",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Renames a draft: the Campaign step's Campaign Name, which the library shows and Meta gets as the campaign's name at launch. Keep the event code in square brackets at the front (\"[ES27-ENZOSIRAGUSA] ANNOUNCE\"): the launch checks flag a name without it.",
    'Example: set_draft_name({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", name: "[ES27-ENZOSIRAGUSA] ANNOUNCE A" }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    // Trimmed by the input check, so an empty or blank name never reaches the tool.
    name: z.string().trim().min(1).max(20_000).describe("The new name."),
  },
  async run(ctx, args) {
    requireDraftScope(ctx);
    const name = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim() : "";
    if (name.length > MAX_CAMPAIGN_NAME_LENGTH) throw new ToolInputError(NAME_WORDS.tooLong(MAX_CAMPAIGN_NAME_LENGTH), { refused: "name_too_long" });
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const before = loaded.draft.settings.campaignName ?? "";
    if (before === name) {
      // claude.mcp.name.same: nothing is written.
      return {
        data: { draft_id: loaded.row.id, updated_at: loaded.row.updated_at, name, message: NAME_WORDS.same },
        eventId: loaded.row.event_id,
        clientId: loaded.row.client_id,
        summary: { draftId: loaded.row.id, fieldsChanged: [] },
      };
    }
    const next: CampaignDraft = { ...loaded.draft, settings: { ...loaded.draft.settings, campaignName: name } };
    return finish(ctx, loaded, next, () => ({
      data: { name, message: NAME_WORDS.done(before, name) },
      summary: { fieldsChanged: ["campaignName"], changes: changes([["campaignName", before, name]]) },
    }));
  },
};
