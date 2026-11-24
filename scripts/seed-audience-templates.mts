// scripts/seed-audience-templates.mts
//
// R6 (record RC5): propose Electric's four audience templates from past
// launches and show, per Electric ad account, which items would be Reused
// and which Will be created. lib/audience-templates/seed.ts does the
// planning, lib/audience-templates/resolve.ts the reuse (see their headers).
//
// Dry run by default: SELECTs and read-only Graph GETs, prints the proposal.
// Writes nothing. Meta is read for one thing: Electric's customer lists, by
// GET /act_{id}/customaudiences (every page) in each Electric account
// (lib/audience-templates/graph-lists.ts). Every Graph request is counted;
// anything that isn't a GET on that edge is refused. No audience is created,
// shared or uploaded, ever, by this script.
//
//   --apply             writes the templates (audience_templates +
//                       audience_template_items) and registers the template
//                       lists as meta_custom_audiences rows (the rows the dry
//                       run prints), as --user. Only after Matas has
//                       confirmed the printed proposal.
//   --confirmed         with --apply, stamps confirmed_by = --user and
//                       confirmed_at = now (RC5: "confirmed by {name} {date}").
//                       Without it the templates are saved "Not confirmed yet".
//   --only "<name>"     one template (repeatable), e.g. --only "House & disco".
//   --user <uuid>       the owner of the rows. Default: Matas (MATAS_USER_IDS[0]).
//   --client <uuid>     default: Electric (f9045034-2788-4b1d-94d1-1a5ab7fa5ac8).
//   --json <file>       also write the proposal as JSON.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/seed-audience-templates.mts
//   npx tsx --env-file=.env.local scripts/seed-audience-templates.mts --apply --confirmed

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { MATAS_USER_IDS } from "../lib/auth/operator-allowlist.ts";
import {
  dedupeKnown,
  knownFromDraftAudiences,
  knownFromRows,
  normalizeAccount,
  resolveTemplate,
  type CustomAudienceRow,
  type KnownAudience,
} from "../lib/audience-templates/resolve.ts";
import { pageNamesFromDrafts, planTemplates, type SeedCluster, type SeedDraft, type SeedEvent } from "../lib/audience-templates/seed.ts";
import { templateRows } from "../lib/audience-templates/store.ts";
import {
  fetchAccountAudiences,
  isAllowedGraphRead,
  knownFromPlacements,
  listRegisterRows,
  placeLists,
  type AccountListing,
} from "../lib/audience-templates/graph-lists.ts";

const ELECTRIC = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
const PAGE = 1000;
const CHUNK = 100;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--confirmed");
const ONLY = args("--only");
const USER = arg("--user") ?? MATAS_USER_IDS[0]!;
const CLIENT = arg("--client") ?? ELECTRIC;
const JSON_OUT = arg("--json");

// ── Meta guard: GET /act_{id}/customaudiences only, every request counted ──
let metaCalls = 0;
let metaRefused = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/graph\.facebook\.com/.test(url)) {
    if (!isAllowedGraphRead(url, init?.method)) {
      metaRefused += 1;
      throw new Error("seed-audience-templates: only GET /act_{id}/customaudiences is allowed");
    }
    metaCalls += 1;
  }
  return realFetch(input, init);
}) as typeof fetch;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (--env-file=.env.local)");
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = Record<string, unknown>;
interface Q {
  eq(col: string, value: unknown): Q;
  in(col: string, values: unknown[]): Q;
  order(col: string): Q;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function paged(table: string, cols: string, build: (q: Q) => Q): Promise<Row[]> {
  const out: Row[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await build(db.from(table).select(cols) as unknown as Q).range(at, at + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if ((data as Row[]).length < PAGE) return out;
  }
}

async function chunked(table: string, cols: string, col: string, values: string[], order: string, extra: (q: Q) => Q = (q) => q): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    out.push(...(await paged(table, cols, (q) => extra(q.in(col, values.slice(i, i + CHUNK))).order(order))));
  }
  return out;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ── Reads ──────────────────────────────────────────────────────────────────
const clientRows = await paged("clients", "id, name, meta_business_id", (q) => q.eq("id", CLIENT).order("id"));
const client = clientRows[0];
if (!client) throw new Error(`client ${CLIENT} not found`);
const businessId = text(client.meta_business_id);
if (!businessId) throw new Error("the client has no meta_business_id");
const bm = await paged("client_business_managers", "business_id, business_name", (q) => q.eq("business_id", businessId).order("business_id"));

// The events' genre family is not read here: the genre key keeps it to the
// shadow runner until its audit passes (GK, lib/learning/__tests__/genre.test.ts
// guards who names and reads it). The brief's shows stand in.
const eventRows = await paged("events", "id, event_code, name, meta_ad_account_id", (q) => q.eq("client_id", CLIENT).order("event_code"));
const events: SeedEvent[] = eventRows.map((r) => ({ id: String(r.id), code: String(r.event_code ?? ""), name: String(r.name ?? ""), genreFamily: null }));

const draftRows = await chunked(
  "campaign_drafts",
  "id, event_id, status, ad_account_id, audiences:draft_json->audiences, pixel:draft_json->settings->metaPixelId",
  "event_id",
  events.map((e) => e.id),
  "id",
);
const drafts: SeedDraft[] = draftRows.map((r) => ({ eventId: String(r.event_id), status: String(r.status ?? ""), audiences: r.audiences }));

const bmPages = await paged("bm_pages", "page_id, page_name", (q) => q.eq("business_id", businessId).order("page_id"));
const bmPixels = await paged("bm_pixels", "pixel_id, name", (q) => q.eq("business_id", businessId).order("pixel_id"));
const bmAccounts = await paged("bm_ad_accounts", "ad_account_id, name", (q) => q.eq("business_id", businessId).order("ad_account_id"));
const accountName = new Map(bmAccounts.map((r) => [String(r.ad_account_id), String(r.name ?? "")]));
const pixelName = new Map(bmPixels.map((r) => [String(r.pixel_id), String(r.name ?? "")]));

// The Electric venue accounts: every account in the business that an event
// or a draft is on, by use. An account outside the business is printed and left out.
const accountUse = new Map<string, number>();
for (const r of [...eventRows.map((e) => ({ ad_account_id: e.meta_ad_account_id })), ...draftRows]) {
  const acct = normalizeAccount(r.ad_account_id as string | null);
  if (acct) accountUse.set(acct, (accountUse.get(acct) ?? 0) + 1);
}
const usedAccounts = [...accountUse.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
const accounts = usedAccounts.filter((a) => accountName.has(a));
const outsideAccounts = usedAccounts.filter((a) => !accountName.has(a)).map((a) => `${a} (${accountUse.get(a)} uses)`);

// The pixel each account's drafts used most.
const pixelUse = new Map<string, Map<string, number>>();
for (const r of draftRows) {
  const acct = normalizeAccount(r.ad_account_id as string | null);
  const px = text(r.pixel);
  if (!acct || !px) continue;
  const m = pixelUse.get(acct) ?? new Map<string, number>();
  m.set(px, (m.get(px) ?? 0) + 1);
  pixelUse.set(acct, m);
}
const pixelFor = (acct: string): string | null => [...(pixelUse.get(acct)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const audienceRows = await chunked(
  "meta_custom_audiences",
  "meta_audience_id, meta_ad_account_id, audience_subtype, list_role, retention_days, source_id, source_meta, event_id, status",
  "meta_ad_account_id",
  accounts.flatMap((a) => [a, a.slice(4)]),
  "meta_audience_id",
);

const pageNames: Record<string, string> = {};
for (const r of bmPages) if (text(r.page_name)) pageNames[String(r.page_id)] = text(r.page_name)!;
for (const [id, name] of Object.entries(pageNamesFromDrafts(drafts))) pageNames[id] ??= name;
for (const r of audienceRows) {
  const meta = (r.source_meta ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(meta.pageIds) ? meta.pageIds : [];
  if (ids.length === 1 && typeof ids[0] === "string" && text(meta.pageName)) pageNames[ids[0]] ??= text(meta.pageName)!;
}

const clusterRows = await paged("interest_clusters", "name, interests, live_evidence", (q) => q.order("name"));
const clusters: SeedCluster[] = clusterRows.map((r) => {
  const interests = Array.isArray(r.interests) ? (r.interests as Array<Record<string, unknown>>) : [];
  const perClient = ((r.live_evidence as { perClient?: unknown } | null)?.perClient ?? []) as Array<Record<string, unknown>>;
  const slice = Array.isArray(perClient) ? perClient.find((p) => p.clientId === CLIENT) : undefined;
  return {
    name: String(r.name ?? ""),
    interestIds: interests.map((i) => String(i.id ?? "")).filter(Boolean),
    cprIndex: typeof slice?.cprIndex === "number" ? slice.cprIndex : null,
    confidence: typeof slice?.confidence === "string" ? slice.confidence : null,
  };
});

// ── Meta, read-only: Electric's customer lists in each account ─────────────
const token = process.env.META_ACCESS_TOKEN;
if (!token) throw new Error("META_ACCESS_TOKEN is required to read the customer lists (--env-file=.env.local)");
const version = process.env.META_API_VERSION || "v21.0";
const listings: AccountListing[] = [];
for (const a of accounts) listings.push(await fetchAccountAudiences(a, { token, version, fetch: globalThis.fetch }));
const placements = placeLists(listings);

const known: KnownAudience[] = dedupeKnown([
  ...knownFromRows(audienceRows as unknown as CustomAudienceRow[]),
  ...drafts.flatMap((d) => knownFromDraftAudiences(d.audiences)),
  ...knownFromPlacements(placements),
]);

const registered = new Set(
  (audienceRows as Row[]).flatMap((r) => (r.meta_audience_id ? [`${r.meta_audience_id}|${normalizeAccount(r.meta_ad_account_id as string)}`] : [])),
);
const registerRows = listRegisterRows(placements, { userId: USER, clientId: CLIENT, registered });

// ── Plan ───────────────────────────────────────────────────────────────────
const proposals = planTemplates({ clientId: CLIENT, businessId, events, drafts, pageNames, clusters, lists: placements }).filter(
  (p) => ONLY.length === 0 || ONLY.includes(p.def.name),
);

const out: string[] = [];
const log = (s = "") => out.push(s);
const acctLabel = (a: string) => `${a} (${accountName.get(a) || "no name stored"})`;
const pixelLabel = (p: string | null) => (p ? `${p} (${pixelName.get(p) || "no name stored"})` : "none");

log(`# Audience templates: seed proposal (dry run)`);
log();
log(`Client ${client.name} (${CLIENT}) · business ${businessId} (${text(bm[0]?.business_name) ?? "no name stored"})`);
log(`${events.length} events · ${drafts.length} drafts · shows from the brief (the events' genre family is the genre key's shadow input and is not read here)`);
log(`Known audiences in the accounts: ${known.filter((k) => k.source === "row").length} meta_custom_audiences rows (ready) · ${known.filter((k) => k.source === "launch").length} launch-made page audiences recorded on drafts`);
log(`Accounts: ${accounts.map((a) => `${acctLabel(a)} · pixel ${pixelLabel(pixelFor(a))}`).join("; ")}`);
if (outsideAccounts.length) log(`Not in the business, left out: ${outsideAccounts.join(", ")}`);
log(`Ranking: tag_performance has no audience or page dimension (its dimensions are creative tags), so pages rank by shows used. Interests rank by Electric's interest_clusters.live_evidence slice where it reads ok or better: ${clusters.filter((c) => c.confidence && ["ok", "good", "strong"].includes(c.confidence)).length} clusters do.`);
log();

// ── Electric's customer lists, by account ──────────────────────────────────
log(`## Customer lists, by account (Meta, read-only)`);
log();
log(`Listings: ${listings.map((l) => `${acctLabel(l.accountId)} ${l.audiences.length} audiences in ${l.requests} requests${l.error ? ` · ERROR ${l.error}` : ""}`).join("; ")}`);
log(`Which account holds a list: the audience's own account_id (its owner) in Meta's answer. A list another account can use shows in that account's listing with the holder's account_id; that's what "shared to" means here.`);
log();
log(`| List | Use | Meta id | Held in | Shared to | Approx. size | Updated | Meta status |`);
log(`|---|---|---|---|---|---|---|---|`);
for (const pl of placements) {
  const size = pl.countLower != null ? `${pl.countLower.toLocaleString("en-GB")}–${(pl.countUpper ?? pl.countLower).toLocaleString("en-GB")}` : "";
  log(
    `| ${pl.metaName ?? pl.list.name}${pl.id ? "" : " (not found)"} | ${pl.list.use === "template" ? "templates" : "per show, not in templates"} | ${pl.id ?? ""} | ${pl.holder ? acctLabel(pl.holder) : ""} | ${pl.sharedTo.map(acctLabel).join(", ") || "none of the others"} | ${size} | ${pl.timeUpdated?.slice(0, 10) ?? ""} | ${pl.operation ?? ""}${pl.outdated ? " · OUTDATED" : ""} |`,
  );
  if (pl.alsoMatched.length) log(`|  ↳ also named like it | | ${pl.alsoMatched.join(", ")} | | | | | |`);
}
const outdated = placements.filter((pl) => pl.outdated);
log();
log(outdated.length ? `Outdated per Meta: ${outdated.map((pl) => `${pl.metaName} (updated ${pl.timeUpdated?.slice(0, 10)})`).join(", ")}` : `Outdated per Meta: none (every list reads "${[...new Set(placements.filter((pl) => pl.id).map((pl) => pl.operation))].join(" / ")}").`);
log();
log(`### meta_custom_audiences rows --apply would register (${registerRows.length})`);
log();
log(`Shape copied from lib/retargeting/list-row.ts listRowPayload, the only customer-list writer: prod has no customer_list row to copy from (SELECT, 24 Nov). event_id and list_role null; no counts stored.`);
log();
log(`| name | meta_audience_id | meta_ad_account_id | funnel_stage | audience_subtype | list_role | retention_days | source_id | status | client_id |`);
log(`|---|---|---|---|---|---|---|---|---|---|`);
for (const r of registerRows) {
  log(`| ${r.name} | ${r.meta_audience_id} | ${r.meta_ad_account_id} | ${r.funnel_stage} | ${r.audience_subtype} | null | null | ${r.source_id} | ${r.status} | ${r.client_id} |`);
}
log();

const totals: Array<{ template: string; account: string; reused: number; toCreate: number; metaCreates: number }> = [];

for (const p of proposals) {
  const t = p.template;
  log(`## ${t.name}  (${t.genreFamilies.join(" + ")})`);
  log();
  log(`Shows: ${p.shows.map((s) => `${s.code} ${s.name} [${s.source}, ${s.drafts} drafts]`).join("; ") || "none"}`);
  if (p.missingShows.length) log(`Not found: ${p.missingShows.join(", ")}`);
  log();
  log(`| # | Group | Item | Role / id | Behind it |`);
  log(`|---|---|---|---|---|`);
  t.items.forEach((it, i) => {
    const group = { customer_list: "Customer list", retargeting_pool: "Retargeting pool", page_engagers: "Artist page", interest: "Interest" }[it.kind];
    const name =
      it.kind === "customer_list" ? it.detail.name : it.kind === "retargeting_pool" ? it.listRole : it.kind === "page_engagers" ? (it.detail.name ?? "(no name stored)") : it.interestName;
    const role =
      it.kind === "customer_list"
        ? `${it.listRole}${it.familyKey ? `, ${it.familyKey}` : ""}`
        : it.kind === "retargeting_pool"
          ? `${it.retentionDays} days${it.detail.threshold ? `, ${it.detail.threshold}% watched` : ""}`
          : it.kind === "page_engagers"
            ? it.pageId
            : it.interestId;
    const page = it.kind === "page_engagers" ? p.pages.find((x) => x.pageId === it.pageId) : null;
    const interest = it.kind === "interest" ? p.interests.find((x) => x.id === it.interestId) : null;
    const behind = it.kind === "customer_list"
      ? it.metaAudienceId
        ? `Meta ${it.metaAudienceId} · held in ${it.detail.heldIn ? acctLabel(String(it.detail.heldIn)) : "unknown"}`
        : "not found in Meta: by role and family"
      : page
      ? `${page.why}${page.shows.length ? ` · ${page.shows.length} shows (${page.shows.join(", ")})` : ""}${page.groups.length ? ` · groups: ${page.groups.join(", ")}` : ""}`
      : interest
        ? `${interest.shows.length} shows${interest.evidence ? ` · ${interest.evidence.cluster} cprIndex ${interest.evidence.cprIndex} (${interest.evidence.confidence})` : ""}`
        : "brief";
    log(`| ${i + 1} | ${group} | ${name} | ${role} | ${behind} |`);
  });
  if (p.missingPages.length) log(`\nThe brief's pages not found in the business or the drafts: ${p.missingPages.join(", ")}. Add them with "Add page to this group".`);
  log();
  log(`| Account | Pixel | Reused | Will be created | Meta creates it would need (writes on) |`);
  log(`|---|---|---|---|---|`);
  for (const a of accounts) {
    const r = resolveTemplate(t.items, a, known, pixelFor(a));
    totals.push({ template: t.name, account: a, reused: r.reused, toCreate: r.toCreate, metaCreates: r.metaCreates });
    log(`| ${acctLabel(a)} | ${pixelLabel(pixelFor(a))} | ${r.reused} | ${r.toCreate} | ${r.metaCreates} |`);
  }
  for (const a of accounts) {
    const r = resolveTemplate(t.items, a, known, pixelFor(a));
    const elsewhere = r.items.filter((x) => x.heldIn);
    if (elsewhere.length) {
      log(`- ${acctLabel(a)}: ${elsewhere.map((x) => x.item.detail.name).join(", ")} read "Will be created" — held in ${[...new Set(elsewhere.map((x) => acctLabel(x.heldIn!)))].join(", ")}, not shared here. Share in Business Manager; never re-uploaded (0 Meta creates).`);
    }
  }
  const nx = accounts[0];
  if (nx) {
    const r = resolveTemplate(t.items, nx, known, pixelFor(nx));
    const reusedNonInterest = r.items.filter((x) => x.status === "reused" && x.item.kind !== "interest");
    log();
    log(`Reused in ${acctLabel(nx)} (not counting interests): ${reusedNonInterest.map((x) => x.item.detail.name ?? x.item.listRole ?? x.item.pageId).join(", ") || "none"}`);
  }
  log();
}

log(`## Meta calls`);
log();
log(`Meta calls made by this dry run: ${metaCalls}, all GET /act_{id}/customaudiences (${listings.map((l) => `${acctLabel(l.accountId)} ${l.requests}`).join(", ")}). Refused: ${metaRefused}. No write, share or upload.`);
log(`Meta creates the "Will be created" items would need with OFFPIXEL_META_AUDIENCE_WRITES_ENABLED on, per account: ${accounts
  .map((a) => `${acctLabel(a)} ${totals.filter((x) => x.account === a).reduce((s, x) => s + x.metaCreates, 0)}`)
  .join(" · ")}. Reused items need none.`);
log();

if (!APPLY) {
  log(`Dry run: nothing written. Matas confirms, then --apply --confirmed.`);
  console.log(out.join("\n"));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ proposals, totals, placements, registerRows, metaCalls }, null, 2));
  process.exit(0);
}

// ── Apply (only after Matas confirms) ──────────────────────────────────────
const now = new Date().toISOString();
if (registerRows.length) {
  const reg = await db.from("meta_custom_audiences").insert(registerRows);
  if (reg.error) throw new Error(`meta_custom_audiences: ${reg.error.message}`);
  log(`Registered ${registerRows.length} customer lists as meta_custom_audiences rows`);
}
for (const p of proposals) {
  const { template, items } = templateRows(p.template, USER, CONFIRMED ? { by: USER, at: now } : null);
  const up = await db.from("audience_templates").upsert(template, { onConflict: "user_id,business_id,name" }).select("id").single();
  if (up.error) throw new Error(`audience_templates ${p.template.name}: ${up.error.message}`);
  const id = String((up.data as Row).id);
  const rows = items.map((r) => ({ ...r, template_id: id }));
  const ins = await db.from("audience_template_items").upsert(rows, {
    onConflict: "template_id,kind,list_role,family_key,page_id,retention_days,interest_id",
    ignoreDuplicates: true,
  });
  if (ins.error) throw new Error(`audience_template_items ${p.template.name}: ${ins.error.message}`);
  log(`Wrote ${p.template.name} (${id}): ${rows.length} items${CONFIRMED ? ", confirmed" : ", not confirmed"}`);
}
console.log(out.join("\n"));
