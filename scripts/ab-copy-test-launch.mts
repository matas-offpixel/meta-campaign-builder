/**
 * The A/B copy test (#1285, Matas's rulings of 17 Nov): one small campaign per test,
 * "{code} · AB copy test", with its campaign daily budget set to the test budget,
 * holding one ad set copied from the show's main ad set and the A and B ads (or
 * Kream's four cards in "EBR26-KREAM · Artist cards test"). Everything is PAUSED.
 * The ad set ends 23:59 London 4 days after creation; Matas switches the tests on,
 * so the end must be moved if they sit paused. Nothing here moves it.
 *
 * Dry run by default: reads Meta (the account minimum, the source ad set, the
 * source creative) and, for the cards, downloads the four images from Drive as
 * the export service account; prints every payload. Nothing is written.
 *
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-launch.mts                 # every test, dry run
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-launch.mts --only NX26-DOD # one test
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-launch.mts --apply --json /tmp/ab.json
 *
 * --apply, per test: upserts the test's own campaign_drafts row (a fixed id, so a
 * rerun is the same draft), then makes the campaign, ad set, creatives and ads
 * through meta_write_idempotency (required), writes launched_ad_sets and
 * launched_ads rows, and marks the draft published. A rerun returns the ids
 * already made. Only one run of a test may go at a time: a second run that starts while
 * the first holds the test stops before any read or write (the 17 Nov P26 duplicate).
 * Every creative must post as the show's promoter/venue page and its own Instagram
 * account (promoterIdentities, from data); an artist page is refused before any write.
 * --repoint moves the 17 Nov ads made on an artist identity (REPOINT) onto the promoter
 * creative: new creative, then the ad's creative and name swapped; if Meta refuses the
 * swap, the old ad is archived (never deleted) and a new paused ad made.
 *
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-launch.mts --repoint --only "NX26-DOD · AB copy test"          # dry run
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-launch.mts --repoint --apply --only "NX26-DOD · AB copy test"
 *
 * It acts as the operator, on META_ACCESS_TOKEN, which the app only
 * allows an operator (mayUseAgencyMetaToken).
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { createDefaultDraft } from "../lib/campaign-defaults.ts";
import { driveFromEnv } from "../lib/drive/client.ts";
import { recordLaunchedAdSet } from "../lib/launched-ad-sets/record.ts";
import { phaseAtLaunchFromObjective } from "../lib/launched-ad-sets/snapshot.ts";
import { recordLaunchedAd } from "../lib/launched-ads/record.ts";
import { mayUseAgencyMetaToken } from "../lib/meta/agency-token.ts";
import { createMetaAd, createMetaAdSet, createMetaCreative, graphGetWithToken, graphPostWithToken, uploadImageAsset } from "../lib/meta/client.ts";
import {
  copyTestAdSetPayload,
  copyTestCampaignPayload,
  copyTestCardPayload,
  creativeIdentity,
  promoterIdentities,
  repointCopyTestAds,
  withRuledIdentity,
  type RepointRow,
  type CopyTestRecorders,
  type PageFacts,
  type PromoterIdentity,
  copyTestCreativePayload,
  copyTestEndTime,
  copyTestLockFilter,
  copyTestWriteCount,
  LOCK_STALE_MINUTES,
  createCopyTest,
  type CopyTestAdSpec,
  type CopyTestLock,
  type CopyTestMeta,
  type CopyTestSpec,
} from "../lib/meta/copy-test-campaign.ts";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const repoint = argv.includes("--repoint");
const only = argv.flatMap((arg, i) => (arg === "--only" && argv[i + 1] ? [argv[i + 1]!] : []));
const jsonOut = argv.flatMap((arg, i) => (arg === "--json" && argv[i + 1] ? [argv[i + 1]!] : []))[0] ?? null;

/** The operator the tests are made as (Matas's main account, an operator). */
const OPERATOR_USER_ID = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";
const ELECTRIC_BRIXTON = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
const PUZZLE = "92f7334b-ef76-4095-88d6-f422ba1ff3f2";
const NX = "606252931141334";
const CTA = "Tickets on sale now.";

type Test = CopyTestSpec & { draftId: string; eventId: string; clientId: string; sourceAdName: string };

const ab = (sourceAdName: string, a: string, b: string): CopyTestAdSpec[] => [
  { kind: "copy", label: "A", adName: `[AB-A] ${sourceAdName}`, message: `${a}\n${CTA}` },
  { kind: "copy", label: "B", adName: `[AB-B] ${sourceAdName}`, message: `${b}\n${CTA}` },
];

const KREAM_A = "Kream, Estiva, Leena Punks & Parts at Electric Bristol, Friday 4 December.";
const KREAM_CARDS: { label: string; adName: string; fileName: string; fileId: string }[] = [
  { label: "headliner", adName: "[CARD-HEADLINER]", fileName: "Kream.jpg", fileId: "1S2B2AM3ccqU7c3qDkQI4l66sAWmvap_E" },
  { label: "Estiva", adName: "[CARD-SUPPORT-Estiva]", fileName: "Estiva.jpg", fileId: "1sW1dtK8u0tfDPmupBb8KDgdM9-oMmt6q" },
  { label: "LeenaPunks", adName: "[CARD-SUPPORT-LeenaPunks]", fileName: "LeenaPunks.jpg", fileId: "1C4rRF0BZhACSwz1gMB7o9pvp-E10PHyE" },
  { label: "Parts", adName: "[CARD-SUPPORT-Parts]", fileName: "Parts.jpg", fileId: "1PwMah6CK-Ei2Bs0bpO9lyNf78iAbj6ug" },
];

function test(t: Omit<Test, "adSetName" | "identities">): Test {
  // identities are read from data at run time (identitiesFor), never written here.
  return { ...t, adSetName: t.campaignName, identities: [] };
}

const TESTS: Test[] = [
  test({
    eventCode: "NX26-LOCKLEAD", campaignName: "NX26-LOCKLEAD · AB copy test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d01",
    eventId: "602f9e86-ee03-4ece-81e0-6b7a3b224ae6", clientId: ELECTRIC_BRIXTON, adAccountId: NX, dailyMinor: 300,
    sourceAdSetId: "120252504502750755", sourceCreativeId: "1491622176394503", sourceAdName: "Artist - Static Lineup",
    ads: ab("Artist - Static Lineup", "Locklead, Marlie & Paramida at NX Newcastle, Friday 11 December.", "In-demand house star Locklead lands at NX Newcastle, 11 December, with Marlie & Paramida."),
  }),
  test({
    eventCode: "NX26-DOD", campaignName: "NX26-DOD · AB copy test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d02",
    eventId: "f0b5636b-ea5d-442e-8a71-36fd930a2b2b", clientId: ELECTRIC_BRIXTON, adAccountId: NX, dailyMinor: 76,
    sourceAdSetId: "120252309614100755", sourceCreativeId: "1088553564059419", sourceAdName: "Promo Vid - No Text – Copy 2",
    ads: ab("Promo Vid - No Text – Copy 2", "D.O.D at NX Newcastle, Friday 4 December.", "A highly anticipated return: D.O.D is back at NX Newcastle, 4 December."),
  }),
  test({
    eventCode: "NX26-ROBBIEDOHERTY", campaignName: "NX26-ROBBIEDOHERTY · AB copy test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d03",
    eventId: "6e629f57-ac3f-4c9e-b1e4-9b717b65c004", clientId: ELECTRIC_BRIXTON, adAccountId: NX, dailyMinor: 300,
    sourceAdSetId: "120252129292810755", sourceCreativeId: "1433206562128815", sourceAdName: "Artwork Static – Lineup",
    ads: ab("Artwork Static – Lineup", "Robbie Doherty at NX Newcastle, Friday 27 November.", "Newcastle, get ready to dance: Robbie Doherty brings house music to NX Newcastle, 27 November."),
  }),
  test({
    eventCode: "NX27-JULIANFIJMA", campaignName: "NX27-JULIANFIJMA · AB copy test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d04",
    eventId: "217c0436-460d-4a18-b612-68fe8f9ba794", clientId: ELECTRIC_BRIXTON, adAccountId: NX, dailyMinor: 76,
    sourceAdSetId: "120252504524480755", sourceCreativeId: "1948436576120619", sourceAdName: "Venue - UGC 1",
    ads: ab("Venue - UGC 1", "Julian Fijma at NX Newcastle, Friday 19 March.", "The final stop of his UK tour: Julian Fijma closes it out at NX Newcastle, 19 March."),
  }),
  test({
    eventCode: "EBR26-KREAM", campaignName: "EBR26-KREAM · AB copy test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d05",
    eventId: "cd1035d1-1d5a-47ce-a37c-0750f9012b85", clientId: ELECTRIC_BRIXTON, adAccountId: "2011069725849568", dailyMinor: 200,
    sourceAdSetId: "120250163686370716", sourceCreativeId: "2188548768753745", sourceAdName: "Static",
    ads: ab("Static", KREAM_A, "Norwegian house duo Kream headline Electric Bristol, 4 December, with Estiva, Leena Punks & Parts."),
  }),
  test({
    eventCode: "EBR26-KREAM", campaignName: "EBR26-KREAM · Artist cards test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d06",
    eventId: "cd1035d1-1d5a-47ce-a37c-0750f9012b85", clientId: ELECTRIC_BRIXTON, adAccountId: "2011069725849568", dailyMinor: 200,
    sourceAdSetId: "120250163686370716", sourceCreativeId: "906635865776611", sourceAdName: "Motion - New – Copy",
    ads: [], // filled with the card images below
  }),
  test({
    eventCode: "P26-BDAY", campaignName: "P26-BDAY · AB copy test", draftId: "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d07",
    eventId: "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8", clientId: PUZZLE, adAccountId: "1058599195559790", dailyMinor: 100,
    sourceAdSetId: "120248863412000539", sourceCreativeId: "2322179805273190", sourceAdName: "Puzzle - Static CTA",
    ads: ab("Puzzle - Static CTA", "Luke Dean, Enzo Siragusa & more. Puzzle's 4th Birthday, 27 December at Circuit & Engine Rooms.", "The biggest house party in Southampton returns on 27 December with Luke Dean, Enzo Siragusa & more."),
  }),
];

/**
 * 17 Nov (Matas): copy tests post as the promoter or venue page, never an artist.
 * --repoint moves the paused ads made on an artist identity onto the ruled page and
 * its linked Instagram account. "source": a new creative from the test's promoter
 * lineup artwork with the approved line. "identity": the ad's own creative (Kream's
 * cards, promoter artwork) with only the page changed. The ruled page is checked at
 * run time (withRuledIdentity): never an artist page, and the Instagram must be the
 * account linked to it on Meta.
 */
const NX_LOVES: PromoterIdentity = { pageId: "259905047197071", instagramId: "17841460869627228" };
const ELECTRIC_BRISTOL: PromoterIdentity = { pageId: "1593045637629255", instagramId: "17841401923285132" };
const ab2 = (a: string, b: string): RepointRow[] => [{ label: "A", adId: a, mode: "source" }, { label: "B", adId: b, mode: "source" }];
const REPOINT: Record<string, { postAs: PromoterIdentity; rows: RepointRow[] }> = {
  "NX26-LOCKLEAD · AB copy test": { postAs: NX_LOVES, rows: ab2("120252640393760755", "120252640395850755") },
  "NX26-DOD · AB copy test": { postAs: NX_LOVES, rows: ab2("120252640400630755", "120252640402570755") },
  "NX26-ROBBIEDOHERTY · AB copy test": { postAs: NX_LOVES, rows: ab2("120252640406780755", "120252640408200755") },
  "EBR26-KREAM · AB copy test": { postAs: ELECTRIC_BRISTOL, rows: ab2("120250552877890716", "120250552884850716") },
  "EBR26-KREAM · Artist cards test": {
    postAs: ELECTRIC_BRISTOL,
    rows: [
      { label: "headliner", adId: "120250553057260716", mode: "identity" },
      { label: "Estiva", adId: "120250553067990716", mode: "identity" },
      { label: "LeenaPunks", adId: "120250553073120716", mode: "identity" },
      { label: "Parts", adId: "120250553078180716", mode: "identity" },
    ],
  },
};

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN is not set");
  process.exit(2);
}
if (!mayUseAgencyMetaToken(OPERATOR_USER_ID)) {
  console.error("The operator may not use the agency token (mayUseAgencyMetaToken), so nothing runs");
  process.exit(2);
}

let reads = 0;
const get = async (path: string, fields: string): Promise<Record<string, unknown>> => {
  reads += 1;
  return graphGetWithToken<Record<string, unknown>>(path, { fields }, token);
};

const meta: CopyTestMeta = {
  readAdSet: (id) => get(`/${id}`, "id,name,campaign_id,targeting,optimization_goal,billing_event,promoted_object,attribution_spec,destination_type,adset_schedule,is_dynamic_creative"),
  readCreative: (id) => get(`/${id}`, "name,object_story_spec,asset_feed_spec,url_tags"),
  readMinDailyBudget: async (account) => {
    const row = await get(`/act_${account}`, "min_daily_budget,currency");
    const value = Number(row.min_daily_budget);
    return Number.isFinite(value) ? value : null;
  },
  createCampaign: async (account, payload) => (await graphPostWithToken<{ id: string }>(`/act_${account}/campaigns`, payload, token)).id,
  createAdSet: async (account, payload) => (await createMetaAdSet(account, payload as never, token)).id,
  uploadImage: async (account, image) => {
    const uploaded = await uploadImageAsset(account, new Blob([new Uint8Array(image.bytes)], { type: "image/jpeg" }), image.fileName, token);
    if (!uploaded.hash) throw new Error(`Meta returned no hash for ${image.fileName}`);
    return uploaded.hash;
  },
  createCreative: async (account, payload) => (await createMetaCreative(account, payload as never, token)).id,
  createAd: async (account, payload) => (await createMetaAd(account, payload as never, token)).id,
  readAd: async (id) => {
    const row = await get(`/${id}`, "id,name,adset_id,campaign_id,status,creative{id}");
    return { id: String(row.id), name: String(row.name ?? ""), adsetId: String(row.adset_id), campaignId: String(row.campaign_id), status: String(row.status), creativeId: ((row.creative as { id?: string } | undefined)?.id) ?? null };
  },
  updateAd: async (id, fields) => {
    await graphPostWithToken(`/${id}`, { creative: fields.creative, name: fields.name }, token);
  },
  archiveAd: async (id) => {
    await graphPostWithToken(`/${id}`, { status: "ARCHIVED" }, token);
  },
};

/** Every page of a Graph edge. */
async function getAll(path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    reads += 1;
    const res = await graphGetWithToken<{ data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, { ...params, limit: "200", ...(after ? { after } : {}) }, token!);
    out.push(...(res.data ?? []));
    if (!res.paging?.next || !res.paging.cursors?.after) break;
    after = res.paging.cursors.after;
  }
  return out;
}

/**
 * The show's promoter/venue identities, from data (promoterIdentities): the client's
 * pages on record, the pages promotable on the ad account, the pages on the show's own
 * ads (every campaign named [CODE] on the account), and each page's Meta category and
 * linked Instagram account. Reads only.
 */
async function identitiesFor(t: Test): Promise<{ identities: PromoterIdentity[]; facts: PageFacts[]; showAdPageIds: string[]; clientPageIds: string[] }> {
  const client = await dbRead!.from("clients").select("default_page_ids").eq("id", t.clientId).maybeSingle();
  if (client.error) throw new Error(`clients: ${client.error.message}`);
  const clientPageIds = ((client.data as { default_page_ids?: string[] | null } | null)?.default_page_ids ?? []).map(String);
  const promotable = (await getAll(`/act_${t.adAccountId}/promote_pages`, { fields: "id" })).map((row) => String(row.id));
  const campaigns = await getAll(`/act_${t.adAccountId}/campaigns`, { fields: "id,name", filtering: JSON.stringify([{ field: "name", operator: "CONTAIN", value: `[${t.eventCode}` }]) });
  const showAdPageIds = new Set<string>();
  for (const campaign of campaigns) {
    for (const ad of await getAll(`/${String(campaign.id)}/ads`, { fields: "creative{object_story_spec}" })) {
      const page = ((ad.creative as { object_story_spec?: { page_id?: string } } | undefined)?.object_story_spec?.page_id);
      if (page) showAdPageIds.add(String(page));
    }
  }
  const facts: PageFacts[] = [];
  for (const id of new Set([...showAdPageIds, ...clientPageIds])) {
    const page = await get(`/${id}`, "category,instagram_business_account{id}");
    facts.push({ id, category: (page.category as string | undefined) ?? null, linkedInstagramId: ((page.instagram_business_account as { id?: string } | undefined)?.id) ?? null });
  }
  return { identities: promoterIdentities({ clientPageIds, promotablePageIds: promotable, showAdPageIds: [...showAdPageIds], pages: facts }), facts, showAdPageIds: [...showAdPageIds], clientPageIds };
}

async function cardAds(): Promise<CopyTestAdSpec[]> {
  const { drive, reason } = driveFromEnv();
  if (!drive) throw new Error(`Drive isn't configured: ${reason}`);
  const out: CopyTestAdSpec[] = [];
  for (const card of KREAM_CARDS) {
    const bytes = await drive.download(card.fileId);
    console.log(`  ${card.fileName}: ${bytes.byteLength} bytes from Drive (read only)`);
    out.push({ kind: "card", label: card.label, adName: card.adName, message: `${KREAM_A}\n${CTA}`, image: { fileName: card.fileName, bytes } });
  }
  return out;
}

const selected = TESTS.filter((t) => !only.length || only.includes(t.eventCode) || only.includes(t.campaignName));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
// The service role reads the client's pages on record in a dry run too (a SELECT); it writes only with --apply.
const dbRead = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
const db = apply ? dbRead : null;
if (!dbRead) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, so the promoter pages can't be read and nothing runs");
  process.exit(2);
}
if (apply && !db) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, so nothing is written");
  process.exit(2);
}

function draftRow(t: Test, status: "draft" | "published") {
  const base = createDefaultDraft();
  const draftJson = {
    ...base,
    id: t.draftId,
    status,
    settings: { ...base.settings, clientId: t.clientId, eventId: t.eventId, adAccountId: t.adAccountId, metaAdAccountId: t.adAccountId, campaignName: t.campaignName, objective: "purchase" },
    adSetSuggestions: [],
    creatives: [],
  };
  return { id: t.draftId, user_id: OPERATOR_USER_ID, name: t.campaignName, objective: "purchase", ad_account_id: t.adAccountId, status, client_id: t.clientId, event_id: t.eventId, draft_json: draftJson };
}

/**
 * One run per test: an atomic conditional UPDATE on the test's own campaign_drafts row
 * claims it (draft_json.copyTestRun), and fails closed — an error or no row updated means
 * another run holds it. A run older than LOCK_STALE_MINUTES is taken over. Marking the
 * draft published rewrites draft_json, which also clears the claim.
 */
function draftLock(t: Test, runId: string): CopyTestLock {
  return {
    async acquire() {
      const current = await db!.from("campaign_drafts").select("status").eq("id", t.draftId).maybeSingle();
      if (current.error || !current.data) return false;
      const status = (current.data as { status: string }).status === "published" ? "published" : "draft";
      const staleBefore = new Date(Date.now() - LOCK_STALE_MINUTES * 60_000).toISOString();
      const claimed = await db!
        .from("campaign_drafts")
        .update({ draft_json: { ...draftRow(t, status).draft_json, copyTestRun: { id: runId, at: new Date().toISOString() } } })
        .eq("id", t.draftId)
        .or(copyTestLockFilter(staleBefore))
        .select("id");
      if (claimed.error) console.error(`  lock: ${claimed.error.message}`);
      return !claimed.error && (claimed.data ?? []).length === 1;
    },
    async release() {
      const current = await db!.from("campaign_drafts").select("status").eq("id", t.draftId).maybeSingle();
      const status = (current.data as { status?: string } | null)?.status === "published" ? "published" : "draft";
      await db!.from("campaign_drafts").update({ draft_json: draftRow(t, status).draft_json }).eq("id", t.draftId).eq("draft_json->copyTestRun->>id", runId);
    },
  };
}

function recorders(t: Test, launchRunId: string): CopyTestRecorders {
  return {
          adSet: (row) =>
            recordLaunchedAdSet(db!, {
              metaAdsetId: row.metaAdsetId, metaCampaignId: row.metaCampaignId, adAccountId: t.adAccountId, draftId: t.draftId, userId: OPERATOR_USER_ID,
              clientId: t.clientId, eventId: t.eventId, launchRunId, objective: "purchase", phaseAtLaunch: phaseAtLaunchFromObjective("purchase"), descriptorSource: "launch",
              suggestion: {
                id: `copy-test-${t.sourceAdSetId}`, name: t.adSetName, sourceType: "custom_group", sourceId: t.sourceAdSetId, sourceName: `copy of ${t.sourceAdSetId}`,
                ageMin: Number((row.source.targeting as Record<string, unknown>)?.age_min ?? 18), ageMax: Number((row.source.targeting as Record<string, unknown>)?.age_max ?? 65),
                budgetPerDay: row.dailyMinor / 100, advantagePlus: ((row.source.targeting as Record<string, Record<string, unknown>>)?.targeting_automation?.advantage_audience ?? 0) === 1, enabled: true,
              } as never,
              audiences: null,
              launchNote: `AB copy test: copy of ad set ${t.sourceAdSetId}, campaign daily budget ${row.dailyMinor}`,
            }),
          ad: (row) =>
            recordLaunchedAd(db!, {
              metaAdId: row.metaAdId, metaCreativeId: row.metaCreativeId, metaAdsetId: row.metaAdsetId, metaCampaignId: row.metaCampaignId, adAccountId: t.adAccountId,
              draftId: t.draftId, userId: OPERATOR_USER_ID, clientId: t.clientId, eventId: t.eventId, launchRunId, descriptorSource: "launch", adName: row.adName,
              descriptor: {
                creativeName: row.adName, mediaType: (row.creative.object_story_spec as Record<string, unknown>)?.video_data ? "video" : "image",
                sourceType: "uploaded", placementMode: row.creative.asset_feed_spec ? "per_placement" : "single", variationCount: 1,
                cta: null, destinationUrl: null, urlTagsApplied: typeof row.creative.url_tags === "string", assetContentHashes: [],
              },
            }),
    archivedAd: async (row) => {
      const current = await db!.from("launched_ads").select("ad_name").eq("meta_ad_id", row.metaAdId).maybeSingle();
      const name = (current.data as { ad_name?: string | null } | null)?.ad_name ?? "";
      if (!name.startsWith("[ARCHIVED")) await db!.from("launched_ads").update({ ad_name: `[ARCHIVED, replaced by ${row.replacedBy}] ${name}` }).eq("meta_ad_id", row.metaAdId);
    },
  };
}

const results: Record<string, unknown>[] = [];
let failed = false;
for (const t of selected) {
  console.log(`\n== ${t.campaignName} · £${(t.dailyMinor / 100).toFixed(2)} a day · act_${t.adAccountId}`);
  const who = await identitiesFor(t);
  t.identities = who.identities;
  console.log(`  promoter/venue: ${who.identities.length ? who.identities.map((id) => `page ${id.pageId} + Instagram ${id.instagramId}`).join("; ") : "NONE on record"} (client pages ${who.clientPageIds.join(",") || "none"}; show ad pages ${who.showAdPageIds.join(",")}; ${who.facts.map((f) => `${f.id}=${f.category}`).join(", ")})`);
  if (repoint) {
    const plan = REPOINT[t.campaignName];
    if (!plan) {
      console.log("  not a repoint test; skipped");
      continue;
    }
    const ruledPage = await get(`/${plan.postAs.pageId}`, "name,category,instagram_business_account{id,username}");
    const ruledIg = ruledPage.instagram_business_account as { id?: string; username?: string } | undefined;
    try {
      t.identities = withRuledIdentity(t.identities, plan.postAs, { id: String(ruledPage.id), category: (ruledPage.category as string | undefined) ?? null, linkedInstagramId: ruledIg?.id ?? null });
    } catch (err) {
      console.error(`  STOPPED: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
      break;
    }
    console.log(`  posts as: ${String(ruledPage.name).trim()} ${plan.postAs.pageId} (${String(ruledPage.category)}) + Instagram ${ruledIg?.username} ${plan.postAs.instagramId} (the page's linked account)`);
    const source = plan.rows.some((row) => row.mode === "source") ? await meta.readCreative(t.sourceCreativeId) : null;
    for (const row of plan.rows) {
      const live = await meta.readAd!(row.adId);
      const current = live?.creativeId ? await meta.readCreative(live.creativeId) : null;
      const now = current ? creativeIdentity(current) : null;
      let payload: Record<string, unknown>;
      if (row.mode === "source") {
        const ad = t.ads.find((a) => a.label === row.label)!;
        payload = copyTestCreativePayload(source!, { name: ad.adName, message: ad.kind === "copy" ? ad.message : "", postAs: plan.postAs });
      } else {
        const oss = (current?.object_story_spec ?? {}) as Record<string, Record<string, unknown>>;
        payload = copyTestCreativePayload(current!, { name: live!.name, message: String(oss.link_data?.message ?? oss.video_data?.message ?? ""), postAs: plan.postAs });
      }
      const done = now?.pageId === plan.postAs.pageId && now?.instagramId === plan.postAs.instagramId;
      console.log(`  ${row.label} ad ${row.adId} (${live?.status}; now page ${now?.pageId} / IG ${now?.instagramId}, creative ${live?.creativeId}) → ${row.mode === "source" ? `new creative from ${t.sourceCreativeId}` : "its own creative, page changed"}${done ? " [already on the ruled page]" : ""}: ${JSON.stringify(payload).slice(0, 360)}`);
    }
    const toDo = plan.rows.length;
    console.log(`  Meta writes: ${toDo * 2} (${toDo} creatives + ${toDo} in-place swaps, no status change; if Meta refuses a swap, +2 for that ad: archive, never delete, and a new paused ad)`);
    if (!apply) continue;
    const launchRunId = randomUUID();
    try {
      const out = await repointCopyTestAds({ meta, ledger: { supabase: db!, userId: OPERATOR_USER_ID, draftId: t.draftId, eventId: t.eventId }, lock: draftLock(t, launchRunId), record: recorders(t, launchRunId) }, t, plan.rows, plan.postAs);
      console.log(`  repointed: ${out.ads.map((a) => `${a.label} ${a.action} ad ${a.adId} creative ${a.creativeId}${a.archivedAdId ? ` (archived ${a.archivedAdId})` : ""}`).join("; ")}; writes ${out.writes}`);
      results.push({ test: t.campaignName, repoint: out });
    } catch (err) {
      console.error(`  STOPPED: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ test: t.campaignName, stopped: err instanceof Error ? err.message : String(err) });
      failed = true;
      break;
    }
    continue;
  }
  if (t.campaignName.endsWith("Artist cards test")) t.ads = await cardAds();
  console.log(`  Meta writes: ${copyTestWriteCount(t)}`);
  if (!apply) {
    const [minimum, source, creative] = [await meta.readMinDailyBudget(t.adAccountId), await meta.readAdSet(t.sourceAdSetId), await meta.readCreative(t.sourceCreativeId)];
    const { day, endTime } = copyTestEndTime(new Date());
    console.log(`  account minimum: ${minimum}; budget ${t.dailyMinor} ${minimum != null && t.dailyMinor >= minimum ? "ok" : "UNDER THE MINIMUM"}; ends ${endTime} (${day})`);
    console.log("  campaign:", JSON.stringify(copyTestCampaignPayload(t.campaignName, t.dailyMinor)));
    console.log("  ad set:", JSON.stringify(copyTestAdSetPayload(source!, { campaignId: "{campaign}", name: t.adSetName, endTime })));
    for (const ad of t.ads) {
      const payload = ad.kind === "copy" ? copyTestCreativePayload(creative!, { name: ad.adName, message: ad.message }) : copyTestCardPayload(creative!, { name: ad.adName, message: ad.message, imageHash: "{hash}" });
      console.log(`  creative ${ad.label}:`, JSON.stringify(payload));
    }
    continue;
  }
  const upsert = await db!.from("campaign_drafts").upsert(draftRow(t, "draft"), { onConflict: "id", ignoreDuplicates: true });
  if (upsert.error) {
    console.error(`  draft row: ${upsert.error.message}; nothing made`);
    failed = true;
    break;
  }
  const launchRunId = randomUUID();
  try {
    const out = await createCopyTest(
      {
        meta,
        ledger: { supabase: db!, userId: OPERATOR_USER_ID, draftId: t.draftId, eventId: t.eventId },
        lock: draftLock(t, launchRunId),
        record: recorders(t, launchRunId),
      },
      t,
    );
    await db!.from("campaign_drafts").update({ status: "published", draft_json: draftRow(t, "published").draft_json }).eq("id", t.draftId);
    console.log(`  made: campaign ${out.campaignId}, ad set ${out.adSetId}, ads ${out.ads.map((a) => `${a.label}=${a.adId}`).join(", ")}; ends ${out.endTime}; writes ${out.writes}`);
    results.push({ test: t.campaignName, eventCode: t.eventCode, dailyMinor: t.dailyMinor, launchRunId, ...out });
  } catch (err) {
    console.error(`  STOPPED: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ test: t.campaignName, stopped: err instanceof Error ? err.message : String(err) });
    failed = true;
    break;
  }
}
console.log(`\nMeta reads: ${reads}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
if (failed) process.exit(1);
