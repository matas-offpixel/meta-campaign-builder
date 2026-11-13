/**
 * POST /api/events/[id]/onsale-refresh/apply { retry?: boolean, lineIds?: string[] }
 *
 * Apply accepted (n) — or, with retry, Retry failed (n) — for the event's
 * creative, audience and budget lines (P2 and P3 of docs/design-record/2026-11-12-on-sale-refresh.html).
 *
 * Gates, before any Drive, Storage or Graph call: session auth and the
 * event's owner, then Live — ONSALE_REFRESH_APPLY_ENABLED exactly "1" and
 * the event armed Live. Each write also needs its own gate: Pause creative
 * OFFPIXEL_META_AD_STATUS_WRITES_ENABLED = "true"; Bring back and Drop
 * OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED = "true"; a move
 * ENABLE_OPTIMISATION_WRITES = "1" (P3). The engine
 * (lib/onsale-refresh/apply.ts) re-checks the campaign guard and the plan
 * guard per line and records every write on meta_write_idempotency.
 *
 * This route only wires the real paths in: the launch path's creative
 * build (buildCreativePayload with the IG actor checked, as bulk attach),
 * POST /act_{id}/adcreatives and /ads with status ACTIVE, #1200's From
 * Drive copy, the draft upload (POST /api/meta/upload-asset), and the
 * ad-status POST behind its own gate.
 */

import { NextResponse, type NextRequest } from "next/server";

import { uploadFileToStorageBucket } from "@/lib/clients/asset-queue/storage-upload";
import { driveFromEnv } from "@/lib/drive/client";
import { PICKER_BUCKET, copyPickedFile } from "@/lib/drive/picker";
import { createMetaAd, createMetaCreative, graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import { buildCreativePayload } from "@/lib/meta/creative";
import { createIgActorValidator } from "@/lib/meta/ig-actor-validator";
import { resolvePageIdentity } from "@/lib/meta/page-token";
import { handleUploadAsset } from "@/lib/meta/upload-asset-handler";
import { APPLY_SHADOW, applyAccepted, type DriveCopy, type RefreshMeta } from "@/lib/onsale-refresh/apply";

import { ownedRefreshEvent } from "../_owned";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await ownedRefreshEvent(id);
  if (who.error) return who.error;
  if (who.gates.mode !== "live") return NextResponse.json({ ok: false, error: APPLY_SHADOW }, { status: 409 });

  let body: { retry?: unknown; lineIds?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const lineIds = Array.isArray(body.lineIds) ? body.lineIds.filter((value): value is string => typeof value === "string") : undefined;

  let token = process.env.META_ACCESS_TOKEN ?? "";
  try {
    const { data } = await who.session.from("user_facebook_tokens").select("provider_token").eq("user_id", who.userId).maybeSingle();
    if ((data as { provider_token?: string } | null)?.provider_token) token = (data as { provider_token: string }).provider_token;
  } catch {
    // the env token stands
  }
  if (!token) return NextResponse.json({ ok: false, error: "No Facebook token available. Reconnect Facebook in Account Setup." }, { status: 401 });

  const validators = new Map<string, ReturnType<typeof createIgActorValidator>>();
  const meta: RefreshMeta = {
    async readAdSet(adsetId) {
      const row = await graphGetWithToken<{ id: string; campaign_id?: string; effective_status?: string; status?: string; name?: string; daily_budget?: string }>(
        `/${adsetId}`,
        { fields: "id,campaign_id,effective_status,status,name,daily_budget" },
        token,
        { maxAttempts: 1 },
      );
      const daily = Number(row?.daily_budget);
      return row?.id
        ? { id: row.id, campaignId: row.campaign_id ?? null, effectiveStatus: row.effective_status ?? null, status: row.status ?? null, name: row.name ?? null, dailyBudget: row.daily_budget != null && Number.isFinite(daily) && daily > 0 ? daily : null }
        : null;
    },
    async listAdSets(campaignId) {
      const res = await graphGetWithToken<{ data?: { id: string; name?: string; effective_status?: string; status?: string }[] }>(`/${campaignId}/adsets`, { fields: "id,name,effective_status,status", limit: "200" }, token, { maxAttempts: 1 });
      return (res.data ?? []).map((set) => ({ id: set.id, campaignId, effectiveStatus: set.effective_status ?? null, status: set.status ?? null, name: set.name ?? null }));
    },
    // The optimisation budget write (app/api/cron/optimisation-tick): POST /{adset} { daily_budget }, single shot.
    async updateAdSetDailyBudget(adsetId, dailyBudgetPence) {
      await graphPostWithToken(`/${adsetId}`, { daily_budget: dailyBudgetPence }, token);
    },
    // The gated ad-set status write's POST (lib/meta/adset-status-write.ts).
    async postAdSetStatus(adsetId, status) {
      await graphPostWithToken(`/${adsetId}`, { status }, token);
    },
    async listAds(adsetId) {
      const res = await graphGetWithToken<{ data?: { id: string; effective_status?: string }[] }>(`/${adsetId}/ads`, { fields: "id,effective_status", limit: "200" }, token);
      return (res.data ?? []).map((ad) => ({ id: ad.id, effectiveStatus: ad.effective_status ?? null }));
    },
    async createCreative(adAccountId, creative) {
      const validator = validators.get(adAccountId) ?? createIgActorValidator(adAccountId, token);
      validators.set(adAccountId, validator);
      let pageToken: string | null = null;
      try {
        pageToken = (await resolvePageIdentity(creative.identity.pageId, token)).pageAccessToken ?? null;
      } catch {
        pageToken = null;
      }
      const igActor = creative.identity.instagramActorId ? await validator.validate(creative.identity.instagramActorId, { pageId: creative.identity.pageId, pageToken }) : null;
      const payload = await buildCreativePayload(creative, { validatedIgActorId: igActor ?? undefined, metaAccessToken: token });
      const { id: creativeId } = await createMetaCreative(adAccountId, payload, token);
      return creativeId;
    },
    async createAd(adAccountId, ad) {
      const { id: adId } = await createMetaAd(adAccountId, ad, token);
      return adId;
    },
    async post(adId, status) {
      await graphPostWithToken(`/${adId}`, { status }, token);
    },
  };

  const copyFromDrive = async (fileId: string): Promise<DriveCopy> => {
    const { drive } = driveFromEnv();
    if (!drive) return { ok: false, reason: "Drive isn't configured on this deployment" };
    const deps = {
      db: who.db,
      drive,
      userId: who.userId,
      uploadFile: async (storagePath: string, filePath: string, contentType: string) => {
        const uploaded = await uploadFileToStorageBucket(who.db as never, PICKER_BUCKET, storagePath, filePath, contentType);
        if (uploaded.error) throw new Error(uploaded.error.message ?? "Storage upload failed");
      },
      copyObject: async (from: string, to: string) => {
        const copied = await who.db.storage.from(PICKER_BUCKET).copy(from, to);
        if (copied.error) throw new Error(copied.error.message);
      },
    };
    // A video runs as 9:16; a static may be a 4:5 or 1:1 final.
    let last: DriveCopy = { ok: false, reason: "Couldn't copy from Drive" };
    for (const role of ["9:16", "4:5", "1:1"] as const) {
      const result = await copyPickedFile(deps, who.event, { fileId, role });
      if (result.ok) return { ok: true, storagePath: result.storagePath, storageBucket: result.storageBucket, registryAssetId: result.registryAssetId, mediaType: result.mediaType === "video" ? "video" : "image", fileName: result.fileName, aspectRatio: role };
      last = { ok: false, reason: result.reason };
      if (result.code !== "not_916") break;
    }
    return last;
  };

  const upload = async (input: { storagePath: string; storageBucket: string; type: "video" | "image"; adAccountId: string; fileName: string; aspectRatio: string }) => {
    const res = await handleUploadAsset(
      new Request("http://internal/api/meta/upload-asset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    );
    const json = (await res.json()) as { error?: string; videoId?: string; hash?: string };
    if (!res.ok) throw new Error(json.error || "upload failed");
    return { videoId: json.videoId, imageHash: json.hash };
  };

  const result = await applyAccepted({
    deps: { db: who.db, env: process.env, meta, copyFromDrive, upload },
    eventId: who.event.id,
    userId: who.userId,
    appliedByName: who.userName,
    gates: who.gates,
    retry: body.retry === true,
    lineIds,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
