import { NextRequest, NextResponse } from "next/server";

import {
  loadGoogleSearchPlanTree,
  saveGoogleSearchPlanTree,
} from "@/lib/db/google-search-plans";
import { upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import {
  deriveGoogleKeywords,
  deriveGoogleNoiseNegatives,
  mergeDerivedGoogleKeywords,
} from "@/lib/plan/derive/google";
import { buildPlanVocabulary, deriveTikTokTargeting } from "@/lib/plan/derive/server";
import { TIKTOK_HASHTAG_WITHHELD_REASON } from "@/lib/plan/derive/tiktok";
import { loadPlanForUser } from "@/lib/plan/load";
import { loadLinkedDraftsForPlan } from "@/lib/plan/linked-drafts";
import { createClient } from "@/lib/supabase/server";

const NO_META_DRAFT =
  "no_meta_draft — build the Meta campaign first; TikTok and Google derive their targeting vocabulary from it";

/**
 * Re-derive TikTok / Google inputs from the linked Meta draft.
 *
 * Meta is the authoring surface. This never overwrites a field the operator
 * edited in the TikTok or Google wizard — see the derived-vs-operator
 * provenance rules in lib/plan/derive/{tiktok,google}.ts.
 */
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
  try {
    const body = (await req.json()) as { adapter?: unknown };
    adapter = body.adapter;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bad JSON" },
      { status: 400 },
    );
  }
  if (adapter !== "tiktok" && adapter !== "google") {
    return NextResponse.json(
      { ok: false, error: "adapter must be tiktok or google" },
      { status: 400 },
    );
  }

  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const { vocabulary, hasMetaDraft } = await buildPlanVocabulary(supabase, plan);
  if (!hasMetaDraft) {
    return NextResponse.json({ ok: false, error: NO_META_DRAFT }, { status: 400 });
  }

  if (adapter === "tiktok") {
    const linked = await loadLinkedDraftsForPlan(supabase, plan);
    if (!linked.tiktok) {
      return NextResponse.json(
        { ok: false, error: "Prepare the TikTok draft before re-deriving" },
        { status: 400 },
      );
    }
    const outcome = await deriveTikTokTargeting(supabase, {
      userId: user.id,
      draft: linked.tiktok,
      vocabulary,
    });
    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.reason }, { status: 400 });
    }
    await upsertTikTokDraft(supabase as never, outcome.merged.draft.id, {
      ...outcome.merged.draft,
      userId: user.id,
    });
    return NextResponse.json({
      ok: true,
      adapter,
      added: outcome.merged.added,
      lastDerivedAt: outcome.merged.draft.lastDerivedAt ?? null,
      keptOperatorItems: outcome.merged.keptOperatorItems,
      replacedDerivedItems: outcome.merged.replacedDerivedItems,
      terms: outcome.derived.map((term) => ({
        name: term.name,
        provenance: term.provenance,
      })),
      hashtagsWithheld: TIKTOK_HASHTAG_WITHHELD_REASON,
    });
  }

  const googlePlanId = plan.launches.google.draftId;
  if (!googlePlanId) {
    return NextResponse.json(
      { ok: false, error: "Prepare the Google plan before re-deriving" },
      { status: 400 },
    );
  }
  const tree = await loadGoogleSearchPlanTree(supabase, googlePlanId);
  if (!tree) {
    return NextResponse.json(
      { ok: false, error: "Linked Google search plan not found" },
      { status: 404 },
    );
  }
  const merged = mergeDerivedGoogleKeywords(
    tree,
    deriveGoogleKeywords(vocabulary),
    deriveGoogleNoiseNegatives(),
  );
  await saveGoogleSearchPlanTree(supabase, merged.tree);
  return NextResponse.json({
    ok: true,
    adapter,
    added: merged.addedKeywords,
    lastDerivedAt: merged.lastDerivedAt,
    keptOperatorItems: merged.keptOperatorKeywords,
    replacedDerivedItems: merged.replacedDerivedKeywords,
    addedNegatives: merged.addedNegatives,
    terms: merged.tree.campaigns[0]?.ad_groups[0]?.keywords
      .filter((row) => row.notes?.startsWith("plan-derived:"))
      .map((row) => ({ name: row.keyword, provenance: row.notes ?? "" })),
  });
}
