/**
 * lib/db/google-search-plans.ts
 *
 * CRUD for the Google Search Campaign Creator data model (migration 096).
 * Mirrors the shape conventions in `lib/db/drafts.ts` and
 * `lib/db/tiktok-drafts.ts`, but uses an untyped `SupabaseClient` for the
 * new tables — they're not in `lib/db/database.types.ts` yet because
 * migration 096 hasn't been applied + regenerated. Ops applies via
 * Supabase MCP post-merge; a follow-up regen PR types the tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseGeoTargetsColumn,
  serializeGeoTargetsColumn,
} from "../google-search/geo-targets-codec.ts";
import {
  DEFAULT_GEO_TARGET_TYPE,
  DEFAULT_STRUCTURE_MODE,
  STRUCTURE_MODES,
  type GoogleSearchAdGroup,
  type GoogleSearchAdGroupNode,
  type GoogleSearchCampaign,
  type GoogleSearchCampaignNode,
  type GoogleSearchGeoTargetType,
  type GoogleSearchKeyword,
  type GoogleSearchNegative,
  type GoogleSearchPlan,
  type GoogleSearchPlanDraftTree,
  type GoogleSearchPlanTree,
  type GoogleSearchRsa,
  type GoogleSearchStructureMode,
} from "../google-search/types.ts";

const SUPABASE_LIST_PAGE_LIMIT = 1_000;

// ─── UUID guard ───────────────────────────────────────────────────────
//
// Postgres rejects non-UUID strings as `invalid input syntax for type
// uuid`. The wizard uses `tmp-…` prefixed IDs for newly-added rows
// that haven't been persisted yet. Guarding every id that flows into
// a `.in()` filter or a FK insert prevents this class of 500.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true iff `id` looks like a real Postgres UUID (not `tmp-…`). */
export function isRealRowId(id: string): boolean {
  return UUID_RE.test(id);
}

export interface CreatePlanInput {
  user_id: string;
  name: string;
  event_id?: string | null;
  google_ads_account_id?: string | null;
  total_budget?: number | null;
  bidding_strategy?: GoogleSearchPlan["bidding_strategy"];
  structure_mode?: GoogleSearchStructureMode;
  geo_targets?: GoogleSearchPlan["geo_targets"];
  geo_target_type?: GoogleSearchGeoTargetType;
  date_range?: GoogleSearchPlan["date_range"];
}

export async function createGoogleSearchPlan(
  supabase: SupabaseClient,
  input: CreatePlanInput,
): Promise<GoogleSearchPlan> {
  const { data, error } = await supabase
    .from("google_search_plans")
    .insert({
      user_id: input.user_id,
      event_id: input.event_id ?? null,
      google_ads_account_id: input.google_ads_account_id ?? null,
      name: input.name,
      total_budget: input.total_budget ?? null,
      bidding_strategy: input.bidding_strategy ?? "maximize_clicks",
      structure_mode: input.structure_mode ?? DEFAULT_STRUCTURE_MODE,
      geo_targets: serializeGeoTargetsColumn({
        targets: input.geo_targets ?? [],
        geo_target_type: input.geo_target_type ?? DEFAULT_GEO_TARGET_TYPE,
      }),
      date_range: input.date_range ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`createGoogleSearchPlan failed: ${error?.message ?? "no row"}`);
  }
  return hydratePlan(data as Record<string, unknown>);
}

/**
 * Coerce a raw Supabase row into a typed `GoogleSearchPlan` with the
 * (geo_targets, geo_target_type) pair split out of the wrapping
 * `geo_targets` jsonb. Centralised so every read path stays
 * forward-compatible with the legacy array shape (see
 * `lib/google-search/geo-targets-codec.ts`).
 */
export function hydratePlan(raw: Record<string, unknown>): GoogleSearchPlan {
  const decoded = parseGeoTargetsColumn(raw.geo_targets);
  const rawMode = raw.structure_mode;
  const structure_mode: GoogleSearchStructureMode =
    typeof rawMode === "string" && (STRUCTURE_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as GoogleSearchStructureMode)
      : DEFAULT_STRUCTURE_MODE;
  return {
    ...(raw as Omit<GoogleSearchPlan, "geo_targets" | "geo_target_type" | "structure_mode">),
    geo_targets: decoded.targets,
    geo_target_type: decoded.geo_target_type,
    structure_mode,
  } as GoogleSearchPlan;
}

export async function listGoogleSearchPlansForEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<GoogleSearchPlan[]> {
  const { data, error } = await supabase
    .from("google_search_plans")
    .select("*")
    .eq("event_id", eventId)
    .order("updated_at", { ascending: false })
    .limit(SUPABASE_LIST_PAGE_LIMIT);
  if (error) {
    throw new Error(`listGoogleSearchPlansForEvent failed: ${error.message}`);
  }
  return (data ?? []).map((row) => hydratePlan(row as Record<string, unknown>));
}

/**
 * Return all plans owned by `userId`, newest-first.
 *
 * Uses the session-bound Supabase client so that RLS (`auth.uid() = user_id`)
 * is satisfied — the caller must pass the result of `createClient()` (server),
 * not the service-role client.
 */
export async function listGoogleSearchPlansForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<GoogleSearchPlan[]> {
  const { data, error } = await supabase
    .from("google_search_plans")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(SUPABASE_LIST_PAGE_LIMIT);
  if (error) {
    throw new Error(`listGoogleSearchPlansForUser failed: ${error.message}`);
  }
  return (data ?? []).map((row) => hydratePlan(row as Record<string, unknown>));
}

export async function deleteGoogleSearchPlan(
  supabase: SupabaseClient,
  planId: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_plans")
    .delete()
    .eq("id", planId);
  if (error) throw new Error(`deleteGoogleSearchPlan failed: ${error.message}`);
}

// ─── Phase 3 push-back helpers ────────────────────────────────────────
//
// Per-row writers used by the Google Ads push adapter
// (`lib/google-ads/campaign-writer.ts`) to stamp `pushed_resource_name`
// onto each platform-created row. Kept tiny and per-row so partial
// success can persist incrementally — a single failing row doesn't
// roll back the rows that already succeeded.

export async function setGoogleSearchPlanStatus(
  supabase: SupabaseClient,
  planId: string,
  status: "pushed" | "partially_pushed",
  pushedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_plans")
    .update({ status, pushed_at: pushedAt })
    .eq("id", planId);
  if (error) throw new Error(`setGoogleSearchPlanStatus failed: ${error.message}`);
}

export async function setGoogleSearchCampaignResource(
  supabase: SupabaseClient,
  campaignId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_campaigns")
    .update({ pushed_resource_name: resourceName })
    .eq("id", campaignId);
  if (error) {
    throw new Error(`setGoogleSearchCampaignResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchAdGroupResource(
  supabase: SupabaseClient,
  adGroupId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_ad_groups")
    .update({ pushed_resource_name: resourceName })
    .eq("id", adGroupId);
  if (error) {
    throw new Error(`setGoogleSearchAdGroupResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchKeywordResource(
  supabase: SupabaseClient,
  keywordId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_keywords")
    .update({ pushed_resource_name: resourceName })
    .eq("id", keywordId);
  if (error) {
    throw new Error(`setGoogleSearchKeywordResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchNegativeResource(
  supabase: SupabaseClient,
  negativeId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_negatives")
    .update({ pushed_resource_name: resourceName })
    .eq("id", negativeId);
  if (error) {
    throw new Error(`setGoogleSearchNegativeResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchRsaResource(
  supabase: SupabaseClient,
  rsaId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_rsas")
    .update({ pushed_resource_name: resourceName })
    .eq("id", rsaId);
  if (error) {
    throw new Error(`setGoogleSearchRsaResource failed: ${error.message}`);
  }
}

/**
 * Single round-trip-ish load of the full nested plan tree. Five queries
 * scoped by the plan id (RLS enforces ownership on every table), then
 * an in-memory join. Page limit hits the 1k Supabase ceiling per
 * table — a single plan that produces >1k keywords, ad groups, or RSAs
 * is out of scope; the wizard surfaces a warning if any list saturates.
 */
export async function loadGoogleSearchPlanTree(
  supabase: SupabaseClient,
  planId: string,
): Promise<GoogleSearchPlanTree | null> {
  const { data: planRow, error: planErr } = await supabase
    .from("google_search_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (planErr) throw new Error(`loadGoogleSearchPlanTree (plan) failed: ${planErr.message}`);
  if (!planRow) return null;
  const plan = hydratePlan(planRow as Record<string, unknown>);

  const [campaignsRes, adGroupsRes, keywordsRes, rsasRes, negativesRes] =
    await Promise.all([
      supabase
        .from("google_search_campaigns")
        .select("*")
        .eq("plan_id", planId)
        .order("sort_order", { ascending: true })
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_ad_groups")
        .select("*, campaign:google_search_campaigns!inner(plan_id)")
        .eq("campaign.plan_id", planId)
        .order("sort_order", { ascending: true })
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_keywords")
        .select("*, ad_group:google_search_ad_groups!inner(campaign:google_search_campaigns!inner(plan_id))")
        .eq("ad_group.campaign.plan_id", planId)
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_rsas")
        .select("*, ad_group:google_search_ad_groups!inner(campaign:google_search_campaigns!inner(plan_id))")
        .eq("ad_group.campaign.plan_id", planId)
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_negatives")
        .select("*")
        .eq("plan_id", planId)
        .limit(SUPABASE_LIST_PAGE_LIMIT),
    ]);

  for (const [label, res] of Object.entries({
    campaigns: campaignsRes,
    ad_groups: adGroupsRes,
    keywords: keywordsRes,
    rsas: rsasRes,
    negatives: negativesRes,
  })) {
    if (res.error) {
      throw new Error(`loadGoogleSearchPlanTree (${label}) failed: ${res.error.message}`);
    }
  }

  const campaigns = (campaignsRes.data ?? []) as GoogleSearchCampaign[];
  const adGroups = (adGroupsRes.data ?? []) as GoogleSearchAdGroup[];
  const keywords = (keywordsRes.data ?? []) as GoogleSearchKeyword[];
  const rsas = (rsasRes.data ?? []) as GoogleSearchRsa[];
  const negatives = (negativesRes.data ?? []) as GoogleSearchNegative[];

  const keywordsByAdGroup = new Map<string, GoogleSearchKeyword[]>();
  for (const k of keywords) {
    const bucket = keywordsByAdGroup.get(k.ad_group_id) ?? [];
    bucket.push(k);
    keywordsByAdGroup.set(k.ad_group_id, bucket);
  }
  const rsasByAdGroup = new Map<string, GoogleSearchRsa[]>();
  for (const r of rsas) {
    const bucket = rsasByAdGroup.get(r.ad_group_id) ?? [];
    bucket.push(r);
    rsasByAdGroup.set(r.ad_group_id, bucket);
  }
  const adGroupsByCampaign = new Map<string, GoogleSearchAdGroupNode[]>();
  for (const ag of adGroups) {
    const node: GoogleSearchAdGroupNode = {
      ...ag,
      keywords: keywordsByAdGroup.get(ag.id) ?? [],
      rsas: rsasByAdGroup.get(ag.id) ?? [],
    };
    const bucket = adGroupsByCampaign.get(ag.campaign_id) ?? [];
    bucket.push(node);
    adGroupsByCampaign.set(ag.campaign_id, bucket);
  }
  const negativesByCampaign = new Map<string, GoogleSearchNegative[]>();
  const planNegatives: GoogleSearchNegative[] = [];
  for (const n of negatives) {
    if (n.campaign_id) {
      const bucket = negativesByCampaign.get(n.campaign_id) ?? [];
      bucket.push(n);
      negativesByCampaign.set(n.campaign_id, bucket);
    } else {
      planNegatives.push(n);
    }
  }

  const campaignNodes: GoogleSearchCampaignNode[] = campaigns.map((c) => ({
    ...c,
    ad_groups: adGroupsByCampaign.get(c.id) ?? [],
    negatives: negativesByCampaign.get(c.id) ?? [],
  }));

  return { plan, campaigns: campaignNodes, plan_negatives: planNegatives };
}

/**
 * Inserts a fresh tree (xlsx-import path). Sequential, all-or-nothing
 * within a request: the caller wraps in a try/catch and surfaces the
 * partial state. We avoid a transactional RPC for v0 to stay additive
 * to the schema; Phase 3 can move this into a Postgres function if
 * intermediate-state cleanup becomes painful.
 *
 * Returns the inserted plan id so the caller can route to the wizard.
 */
export async function createGoogleSearchPlanTreeFromDraft(
  supabase: SupabaseClient,
  userId: string,
  draft: GoogleSearchPlanDraftTree,
  options: { event_id?: string | null; google_ads_account_id?: string | null } = {},
): Promise<{ plan_id: string }> {
  const plan = await createGoogleSearchPlan(supabase, {
    user_id: userId,
    name: draft.plan.name,
    event_id: options.event_id ?? draft.plan.event_id ?? null,
    google_ads_account_id:
      options.google_ads_account_id ?? draft.plan.google_ads_account_id ?? null,
    total_budget: draft.plan.total_budget,
    bidding_strategy: draft.plan.bidding_strategy,
    structure_mode: draft.plan.structure_mode,
    geo_targets: draft.plan.geo_targets,
    geo_target_type: draft.plan.geo_target_type,
    date_range: draft.plan.date_range,
  });

  const campaignNameToId = new Map<string, string>();
  for (const campaignDraft of draft.campaigns) {
    const { data: campaignRow, error: campaignErr } = await supabase
      .from("google_search_campaigns")
      .insert({
        plan_id: plan.id,
        name: campaignDraft.name,
        priority: campaignDraft.priority,
        monthly_budget: campaignDraft.monthly_budget,
        daily_budget: campaignDraft.daily_budget,
        bid_adjustments: campaignDraft.bid_adjustments,
        notes: campaignDraft.notes,
        sort_order: campaignDraft.sort_order,
      })
      .select("id")
      .single();
    if (campaignErr || !campaignRow) {
      throw new Error(`Insert campaign "${campaignDraft.name}" failed: ${campaignErr?.message ?? "no row"}`);
    }
    const campaignId = (campaignRow as { id: string }).id;
    campaignNameToId.set(campaignDraft.name, campaignId);

    for (const adGroupDraft of campaignDraft.ad_groups) {
      const { data: adGroupRow, error: adGroupErr } = await supabase
        .from("google_search_ad_groups")
        .insert({
          campaign_id: campaignId,
          name: adGroupDraft.name,
          default_cpc: adGroupDraft.default_cpc,
          sort_order: adGroupDraft.sort_order,
        })
        .select("id")
        .single();
      if (adGroupErr || !adGroupRow) {
        throw new Error(`Insert ad group "${adGroupDraft.name}" failed: ${adGroupErr?.message ?? "no row"}`);
      }
      const adGroupId = (adGroupRow as { id: string }).id;

      if (adGroupDraft.keywords.length > 0) {
        const { error: kwErr } = await supabase
          .from("google_search_keywords")
          .insert(
            adGroupDraft.keywords.map((k) => ({
              ad_group_id: adGroupId,
              keyword: k.keyword,
              match_type: k.match_type,
              est_cpc_low: k.est_cpc_low,
              est_cpc_high: k.est_cpc_high,
              intent: k.intent,
              notes: k.notes,
            })),
          );
        if (kwErr) throw new Error(`Insert keywords for "${adGroupDraft.name}" failed: ${kwErr.message}`);
      }
      if (adGroupDraft.rsas.length > 0) {
        const { error: rsaErr } = await supabase
          .from("google_search_rsas")
          .insert(
            adGroupDraft.rsas.map((r) => ({
              ad_group_id: adGroupId,
              headlines: r.headlines,
              descriptions: r.descriptions,
              final_url: r.final_url,
              path1: r.path1,
              path2: r.path2,
            })),
          );
        if (rsaErr) throw new Error(`Insert RSAs for "${adGroupDraft.name}" failed: ${rsaErr.message}`);
      }
    }
  }

  if (draft.negatives.length > 0) {
    const negRows = draft.negatives.map((n) => {
      const campaignId =
        n.scope.kind === "campaign"
          ? campaignNameToId.get(n.scope.campaign_name) ?? null
          : null;
      return {
        plan_id: plan.id,
        campaign_id: campaignId,
        keyword: n.keyword,
        match_type: n.match_type,
        reason: n.reason,
      };
    });
    const { error: negErr } = await supabase
      .from("google_search_negatives")
      .insert(negRows);
    if (negErr) throw new Error(`Insert negatives failed: ${negErr.message}`);
  }

  return { plan_id: plan.id };
}

/**
 * Wizard autosave hook. **Diff-aware** — every save reconciles the
 * incoming tree against the rows currently in Postgres by row id, so
 * `pushed_resource_name` (set by the Phase 3 push adapter) is preserved
 * across autosave. This is the gate that makes the wizard safe to use
 * on a real client account: without it, the push adapter's per-row
 * idempotency check (skip if `pushed_resource_name` is non-null) gets
 * silently defeated every 1500 ms by the autosave debounce.
 *
 * Reconciliation per child level (campaigns → ad_groups → keywords /
 * rsas → negatives):
 *   - Tree row with id present in DB  → UPDATE (excluding
 *     `pushed_resource_name`, which the push adapter owns).
 *   - Tree row with id absent from DB → INSERT (`pushed_resource_name`
 *     stays NULL; correct, it hasn't been pushed).
 *   - DB row whose id is absent from the tree → DELETE (CASCADE drops
 *     descendants).
 *
 * Plan-level update purposefully omits `status` and `pushed_at` — those
 * are owned by the push adapter (`lib/google-ads/campaign-writer.ts`).
 * Letting the wizard write them would race the adapter's status
 * updates and could un-do a `pushed` → `partially_pushed` transition.
 */
export async function saveGoogleSearchPlanTree(
  supabase: SupabaseClient,
  tree: GoogleSearchPlanTree,
): Promise<void> {
  // ── 1. Plan-level fields (status + pushed_at owned by push adapter) ─
  const { error: planErr } = await supabase
    .from("google_search_plans")
    .update({
      name: tree.plan.name,
      event_id: tree.plan.event_id,
      google_ads_account_id: tree.plan.google_ads_account_id,
      total_budget: tree.plan.total_budget,
      bidding_strategy: tree.plan.bidding_strategy,
      structure_mode: tree.plan.structure_mode,
      geo_targets: serializeGeoTargetsColumn({
        targets: tree.plan.geo_targets,
        geo_target_type: tree.plan.geo_target_type,
      }),
      date_range: tree.plan.date_range,
    })
    .eq("id", tree.plan.id);
  if (planErr) {
    throw new Error(`saveGoogleSearchPlanTree (plan update) failed: ${planErr.message}`);
  }

  // ── 2. Campaigns ──────────────────────────────────────────────────
  const { data: existingCampaignsRaw, error: existCampErr } = await supabase
    .from("google_search_campaigns")
    .select("id")
    .eq("plan_id", tree.plan.id);
  if (existCampErr) {
    throw new Error(`saveGoogleSearchPlanTree (load campaigns) failed: ${existCampErr.message}`);
  }
  const existingCampaignIds = new Set(
    ((existingCampaignsRaw ?? []) as Array<{ id: string }>).map((r) => r.id),
  );
  const campaignPlan = partitionTreeRows(existingCampaignIds, tree.campaigns);

  if (campaignPlan.deletes.length > 0) {
    const { error } = await supabase
      .from("google_search_campaigns")
      .delete()
      .in("id", campaignPlan.deletes);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (campaign delete) failed: ${error.message}`);
    }
  }
  for (const c of campaignPlan.updates) {
    const { error } = await supabase
      .from("google_search_campaigns")
      .update({
        name: c.name,
        priority: c.priority,
        monthly_budget: c.monthly_budget,
        daily_budget: c.daily_budget,
        bid_adjustments: c.bid_adjustments,
        notes: c.notes,
        sort_order: c.sort_order,
      })
      .eq("id", c.id);
    if (error) {
      throw new Error(
        `saveGoogleSearchPlanTree (campaign update "${c.name}") failed: ${error.message}`,
      );
    }
  }
  const campaignTmpToReal = new Map<string, string>();
  for (const c of campaignPlan.inserts) {
    const { data, error } = await supabase
      .from("google_search_campaigns")
      .insert({
        plan_id: tree.plan.id,
        name: c.name,
        priority: c.priority,
        monthly_budget: c.monthly_budget,
        daily_budget: c.daily_budget,
        bid_adjustments: c.bid_adjustments,
        notes: c.notes,
        sort_order: c.sort_order,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        `saveGoogleSearchPlanTree (campaign insert "${c.name}") failed: ${error?.message ?? "no row"}`,
      );
    }
    campaignTmpToReal.set(c.id, (data as { id: string }).id);
  }
  const resolveCampaignId = (treeId: string): string => {
    if (isRealRowId(treeId) && existingCampaignIds.has(treeId) && !campaignPlan.deletes.includes(treeId)) {
      return treeId;
    }
    const realId = campaignTmpToReal.get(treeId);
    if (realId !== undefined) return realId;
    // treeId is a tmp- id whose insert somehow didn't resolve — the insert
    // step above would have thrown on failure, so this should be unreachable.
    // Throw explicitly rather than leaking the tmp- string into a FK insert.
    if (!isRealRowId(treeId)) {
      throw new Error(
        `[google-search save] unresolved tmp campaign id "${treeId}" — insert must have failed`,
      );
    }
    return treeId; // real UUID not in existing set — let Postgres catch FK violation
  };

  // ── 3. Ad groups ──────────────────────────────────────────────────
  // Load ad groups across the SURVIVING campaign ids only — the delete
  // step above already cascaded ad groups of removed campaigns, so
  // querying by the post-reconciliation set is correct.
  // Filter to real UUIDs defensively: .in() with a tmp- string causes
  // "invalid input syntax for type uuid" in Postgres.
  const survivingCampaignIds: string[] = [
    ...campaignPlan.updates.map((c) => c.id),
    ...campaignTmpToReal.values(),
  ].filter(isRealRowId);

  const existingAdGroupIds = new Set<string>();
  if (survivingCampaignIds.length > 0) {
    const { data, error } = await supabase
      .from("google_search_ad_groups")
      .select("id")
      .in("campaign_id", survivingCampaignIds);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (load ad_groups) failed: ${error.message}`);
    }
    for (const row of (data ?? []) as Array<{ id: string }>) existingAdGroupIds.add(row.id);
  }

  const treeAdGroups = tree.campaigns.flatMap((c) =>
    c.ad_groups.map((ag) => ({ ag, campaignRealId: resolveCampaignId(c.id) })),
  );
  const adGroupPlan = partitionTreeRows(
    existingAdGroupIds,
    treeAdGroups.map(({ ag }) => ag),
  );
  // Re-attach the resolved campaign id to each ad group plan entry so
  // inserts can write the FK; we keep the same row references so the
  // partition above stays a pure id-based op.
  const adGroupCampaignByTreeId = new Map(
    treeAdGroups.map(({ ag, campaignRealId }) => [ag.id, campaignRealId]),
  );

  if (adGroupPlan.deletes.length > 0) {
    const { error } = await supabase
      .from("google_search_ad_groups")
      .delete()
      .in("id", adGroupPlan.deletes);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (ad_group delete) failed: ${error.message}`);
    }
  }
  for (const ag of adGroupPlan.updates) {
    const { error } = await supabase
      .from("google_search_ad_groups")
      .update({
        name: ag.name,
        default_cpc: ag.default_cpc,
        sort_order: ag.sort_order,
      })
      .eq("id", ag.id);
    if (error) {
      throw new Error(
        `saveGoogleSearchPlanTree (ad_group update "${ag.name}") failed: ${error.message}`,
      );
    }
  }
  const adGroupTmpToReal = new Map<string, string>();
  for (const ag of adGroupPlan.inserts) {
    const campaignId = adGroupCampaignByTreeId.get(ag.id);
    if (!campaignId) {
      throw new Error(
        `saveGoogleSearchPlanTree: ad group "${ag.name}" has no resolved campaign id (orphan in tree)`,
      );
    }
    const { data, error } = await supabase
      .from("google_search_ad_groups")
      .insert({
        campaign_id: campaignId,
        name: ag.name,
        default_cpc: ag.default_cpc,
        sort_order: ag.sort_order,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        `saveGoogleSearchPlanTree (ad_group insert "${ag.name}") failed: ${error?.message ?? "no row"}`,
      );
    }
    adGroupTmpToReal.set(ag.id, (data as { id: string }).id);
  }
  const resolveAdGroupId = (treeId: string): string => {
    if (isRealRowId(treeId) && existingAdGroupIds.has(treeId) && !adGroupPlan.deletes.includes(treeId)) {
      return treeId;
    }
    const realId = adGroupTmpToReal.get(treeId);
    if (realId !== undefined) return realId;
    if (!isRealRowId(treeId)) {
      throw new Error(
        `[google-search save] unresolved tmp ad group id "${treeId}" — insert must have failed`,
      );
    }
    return treeId;
  };

  // ── 4. Keywords ───────────────────────────────────────────────────
  const survivingAdGroupIds: string[] = [
    ...adGroupPlan.updates.map((ag) => ag.id),
    ...adGroupTmpToReal.values(),
  ].filter(isRealRowId);

  const existingKeywordIds = new Set<string>();
  if (survivingAdGroupIds.length > 0) {
    const { data, error } = await supabase
      .from("google_search_keywords")
      .select("id")
      .in("ad_group_id", survivingAdGroupIds);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (load keywords) failed: ${error.message}`);
    }
    for (const row of (data ?? []) as Array<{ id: string }>) existingKeywordIds.add(row.id);
  }

  const treeKeywords = tree.campaigns.flatMap((c) =>
    c.ad_groups.flatMap((ag) =>
      ag.keywords.map((k) => ({ k, adGroupRealId: resolveAdGroupId(ag.id) })),
    ),
  );
  const keywordPlan = partitionTreeRows(
    existingKeywordIds,
    treeKeywords.map(({ k }) => k),
  );
  const keywordAdGroupByTreeId = new Map(
    treeKeywords.map(({ k, adGroupRealId }) => [k.id, adGroupRealId]),
  );

  if (keywordPlan.deletes.length > 0) {
    const { error } = await supabase
      .from("google_search_keywords")
      .delete()
      .in("id", keywordPlan.deletes);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (keyword delete) failed: ${error.message}`);
    }
  }
  for (const k of keywordPlan.updates) {
    const { error } = await supabase
      .from("google_search_keywords")
      .update({
        keyword: k.keyword,
        match_type: k.match_type,
        est_cpc_low: k.est_cpc_low,
        est_cpc_high: k.est_cpc_high,
        intent: k.intent,
        notes: k.notes,
      })
      .eq("id", k.id);
    if (error) {
      throw new Error(
        `saveGoogleSearchPlanTree (keyword update "${k.keyword}") failed: ${error.message}`,
      );
    }
  }
  if (keywordPlan.inserts.length > 0) {
    const rows = keywordPlan.inserts.map((k) => {
      const adGroupId = keywordAdGroupByTreeId.get(k.id);
      if (!adGroupId) {
        throw new Error(
          `saveGoogleSearchPlanTree: keyword "${k.keyword}" has no resolved ad_group id`,
        );
      }
      return {
        ad_group_id: adGroupId,
        keyword: k.keyword,
        match_type: k.match_type,
        est_cpc_low: k.est_cpc_low,
        est_cpc_high: k.est_cpc_high,
        intent: k.intent,
        notes: k.notes,
      };
    });
    const { error } = await supabase.from("google_search_keywords").insert(rows);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (keyword insert) failed: ${error.message}`);
    }
  }

  // ── 5. RSAs ───────────────────────────────────────────────────────
  const existingRsaIds = new Set<string>();
  if (survivingAdGroupIds.length > 0) {
    const { data, error } = await supabase
      .from("google_search_rsas")
      .select("id")
      .in("ad_group_id", survivingAdGroupIds);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (load rsas) failed: ${error.message}`);
    }
    for (const row of (data ?? []) as Array<{ id: string }>) existingRsaIds.add(row.id);
  }

  const treeRsas = tree.campaigns.flatMap((c) =>
    c.ad_groups.flatMap((ag) =>
      ag.rsas.map((r) => ({ r, adGroupRealId: resolveAdGroupId(ag.id) })),
    ),
  );
  const rsaPlan = partitionTreeRows(
    existingRsaIds,
    treeRsas.map(({ r }) => r),
  );
  const rsaAdGroupByTreeId = new Map(
    treeRsas.map(({ r, adGroupRealId }) => [r.id, adGroupRealId]),
  );

  if (rsaPlan.deletes.length > 0) {
    const { error } = await supabase
      .from("google_search_rsas")
      .delete()
      .in("id", rsaPlan.deletes);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (rsa delete) failed: ${error.message}`);
    }
  }
  for (const r of rsaPlan.updates) {
    const { error } = await supabase
      .from("google_search_rsas")
      .update({
        headlines: r.headlines,
        descriptions: r.descriptions,
        final_url: r.final_url,
        path1: r.path1,
        path2: r.path2,
      })
      .eq("id", r.id);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (rsa update) failed: ${error.message}`);
    }
  }
  if (rsaPlan.inserts.length > 0) {
    const rows = rsaPlan.inserts.map((r) => {
      const adGroupId = rsaAdGroupByTreeId.get(r.id);
      if (!adGroupId) {
        throw new Error("saveGoogleSearchPlanTree: RSA has no resolved ad_group id");
      }
      return {
        ad_group_id: adGroupId,
        headlines: r.headlines,
        descriptions: r.descriptions,
        final_url: r.final_url,
        path1: r.path1,
        path2: r.path2,
      };
    });
    const { error } = await supabase.from("google_search_rsas").insert(rows);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (rsa insert) failed: ${error.message}`);
    }
  }

  // ── 6. Negatives (plan- + campaign-scoped) ─────────────────────────
  const { data: existingNegRaw, error: existNegErr } = await supabase
    .from("google_search_negatives")
    .select("id")
    .eq("plan_id", tree.plan.id);
  if (existNegErr) {
    throw new Error(`saveGoogleSearchPlanTree (load negatives) failed: ${existNegErr.message}`);
  }
  const existingNegativeIds = new Set(
    ((existingNegRaw ?? []) as Array<{ id: string }>).map((r) => r.id),
  );

  // Tag each negative with its target campaign id (null for plan-scoped)
  // BEFORE diffing so inserts can resolve the FK without an extra map.
  const taggedNegatives = [
    ...tree.plan_negatives.map((n) => ({ n, campaignId: null as string | null })),
    ...tree.campaigns.flatMap((c) =>
      c.negatives.map((n) => ({ n, campaignId: resolveCampaignId(c.id) })),
    ),
  ];
  const negativePlan = partitionTreeRows(
    existingNegativeIds,
    taggedNegatives.map(({ n }) => n),
  );
  const negativeCampaignByTreeId = new Map(
    taggedNegatives.map(({ n, campaignId }) => [n.id, campaignId]),
  );

  if (negativePlan.deletes.length > 0) {
    const { error } = await supabase
      .from("google_search_negatives")
      .delete()
      .in("id", negativePlan.deletes);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (negative delete) failed: ${error.message}`);
    }
  }
  for (const n of negativePlan.updates) {
    const campaignId = negativeCampaignByTreeId.get(n.id);
    // campaignId of `undefined` shouldn't happen because every tree
    // negative was tagged above; fall back to whatever the tree row
    // carries so a stray case doesn't null the FK silently.
    const resolvedCampaignId = campaignId === undefined ? n.campaign_id : campaignId;
    const { error } = await supabase
      .from("google_search_negatives")
      .update({
        campaign_id: resolvedCampaignId,
        keyword: n.keyword,
        match_type: n.match_type,
        reason: n.reason,
      })
      .eq("id", n.id);
    if (error) {
      throw new Error(
        `saveGoogleSearchPlanTree (negative update "${n.keyword}") failed: ${error.message}`,
      );
    }
  }
  if (negativePlan.inserts.length > 0) {
    const rows = negativePlan.inserts.map((n) => ({
      plan_id: tree.plan.id,
      campaign_id: negativeCampaignByTreeId.get(n.id) ?? null,
      keyword: n.keyword,
      match_type: n.match_type,
      reason: n.reason,
    }));
    const { error } = await supabase.from("google_search_negatives").insert(rows);
    if (error) {
      throw new Error(`saveGoogleSearchPlanTree (negative insert) failed: ${error.message}`);
    }
  }
}

// ─── Pure reconciliation helper (exported for unit tests) ─────────────

export interface ReconcilePlan<T extends { id: string }> {
  updates: T[];
  inserts: T[];
  deletes: string[];
}

/**
 * Splits a set of tree rows against the ids currently in the database
 * into update / insert / delete buckets. Pure — testable in isolation
 * + reused across the five child levels (campaigns, ad_groups,
 * keywords, rsas, negatives).
 *
 *  - Tree row whose id is a real UUID present in `existing` → UPDATE.
 *  - Tree row whose id is NOT a real UUID (tmp-…) or not in `existing`
 *    → INSERT. Non-UUID ids (tmp-…) are *explicitly* treated as inserts
 *    regardless of `existing`, which prevents them from leaking into
 *    `.in()` filters or FK insert payloads and triggering Postgres's
 *    "invalid input syntax for type uuid" error.
 *  - DB id absent from `tree` → DELETE.
 */
export function partitionTreeRows<T extends { id: string }>(
  existing: Set<string>,
  tree: T[],
): ReconcilePlan<T> {
  const updates: T[] = [];
  const inserts: T[] = [];
  const treeIds = new Set<string>();
  for (const row of tree) {
    treeIds.add(row.id);
    // Non-UUID ids (tmp-…) can never be in the DB — always INSERT.
    if (isRealRowId(row.id) && existing.has(row.id)) updates.push(row);
    else inserts.push(row);
  }
  const deletes: string[] = [];
  for (const id of existing) if (!treeIds.has(id)) deletes.push(id);
  return { updates, inserts, deletes };
}
