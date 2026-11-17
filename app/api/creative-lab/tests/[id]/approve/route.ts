/**
 * POST /api/creative-lab/tests/{id}/approve — "Approve variants": creates
 * the test on Meta, ACTIVE, in the show's one "{code} · Tests" campaign
 * (lib/creative-tests/approve.ts, tests-campaign.ts).
 *
 * CREATIVE_TESTS_CREATE_ENABLED must be exactly "true", or this returns 503
 * before any Graph call or database write. Then Matas only, then the test's
 * owner.
 */

import { NextRequest, NextResponse } from "next/server";

import { POST as metaLaunchPost } from "@/app/api/meta/launch-campaign/route";
import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import type { LabUploadRequest } from "@/lib/creative-lab/launch";
import { CREATES_OFF, approveTest, createsEnabled, type AdCopy, type TestMeta } from "@/lib/creative-tests/approve";
import type { ListedCampaign } from "@/lib/creative-tests/tests-campaign";
import { agencyMetaToken } from "@/lib/meta/agency-token";
import { createMetaAdSet, graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import type { MetaAdSetPayload } from "@/lib/meta/adset";
import { handleUploadAsset } from "@/lib/meta/upload-asset-handler";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

function ctaOf(type: string | undefined): string {
  const t = (type ?? "").toUpperCase();
  if (t === "BUY_TICKETS") return "buy_tickets";
  if (t === "SIGN_UP") return "sign_up";
  if (t === "BOOK_TRAVEL" || t === "BOOK_NOW") return "book_now";
  return "learn_more";
}

function metaFor(token: string): TestMeta {
  return {
    async readAccount(adAccountId) {
      const row = await graphGetWithToken<{ min_daily_budget?: number | string; currency?: string }>(`/${act(adAccountId)}`, { fields: "min_daily_budget,currency" }, token, { maxAttempts: 1 });
      const min = Number(row?.min_daily_budget);
      return { minDailyBudget: Number.isFinite(min) && min > 0 ? min : null, currency: row?.currency ?? null };
    },
    readAdSet: (adsetId) =>
      graphGetWithToken<Record<string, unknown>>(`/${adsetId}`, { fields: "id,name,campaign_id,status,effective_status,targeting,daily_budget,optimization_goal,billing_event,promoted_object,attribution_spec,destination_type" }, token, { maxAttempts: 1 }),
    async readCampaign(campaignId) {
      const row = await graphGetWithToken<{ objective?: string; daily_budget?: string; status?: string }>(`/${campaignId}`, { fields: "objective,daily_budget,status" }, token, { maxAttempts: 1 });
      const daily = Number(row?.daily_budget);
      return row ? { objective: row.objective ?? null, dailyBudget: Number.isFinite(daily) && daily > 0 ? daily : null, status: row.status ?? null } : null;
    },
    async readAdCopy(adId): Promise<AdCopy | null> {
      type Spec = { page_id?: string; instagram_user_id?: string; instagram_actor_id?: string; link_data?: { message?: string; link?: string; call_to_action?: { type?: string } }; video_data?: { message?: string; call_to_action?: { type?: string; value?: { link?: string } } } };
      const ad = await graphGetWithToken<{ creative?: { object_story_spec?: Spec; body?: string; link_url?: string; call_to_action_type?: string; actor_id?: string; instagram_user_id?: string; instagram_actor_id?: string } }>(
        `/${adId}`,
        { fields: "creative{object_story_spec,body,link_url,call_to_action_type,actor_id,instagram_user_id,instagram_actor_id}" },
        token,
        { maxAttempts: 1 },
      );
      const c = ad?.creative;
      const spec = c?.object_story_spec;
      const pageId = spec?.page_id ?? c?.actor_id ?? "";
      const message = spec?.video_data?.message ?? spec?.link_data?.message ?? c?.body ?? "";
      const link = spec?.video_data?.call_to_action?.value?.link ?? spec?.link_data?.link ?? c?.link_url ?? "";
      const cta = spec?.video_data?.call_to_action?.type ?? spec?.link_data?.call_to_action?.type ?? c?.call_to_action_type;
      if (!pageId || !link) return null;
      return { pageId, instagramActorId: spec?.instagram_user_id ?? spec?.instagram_actor_id ?? c?.instagram_user_id ?? c?.instagram_actor_id ?? null, message, link, cta: ctaOf(cta) };
    },
    async createCampaign(adAccountId, payload) {
      const res = await graphPostWithToken<{ id: string }>(`/${act(adAccountId)}/campaigns`, payload, token);
      return res.id;
    },
    async createAdSet(adAccountId, payload) {
      const { id } = await createMetaAdSet(adAccountId, payload as unknown as MetaAdSetPayload, token);
      return id;
    },
    async findCampaigns(adAccountId, nameContains) {
      const res = await graphGetWithToken<{ data?: ListedCampaign[] }>(
        `/${act(adAccountId)}/campaigns`,
        {
          fields: "id,name,effective_status,created_time,daily_budget,lifetime_budget",
          effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
          filtering: JSON.stringify([{ field: "name", operator: "CONTAIN", value: nameContains }]),
          limit: "50",
        },
        token,
        { maxAttempts: 1 },
      );
      return res?.data ?? [];
    },
  };
}

async function upload(body: LabUploadRequest): Promise<{ videoId: string; registryAssetId?: string | null }> {
  const res = await handleUploadAsset(new Request("http://internal/api/meta/upload-asset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const json = (await res.json()) as { error?: string; videoId?: string; registryAssetId?: string | null };
  if (!res.ok || !json.videoId) throw new Error(json.error || "upload failed");
  return { videoId: json.videoId, registryAssetId: json.registryAssetId };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!createsEnabled(process.env)) return NextResponse.json({ ok: false, error: CREATES_OFF }, { status: 503 });
  const { id } = await ctx.params;
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  let token = agencyMetaToken(user.id) ?? "";
  try {
    const { data } = await session.from("user_facebook_tokens").select("provider_token").eq("user_id", user.id).maybeSingle();
    if ((data as { provider_token?: string } | null)?.provider_token) token = (data as { provider_token: string }).provider_token;
  } catch {
    // the agency token stands
  }
  if (!token) return NextResponse.json({ ok: false, error: "No Facebook token available. Reconnect Facebook in Account Setup." }, { status: 401 });
  const result = await approveTest(
    {
      db: createServiceRoleClient(),
      env: process.env,
      meta: metaFor(token),
      upload,
      async launch(body) {
        const launchReq = new NextRequest(new URL("/api/meta/launch-campaign", req.url), { method: "POST", headers: req.headers, body: JSON.stringify(body) });
        const res = await metaLaunchPost(launchReq);
        const json = (await res.json()) as { launchRunId?: string; error?: string; creativesFailed?: { name: string; error: string }[] };
        return { ok: res.ok, status: res.status, launchRunId: json.launchRunId, error: json.error, creativesFailed: json.creativesFailed };
      },
      isMatas: (userId) => MATAS_USER_IDS.includes(userId),
    },
    { testId: id, userId: user.id },
  );
  return NextResponse.json(result.body, { status: result.status });
}
