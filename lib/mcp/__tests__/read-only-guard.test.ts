/**
 * What the MCP may write. M1 (the read tools) writes nothing outside the
 * action log (mcp_actions) and the OAuth store (mcp_oauth_*). M2 and M2b
 * (the draft tools) add campaign_drafts, from lib/mcp/drafts/write.ts only,
 * and the Drive picker's own copy (copyPickedFile: creative_assets and
 * Storage). Nothing writes Meta, TikTok, Google, Slack or D2C; the only
 * network calls are three Graph GETs in lib/mcp/graph-reads.ts (location
 * search, interest search, the account's page list), sent by
 * lib/mcp/draft-deps.ts. A grep over every file the MCP server and its
 * tools import (relative and `@/`, walked transitively), plus the routes,
 * and a check of migration 268.
 *
 * M3a adds two write paths and pins both:
 *   - Meta, through one seam only, lib/mcp/meta-deps.ts: standalone
 *     Launch's send step (sendStoredDraftAssetsToMeta, handleUploadAsset for
 *     the operator) and the launch route's own handler (launchCampaignAs).
 *     The walk stops at the seam; a test pins exactly what it imports, and
 *     that no other MCP file reaches it but the route wiring.
 *   - events, from lib/mcp/meta/event-write.ts only (update_event: three
 *     dates and two links).
 *
 * M3d-b adds the Lab seam, lib/mcp/lab-deps.ts (scope mcp:draft): the
 * Snippet tab's scan of the act's Audio folder (scanArtistAudio with the
 * route's intakeDeps: creative_lab_audio_files rows, the Storage copy, the
 * folder made on first need), its drop edit (saveAudioEdit,
 * creative_lab_audio_files) and the Clips card's owner (saveClipOwner,
 * creative_lab_clips). Like the Meta seam it isn't walked; a test pins
 * exactly what it imports, what each of those writes, and that only the
 * route wiring imports it. It sends nothing to Meta.
 * M3b adds the live changes, all through the same seam: the status writes,
 * the budget write, the refresh's move, the name write and the ad study
 * (each handed its Graph POST as a callback), and the campaign tree's two
 * route handlers (bulkAttachAs, adsetAudienceAs). Its one table is
 * scheduled_meta_changes, from lib/mcp/live/scheduled.ts only, applied by
 * the cron route it pins too.
 * M3d-c adds one Drive seam, lib/mcp/folder-in-deps.ts
 * (upload_to_event_folder): the export Drive and a Storage read, its writes
 * folderDepsFor's files.copy and upload only. The walk stops at it; a test
 * pins what it imports, that only the route wiring imports it, and that it
 * never reaches a permission, share, move or delete.
 *
 * M3d-a adds the shows seam, lib/mcp/shows-deps.ts (scope mcp:draft): the
 * event form's create (insertEventRow: events, and its key-moments seed),
 * the clients form's create (insertClientRow: clients), the Lab's lineup
 * save and add-from-Spotify (saveLabLineup, addSpotifyToLineup: artists,
 * event_artists, creative_lab_event_facts) and the Releases card's reads and
 * save (postReleaseAs: event_releases, the derived sale dates on events, a
 * manual tier_channel_sales count, a held ticket_warnings proposal). Like
 * the Meta seam it isn't walked; a test pins exactly what it imports, what
 * each of those writes, and that only the route wiring imports it. It sends
 * nothing to Meta or Drive.
 *
 * M3c adds the audience seam, lib/mcp/audience-deps.ts (scope mcp:meta):
 * Meta reads (GETs, and the purchase read's batch of GETs) with the
 * operator's token; the Audience Builder's own create (createAudienceDraft,
 * createMetaCustomAudience: meta_custom_audiences, its own
 * meta_audience_write_idempotency ledger, behind
 * OFFPIXEL_META_AUDIENCE_WRITES_ENABLED) with seed grants off; and one POST,
 * /{business}/client_pages, handed to lib/meta/page-access-request.ts
 * (ledger page_access_request, Off/Pixel's business refused). Like the Meta
 * seam it isn't walked; a test pins exactly what it imports, its one POST,
 * that seed grants are off, and that only the route wiring imports it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const WRITE = /\.(insert|update|upsert|delete|rpc)\s*\(/g;
const NETWORK = /\b(fetch|graphPost|graphPostWithToken|graphDelete)\s*\(/;

/** The only files allowed a write, and the only tables each may write. */
const ALLOWED_WRITERS: Record<string, RegExp> = {
  "lib/mcp/action-log.ts": /^mcp_actions$/,
  "lib/mcp/oauth/store.ts": /^mcp_oauth_(clients|grants|codes|tokens)$/,
  // M2: the one campaign_drafts writer (status draft only, guarded on updated_at).
  "lib/mcp/drafts/write.ts": /^campaign_drafts$/,
  // M3a: update_event, the event form's save for five fields.
  "lib/mcp/meta/event-write.ts": /^events$/,
  // M3b: budget changes for later, and the cron that applies them.
  "lib/mcp/live/scheduled.ts": /^scheduled_meta_changes$/,
};

/**
 * M3a's Meta seam: the only MCP file allowed a Meta write path, and exactly
 * these imports. The walk doesn't follow it (the launch route is the app's,
 * not the MCP's); every name it imports is pinned here.
 */
const META_SEAM = "lib/mcp/meta-deps.ts";
const META_SEAM_IMPORTS: Record<string, readonly string[]> = {
  "app/api/meta/launch-campaign/route.ts": ["launchCampaignAs"],
  "lib/meta/upload-asset-handler.ts": ["handleUploadAsset", "uploadAssetHooksForUser"],
  "lib/plan/creative-intake-server.ts": ["sendStoredDraftAssetsToMeta", "waitForStoredVideosAs"],
  // M3b: the campaign tree's two route handlers, for the operator.
  "app/api/meta/bulk-attach-ads/route.ts": ["bulkAttachAs"],
  "app/api/meta/adset-audience/route.ts": ["adsetAudienceAs"],
  // M3b: the reads and the POSTs handed to the ledgered writers below.
  "lib/meta/client.ts": ["graphGetWithToken", "graphPostWithToken"],
  "lib/meta/server-token.ts": ["resolveServerMetaToken"],
  "lib/meta/ad-status-write.ts": ["adStatusWritesEnabled", "writeAdStatus"],
  "lib/meta/adset-status-write.ts": ["adsetStatusWritesEnabled", "writeAdSetStatus"],
  "lib/meta/campaign-status-write.ts": ["writeCampaignStatus"],
  "lib/meta/budget-write.ts": ["budgetWritesEnabled", "writeBudget"],
  "lib/meta/object-name-write.ts": ["writeObjectName"],
  "lib/meta/ad-study.ts": ["campaignsInRunningStudies", "studyPayload", "writeAdStudy"],
  "lib/meta/adset-targeting-write.ts": ["adsetTargetingWritesEnabled"],
  "lib/campaign-tree/switch.ts": ["treeAddWritesEnabled"],
  "lib/onsale-refresh/apply.ts": ["moveAdSetDailyBudget"],
};

/** Every Graph POST in the seam is the callback one ledgered writer is handed. */
const SEAM_POSTS = [
  /const post = \(objectId: string, s: string\) => graphPostWithToken\(`\/\$\{objectId\}`, \{ status: s \}, token\)/,
  /postBudget: \(objectId, f, m\) => graphPostWithToken\(`\/\$\{objectId\}`, \{ \[f\]: m \}, token\)/,
  /await graphPostWithToken\(`\/\$\{adsetId\}`, \{ daily_budget: minor \}, token\);/,
  /postName: \(objectId, n\) => graphPostWithToken\(`\/\$\{objectId\}`, \{ name: n \}, token\)/,
  /createAdStudy: \(b, p\) => graphPostWithToken<\{ id: string \}>\(`\/\$\{b\}\/ad_studies`, p, token\)/,
];
/** M3d-c's Drive seam: the export Drive, a Storage read, and folderDepsFor's two writes. */
const FOLDER_SEAM = "lib/mcp/folder-in-deps.ts";
const FOLDER_SEAM_IMPORTS: Record<string, readonly string[]> = {
  "lib/drive/client.ts": ["driveFromEnv"],
  "lib/mcp/folder-in/place.ts": ["folderDepsFor"],
};

/**
 * M3d-b's Lab seam: the Lab's own write paths, pinned like the Meta seam
 * (the Snippet route's scan and edit, the Clips card's owner write), and
 * the tables each one's body may write.
 */
/** M3c's audience seam: what it imports, by file, and its one POST. */
const AUDIENCE_SEAM = "lib/mcp/audience-deps.ts";
const AUDIENCE_SEAM_IMPORTS: Record<string, readonly string[]> = {
  "lib/db/meta-custom-audiences.ts": ["createAudienceDraft"],
  "lib/meta/audience-write.ts": ["createMetaCustomAudience", "metaAudienceWritesEnabled"],
  "lib/meta/client.ts": ["graphGetWithToken", "graphPostWithToken"],
  "lib/meta/graph-multi-get.ts": ["graphMultiGetByIds"],
  "lib/meta/server-token.ts": ["resolveServerMetaToken"],
  "lib/meta/page-access.ts": ["businessSharedPages", "resolvePageAccess"],
  "lib/meta/business-manager.ts": ["paginateAll"],
  "lib/meta/page-access-request.ts": ["writePageAccessRequest"],
  "lib/bm/user-token.ts": ["resolveUserFacebookToken"],
  "lib/audiences/sources.ts": ["fetchAudienceMultiCampaignVideos"],
  "lib/onsale-refresh/purchase-read.ts": ["fetchAdSetPixels", "fetchEventHosts"],
  "lib/cirqlin/page-links.ts": ["fetchCirqlinPageLinks"],
  "lib/retargeting/audiences.ts": ["groupVideosByPage"],
  "lib/retargeting/links.ts": ["linksFromPages"],
};

const LAB_SEAM = "lib/mcp/lab-deps.ts";
const LAB_SEAM_IMPORTS: Record<string, readonly string[]> = {
  "lib/creative-tests/audio-edits.ts": ["saveAudioEdit"],
  "lib/creative-tests/audio-intake.ts": ["scanArtistAudio"],
  "lib/creative-tests/snippet-server.ts": ["intakeDeps"],
  "lib/creative-lab/card-write.ts": ["saveClipOwner"],
  "lib/drive/client.ts": ["driveFromEnv"],
  "lib/onsale-refresh/line-states.ts": ["displayName"],
};
const LAB_SEAM_WRITES: Record<string, Record<string, RegExp>> = {
  "lib/creative-tests/audio-edits.ts": { saveAudioEdit: /^creative_lab_audio_files$/ },
  "lib/creative-tests/audio-intake.ts": { scanArtistAudio: /^creative_lab_audio_files$/ },
  "lib/creative-lab/card-write.ts": { saveClipOwner: /^creative_lab_clips$/ },
};

/**
 * M3d-a's shows seam: the app's own create and save paths, pinned like the
 * Meta seam, and the tables each one's body may write. regenerateAutoMoments
 * is insertEventRow's key-moments seed (not imported by the seam itself).
 */
const SHOWS_SEAM = "lib/mcp/shows-deps.ts";
const SHOWS_SEAM_IMPORTS: Record<string, readonly string[]> = {
  "lib/db/events.ts": ["insertEventRow"],
  "lib/db/clients.ts": ["insertClientRow"],
  "lib/creative-lab/lineup.ts": ["addSpotifyToLineup", "saveLabLineup"],
  "lib/db/releases.ts": ["loadClientLadder", "loadEventArtists", "loadEventReleases", "loadSalesHistory"],
  "app/api/events/[id]/releases/route.ts": ["postReleaseAs"],
};
const SHOWS_SEAM_WRITES: Record<string, Record<string, RegExp>> = {
  "lib/db/events.ts": { insertEventRow: /^events$/ },
  "lib/db/event-key-moments.ts": { regenerateAutoMoments: /^event_key_moments$/ },
  "lib/db/clients.ts": { insertClientRow: /^clients$/ },
  // addSpotifyToLineup's own writes are artists (its reads go through rowsOf); its lineup step is saveLabLineup.
  "lib/creative-lab/lineup.ts": { addSpotifyToLineup: /^artists$/, saveLabLineup: /^(event_artists|creative_lab_event_facts)$/ },
  // The Releases card's save: the release, the derived dates, a manual count (read the channel, write the count), a held proposal.
  "app/api/events/[id]/releases/route.ts": { postRelease: /^(events|tier_channels|tier_channel_sales)$/ },
  "lib/db/releases.ts": { saveReleaseRow: /^event_releases$/, insertWarning: /^ticket_warnings$/ },
};

const ENTRIES = [
  // M3b on Today (MB1, MB2): Undo and Cancel, and the log they draw from.
  "app/(dashboard)/today/claude-actions.ts",
  "lib/mcp/today/load.ts",
  "lib/mcp/server.ts",
  "lib/mcp/tools/index.ts",
  "lib/mcp/draft-deps.ts",
  "lib/mcp/graph-reads.ts",
  "lib/mcp/readers.ts",
  "lib/mcp/route-deps.ts",
  "lib/mcp/oauth/http.ts",
  "app/api/mcp/route.ts",
  "app/api/oauth/register/route.ts",
  "app/api/oauth/token/route.ts",
  "app/api/oauth/revoke/route.ts",
  "app/oauth/authorize/page.tsx",
  "app/oauth/authorize/actions.ts",
  "app/.well-known/oauth-protected-resource/route.ts",
  "app/.well-known/oauth-protected-resource/api/mcp/route.ts",
  "app/.well-known/oauth-authorization-server/route.ts",
  // M3b: the cron that applies scheduled budget changes.
  "app/api/cron/mcp-scheduled-changes/route.ts",
];

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = join(ROOT, dirname(from), spec);
  else return null;
  const rel = (p: string) => p.slice(ROOT.length + 1);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (/\.(ts|tsx)$/.test(cand) && existsSync(cand)) return rel(cand);
  }
  return null;
}

function walk(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [...ENTRIES];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const src = readFileSync(join(ROOT, file), "utf8");
    seen.set(file, src);
    // The Meta, Lab, Drive and shows seams are pinned by their own tests, not walked.
    if (file === META_SEAM || file === LAB_SEAM || file === FOLDER_SEAM || file === SHOWS_SEAM || file === AUDIENCE_SEAM) continue;
    // Value imports only: `import type` brings no code.
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+["']([^"']+)["']/gm)) {
      const next = resolve(file, m[1]!);
      if (next) queue.push(next);
    }
    for (const m of src.matchAll(/await import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolve(file, m[1]!);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/**
 * Every function the MCP imports from outside lib/mcp, by file. Each one is
 * a reader or a pure helper (no I/O): the body of none of them writes.
 */
const EXTERNAL_READERS: Record<string, readonly string[]> = {
  "lib/db/paged-read.ts": ["loadAllPaged"],
  "lib/db/client-status.ts": ["ARCHIVED", "dropArchivedClientRows", "loadArchivedClientIds"],
  "lib/db/event-daily-rollups.ts": ["listRollupsForEvent"],
  "lib/db/signup-source-snapshots.ts": ["loadCirqlinSnapshotsForEvent"],
  "lib/db/ticketing.ts": ["listAllSnapshotsForEvent"],
  "lib/cirqlin/page-audience/read.ts": ["pageAudienceForShow"],
  "lib/learning/findings/phase.ts": ["phaseOf"],
  "lib/learning/findings/observed-tests.ts": ["addDays"],
  "lib/learning/findings/read-all.ts": ["all", "chunks"],
  "lib/learning/findings/digest.ts": ["learningLine", "showLine", "testLine"],
  "lib/onsale-refresh/on-sale.ts": ["isShowWeek"],
  "lib/autosave.ts": ["migrateDraft"],
  "lib/auth/operator-allowlist.ts": ["isOperator", "MATAS_USER_IDS"],
  "lib/supabase/server.ts": ["createServiceRoleClient", "createClient"],
  "components/ui/button.tsx": ["Button"],
  // M2: the replicate (pure) and its reads.
  "lib/replicate/replicate.ts": ["draftAudienceIds", "replicateDraft", "displayUrl"],
  "lib/replicate/load.ts": ["loadAudienceRows", "loadReplicateEvent", "loadReplicateNames", "loadReplicateVenue"],
  "lib/meta/ad-account.ts": ["normalizeAdAccountId"],
  // M2: Step 5's location picker helpers (pure).
  "lib/meta/location-pins.ts": ["PIN_PRESETS", "isPresetPinGroup", "manualPinGroup", "pinSelection", "presetPinGroup", "regionMismatchForCityKey", "validatePinForm"],
  "lib/meta/location-search.ts": ["selectionFromGeoResult", "locationSearchQuery", "parseLocationSearchHits"],
  "lib/meta/location-radius.ts": ["clampCityRadius"],
  "lib/meta/location-targeting.ts": ["groupTier", "withGroupTier"],
  // strict_audit's location expansion read and line (pure; cc/meta-geo-expansion-off).
  "lib/meta/geo-expansion.ts": ["geoExpansionOf", "GEO_WORDS"],
  "lib/wizard/adset-suggestions.ts": [
    "addLocationToEveryAdSet",
    "adSetsTargetingLocation",
    "convertAdSetBudgetsOnTypeChange",
    "followLocationTiers",
    "MAX_ADSET_NAME_LENGTH",
    "UK_NATIONWIDE_FALLBACK",
    "appendBlankAdSet",
    "clearUnsupportedAdvantagePlus",
  ],
  "lib/wizard/budget-schedule-update.ts": ["mapExcludedLocations", "mapLocationGroups", "patchBudgetSchedule"],
  "lib/time.ts": ["zonedLocalToUtc"],
  // M2: the Drive picker's model and view (reads), and the creative defaults (pure).
  "lib/drive/picker.ts": ["loadPickerView", "PICKER_BUCKET", "fileInSharedDrive", "fileInTree", "loadDriveFolderView"],
  // M3a: which slots go to Meta at launch (pure).
  "lib/creatives/stored-at-launch.ts": ["storedSlotsToSend"],
  // M3a: whose footage a Drive file is (drive_folders, events, artist_library_folders reads; Drive metadata).
  "lib/drive/file-owner.ts": ["mayUseFor", "resolveDriveOwner"],
  // M3a: the video step's slot helpers (pure); the send step itself is behind the Meta seam.
  "lib/plan/stored-assets-meta.ts": ["failVideos", "sentVideoIds"],
  "lib/drive/picker-model.ts": ["PICKER_WORDS", "defaultBatchFields", "folderTiles", "formatBytes", "PICKER_MAX_IMAGE_BYTES", "PICKER_MAX_VIDEO_BYTES"],
  "lib/drive/picker-batch.ts": ["planPrepare"],
  "lib/drive/client.ts": ["driveFromEnv", "APP_ID_KEY", "APP_TAG_KEY", "FOLDER_MIME", "SHORTCUT_MIME"],
  // M3d-c: the show's Lab lineup (event_artists, artists reads) and the tree's cycle names (pure).
  "lib/drive/lineup.ts": ["loadLineupArtists"],
  "lib/drive/tree.ts": ["cycleFolderName"],
  "lib/campaign-defaults.ts": ["createDefaultAssetVariation", "createDefaultCreative", "defaultCtaForObjective"],
  "lib/clients/channel-defaults.ts": ["loadClientChannelDefaults"],
  "lib/meta/server-token.ts": ["resolveServerMetaToken"],
  // The launch checks (#1361): runLaunchGuard's database reads, and takeIdentity (pure).
  "lib/launch-guard/load.ts": ["runLaunchGuard"],
  "lib/launch-guard/check.ts": ["takeIdentity"],
  // The wizard's own step checks (Review's validateStep(7)): pure.
  "lib/validation.ts": ["validateStep"],
  // M2b: the wizard's own helpers (pure).
  "lib/wizard/objective-change.ts": ["OBJECTIVE_LABELS", "objectiveChangePatch", "stampRulesObjective"],
  "lib/wizard/assignments.ts": ["assignAllCreatives", "assignmentCounts", "forAdSets", "withoutCreatives"],
  "lib/wizard/generate-adset-suggestions.ts": ["generateSuggestions"],
  "lib/wizard/follow-audience-groups.ts": ["followAudienceGroups", "groupKey"],
  // M3a ceiling: the launch route's own "launchable" filter (a pure read of the draft).
  "lib/wizard/import-edits.ts": ["adSetAudienceRemoved"],
  "lib/meta/advantage-plus-compat.ts": ["isAdvantageAudienceSupportedForObjective"],
  "lib/meta/adset.ts": ["buildPromotedObject"],
  "lib/mock-data.ts": ["CTA_OPTIONS"],
  "lib/campaign-event.ts": ["buildDuplicatedCampaign"],
  "lib/interest-targetability.ts": ["enrichWithTargetability"],
  // Audience templates (#1363): the resolver and the row mapping (pure).
  "lib/audience-templates/resolve.ts": ["dedupeKnown", "knownFromDraftAudiences", "knownFromRows", "normalizeAccount", "resolveTemplate"],
  "lib/audience-templates/store.ts": ["templateFromRows"],
  // AL5: get_artist's reads (artists, artist_assets, event_artists, events, clients, ad_daily_insights) and its pure view and words.
  "lib/artist-library/load.ts": ["findArtist", "loadArtistData"],
  "lib/artist-library/view.ts": ["buildArtistView"],
  "lib/artist-library/answer.ts": ["artistAnswer", "unknownArtistAnswer"],
  // M4a: render_package's words, cap and finished lines (pure), the upload guard's read, and the real start deps (Storage and ffmpeg reads).
  "lib/render-templates/package-view.ts": ["MAX_PACKAGE_FILES", "RECIPE_FILES", "refusalRowLine"],
  "lib/render-templates/report.ts": ["doneLines"],
  "lib/render-templates/words.ts": ["RECIPES", "candidate", "m4"],
  "lib/render-templates/upload-guard.ts": ["refusedUploads"],
  "lib/render-templates/server-deps.ts": ["startDeps"],
  // M3d-b: the Lab tools' reads (render_package's lineup, clips and track order) and the Snippet tab's words (pure).
  "lib/render-templates/load.ts": ["compareTracks", "loadClips", "loadLineup"],
  "lib/creative-tests/snippet.ts": ["DROP_FOUND", "NO_CLEAR_DROP", "cantUseText", "dropSetBy", "mmss"],
  // M3b: the event's campaign tree (database reads, and Meta through the reader the live seam passes) and its pure helpers.
  "lib/campaign-tree/load.ts": ["loadCampaignTree", "loadEventAdSets", "loadEventDrafts", "splitCampaignIds"],
  "lib/campaign-tree/tree.ts": ["canWrite", "defaultSelection", "stageAccount", "stageLabel", "stageSheetCampaigns"],
  // M3d-a: the Releases card's ladder reckoning and its words (pure), as the card runs it.
  "lib/releases/types.ts": ["RELEASE_STATES", "stateIndex"],
  // set_release's check before the save (Matas, 26 Nov): the route's own pure steps.
  "lib/releases/entry.ts": ["applyCount", "applyState"],
  "lib/releases/dates.ts": ["deriveSaleDates"],
  "lib/releases/ladder.ts": ["completeLadder"],
  "lib/releases/derived.ts": ["nextReleaseListAt"],
  "lib/releases/visibility.ts": ["isBackfilled"],
  "lib/releases/london.ts": ["londonDayMonth"],
  "lib/ticket-warnings/next-rung.ts": ["derivedProposals", "nextRung", "sellingFastDays"],
  // M3c: the Audience Builder's payload (pure: create_audiences compares rules before anything is made), the
  // retargeting builder's URL rule and links fallback, the purchase read's pixel choice (pure), and the
  // client_pages helper's fixed values (Off/Pixel's business, the tasks, the daily cap).
  "lib/meta/audience-payload.ts": ["buildMetaCustomAudiencePayload"],
  // M3c: the builder's own rule match, run against the account's full list (pure).
  "lib/meta/reuse-existing-audience.ts": ["matchExistingCustomAudience"],
  // 276: which clients a Business Manager serves (client_business_managers and client_business_manager_links reads).
  "lib/bm/client-links.ts": ["businessClientLinks"],
  "lib/retargeting/links.ts": ["linksFallback", "urlRule"],
  "lib/onsale-refresh/purchases.ts": ["resolvePixel"],
  "lib/meta/page-access-request.ts": ["DEFAULT_PAGE_REQUEST_TASKS", "OFF_PIXEL_BUSINESS_IDS", "PAGE_REQUESTS_PER_DAY", "PAGE_REQUEST_TASKS"],
};

/**
 * The outside functions M2 may call that write, and what each writes. Both
 * are the Drive picker's own copy path (POST /api/events/[id]/drive/picker/copy).
 */
const EXTERNAL_WRITERS: Record<string, Record<string, RegExp>> = {
  // Drive → Storage, registered in creative_assets (deduped on drive_file_id).
  "lib/drive/picker.ts": { copyPickedFile: /^creative_assets$/ },
  // The Storage upload the copy route passes it.
  "lib/clients/asset-queue/storage-upload.ts": { uploadFileToStorageBucket: /^$/ },
  // M4a (scope mcp:render, Matas only): a package row, its file rows and the track's beat-grid cache. Nothing renders here; the cron does.
  "lib/render-templates/start.ts": { requestPackage: /^(creative_lab_render_packages|creative_lab_renders|creative_lab_audio_files|artists|artist_assets)$/ },
  // M3b: the cron route's run log (recordCronRun writes cron_runs; the wrapper itself has no table).
  "lib/reporting/with-cron-run-log.ts": { withCronRunLog: /^cron_runs$/ },
};

/**
 * lib/meta modules the MCP may import: pure helpers and the token read. No
 * Meta write path (lib/meta/client.ts, the Graph client, is never imported).
 */
const META_IMPORTS_ALLOWED = /\/meta\/(ad-account|location-pins|location-search|location-radius|location-targeting|server-token|advantage-plus-compat|adset|geo-expansion|audience-payload|page-access-request|reuse-existing-audience)(\.ts)?["']/;

const isOwn = (f: string) => f.startsWith("lib/mcp/") || f.startsWith("app/") || f.startsWith("components/mcp/");

function importsOf(file: string, src: string): Array<{ target: string; names: string[] }> {
  const out: Array<{ target: string; names: string[] }> = [];
  for (const m of src.matchAll(/^\s*import\s+(?!type\b)\{([^}]*)\}\s*from\s+["']([^"']+)["']/gm)) {
    const target = resolve(file, m[2]!);
    if (!target) continue;
    const names = m[1]!
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) => n.split(/\s+as\s+/)[0]!.trim());
    out.push({ target, names });
  }
  return out;
}

/** The body of one exported function (to the next top-level export). */
function bodyOf(src: string, name: string): string | null {
  const m = new RegExp(`export (?:async )?function ${name}\\b|export const ${name}\\b`).exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const next = rest.slice(1).search(/\nexport /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The body of one module-private function (to the next top-level function or export). */
function bodyOfAsync(src: string, name: string): string | null {
  const m = new RegExp(`\\n(?:async )?function ${name}\\b`).exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + 1);
  const next = rest.slice(1).search(/\n(?:export |async function |function )/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the MCP's own code writes only mcp_actions and mcp_oauth_*", () => {
  const own = [...walk().entries()].filter(([f]) => isOwn(f));
  const hits: string[] = [];
  for (const [file, src] of own) {
    // Hash.update() in crypto.ts is not a write.
    const code = strip(src).replace(/createHash\([^)]*\)\s*\.update\(/g, "createHash().digestOf(");
    const writes = [...code.matchAll(WRITE)];
    if (writes.length === 0) continue;
    const allowed = ALLOWED_WRITERS[file];
    if (!allowed) {
      hits.push(`${file}: ${writes.map((w) => w[0]).join(", ")}`);
      continue;
    }
    for (const m of code.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!allowed.test(m[1]!)) hits.push(`${file}: from("${m[1]}")`);
    }
  }
  assert.deepEqual(hits, []);
});

test("from outside lib/mcp the MCP imports only reader functions, and none of them writes", () => {
  const own = [...walk().entries()].filter(([f]) => isOwn(f));
  const unexpected: string[] = [];
  const used = new Map<string, Set<string>>();
  for (const [file, src] of own) {
    if (file === META_SEAM || file === LAB_SEAM || file === FOLDER_SEAM || file === SHOWS_SEAM || file === AUDIENCE_SEAM) continue;
    for (const { target, names } of importsOf(file, src)) {
      if (isOwn(target)) continue;
      const allowed = EXTERNAL_READERS[target];
      for (const n of names) {
        if (EXTERNAL_WRITERS[target]?.[n]) continue;
        if (!allowed?.includes(n)) unexpected.push(`${file} imports ${n} from ${target}`);
        else (used.get(target) ?? used.set(target, new Set()).get(target)!).add(n);
      }
    }
  }
  assert.deepEqual(unexpected, []);
  const writers: string[] = [];
  for (const [target, names] of used) {
    const src = readFileSync(join(ROOT, target), "utf8");
    for (const n of names) {
      const body = bodyOf(src, n);
      assert.ok(body, `${n} in ${target}`);
      if (WRITE.test(strip(body!))) writers.push(`${target}#${n}`);
      WRITE.lastIndex = 0;
    }
  }
  assert.deepEqual(writers, []);
});

test("the outside writers M2 calls write only what the Drive picker's copy writes", () => {
  for (const [target, fns] of Object.entries(EXTERNAL_WRITERS)) {
    const src = readFileSync(join(ROOT, target), "utf8");
    for (const [n, tables] of Object.entries(fns)) {
      const body = bodyOf(src, n);
      assert.ok(body, `${n} in ${target}`);
      for (const m of strip(body!).matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) assert.match(m[1]!, tables, `${target}#${n} from("${m[1]}")`);
    }
  }
});

test("the tools and the server make no network calls and import no write paths; the only requests are graph-reads' four GETs", () => {
  const files = walk();
  const hits: string[] = [];
  const SENDERS = new Set(["lib/mcp/graph-reads.ts", "lib/mcp/draft-deps.ts"]);
  for (const [file, src] of files) {
    if (!isOwn(file) || file === META_SEAM || file === LAB_SEAM || file === FOLDER_SEAM || file === SHOWS_SEAM || file === AUDIENCE_SEAM) continue;
    const code = strip(src);
    if (!SENDERS.has(file) && (NETWORK.test(code) || /\bfetchImpl\s*\(/.test(code))) hits.push(`${file}: network`);
    for (const m of code.matchAll(/from\s+["']((?:@\/|\.\.?\/)[^"']*)["']/g)) {
      const spec = m[1]!;
      if (/\b(tiktok|google-ads|notify|d2c|actions)\//.test(spec)) hits.push(`${file}: write-path import ${spec}`);
      // lib/mcp/meta/ is the MCP's own (approval, ceilings, the events writer), not lib/meta.
      const target = resolve(file, spec) ?? "";
      if (/\/meta\//.test(spec) && !target.startsWith("lib/mcp/") && !META_IMPORTS_ALLOWED.test(`${spec}"`)) hits.push(`${file}: meta import ${spec}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(!files.has("lib/meta/client.ts"), "the Graph client is never imported");
  // graph-reads: one request site, GET only, to /search, /{act}/promote_pages and (M3d-d strict_audit) /?ids=….
  const reads = strip(readFileSync(join(ROOT, "lib/mcp/graph-reads.ts"), "utf8"));
  assert.equal([...reads.matchAll(/\bfetchImpl\s*\(/g)].length, 1, "one request site");
  assert.match(reads, /fetchImpl\(url\.toString\(\), \{ method: "GET", cache: "no-store" \}\)/);
  assert.doesNotMatch(reads, /\bfetch\s*\(|graphPost|method:\s*"(POST|DELETE|PUT|PATCH)"/);
  const paths = [...reads.matchAll(/graphGet\(fetchImpl, version, (["`])([^"`]+)\1/g)].map((m) => m[2]);
  assert.deepEqual(paths.sort(), ["/", "/act_${digits}/promote_pages", "/search", "/search"]);
  // draft-deps passes the global fetch through, and sends nothing itself.
  const deps = strip(readFileSync(join(ROOT, "lib/mcp/draft-deps.ts"), "utf8"));
  assert.equal([...deps.matchAll(/\bfetch\s*\(/g)].length, 1, "one fetch: the GET-only pass-through");
  assert.match(deps, /const getOnly: FetchLike = \(url, init\) => globalThis\.fetch\(url, init\);/);
  assert.doesNotMatch(deps, /graphPost|method:\s*"(POST|DELETE|PUT|PATCH)"/);
});

test("M3a: the Meta seam imports exactly the launch route's handler, the upload handler for the operator and the send step, and only the route wiring imports it", () => {
  const files = walk();
  assert.ok(files.has(META_SEAM), "the route wires the seam");
  const src = files.get(META_SEAM)!;
  const imports = importsOf(META_SEAM, src).filter(({ target }) => !isOwn(target) || target.startsWith("app/api/meta/"));
  const got: Record<string, string[]> = {};
  for (const { target, names } of imports) {
    if (target === "lib/supabase/server.ts") continue;
    got[target] = [...(got[target] ?? []), ...names].sort();
  }
  assert.deepEqual(got, Object.fromEntries(Object.entries(META_SEAM_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  // No network call of its own but the reads and the POSTs it hands to the ledgered writers (M3b).
  const code = strip(src);
  assert.doesNotMatch(code, /\b(fetch|graphDelete)\s*\(/);
  const posts = code.split("\n").filter((l) => /graphPostWithToken\s*[<(]/.test(l));
  assert.equal(posts.length, SEAM_POSTS.length, "one POST per ledgered writer");
  for (const p of SEAM_POSTS) assert.equal(posts.filter((l) => p.test(l)).length, 1, String(p));
  // Only route-deps and the scheduled-changes cron wire it; no tool imports it (tools reach Meta through ctx.meta / ctx.live).
  const importers = [...files.entries()].filter(([f, s2]) => f !== META_SEAM && /from\s+["'][^"']*meta-deps["']/.test(s2)).map(([f]) => f).sort();
  assert.deepEqual(importers, ["app/(dashboard)/today/claude-actions.ts", "app/api/cron/mcp-scheduled-changes/route.ts", "lib/mcp/route-deps.ts"]);
  // The tree's handlers are the routes' own, and bulk-attach keeps the tree switch and the paused flag.
  const attach = readFileSync(join(ROOT, "app/api/meta/bulk-attach-ads/route.ts"), "utf8");
  assert.match(attach, /export async function bulkAttachAs\(/);
  assert.match(attach, /if \(!treeAddWritesEnabled\(\)\) \{/);
  assert.match(attach, /buildAdPayload\(adName, metaCreativeId, adSetId, body\.createPaused === true \? "PAUSED" : "ACTIVE"\)/);
  const audience = readFileSync(join(ROOT, "app/api/meta/adset-audience/route.ts"), "utf8");
  assert.match(audience, /export async function adsetAudienceAs\(/);
  assert.match(audience, /if \(commit && !adsetTargetingWritesEnabled\(\)\) \{/);
  // The handlers it names are the app's own, and the launch keeps the route's paused path.
  const route = readFileSync(join(ROOT, "app/api/meta/launch-campaign/route.ts"), "utf8");
  assert.match(route, /export async function launchCampaignAs\(/);
  assert.match(route, /const entityStatus = resolveMetaLaunchEntityStatus\(\{ createPaused \}\);/);
  assert.match(src, /body: JSON\.stringify\(\{ draft, createPaused \}\)/);
});

test("M3c: the audience seam imports exactly the Audience Builder's create, the reads and the client_pages helper, sends one POST, grants no seeds, and only the route wiring imports it", () => {
  const files = walk();
  assert.ok(files.has(AUDIENCE_SEAM), "the route wires the audience seam");
  const src = files.get(AUDIENCE_SEAM)!;
  const got: Record<string, string[]> = {};
  for (const { target, names } of importsOf(AUDIENCE_SEAM, src)) {
    if (isOwn(target)) continue;
    got[target] = [...(got[target] ?? []), ...names].sort();
  }
  assert.deepEqual(got, Object.fromEntries(Object.entries(AUDIENCE_SEAM_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  const code = strip(src);
  // No database write of its own (the builder's create writes meta_custom_audiences), and no fetch or DELETE.
  assert.doesNotMatch(code, WRITE);
  WRITE.lastIndex = 0;
  assert.doesNotMatch(code, /\b(fetch|graphDelete)\s*\(/);
  // One POST: client_pages, the callback writePageAccessRequest is handed.
  const posts = code.split("\n").filter((l) => /graphPostWithToken\s*[<(]/.test(l));
  assert.equal(posts.length, 1);
  assert.match(posts[0]!, /postClientPage: \(b, body\) => graphPostWithToken\(`\/\$\{b\}\/client_pages`, body, token\)/);
  // The create is the builder's own, with the connector's rows client and seed grants off.
  assert.match(code, /createMetaCustomAudience\(draft\.id, \{ userId, supabase: db as never, rows: db, remediateSeeds: noSeedGrants \}\)/);
  assert.match(code, /const noSeedGrants = async \(_db: unknown, sourceIds: string\[\]\) => \(\{ remediated: \[\] as string\[\]/);
  // Business Manager calls run as Matas's own token, never the env token.
  assert.match(code, /const personal = \(userId: string\) => resolveUserFacebookToken\(db, userId\)/);
  // The builder's create keeps its gate; the helper refuses Off/Pixel's business before the ledger.
  const write = readFileSync(join(ROOT, "lib/meta/audience-write.ts"), "utf8");
  assert.match(write, /export async function createMetaCustomAudience\([\s\S]*?assertMetaAudienceWritesEnabled\(\);/);
  const helper = strip(readFileSync(join(ROOT, "lib/meta/page-access-request.ts"), "utf8"));
  assert.match(helper, /export const OFF_PIXEL_BUSINESS_IDS: readonly string\[\] = \["944651277948334", "237857750137825"\];/);
  assert.match(helper, /if \(isOffPixelBusiness\(businessId\)\) throw new OffPixelBusinessRefused\(\);[\s\S]*withMetaWriteIdempotency\([\s\S]*"page_access_request"[\s\S]*\{ required: true \}/);
  const importers = [...files.entries()].filter(([f, s2]) => f !== AUDIENCE_SEAM && /from\s+["'][^"']*audience-deps["']/.test(s2)).map(([f]) => f);
  assert.deepEqual(importers, ["lib/mcp/route-deps.ts"]);
});

test("M3d-b: the Lab seam imports exactly the Snippet tab's scan and drop edit and the Clips card's owner write, each writes only its table, and only the route wiring imports it", () => {
  const files = walk();
  assert.ok(files.has(LAB_SEAM), "the route wires the Lab seam");
  const src = files.get(LAB_SEAM)!;
  const got: Record<string, string[]> = {};
  for (const { target, names } of importsOf(LAB_SEAM, src)) {
    if (isOwn(target) || target === "lib/supabase/server.ts") continue;
    got[target] = [...(got[target] ?? []), ...names].sort();
  }
  assert.deepEqual(got, Object.fromEntries(Object.entries(LAB_SEAM_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  const code = strip(src);
  // No network of its own and no write of its own except through those paths (it reads events and clients only).
  assert.doesNotMatch(code, NETWORK);
  assert.doesNotMatch(code, WRITE);
  WRITE.lastIndex = 0;
  for (const m of code.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) assert.match(m[1]!, /^(events|clients)$/, `lab-deps from("${m[1]}")`);
  for (const [target, fns] of Object.entries(LAB_SEAM_WRITES)) {
    const body = readFileSync(join(ROOT, target), "utf8");
    for (const [n, tables] of Object.entries(fns)) {
      const fn = bodyOf(body, n);
      assert.ok(fn, `${n} in ${target}`);
      for (const m of strip(fn!).matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) assert.match(m[1]!, tables, `${target}#${n} from("${m[1]}")`);
    }
  }
  // No Meta, ever: none of the seam's imports is a lib/meta path.
  assert.ok(Object.keys(LAB_SEAM_IMPORTS).every((t) => !t.startsWith("lib/meta/")));
  const importers = [...files.entries()].filter(([f, s2]) => f !== LAB_SEAM && /from\s+["'][^"']*lab-deps["']/.test(s2)).map(([f]) => f);
  assert.deepEqual(importers, ["lib/mcp/route-deps.ts"]);
});

test("M3d-c: the Drive seam imports only the export Drive and folderDepsFor, writes only by copy and upload, and only the route wiring imports it", () => {
  const files = walk();
  assert.ok(files.has(FOLDER_SEAM), "the route wires the seam");
  const src = files.get(FOLDER_SEAM)!;
  const got: Record<string, string[]> = {};
  for (const { target, names } of importsOf(FOLDER_SEAM, src)) got[target] = [...(got[target] ?? []), ...names].sort();
  assert.deepEqual(got, Object.fromEntries(Object.entries(FOLDER_SEAM_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  const code = strip(src);
  assert.doesNotMatch(code, NETWORK);
  assert.doesNotMatch(code, WRITE);
  WRITE.lastIndex = 0;
  // A Storage read, nothing else of Storage.
  assert.deepEqual([...code.matchAll(/\.storage\.from\([^)]*\)\.(\w+)\(/g)].map((m) => m[1]), ["download"]);
  const importers = [...files.entries()].filter(([f, s2]) => f !== FOLDER_SEAM && /from\s+["'][^"']*folder-in-deps["']/.test(s2)).map(([f]) => f);
  assert.deepEqual(importers, ["lib/mcp/route-deps.ts"]);
  // folderDepsFor writes by copyFile and uploadFile only: no permission, share, move, rename or delete.
  const place = strip(readFileSync(join(ROOT, "lib/mcp/folder-in/place.ts"), "utf8"));
  const driveCalls = [...place.matchAll(/\bdrive\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(driveCalls)].sort(), ["copyFile", "getFile", "listChildren", "uploadFile"]);
  assert.doesNotMatch(place, /shareReader|removePermission|permissions|\.update\(fileId|trash|delete/i);
});

test("M3d-a: the shows seam imports exactly the event and clients forms' create, the Lab's lineup save and the Releases card's reads and save, each writes only its tables, and only the route wiring imports it", () => {
  const files = walk();
  assert.ok(files.has(SHOWS_SEAM), "the route wires the shows seam");
  const src = files.get(SHOWS_SEAM)!;
  const got: Record<string, string[]> = {};
  for (const { target, names } of importsOf(SHOWS_SEAM, src)) {
    if (isOwn(target) && !target.startsWith("app/api/events/")) continue;
    got[target] = [...(got[target] ?? []), ...names].sort();
  }
  assert.deepEqual(got, Object.fromEntries(Object.entries(SHOWS_SEAM_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  const code = strip(src);
  // No network and no write of its own (it reads one events column for the card's show date).
  assert.doesNotMatch(code, NETWORK);
  assert.doesNotMatch(code, WRITE);
  WRITE.lastIndex = 0;
  for (const m of code.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) assert.match(m[1]!, /^events$/, `shows-deps from("${m[1]}")`);
  for (const [target, fns] of Object.entries(SHOWS_SEAM_WRITES)) {
    const body = readFileSync(join(ROOT, target), "utf8");
    for (const [n, tables] of Object.entries(fns)) {
      const fn = bodyOf(body, n) ?? bodyOfAsync(body, n);
      assert.ok(fn, `${n} in ${target}`);
      for (const m of strip(fn!).matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) assert.match(m[1]!, tables, `${target}#${n} from("${m[1]}")`);
    }
  }
  // The seam's paths never reach Meta, Drive, Slack or D2C.
  for (const target of Object.keys(SHOWS_SEAM_IMPORTS)) {
    const body = strip(readFileSync(join(ROOT, target), "utf8"));
    assert.doesNotMatch(body, /from\s+["'][^"']*(\/meta\/client|\/drive\/|\/notify\/|\/d2c\/)[^"']*["']/, `${target} imports no platform write path`);
    assert.doesNotMatch(body, NETWORK, `${target} makes no network call`);
  }
  const importers = [...files.entries()].filter(([f, s2]) => f !== SHOWS_SEAM && /from\s+["'][^"']*shows-deps["']/.test(s2)).map(([f]) => f);
  assert.deepEqual(importers, ["lib/mcp/route-deps.ts"]);
});

test("M3a: every meta tool checks the scope and the approval before anything else, and reaches Meta only through ctx.meta", async () => {
  const { META_TOOLS } = await import("../tools/index.ts");
  const files = ["lib/mcp/tools/meta-launch.ts", "lib/mcp/tools/meta-event.ts", "lib/mcp/tools/live-status.ts", "lib/mcp/tools/live-budget.ts", "lib/mcp/tools/live-rename.ts", "lib/mcp/tools/live-stage.ts", "lib/mcp/tools/live-test.ts", "lib/mcp/tools/live-read.ts", "lib/mcp/tools/audiences.ts", "lib/mcp/tools/page-access.ts"];
  for (const file of files) {
    const code = strip(readFileSync(join(ROOT, file), "utf8"));
    // The read-only meta tools (get_live, list_scheduled) check the scope; every other one the scope and the approval.
    for (const m of code.matchAll(/async run\(ctx, args\) \{\n\s*(.+)\n/g)) assert.match(m[1]!, /requireMetaApproval\(ctx, args\)|requireMetaScope\(ctx\)/, file);
    assert.doesNotMatch(code, /from\s+["'](@\/|\.\.\/\.\.\/)(app\/|meta\/(?!ad-account)|lib\/meta\/)/, `${file}: no Meta import`);
  }
  // pause and resume share runStatus, which checks the approval first.
  assert.match(strip(readFileSync(join(ROOT, "lib/mcp/tools/live-status.ts"), "utf8")), /async function runStatus\(ctx: ToolContext, args: Record<string, unknown>, to: "PAUSED" \| "ACTIVE", tool: "pause" \| "resume"\) \{\n\s*const \{ approval \} = requireMetaApproval\(ctx, args\);/);
  assert.ok(META_TOOLS.length === 19 && META_TOOLS.every((t) => t.kind === "meta"));
  for (const t of META_TOOLS.filter((x) => x.readOnly === true)) assert.ok(["get_live", "list_scheduled", "list_audiences", "audience_sources", "pending_access"].includes(t.name), t.name);
});

test("tools register with honest annotations: read tools read-only, draft tools never destructive", () => {
  const server = readFileSync(join(ROOT, "lib/mcp/server.ts"), "utf8");
  assert.match(server, /readOnlyHint: tool\.readOnly \?\? tool\.kind === "read"/);
  assert.match(server, /destructiveHint: false/);
  assert.match(server, /kind: tool\.kind/);
});

test("migration 268: six service-role-only tables, RLS on, no policies, hashes only", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/268_mcp_actions.sql"), "utf8");
  const tables = ["mcp_oauth_clients", "mcp_oauth_grants", "mcp_oauth_codes", "mcp_oauth_tokens", "mcp_actions", "client_spend_ceilings"];
  for (const t of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security;`), t);
    assert.match(sql, new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated;`), t);
  }
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /\b(drop table|truncate|alter table [^;]* drop column)\b/i, "additive only");
  // Codes and tokens are stored as SHA-256 hex, never plaintext.
  assert.match(sql, /code_hash\s+text\s+primary key check \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /token_hash\s+text\s+primary key check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(sql, /\b(access_token|refresh_token|client_secret)\s+text/);
  // The plan's columns on mcp_actions.
  for (const col of ["user_id", "client_id", "event_id", "tool", "args", "kind", "status", "approved_by", "approved_at", "approval_source", "result", "error", "created_at", "updated_at", "duration_ms", "result_bytes"]) {
    assert.match(sql, new RegExp(`\\n  ${col}\\s`), col);
  }
  assert.match(sql, /kind in \('read', 'draft', 'meta'\)/);
  assert.match(sql, /status in \('requested', 'approved', 'rejected', 'done', 'failed'\)/);
  assert.match(sql, /approval_source in \('claude_prompt', 'today'\)/);
  assert.match(sql, /daily_gbp\s+numeric\s+not null/);
});

test("the proxy opens exactly the MCP paths", async () => {
  const { MCP_PUBLIC_PATHS, isPublicPath } = await import("../../auth/public-routes.ts");
  assert.deepEqual([...MCP_PUBLIC_PATHS].sort(), [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/api/mcp",
    "/api/oauth/register",
    "/api/oauth/revoke",
    "/api/oauth/token",
    "/oauth/authorize",
  ]);
  assert.equal(isPublicPath("/api/mcpx"), false);
  assert.equal(isPublicPath("/api/mcp/anything"), false);
  assert.equal(isPublicPath("/api/oauth/other"), false);
});

test("M3b on Today: Undo writes only through the live seam's own writers and the action log, Cancel only through cancelScheduled, and both are Matas's", () => {
  const files = walk();
  for (const f of ["app/(dashboard)/today/claude-actions.ts", "lib/mcp/today/undo.ts", "lib/mcp/today/log.ts", "lib/mcp/today/load.ts", "lib/mcp/today/words.ts"]) assert.ok(files.has(f), `${f} is walked`);
  const undo = strip(files.get("lib/mcp/today/undo.ts")!);
  // No table write of its own: the today_undo row goes through the action log, the cancel through scheduled.ts.
  assert.doesNotMatch(undo, /\.(insert|update|upsert|delete|rpc)\s*\(/);
  assert.match(undo, /await deps\.logger\s*\.log\(/);
  assert.match(undo, /approvedOnToday: true/);
  assert.match(undo, /cancelScheduled\(db, \{ userId: input\.userId, id: input\.id, now: input\.now, by: "today" \}\)/);
  // Meta only through McpLiveDeps' existing writes, each keyed "undo:{row}" on the ledger.
  const liveCalls = [...undo.matchAll(/\blive\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(liveCalls)], ["moveBudget", "readObjects", "rename", "setBudget", "setStatus", "switches"]);
  const writesCalled = undo.split("\n").filter((l) => /live\.(setStatus|setBudget|rename|moveBudget)\(\{/.test(l));
  assert.equal(writesCalled.length, 5);
  for (const l of writesCalled) assert.match(l, /key: undoKey \}\);/, l);
  // A delete is status DELETED, only after the confirm, and only here.
  assert.match(undo, /if \(plan\.op === "delete" && opts\.confirmed !== true\) return \{ state: "confirm" \};/);
  const deletes = [...files.entries()].filter(([f, src]) => isOwn(f) && /status: "DELETED"/.test(strip(src))).map(([f]) => f);
  assert.deepEqual(deletes, ["lib/mcp/today/undo.ts"]);
  // The seam sends DELETED through the same status POST as pause and resume (SEAM_POSTS is unchanged).
  // The actions check MATAS_USER_IDS before anything runs.
  const actions = strip(files.get("app/(dashboard)/today/claude-actions.ts")!);
  assert.match(actions, /MATAS_USER_IDS\.includes\(id\)/);
  for (const fn of ["undoClaudeChange", "cancelScheduledChange"]) {
    const body = bodyOf(actions, fn)!;
    assert.ok(body.indexOf("await matas()") >= 0 && body.indexOf("await matas()") < Math.max(body.indexOf("runUndo("), body.indexOf("cancelFromToday(")), fn);
    assert.match(body, /if \(!userId\) return \{ state: "none" \};/);
  }
});
