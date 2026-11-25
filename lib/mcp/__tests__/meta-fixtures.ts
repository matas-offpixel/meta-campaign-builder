/**
 * Fixtures for the M3a meta tools: a launchable draft (D_DRAFT with two
 * stored 9:16 files), the send step's real MML path with the upload handler
 * spied, and the launch route as a spy. No Meta, no network.
 */
import { sendStoredDraftAssets } from "../../plan/stored-assets-meta.ts";
import type { CampaignDraft } from "../../types.ts";
import type { McpMetaDeps, ToolContext } from "../tool-types.ts";
import { CLIENT_NX } from "./fixtures.ts";
import { OPERATOR } from "./helpers.ts";
import { D_DRAFT, TGT_SIGNUP, draftCtx, readRow } from "./draft-fixtures.ts";

export const SCOPE_ALL = "mcp:read mcp:draft mcp:meta";
export const YES = { asked: "Launch [NX27-GLITTERBOX] SIGNUP to Meta paused? 2 ad sets, £50 a day once switched on.", answer: "yes, paused" };
export const REG_A = "a0000000-0000-4000-8000-0000000000a1";
export const REG_B = "a0000000-0000-4000-8000-0000000000a2";
export const ACCOUNT = "act_606252931141334";

export const LAUNCHED = {
  launchRunId: "run-1",
  metaCampaignId: "120200000000000001",
  adSetsCreated: [
    { name: "Broad", metaAdSetId: "120200000000000011", ageMode: "strict" },
    { name: "Fans", metaAdSetId: "120200000000000012", ageMode: "strict" },
  ],
  adSetsFailed: [],
  creativesCreated: [
    { name: "Teaser 1", metaCreativeId: "120200000000000021", ads: [{ adSetName: "Broad", metaAdId: "120200000000000031" }, { adSetName: "Fans", metaAdId: "120200000000000032" }], adsFailed: [] },
    { name: "Teaser 2", metaCreativeId: "120200000000000022", ads: [{ adSetName: "Broad", metaAdId: "120200000000000033" }, { adSetName: "Fans", metaAdId: "120200000000000034" }], adsFailed: [] },
  ],
  creativesFailed: [],
  adsCreated: 4,
  adsFailed: 0,
};

/** D_DRAFT made launchable: copy, link, one interest group, assignments, and each ad's 9:16 file in Storage (pending). */
export async function makeLaunchable(db: ReturnType<typeof draftCtx>["db"], opts: { storage?: boolean } = {}) {
  const row = (await readRow(db, D_DRAFT))!;
  const d = structuredClone(row.draft_json) as CampaignDraft;
  d.audiences.interestGroups = [{ id: "ig-1", name: "Disco", interests: [{ id: "6003000000002", name: "Disco" }] } as never];
  d.adSetSuggestions = d.adSetSuggestions.map((s) => ({ ...s, sourceType: "interest_group", sourceId: "ig-1", sourceName: "Disco" })) as never;
  d.creativeAssignments = { "as-1": ["cr-1", "cr-2"], "as-2": ["cr-1", "cr-2"] };
  d.creatives = d.creatives.map((c, i) => {
    const slot = c.assetVariations[0]!.assets[0]!;
    return {
      ...c,
      captions: [{ id: `cap-${i}`, text: "Glitterbox returns to Newcastle" }],
      destinationUrl: TGT_SIGNUP,
      cta: "sign_up",
      mediaType: "video",
      assetVariations: [
        {
          ...c.assetVariations[0]!,
          name: "Variation 1",
          assets: [
            {
              ...slot,
              id: `slot-${i + 1}`,
              uploadStatus: "pending",
              fileName: `teaser-${i + 1}_9x16.mp4`,
              ...(opts.storage === false ? {} : { storagePath: `videos/drive-send/${i + 1}.mp4`, storageBucket: "campaign-assets", registryAssetId: i === 0 ? REG_A : REG_B }),
            },
          ],
        },
      ],
    };
  });
  await db.from("campaign_drafts").update({ draft_json: d }).eq("id", D_DRAFT);
  await db.from("creative_assets").insert([
    { id: REG_A, user_id: OPERATOR, content_hash: "h-a", byte_size: 8_000_000, filename: "teaser-1_9x16.mp4", media_kind: "video", aspect_ratio: "9:16", storage_bucket: "campaign-assets", storage_path: "videos/drive/h-a.mp4" },
    { id: REG_B, user_id: OPERATOR, content_hash: "h-b", byte_size: 8_000_000, filename: "teaser-2_9x16.mp4", media_kind: "video", aspect_ratio: "9:16", storage_bucket: "campaign-assets", storage_path: "videos/drive/h-b.mp4" },
  ]);
  // The fixture's updated_at is unchanged by the fake's update: UPDATED still reads it.
  db.writes.length = 0;
}

export interface MetaSpy {
  uploads: Array<Record<string, unknown>>;
  launches: Array<{ draft: CampaignDraft; createPaused: boolean }>;
  waited: string[][];
  failUpload: boolean;
  /** Videos Meta reports as video_status error. */
  erroredVideos: string[];
}

export function metaDeps(db: ReturnType<typeof draftCtx>["db"], spy: MetaSpy): McpMetaDeps {
  return {
    sendAssets: ({ userId, draft }) =>
      sendStoredDraftAssets({
        supabase: db,
        draft,
        userId,
        storage: { copy: async () => ({ error: null }), remove: async () => undefined },
        upload: async (req) => {
          const body = (await req.json()) as Record<string, unknown>;
          spy.uploads.push(body);
          if (spy.failUpload) return Response.json({ error: "Meta didn't take this file" }, { status: 500 });
          const rows = (await db.from("creative_assets").select("*")).data as Array<Record<string, unknown>>;
          const reg = rows.find((r) => r.content_hash === body.contentHash)!;
          await db.from("creative_asset_channel_ids").insert({ asset_id: reg.id, channel: "meta", scope: body.adAccountId, platform_id: `vid-${String(body.contentHash)}`, user_id: OPERATOR });
          return Response.json({ videoId: `vid-${String(body.contentHash)}` });
        },
      }),
    async waitVideos({ videoIds }) {
      spy.waited.push([...videoIds]);
      const errored = videoIds.filter((id) => spy.erroredVideos.includes(id));
      return { ready: videoIds.filter((id) => !errored.includes(id)), errored, timedOut: [] };
    },
    async launch({ draft, createPaused }) {
      spy.launches.push({ draft, createPaused });
      return { status: 200, body: LAUNCHED };
    },
  };
}

export async function metaCtx(opts: { storage?: boolean; ceiling?: number | null; scope?: string; isMatas?: boolean } = {}) {
  const made = draftCtx({ scope: opts.scope ?? SCOPE_ALL });
  const { ctx, db } = made;
  await makeLaunchable(db, { storage: opts.storage });
  if (opts.ceiling != null) await db.from("client_spend_ceilings").insert({ client_id: CLIENT_NX, daily_gbp: opts.ceiling, set_by: OPERATOR, set_at: "2026-11-25T10:00:00Z" });
  db.writes.length = 0;
  const spy: MetaSpy = { uploads: [], launches: [], waited: [], failUpload: false, erroredVideos: [] };
  (ctx as ToolContext).meta = metaDeps(db, spy);
  (ctx as ToolContext).isMatas = opts.isMatas ?? true;
  return { ...made, spy };
}

