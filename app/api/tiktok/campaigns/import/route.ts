import { NextResponse, type NextRequest } from "next/server";

import {
  listTikTokDrafts,
  upsertTikTokDraft,
} from "@/lib/db/tiktok-drafts";
import {
  clientIdForTikTokAccount,
  credentialsForImportAdvertiser,
} from "@/lib/tiktok/import/account";
import { fetchTikTokAdvertiserInfo } from "@/lib/tiktok/advertiser";
import {
  buildTikTokImportPicker,
  finalizeTikTokImportDraft,
  mapTikTokLiveCampaignToDraft,
  parseTikTokImportCarry,
} from "@/lib/tiktok/import/map";
import { hydratePickerThumbnails } from "@/lib/tiktok/import/picker";
import { readTikTokLiveCampaign } from "@/lib/tiktok/import/readers";
import { tikTokDuplicateExistingNames } from "@/lib/tiktok-wizard/library";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tiktok/campaigns/import
 *
 * Two steps. Without `carry`, read the live campaign and return the
 * picker — nothing is saved. `carry: []` also saves nothing. With
 * `carry: string[]` of `video_id` / `tiktok_item_id` keys, map those
 * creatives onto a draft and save. Writes nothing to TikTok.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    advertiserId?: string;
    campaignId?: string;
    carry?: unknown;
  };
  const advertiserId = body.advertiserId?.trim();
  const campaignId = body.campaignId?.trim();
  if (!advertiserId || !campaignId) {
    return NextResponse.json(
      { ok: false, error: "advertiserId and campaignId are required" },
      { status: 400 },
    );
  }

  const decision = parseTikTokImportCarry(body);
  if (decision.action === "nosave") {
    return NextResponse.json({ ok: true, saved: false, draft: null }, { status: 200 });
  }

  const credentials = await credentialsForImportAdvertiser(supabase, {
    userId: user.id,
    advertiserId,
  });
  if ("error" in credentials) {
    return NextResponse.json(
      { ok: false, error: credentials.error },
      { status: credentials.status },
    );
  }

  try {
    const [bundle, advertiser] = await Promise.all([
      readTikTokLiveCampaign({
        advertiserId,
        campaignId,
        token: credentials.token,
      }),
      fetchTikTokAdvertiserInfo({
        advertiserId,
        token: credentials.token,
      }),
    ]);

    if (decision.action === "picker") {
      const picker = buildTikTokImportPicker(bundle);
      const rows = await hydratePickerThumbnails({
        rows: picker.rows,
        advertiserId,
        token: credentials.token,
      });
      return NextResponse.json(
        { ok: true, saved: false, picker: { ...picker, rows } },
        { status: 200 },
      );
    }

    const mappedId = crypto.randomUUID();
    const mapped = mapTikTokLiveCampaignToDraft(bundle, mappedId, {
      tiktokAccountId: credentials.accountId,
      advertiserId,
      currency: advertiser.currency,
      timezone: advertiser.timezone,
    }, { carry: decision.carry });
    if (mapped.creatives.items.length === 0) {
      return NextResponse.json(
        { ok: true, saved: false, draft: null },
        { status: 200 },
      );
    }
    mapped.clientId = await clientIdForTikTokAccount(supabase, {
      userId: user.id,
      tiktokAccountId: credentials.accountId,
    });
    const visible = await listTikTokDrafts(supabase, { userId: user.id });
    const draftId = crypto.randomUUID();
    const draft = finalizeTikTokImportDraft(
      mapped,
      draftId,
      tikTokDuplicateExistingNames(mapped, visible),
    );
    const saved = await upsertTikTokDraft(supabase, draftId, {
      ...draft,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, saved: true, draft: saved }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/campaigns/import] failed:", message);
    return NextResponse.json(
      { ok: false, error: message || "TikTok import failed" },
      { status: 200 },
    );
  }
}
