import type { SupabaseClient } from "@supabase/supabase-js";

import { getOwnedTikTokDraft, upsertTikTokDraft } from "../../db/tiktok-drafts.ts";
import type { Database } from "../../db/database.types.ts";
import { readTikTokAccountCredentials } from "../api-account.ts";
import { TikTokApiError } from "../client.ts";
import {
  isTikTokWritesEnabled,
  TIKTOK_WRITES_DISABLED_REASON,
} from "./feature-flag.ts";
import { mapTikTokLaunchError } from "./error-classify.ts";
import {
  launchTikTokDraftState,
  TikTokLaunchPreflightError,
  type LaunchTikTokDraftResult,
} from "./orchestrator.ts";
import { hydrateDraftIdentityBcId } from "../identity.ts";
import { fetchAdvertiserCampaignNames } from "./campaign-names.ts";
import { collectTikTokLaunchPreflight } from "./preflight.ts";
import { tiktokGet } from "../client.ts";
import type { TikTokPost, Sleep } from "./idempotency.ts";

export interface TikTokLaunchSuccessBody {
  ok: true;
  campaign_id: string;
  adgroup_ids: string[];
  ad_ids: string[];
  entities: LaunchTikTokDraftResult["entities"];
}

export interface TikTokLaunchErrorBody {
  ok: false;
  error: string;
  reason?: string;
  preflight?: ReturnType<typeof collectTikTokLaunchPreflight>["issues"];
  tiktok?: { code?: number; message: string; request_id?: string };
}

export type TikTokLaunchResponse = {
  status: number;
  body: TikTokLaunchSuccessBody | TikTokLaunchErrorBody;
};

export async function handleTikTokLaunch(input: {
  userId: string | null;
  draftId: unknown;
  session: SupabaseClient<Database>;
  admin: Pick<SupabaseClient, "from">;
  request?: TikTokPost;
  requestGet?: typeof tiktokGet;
  sleep?: Sleep;
}): Promise<TikTokLaunchResponse> {
  if (!input.userId) {
    return { status: 401, body: { ok: false, error: "Unauthorised" } };
  }
  if (typeof input.draftId !== "string" || !input.draftId.trim()) {
    return { status: 400, body: { ok: false, error: "Missing required field: draftId" } };
  }
  if (!isTikTokWritesEnabled()) {
    return {
      status: 503,
      body: {
        ok: false,
        error: TIKTOK_WRITES_DISABLED_REASON,
        reason: "writes_disabled",
      },
    };
  }

  const draft = await getOwnedTikTokDraft(
    input.session,
    input.draftId,
    input.userId,
  );
  if (!draft) {
    return { status: 404, body: { ok: false, error: "Draft not found" } };
  }

  const advertiserId = draft.accountSetup.advertiserId;
  if (!advertiserId) {
    return { status: 400, body: { ok: false, error: "TikTok advertiser is missing" } };
  }

  const credentials = await readTikTokAccountCredentials(input.session, {
    userId: input.userId,
    advertiserId,
  });
  if (!credentials?.accessToken) {
    return {
      status: 400,
      body: { ok: false, error: "TikTok credentials missing for this advertiser" },
    };
  }

  await hydrateDraftIdentityBcId({
    draft,
    token: credentials.accessToken,
  });

  let existingCampaignNames: string[] = [];
  try {
    existingCampaignNames = await fetchAdvertiserCampaignNames({
      advertiserId,
      token: credentials.accessToken,
      request: input.requestGet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[tiktok/launch] campaign name preflight read failed advertiser=${advertiserId}: ${message}`,
    );
  }

  const preflight = collectTikTokLaunchPreflight(draft, {
    existingCampaignNames,
  });
  if (!preflight.ok) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Launch preflight failed",
        preflight: preflight.issues,
      },
    };
  }

  try {
    const result = await launchTikTokDraftState(
      {
        supabase: input.admin,
        userId: input.userId,
        eventId: draft.eventId!,
        draftId: draft.id,
        token: credentials.accessToken,
        request: input.request,
        existingCampaignNames,
        sleep: input.sleep,
      },
      draft,
    );

    await upsertTikTokDraft(input.session, draft.id, {
      ...draft,
      userId: input.userId,
      status: "published",
      publishedIds: {
        campaignId: result.campaign_id,
        adgroupIds: result.adgroup_ids,
        adIds: result.ad_ids,
      },
    });

    return {
      status: 200,
      body: {
        ok: true,
        campaign_id: result.campaign_id,
        adgroup_ids: result.adgroup_ids,
        ad_ids: result.ad_ids,
        entities: result.entities,
      },
    };
  } catch (err) {
    if (err instanceof TikTokLaunchPreflightError) {
      return {
        status: 400,
        body: {
          ok: false,
          error: "Launch preflight failed",
          preflight: err.issues,
        },
      };
    }
    if (err instanceof TikTokApiError) {
      console.error(
        `[tiktok/launch-campaign] TikTok write failed code=${err.code ?? "n/a"} message=${err.message} request_id=${err.requestId ?? "n/a"}`,
      );
      const mapped = mapTikTokLaunchError({
        code: err.code,
        message: err.message,
        requestId: err.requestId,
        campaignName: draft.campaignSetup.campaignName,
      });
      return {
        status: mapped.status,
        body: {
          ok: false,
          error: mapped.message,
          tiktok: {
            code: err.code,
            message: err.message,
            request_id: err.requestId,
          },
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tiktok/launch-campaign] launch failed: ${message}`);
    return { status: 500, body: { ok: false, error: message } };
  }
}
