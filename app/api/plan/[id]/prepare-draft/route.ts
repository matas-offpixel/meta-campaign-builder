import { NextRequest, NextResponse } from "next/server";

import { createGoogleSearchPlanTreeFromDraft } from "@/lib/db/google-search-plans";
import { listPresetsForClient } from "@/lib/db/optimisation-presets";
import { upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { planToGoogleDraft } from "@/lib/plan/adapters/google";
import {
  deriveGoogleKeywords,
  deriveGoogleNoiseNegatives,
  mergeDerivedGoogleKeywords,
  toGoogleSearchPlanDraftTree,
} from "@/lib/plan/derive/google";
import { buildPlanVocabulary, deriveTikTokTargeting } from "@/lib/plan/derive/server";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import {
  rowToCampaignPlanIntent,
  upsertCampaignPlan,
  upsertPlanLaunchRow,
} from "@/lib/plan/persist";
import {
  GOOGLE_PREPARE_REASON,
  buildPrefillMetaDraft,
  buildPrefillTikTokDraft,
  resolvePreparedDraftId,
  wizardHrefForDraft,
  type PreparableAdapter,
} from "@/lib/plan/prepare-draft";
import {
  applyGoogleChannelDefaults,
  applyMetaChannelDefaults,
  applyTikTokChannelDefaults,
  loadChannelDefaultsForEvent,
  resolveChannelDefaults,
} from "@/lib/clients/channel-defaults";
import {
  cloneCampaignDraft,
  draftFromLibraryTemplate,
  overlayPlanSharedInputs,
} from "@/lib/plan/from-existing";
import { runPlanTikTokAssetFanout } from "@/lib/plan/asset-routing-server";
import { loadLinkedDraftsForPlan, loadLinkedMetaDraft, upsertLinkedMetaDraft } from "@/lib/plan/linked-drafts";
import type { CampaignPlan } from "@/lib/plan/types";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import type { CampaignDraft, CampaignTemplate } from "@/lib/types";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";
import { createClient } from "@/lib/supabase/server";

function isPreparable(value: unknown): value is PreparableAdapter {
  return value === "meta" || value === "tiktok" || value === "google";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  let adapter: unknown;
  let clientId: string | null = null;
  let source: { kind?: string; id?: string } | undefined;
  try {
    const body = (await req.json()) as {
      adapter?: unknown;
      clientId?: string | null;
      source?: { kind?: string; id?: string };
    };
    adapter = body.adapter;
    clientId = body.clientId ?? null;
    source = body.source;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bad JSON" },
      { status: 400 },
    );
  }

  if (!isPreparable(adapter)) {
    return NextResponse.json(
      { ok: false, error: "adapter must be meta, tiktok or google" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("campaign_plans")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "Plan not found — save the plan before preparing a draft" },
      { status: 404 },
    );
  }

  const row = data as {
    id: string;
    user_id: string;
    name: string | null;
    status: CampaignPlan["status"];
    created_at: string;
    updated_at: string;
  } & Parameters<typeof rowToCampaignPlanIntent>[0];

  const launches = await loadPlanLaunchRecords(supabase, row.id);
  const plan: CampaignPlan = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    intent: rowToCampaignPlanIntent(row),
    launches,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  const fromLibrary = source?.kind === "draft" || source?.kind === "template";
  const existing = launches[adapter].draftId;
  if (existing && !fromLibrary) {
    let routed: { failed: number } | undefined;
    if (adapter === "tiktok") {
      routed = await fanoutRoutedAssets(supabase, plan);
    }
    return NextResponse.json({
      ok: true,
      reused: true,
      adapter,
      draftId: existing,
      href: wizardHrefForDraft(adapter, existing),
      launches,
      routed,
    });
  }

  if (adapter === "meta" && fromLibrary) {
    const names = await listOwnedDraftNames(supabase, user.id);
    let copy: CampaignDraft;
    if (source?.kind === "draft" && source.id) {
      const original = await loadLinkedMetaDraft(supabase, source.id, user.id);
      if (!original) {
        return NextResponse.json(
          { ok: false, error: "Campaign not found" },
          { status: 404 },
        );
      }
      copy = overlayPlanSharedInputs(cloneCampaignDraft(original, names), plan, {
        clientId,
      });
      copy = await withMetaDefaults(supabase, plan.intent.eventId, copy);
    } else if (source?.kind === "template" && source.id) {
      const template = await loadOwnedTemplate(supabase, user.id, source.id);
      if (!template) {
        return NextResponse.json(
          { ok: false, error: "Template not found" },
          { status: 404 },
        );
      }
      copy = overlayPlanSharedInputs(draftFromLibraryTemplate(template, names), plan, {
        clientId,
      });
      copy = await withMetaDefaults(supabase, plan.intent.eventId, copy);
    } else {
      return NextResponse.json(
        { ok: false, error: "source.id is required" },
        { status: 400 },
      );
    }
    const saved = await upsertLinkedMetaDraft(supabase, copy, user.id);
    if (!saved.ok) {
      return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
    }
    const record = {
      ...launches.meta,
      draftId: copy.id,
    };
    const launchWrite = await upsertPlanLaunchRow(supabase, {
      planId: plan.id,
      userId: user.id,
      adapter: "meta",
      record,
    });
    if (!launchWrite.ok) {
      return NextResponse.json({ ok: false, error: launchWrite.error }, { status: 500 });
    }
    launches.meta = record;
    return NextResponse.json({
      ok: true,
      reused: false,
      adapter,
      draftId: copy.id,
      href: wizardHrefForDraft("meta", copy.id),
      launches,
    });
  }

  if (adapter === "meta") {
    // Client optimisation policy is materialised here and nowhere else —
    // the draft carries its own copy from this point on.
    const presets = clientId
      ? await listPresetsForClient(supabase, clientId)
      : null;
    const draft = await withMetaDefaults(
      supabase,
      plan.intent.eventId,
      buildPrefillMetaDraft(plan, clientId, presets),
    );
    const saved = await upsertLinkedMetaDraft(supabase, draft, user.id);
    if (!saved.ok) {
      return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
    }
    const resolved = resolvePreparedDraftId(null, draft.id);
    const record = {
      ...launches.meta,
      draftId: resolved.draftId,
    };
    const launchWrite = await upsertPlanLaunchRow(supabase, {
      planId: plan.id,
      userId: user.id,
      adapter: "meta",
      record,
    });
    if (!launchWrite.ok) {
      return NextResponse.json({ ok: false, error: launchWrite.error }, { status: 500 });
    }
    launches.meta = record;
    return NextResponse.json({
      ok: true,
      reused: false,
      adapter,
      draftId: resolved.draftId,
      href: wizardHrefForDraft("meta", resolved.draftId),
      launches,
    });
  }

  // Meta is the authoring surface: TikTok and Google take their targeting
  // vocabulary from the linked Meta draft rather than from plan-level fields.
  const { vocabulary, hasMetaDraft } = await buildPlanVocabulary(supabase, plan);

  if (adapter === "google") {
    if (!hasMetaDraft) {
      return NextResponse.json(
        { ok: false, error: GOOGLE_PREPARE_REASON },
        { status: 400 },
      );
    }
    const seeded = mergeDerivedGoogleKeywords(
      await withGoogleDefaults(supabase, plan.intent.eventId, planToGoogleDraft(plan)),
      deriveGoogleKeywords(vocabulary),
      deriveGoogleNoiseNegatives(),
    );
    const created = await createGoogleSearchPlanTreeFromDraft(
      supabase,
      user.id,
      toGoogleSearchPlanDraftTree(seeded.tree),
      { event_id: plan.intent.eventId },
    );
    const record = { ...launches.google, draftId: created.plan_id };
    const launchWrite = await upsertPlanLaunchRow(supabase, {
      planId: plan.id,
      userId: user.id,
      adapter: "google",
      record,
    });
    if (!launchWrite.ok) {
      return NextResponse.json({ ok: false, error: launchWrite.error }, { status: 500 });
    }
    launches.google = record;
    return NextResponse.json({
      ok: true,
      reused: false,
      adapter,
      draftId: created.plan_id,
      href: wizardHrefForDraft("google", created.plan_id),
      derived: { added: seeded.addedKeywords, negatives: seeded.addedNegatives },
      launches,
    });
  }

  const draft = await withTikTokDefaults(
    supabase,
    plan.intent.eventId,
    buildPrefillTikTokDraft(plan, clientId),
  );
  const saved = await upsertTikTokDraft(supabase as never, draft.id, {
    ...draft,
    userId: user.id,
  });
  const resolved = resolvePreparedDraftId(null, saved.id);

  // Derivation needs an advertiser (suggestions are advertiser-scoped), which
  // a fresh plan draft does not have yet. A skipped derivation is reported,
  // never silently swallowed — the operator re-derives from the plan card.
  let derived: { added: number; skippedReason: string | null } = {
    added: 0,
    skippedReason: hasMetaDraft ? null : GOOGLE_PREPARE_REASON,
  };
  if (hasMetaDraft) {
    const outcome = await deriveTikTokTargeting(supabase, {
      userId: user.id,
      draft,
      vocabulary,
    });
    if (outcome.ok) {
      await upsertTikTokDraft(supabase as never, outcome.merged.draft.id, {
        ...outcome.merged.draft,
        userId: user.id,
      });
      derived = { added: outcome.merged.added, skippedReason: null };
    } else {
      derived = { added: 0, skippedReason: outcome.reason };
    }
  }

  const record = {
    ...launches.tiktok,
    draftId: resolved.draftId,
  };
  const launchWrite = await upsertPlanLaunchRow(supabase, {
    planId: plan.id,
    userId: user.id,
    adapter: "tiktok",
    record,
  });
  if (!launchWrite.ok) {
    return NextResponse.json({ ok: false, error: launchWrite.error }, { status: 500 });
  }
  launches.tiktok = record;
  await upsertCampaignPlan(supabase, plan);
  const routed = await fanoutRoutedAssets(supabase, { ...plan, launches });
  return NextResponse.json({
    ok: true,
    reused: false,
    adapter,
    draftId: resolved.draftId,
    href: wizardHrefForDraft("tiktok", resolved.draftId),
    derived,
    routed,
    launches,
  });
}

async function fanoutRoutedAssets(
  supabase: unknown,
  plan: CampaignPlan,
): Promise<{ failed: number; added: number } | undefined> {
  const drafts = await loadLinkedDraftsForPlan(supabase, plan);
  if (!drafts.tiktok) return undefined;
  const applied = await runPlanTikTokAssetFanout({
    supabase,
    plan,
    metaDraft: drafts.meta,
    tiktokDraft: drafts.tiktok,
  });
  return {
    added: applied.added,
    failed: applied.cells.filter((cell) => !cell.ok).length,
  };
}

async function listOwnedDraftNames(supabase: unknown, userId: string): Promise<string[]> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => Promise<{
          data: Array<{ name?: string | null }> | null;
        }>;
      };
    };
  };
  const { data } = await client.from("campaign_drafts").select("name").eq("user_id", userId);
  return (data ?? []).map((row) => row.name).filter((name): name is string => Boolean(name));
}

async function loadOwnedTemplate(
  supabase: unknown,
  userId: string,
  templateId: string,
): Promise<CampaignTemplate | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
          };
        };
      };
    };
  };
  const { data } = await client
    .from("campaign_templates")
    .select("*")
    .eq("id", templateId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    description: (data.description as string) ?? "",
    tags: (data.tags as string[]) ?? [],
    snapshot: data.snapshot_json as CampaignTemplate["snapshot"],
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

async function resolvedDefaults(supabase: unknown, eventId: string | null) {
  const loaded = await loadChannelDefaultsForEvent(supabase, eventId);
  return resolveChannelDefaults(loaded?.stored ?? null, loaded?.overrides ?? {});
}

async function withMetaDefaults(
  supabase: unknown,
  eventId: string | null,
  draft: CampaignDraft,
): Promise<CampaignDraft> {
  return applyMetaChannelDefaults(draft, await resolvedDefaults(supabase, eventId));
}

async function withTikTokDefaults(
  supabase: unknown,
  eventId: string | null,
  draft: TikTokCampaignDraft,
): Promise<TikTokCampaignDraft> {
  return applyTikTokChannelDefaults(draft, await resolvedDefaults(supabase, eventId));
}

async function withGoogleDefaults(
  supabase: unknown,
  eventId: string | null,
  tree: GoogleSearchPlanTree,
): Promise<GoogleSearchPlanTree> {
  return applyGoogleChannelDefaults(tree, await resolvedDefaults(supabase, eventId));
}
