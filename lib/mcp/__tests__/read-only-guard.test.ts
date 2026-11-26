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
};

const ENTRIES = [
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
    // The Meta seam is pinned by its own test, not walked.
    if (file === META_SEAM) continue;
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
  "lib/db/client-status.ts": ["dropArchivedClientRows", "loadArchivedClientIds"],
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
  "lib/drive/picker-model.ts": ["PICKER_WORDS", "defaultBatchFields", "folderTiles", "formatBytes"],
  "lib/drive/picker-batch.ts": ["planPrepare"],
  "lib/drive/client.ts": ["driveFromEnv"],
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
};

/**
 * lib/meta modules the MCP may import: pure helpers and the token read. No
 * Meta write path (lib/meta/client.ts, the Graph client, is never imported).
 */
const META_IMPORTS_ALLOWED = /\/meta\/(ad-account|location-pins|location-search|location-radius|location-targeting|server-token|advantage-plus-compat|adset)(\.ts)?["']/;

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
    if (file === META_SEAM) continue;
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
    if (!isOwn(file) || file === META_SEAM) continue;
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
  // No network call of its own: everything goes through those handlers.
  assert.doesNotMatch(strip(src), NETWORK);
  // Only route-deps wires it; no tool imports it (tools reach Meta through ctx.meta).
  const importers = [...files.entries()].filter(([f, s2]) => f !== META_SEAM && /from\s+["'][^"']*meta-deps["']/.test(s2)).map(([f]) => f);
  assert.deepEqual(importers, ["lib/mcp/route-deps.ts"]);
  // The handlers it names are the app's own, and the launch keeps the route's paused path.
  const route = readFileSync(join(ROOT, "app/api/meta/launch-campaign/route.ts"), "utf8");
  assert.match(route, /export async function launchCampaignAs\(/);
  assert.match(route, /const entityStatus = resolveMetaLaunchEntityStatus\(\{ createPaused \}\);/);
  assert.match(src, /body: JSON\.stringify\(\{ draft, createPaused \}\)/);
});

test("M3a: every meta tool checks the scope and the approval before anything else, and reaches Meta only through ctx.meta", async () => {
  const { META_TOOLS } = await import("../tools/index.ts");
  for (const file of ["lib/mcp/tools/meta-launch.ts", "lib/mcp/tools/meta-event.ts"]) {
    const code = strip(readFileSync(join(ROOT, file), "utf8"));
    for (const m of code.matchAll(/async run\(ctx, args\) \{\n\s*(.+)\n/g)) assert.match(m[1]!, /requireMetaApproval\(ctx, args\)/, file);
    assert.doesNotMatch(code, /from\s+["'](@\/|\.\.\/\.\.\/)(app|lib\/meta)\//, `${file}: no Meta import`);
  }
  assert.deepEqual(META_TOOLS.map((t) => t.kind), ["meta", "meta", "meta"]);
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
