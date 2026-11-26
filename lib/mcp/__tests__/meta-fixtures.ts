/**
 * Fixtures for the M3a meta tools: a launchable draft (D_DRAFT with two
 * stored 9:16 files), the send step's real MML path with the upload handler
 * spied, and the launch route as a spy. No Meta, no network.
 */
import { sendStoredDraftAssets } from "../../plan/stored-assets-meta.ts";
import type { CampaignDraft } from "../../types.ts";
import type { DriveApi, DriveFile, DriveMediaFile } from "../../drive/client.ts";
import type { McpMetaDeps, ToolContext } from "../tool-types.ts";
import { CLIENT_NX } from "./fixtures.ts";
import { OPERATOR } from "./helpers.ts";
import { D_DRAFT, EV_SRC, EV_TGT, TGT_SIGNUP, draftCtx, fakeDrive, fakeDraftDeps, newSpies, readRow } from "./draft-fixtures.ts";
import { liveDeps, liveSpy } from "./live-fixtures.ts";

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
  // PR D: `ceiling` is the show's own total (EV_TGT, NX27-GLITTERBOX); with none, the NX default (£3,000) applies.
  if (opts.ceiling != null) await db.from("show_spend_ceilings").insert({ id: "5e000000-0000-4000-8000-0000000000f1", event_id: EV_TGT, group_name: null, total_gbp: opts.ceiling, set_by: OPERATOR, set_at: "2026-11-25T10:00:00Z" });
  db.writes.length = 0;
  const spy: MetaSpy = { uploads: [], launches: [], waited: [], failUpload: false, erroredVideos: [] };
  (ctx as ToolContext).meta = metaDeps(db, spy);
  // The show's existing campaigns are read through the live reads (none on EV_TGT); never a write.
  const live = liveSpy();
  live.objects = new Map();
  (ctx as ToolContext).live = liveDeps(live);
  (ctx as ToolContext).isMatas = opts.isMatas ?? true;
  return { ...made, spy };
}

// ── attach_drive_creatives: folders anywhere in the shared drive ──

const FOLDER = "application/vnd.google-apps.folder";
const m = (over: Partial<DriveMediaFile> & { id: string; name: string; mimeType: string }): DriveMediaFile =>
  ({ trashed: false, size: 2_000_000, width: 1080, height: 1920, rotation: 0, durationMs: 15_000, thumbnailLink: null, ...over }) as DriveMediaFile;

/** The fixture drive plus a client folder inside the shared drive and a folder in another drive. */
export function widerDrive(spies: ReturnType<typeof newSpies>): DriveApi {
  const base = fakeDrive(spies);
  const folders: Record<string, DriveFile> = {
    "drv-client": { id: "drv-client", name: "NX Live (promoter)", mimeType: FOLDER, parents: ["drive-test"], trashed: false },
    "drv-foreign": { id: "drv-foreign", name: "Someone else's", mimeType: FOLDER, parents: ["other-drive"], trashed: false },
    "other-drive": { id: "other-drive", name: "Other", mimeType: FOLDER, parents: [], trashed: false },
    // Another NX Live show's tree (mapped), inside NX Live's client folder.
    "drv-src-event": { id: "drv-src-event", name: "2026-12-20 Source show [NX26-SRC]", mimeType: FOLDER, parents: ["drv-client"], trashed: false },
    // Electric's folders, unmapped: the "[CODE]" in a folder's name gives the event and its client.
    "drv-el": { id: "drv-el", name: "Electric", mimeType: FOLDER, parents: ["drive-test"], trashed: false },
    "drv-el-event": { id: "drv-el-event", name: "2027-02-26 Lock Lead [EBR27-LOCKLEAD]", mimeType: FOLDER, parents: ["drv-el"], trashed: false },
    // The artist library, under the drive's root.
    "drv-lib": { id: "drv-lib", name: "00 Artist Library", mimeType: FOLDER, parents: ["drive-test"], trashed: false },
    "drv-lib-artist": { id: "drv-lib-artist", name: "Ada North", mimeType: FOLDER, parents: ["drv-lib"], trashed: false },
    // A folder nobody's: no mapping, no code, not the library.
    "drv-loose": { id: "drv-loose", name: "Shared bits", mimeType: FOLDER, parents: ["drive-test"], trashed: false },
  };
  const extra = [
    m({ id: "file-client-916", name: "meta-date_9x16.mp4", mimeType: "video/mp4", parents: ["drv-client"] }),
    m({ id: "file-client-45", name: "meta-date_4x5.mp4", mimeType: "video/mp4", parents: ["drv-client"], width: 1080, height: 1350 }),
    m({ id: "file-foreign", name: "x.mp4", mimeType: "video/mp4", parents: ["drv-foreign"] }),
    m({ id: "file-src-916", name: "source-show_9x16.mp4", mimeType: "video/mp4", parents: ["drv-src-event"] }),
    m({ id: "file-el-916", name: "lock-lead_9x16.mp4", mimeType: "video/mp4", parents: ["drv-el-event"] }),
    m({ id: "file-lib-916", name: "ada-north-live_9x16.mp4", mimeType: "video/mp4", parents: ["drv-lib-artist"] }),
    m({ id: "file-loose-916", name: "loose_9x16.mp4", mimeType: "video/mp4", parents: ["drv-loose"] }),
  ];
  return {
    ...base,
    async getFile(id) {
      return folders[id] ?? (await base.getFile(id));
    },
    async listChildren(parent, opts) {
      if (parent === "drive-test") return [folders["drv-client"]!];
      return base.listChildren(parent, opts);
    },
    async listMedia(parent) {
      const own = extra.filter((f) => f.parents?.[0] === parent);
      return own.length ? own : base.listMedia!(parent);
    },
    async getMediaFile(id) {
      return extra.find((f) => f.id === id) ?? (await base.getMediaFile!(id));
    },
  };
}

/** A draft context whose Drive has folders across the shared drive (attach_drive_creatives' owner checks). */
export async function driveCtx() {
  const spies = newSpies();
  const made = draftCtx({}, spies);
  made.ctx.draft = fakeDraftDeps(spies, { drive: () => widerDrive(spies) });
  // NX Live's client folder (no event) and another NX Live show's event folder, as the Drive tick maps them.
  await made.db.from("drive_folders").insert([
    { event_id: null, client_id: CLIENT_NX, key: "client", name: "NX Live (promoter)", drive_folder_id: "drv-client" },
    { event_id: EV_SRC, client_id: CLIENT_NX, key: "event", name: "2026-12-20 Source show [NX26-SRC]", drive_folder_id: "drv-src-event" },
  ]);
  made.db.writes.length = 0;
  // The event tree's only folder sits in the shared drive too.
  return { ...made, spies };
}
