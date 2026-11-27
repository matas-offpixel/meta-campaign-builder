/**
 * Replicate to event (R1; design record 2026-11-24-campaign-creator-replicate,
 * RC2). A pure function: no I/O, no clock unless one is passed.
 *
 * Duplicate re-derives only the event, the code and the `[CODE]` prefix
 * (lib/campaign-event.ts). Replicate re-derives everything that belongs to the
 * event from the TARGET, never the source:
 *   - event, client, code, `[CODE]` name prefix;
 *   - ad account: the event's override, else the venue's;
 *   - pixel: the event's override, else the venue's;
 *   - every ad's link: the event's signup page, with the source's UTM tags;
 *   - dates: start now, end at the same phase of the target event;
 *   - audiences: by role in the target account, never by id.
 * It keeps the structure: objective, ad sets, budgets, placements, interests,
 * and the Facebook page / Instagram (which the dialog asks about).
 *
 * `changes[]` is RC2's "Changes to match {code}" list, in its order, one row
 * per field that changed. Each row carries its word key, its fill-ins and the
 * rendered text the dialog shows. A venue with no stored account or pixel
 * gives an amber "not set, check" row and an empty field: the source's value
 * is never carried over, and the launch checks block the launch.
 *
 * Copy (RC2's "Copy" row) is R8's caption templates and isn't re-rendered
 * here: the source's captions are kept, so no Copy row is listed.
 */

import { applyEventToCampaignSettings } from "../campaign-event.ts";
import { normalizeAdAccountId } from "../meta/ad-account.ts";
import type { CampaignDraft, CustomAudienceGroup, PageAudienceGroup } from "../types.ts";
import { applyEventEndToDraft, DEFAULT_SCHEDULE_TIMEZONE, type EndDatePhase } from "../wizard/event-end-date.ts";
import { zoneParts, zonedLocalToUtc } from "../time.ts";
import {
  CHANGE_LABEL,
  STAGE_LABEL,
  fillWords,
  word,
  type ReplicateWordKey,
  type WordFill,
} from "./words.ts";

// ─── Inputs ──────────────────────────────────────────────────────────────

export interface ReplicateEvent {
  id: string;
  event_code?: string | null;
  client_id?: string | null;
  name?: string | null;
  venue_name?: string | null;
  venue_city?: string | null;
  event_date?: string | null;
  presale_at?: string | null;
  general_sale_at?: string | null;
  signup_url?: string | null;
  /** Event override (migration 172). */
  meta_ad_account_id?: string | null;
  /** Event override (migration 266). */
  meta_pixel_id?: string | null;
}

export interface ReplicateVenue {
  id: string;
  name: string;
  meta_ad_account_id?: string | null;
  meta_pixel_id?: string | null;
}

/** Overrides that win over the event's own columns (e.g. a value picked in the dialog). */
export interface ReplicateEventOverrides {
  metaAdAccountId?: string | null;
  metaPixelId?: string | null;
}

export interface ReplicateTarget {
  event: ReplicateEvent;
  venue: ReplicateVenue | null;
  eventOverrides?: ReplicateEventOverrides;
}

/** A meta_custom_audiences row, as much of it as the role needs. */
export interface AudienceRoleRow {
  meta_audience_id: string | null;
  meta_ad_account_id: string;
  funnel_stage: string;
  audience_subtype: string;
  retention_days: number | null;
  source_id: string | null;
  list_role?: string | null;
  event_id?: string | null;
  status?: string | null;
  name?: string | null;
}

export interface ReplicateContext {
  /** The source draft's own event: the "(was …)" side of Event, and the source of event-bound audiences. */
  sourceEvent?: ReplicateEvent | null;
  /** The source draft's venue, for "(was …)" only. */
  sourceVenue?: ReplicateVenue | null;
  /**
   * meta_custom_audiences rows: those behind the source draft's audience ids
   * (any account) and every row in the target ad account. One list; each row
   * says its own account.
   */
  audienceRows?: AudienceRoleRow[];
  /** Ad account names by `act_…` id (bm_ad_accounts.name). Missing → the id. */
  accountNames?: Record<string, string>;
  /** Facebook page names by page id (bm_pages.page_name). Missing → the id. */
  pageNames?: Record<string, string>;
  /** The clock: start date, "replicated at". */
  now: Date;
  /** The new draft's id. */
  id: string;
}

// ─── Outputs ─────────────────────────────────────────────────────────────

export type ReplicateField = "event" | "name" | "account" | "pixel" | "link" | "dates" | "audiences";

export interface ReplicateChange {
  field: ReplicateField;
  /** RC2's row label (replicate.change.labels). */
  label: string;
  /** The word the value is rendered from; null when the value is the draft's own (the Name row). */
  key: ReplicateWordKey | null;
  /** The fill-ins of `key`. A list fills a name that `key` uses more than once, in order. */
  fill: WordFill;
  /** "change" is a re-derived value; "not_set" is amber: the venue has no value. */
  tone: "change" | "not_set";
  /** The new value as shown. */
  value: string;
  /** "(was {old})", or null when there's nothing to show. */
  was: string | null;
  /** `value` then `was`, as one line. */
  text: string;
  /** Raw values, for the UI and the tests. */
  from: string | null;
  to: string | null;
}

export interface ReplicatePageQuestion {
  pageId: string;
  page: string;
  /** "Ads run from {page}: keep or change" */
  question: string;
  /** "Keep {page}" */
  keep: string;
  /** "Change" */
  change: string;
  /** Ads that run from this page. */
  ads: number;
}

export interface ReplicateAudienceOutcome {
  /** Source audience id → the same role's audience in the target account. */
  found: Array<{ sourceId: string; targetId: string; role: string }>;
  /** Source audiences whose role has no audience in the target account yet. */
  toCreate: Array<{ sourceId: string; role: string; row: AudienceRoleRow }>;
  /** Audiences with no meta_custom_audiences row: no role to map by. Left out of targeting. */
  unmapped: string[];
}

export interface ReplicateProvenance {
  sourceDraftId: string;
  sourceName: string;
  sourceEventId: string | null;
  at: string;
  /** Roles the target account doesn't have yet (RC2: "{m} will be created"). */
  audiencesToCreate: Array<{ sourceId: string; role: string }>;
}

export type ReplicatedDraft = CampaignDraft & { replicatedFrom: ReplicateProvenance };

export interface ReplicateResult {
  draft: ReplicatedDraft;
  /** RC2's change rows, in order. */
  changes: ReplicateChange[];
  /** "Replicate {source name} to {target code}" */
  title: string;
  /** "Changes to match {code}" */
  changesTitle: string;
  /** "Kept from the source" */
  keptTitle: string;
  /** "Objective, {n} ad sets, budgets, placements, interests, ad copy." (RC13; one form for 1 ad set) */
  kept: string;
  /** One boxed question per page the ads run from. */
  pages: ReplicatePageQuestion[];
  audiences: ReplicateAudienceOutcome;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function account(value: string | null | undefined): string | null {
  return normalizeAdAccountId(clean(value) || null);
}

function pixel(value: string | null | undefined): string | null {
  const v = clean(value);
  return /^\d+$/.test(v) ? v : null;
}

/**
 * An ad account as the dialog names it (ruling 1, 24 Nov): Meta's name
 * (bm_ad_accounts.name, else the id), then the venue in brackets when known.
 * "NX Promoter (NX Newcastle)".
 */
export function accountDisplay(name: string, venue: string | null | undefined): string {
  const at = clean(venue);
  return at ? fillWords(ACCOUNT_NAMED, { "Meta account name": name, venue: at }) : name;
}

/** replicate.change.account after its label: "{Meta account name} ({venue})". */
const ACCOUNT_NAMED = word("replicate.change.account").slice(word("replicate.change.account").indexOf("{"));

export function lastFour(id: string): string {
  return id.slice(-4);
}

function wasText(old: string | null | undefined): string | null {
  const v = clean(old);
  return v ? fillWords(word("replicate.change.was"), { old: v }) : null;
}

function row(input: Omit<ReplicateChange, "text">): ReplicateChange {
  return { ...input, text: input.was ? `${input.value} ${input.was}` : input.value };
}

function notSet(field: ReplicateField, label: string, place: string, from: string | null): ReplicateChange {
  const fill = { Field: label, venue: place };
  return row({
    field,
    label,
    key: "replicate.change.not_set",
    fill,
    tone: "not_set",
    value: fillWords(word("replicate.change.not_set"), fill),
    was: null,
    from,
    to: null,
  });
}

/** A link as the dialog shows it: no scheme, no query, no trailing slash. */
export function displayUrl(url: string | null | undefined): string {
  const v = clean(url);
  if (!v) return "";
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.host.replace(/^www\./, "")}${path}`;
  } catch {
    return v.replace(/^[a-z]+:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function cirqlinSlug(url: string | null | undefined): string | null {
  try {
    const u = new URL(clean(url));
    const m = u.pathname.match(/^\/l\/([^/]+)/);
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

function replaceAllInsensitive(value: string, find: string, replace: string): string {
  if (!find) return value;
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), (hit) =>
    hit === hit.toLowerCase() ? replace.toLowerCase() : hit === hit.toUpperCase() ? replace.toUpperCase() : replace,
  );
}

/**
 * The target's link with the source link's UTM tags. A tag value that names
 * the source event (its code or CIRQLIN slug) names the target instead. The
 * target URL's own query wins over a source tag of the same name.
 */
export function rebaseLink(
  sourceUrl: string | null | undefined,
  targetUrl: string,
  swap: { fromCode: string; toCode: string; fromSlug: string | null; toSlug: string | null },
): string {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return targetUrl;
  }
  let source: URL | null = null;
  try {
    source = sourceUrl ? new URL(clean(sourceUrl)) : null;
  } catch {
    source = null;
  }
  if (!source) return target.toString();
  for (const [key, raw] of source.searchParams) {
    if (!/^utm_/i.test(key) || target.searchParams.has(key)) continue;
    let value = replaceAllInsensitive(raw, swap.fromCode, swap.toCode);
    if (swap.fromSlug && swap.toSlug) value = replaceAllInsensitive(value, swap.fromSlug, swap.toSlug);
    target.searchParams.append(key, value);
  }
  return target.toString();
}

function formatDay(local: string, timezone: string): string {
  const instant = zonedLocalToUtc(local.slice(0, 16), timezone);
  if (!instant) return local.slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(instant)
    .replace(",", "");
}

/** The record's form for a moment: "Tue 24 Nov, 16:40". */
function formatMoment(local: string, timezone: string): string {
  const time = local.slice(11, 16);
  return time ? `${formatDay(local, timezone)}, ${time}` : formatDay(local, timezone);
}

/**
 * RC2's Dates row. An end at a stage's moment (presale, general sale) names
 * the stage: "Starts Thu 26 Nov · ends at On sale". An end at 23:59 names the
 * day: "… · ends Sat 6 Mar". Any other end names the day and time:
 * "… · ends Tue 1 Dec, 18:00". No end: "… · no end date".
 */
export function datesValue(input: {
  start: string;
  end: string;
  phase: EndDatePhase | null;
  timezone: string;
}): { key: ReplicateWordKey; fill: WordFill; value: string } {
  const start = input.start ? formatDay(input.start, input.timezone) : "";
  const stage =
    input.phase === "presale" ? STAGE_LABEL.presale : input.phase === "general_sale" ? STAGE_LABEL.on_sale : null;
  const [key, fill]: [ReplicateWordKey, WordFill] = !input.end
    ? ["replicate.change.dates.open", { date: start }]
    : stage
      ? ["replicate.change.dates", { date: start, stage }]
      : input.end.slice(11, 16) === "23:59"
        ? ["replicate.change.dates.day", { date: [start, formatDay(input.end, input.timezone)] }]
        : ["replicate.change.dates.time", { date: start, "date, time": formatMoment(input.end, input.timezone) }];
  return { key, fill, value: fillWords(word(key), fill) };
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** Ads per creative: one per enabled ad set it's assigned to. A draft with no assignments counts one each. */
function adsPerCreative(draft: CampaignDraft): Map<string, number> {
  const enabled = new Set(draft.adSetSuggestions.filter((s) => s.enabled).map((s) => s.id));
  const counts = new Map<string, number>();
  for (const [adSetId, creativeIds] of Object.entries(draft.creativeAssignments ?? {})) {
    if (!enabled.has(adSetId)) continue;
    for (const id of creativeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) for (const c of draft.creatives) counts.set(c.id, 1);
  return counts;
}

// ─── Audiences by role ───────────────────────────────────────────────────

const PIXEL_SUBTYPE = "website_pixel";
const LIST_SUBTYPE = "customer_list";

function roleOf(
  r: AudienceRoleRow,
  side: { pixelId: string | null; eventId: string | null },
): string {
  const ref =
    r.audience_subtype === LIST_SUBTYPE
      ? ""
      : r.audience_subtype === PIXEL_SUBTYPE
        ? clean(r.source_id) === clean(side.pixelId)
          ? "pixel"
          : `pixel:${clean(r.source_id)}`
        : clean(r.source_id);
  const event = r.event_id ? (r.event_id === side.eventId ? "this event" : `event:${r.event_id}`) : "";
  return [r.audience_subtype, r.funnel_stage, r.retention_days ?? "", r.list_role ?? "", ref, event].join("|");
}

function usable(r: AudienceRoleRow): boolean {
  return Boolean(r.meta_audience_id) && r.status !== "failed" && r.status !== "archived";
}

interface AudienceMap {
  outcome: ReplicateAudienceOutcome;
  /** Source id → target id, or null when it waits to be created / has no role. */
  map: Map<string, string | null>;
}

function mapAudiences(
  ids: string[],
  rows: AudienceRoleRow[],
  source: { account: string | null; pixelId: string | null; eventId: string | null },
  target: { account: string | null; pixelId: string | null; eventId: string | null },
): AudienceMap {
  const outcome: ReplicateAudienceOutcome = { found: [], toCreate: [], unmapped: [] };
  const map = new Map<string, string | null>();
  const byId = new Map<string, AudienceRoleRow>();
  for (const r of rows) if (r.meta_audience_id) byId.set(r.meta_audience_id, r);
  const targetByRole = new Map<string, AudienceRoleRow>();
  for (const r of rows) {
    if (!usable(r) || account(r.meta_ad_account_id) !== target.account) continue;
    const role = roleOf(r, target);
    if (!targetByRole.has(role)) targetByRole.set(role, r);
  }
  for (const id of ids) {
    if (map.has(id)) continue;
    const src = byId.get(id);
    if (!src) {
      // No row, no role. Same account and same event: it's still the right audience.
      const sameAccount = source.account && source.account === target.account;
      map.set(id, sameAccount ? id : null);
      if (!sameAccount) outcome.unmapped.push(id);
      continue;
    }
    const role = roleOf(src, source);
    const hit = targetByRole.get(role);
    if (hit?.meta_audience_id) {
      map.set(id, hit.meta_audience_id);
      outcome.found.push({ sourceId: id, targetId: hit.meta_audience_id, role });
    } else {
      map.set(id, null);
      outcome.toCreate.push({ sourceId: id, role, row: src });
    }
  }
  return { outcome, map };
}

function remapIds(ids: string[] | undefined, map: Map<string, string | null>): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const next = map.has(id) ? map.get(id) : id;
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}

/** Every custom audience id the draft targets: the ids mapped by role. */
export function draftAudienceIds(draft: CampaignDraft): string[] {
  const a = draft.audiences;
  return [
    ...a.customAudienceGroups.flatMap((g) => g.audienceIds),
    ...a.pageGroups.flatMap((g) => g.customAudienceIds ?? []),
    ...(a.offpixelCustomAudienceIds ?? []),
    ...(a.savedAudiences?.audienceIds ?? []),
  ];
}

/** Launch artefacts of the source account: the launch makes them again in the target. */
function clearPageGroupLaunchIds(g: PageAudienceGroup): PageAudienceGroup {
  return {
    ...g,
    engagementAudienceIds: undefined,
    engagementAudiencesByType: undefined,
    engagementAudienceStatuses: undefined,
    lookalikeAudienceIds: undefined,
  };
}

function remapCustomGroup(g: CustomAudienceGroup, map: Map<string, string | null>): CustomAudienceGroup {
  const audienceIds = remapIds(g.audienceIds, map);
  const names: Record<string, string> = {};
  for (const id of g.audienceIds) {
    const next = map.has(id) ? map.get(id) : id;
    if (next && g.audienceNames?.[id]) names[next] = g.audienceNames[id]!;
  }
  return {
    ...g,
    audienceIds,
    audienceNames: Object.keys(names).length ? names : undefined,
    foreignAccountById: undefined,
    populatingAudienceIds: remapIds(g.populatingAudienceIds, map),
    lookalikeAudienceIdsByRange: undefined,
  };
}

// ─── The replicate ───────────────────────────────────────────────────────

export function replicateDraft(
  source: CampaignDraft,
  target: ReplicateTarget,
  context: ReplicateContext,
): ReplicateResult {
  const { event, venue } = target;
  const overrides = target.eventOverrides ?? {};
  const sourceEvent = context.sourceEvent ?? null;
  const accountNames = context.accountNames ?? {};
  const pageNames = context.pageNames ?? {};
  const code = clean(event.event_code);
  const place = clean(venue?.name) || clean(event.venue_name) || code;
  const changes: ReplicateChange[] = [];

  // Event, client, code, name. replaceEventCodePrefix swaps the name's [CODE]
  // only when the stored campaignCode agrees with it, and a draft can store a
  // short code ("DOD") under a name written for its event ("[NX26-DOD] DOD -
  // On sale"); the copy then kept the source's code (#1372). The name was
  // written for the source event, so its code is the current one. A
  // hand-written prefix that isn't the source event's code is still kept.
  const sourceCode = clean(sourceEvent?.event_code) || clean(source.settings.campaignCode);
  const named = applyEventToCampaignSettings(
    { ...source.settings, campaignCode: sourceCode || source.settings.campaignCode },
    { id: event.id, event_code: event.event_code, client_id: event.client_id },
  );
  // A target with no code keeps the stored code, as applyEventToCampaignSettings does.
  const settings = code ? named : { ...named, campaignCode: source.settings.campaignCode };
  if ((source.settings.eventId ?? "") !== event.id) {
    const fill = { code, venue: place };
    changes.push(
      row({
        field: "event",
        label: CHANGE_LABEL.event,
        key: "replicate.change.event",
        fill,
        tone: "change",
        value: fillWords(word("replicate.change.event"), fill),
        was: wasText(sourceCode),
        from: source.settings.eventId ?? null,
        to: event.id,
      }),
    );
  }
  if (settings.campaignName !== source.settings.campaignName) {
    changes.push(
      row({
        field: "name",
        label: CHANGE_LABEL.name,
        key: null,
        fill: {},
        tone: "change",
        value: settings.campaignName,
        was: wasText(source.settings.campaignName),
        from: source.settings.campaignName,
        to: settings.campaignName,
      }),
    );
  }

  // Ad account: the event's override, else the venue's. Never the source's.
  const fromAccount = account(source.settings.metaAdAccountId || source.settings.adAccountId);
  const toAccount = account(overrides.metaAdAccountId) ?? account(event.meta_ad_account_id) ?? account(venue?.meta_ad_account_id);
  // Ruling 1 (24 Nov): Meta's account name, then the venue in brackets.
  const targetPlace = clean(venue?.name) || clean(event.venue_name);
  const sourcePlace = clean(context.sourceVenue?.name) || clean(sourceEvent?.venue_name);
  const accountName = (id: string | null, at: string) => (id ? accountDisplay(accountNames[id] ?? id, at) : "");
  settings.adAccountId = toAccount ?? "";
  settings.metaAdAccountId = toAccount ?? undefined;
  if (!toAccount) {
    changes.push(notSet("account", CHANGE_LABEL.account, place, fromAccount));
  } else if (toAccount !== fromAccount) {
    const name = accountNames[toAccount] ?? toAccount;
    const fill = { "Meta account name": name, venue: targetPlace };
    changes.push(
      row({
        field: "account",
        label: CHANGE_LABEL.account,
        key: "replicate.change.account",
        fill,
        tone: "change",
        // With no venue name the brackets go: "Account: NX Promoter".
        value: fillWords(targetPlace ? word("replicate.change.account") : word("replicate.change.account").replace(" ({venue})", ""), fill),
        was: wasText(accountName(fromAccount, sourcePlace)),
        from: fromAccount,
        to: toAccount,
      }),
    );
  }

  // Pixel: the event's override, else the venue's.
  const fromPixel = pixel(source.settings.metaPixelId || source.settings.pixelId);
  const toPixel = pixel(overrides.metaPixelId) ?? pixel(event.meta_pixel_id) ?? pixel(venue?.meta_pixel_id);
  settings.pixelId = toPixel ?? "";
  settings.metaPixelId = toPixel ?? undefined;
  if (!toPixel) {
    changes.push(notSet("pixel", CHANGE_LABEL.pixel, place, fromPixel));
  } else if (toPixel !== fromPixel) {
    const fill = { "last 4": lastFour(toPixel) };
    changes.push(
      row({
        field: "pixel",
        label: CHANGE_LABEL.pixel,
        key: "replicate.change.pixel",
        fill,
        tone: "change",
        value: fillWords(word("replicate.change.pixel"), fill),
        was: fromPixel ? wasText(`…${lastFour(fromPixel)}`) : null,
        from: fromPixel,
        to: toPixel,
      }),
    );
  }

  // A replicate is a new campaign in the target account: the source's attach
  // targets and Meta objects are the source's, never the target's.
  settings.wizardMode = "new";
  settings.attachSubmodePending = undefined;
  settings.existingMetaCampaign = undefined;
  settings.existingMetaCampaigns = undefined;
  settings.existingMetaAdSet = undefined;
  settings.existingMetaAdSets = undefined;

  // Links: every ad goes to the event's signup page, with the source's UTM tags.
  const signupUrl = clean(event.signup_url);
  const perCreative = adsPerCreative(source);
  const swap = {
    fromCode: sourceCode,
    toCode: code,
    fromSlug: cirqlinSlug(sourceEvent?.signup_url),
    toSlug: cirqlinSlug(signupUrl),
  };
  const linkedAds = source.creatives.filter((c) => c.sourceType !== "existing_post");
  let changedAds = 0;
  const sourceLinks: string[] = [];
  const creatives = source.creatives.map((c) => {
    const reset = { ...c, metaCreativeId: undefined, metaAdIds: undefined, importedMeta: undefined };
    if (c.sourceType === "existing_post") return reset;
    const next = signupUrl ? rebaseLink(c.destinationUrl, signupUrl, swap) : "";
    if (displayUrl(next) !== displayUrl(c.destinationUrl) || !signupUrl) {
      changedAds += perCreative.get(c.id) ?? 0;
      if (clean(c.destinationUrl)) sourceLinks.push(displayUrl(c.destinationUrl));
    }
    return { ...reset, destinationUrl: next };
  });
  if (linkedAds.length && !signupUrl) {
    changes.push(notSet("link", CHANGE_LABEL.link, code || place, mostCommon(sourceLinks)));
  } else if (changedAds > 0) {
    const fill = { url: displayUrl(signupUrl), n: changedAds };
    const key = changedAds === 1 ? "replicate.change.link.one" : "replicate.change.link";
    changes.push(
      row({
        field: "link",
        label: CHANGE_LABEL.link,
        key,
        fill,
        tone: "change",
        value: fillWords(word(key), fill),
        was: wasText(mostCommon(sourceLinks)),
        from: mostCommon(sourceLinks),
        to: signupUrl,
      }),
    );
  }

  // Dates: start now, end at the same phase of the target event.
  const timezone = source.budgetSchedule.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const reset: CampaignDraft = {
    ...source,
    budgetSchedule: {
      ...source.budgetSchedule,
      startDateSource: "event",
      endDateSource: "event",
    },
  };
  const dated = applyEventEndToDraft(reset, {
    previousEventDate: sourceEvent?.event_date ?? null,
    nextEventDate: event.event_date ?? null,
    nextPresaleAt: event.presale_at ?? null,
    nextGeneralSaleAt: event.general_sale_at ?? null,
    now: context.now,
    refreshStart: true,
    eventChanged: true,
  }).budgetSchedule;
  const fromStart = clean(source.budgetSchedule.startDate);
  const toStart = clean(dated.startDate);
  if (toStart !== fromStart || clean(dated.endDate) !== clean(source.budgetSchedule.endDate)) {
    const { key, fill, value } = datesValue({
      start: toStart,
      end: clean(dated.endDate),
      phase: dated.endDatePhase ?? null,
      timezone,
    });
    changes.push(
      row({
        field: "dates",
        label: CHANGE_LABEL.dates,
        key,
        fill,
        tone: "change",
        value,
        was: fromStart ? wasText(formatDay(fromStart, timezone)) : null,
        from: fromStart || null,
        to: toStart || null,
      }),
    );
  }

  // Audiences by role in the target account.
  const ids = draftAudienceIds(source);
  const { outcome, map } = mapAudiences(
    ids,
    context.audienceRows ?? [],
    { account: fromAccount, pixelId: fromPixel, eventId: source.settings.eventId ?? sourceEvent?.id ?? null },
    { account: toAccount, pixelId: toPixel, eventId: event.id },
  );
  const accountChanged = fromAccount !== toAccount;
  const remapped = outcome.found.some((f) => f.sourceId !== f.targetId) || outcome.toCreate.length > 0;
  const audiences = {
    ...source.audiences,
    customAudienceGroups: source.audiences.customAudienceGroups.map((g) => remapCustomGroup(g, map)),
    pageGroups: source.audiences.pageGroups.map((g) => {
      const next = { ...g, customAudienceIds: remapIds(g.customAudienceIds, map) };
      return accountChanged ? clearPageGroupLaunchIds(next) : next;
    }),
    offpixelCustomAudienceIds: source.audiences.offpixelCustomAudienceIds
      ? remapIds(source.audiences.offpixelCustomAudienceIds, map)
      : undefined,
    savedAudiences: { audienceIds: remapIds(source.audiences.savedAudiences?.audienceIds, map) },
    selectedPagesLookalikeGroups: (source.audiences.selectedPagesLookalikeGroups ?? []).map((g) =>
      accountChanged
        ? { ...g, engagementAudienceIdsByPage: undefined, lookalikeAudienceIdsByRange: undefined, skippedPageIds: undefined, skippedReasons: undefined }
        : g,
    ),
  };
  if (ids.length && toAccount && (accountChanged || remapped)) {
    const fill = { n: outcome.found.length, account: accountName(toAccount, targetPlace), m: outcome.toCreate.length };
    changes.push(
      row({
        field: "audiences",
        label: CHANGE_LABEL.audiences,
        key: "replicate.change.audiences",
        fill,
        tone: "change",
        value: fillWords(word("replicate.change.audiences"), fill),
        was: null,
        from: fromAccount,
        to: toAccount,
      }),
    );
  }

  // Pages: kept, and asked about.
  const byPage = new Map<string, number>();
  for (const c of source.creatives) {
    const pageId = clean(c.identity?.pageId);
    if (pageId) byPage.set(pageId, (byPage.get(pageId) ?? 0) + (perCreative.get(c.id) ?? 0));
  }
  const pages: ReplicatePageQuestion[] = [...byPage].map(([pageId, ads]) => {
    const page = pageNames[pageId] ?? pageId;
    return {
      pageId,
      page,
      question: fillWords(word("replicate.page.question"), { page }),
      keep: fillWords(word("replicate.page.keep"), { page }),
      change: word("replicate.page.change"),
      ads,
    };
  });

  const at = context.now.toISOString();
  // A template's picked videos are the source show's own (record
  // 2026-11-25-signups-into-meta; Matas, 25 Nov): the copy never carries them.
  const copied: CampaignDraft = { ...source };
  delete copied.templateVideoPicks;
  const draft: ReplicatedDraft = {
    ...copied,
    id: context.id,
    settings,
    audiences,
    creatives,
    budgetSchedule: dated,
    status: "draft",
    metaCampaignId: undefined,
    launchSummary: undefined,
    importMeta: undefined,
    createdAt: at,
    updatedAt: at,
    replicatedFrom: {
      sourceDraftId: source.id,
      sourceName: source.settings.campaignName,
      sourceEventId: source.settings.eventId ?? sourceEvent?.id ?? null,
      at,
      audiencesToCreate: outcome.toCreate.map(({ sourceId, role }) => ({ sourceId, role })),
    },
  };

  const adSets = source.adSetSuggestions.filter((s) => s.enabled).length;
  return {
    draft,
    changes,
    title: fillWords(word("replicate.summary.title"), {
      "source name": source.settings.campaignName,
      "target code": code,
    }),
    changesTitle: fillWords(word("replicate.summary.changes"), { code }),
    keptTitle: word("replicate.kept.title"),
    // RC13 (#1366): copy isn't rewritten until R8, so the kept line names the ad copy.
    kept: fillWords(word(adSets === 1 ? "replicate.kept.line.copy.one" : "replicate.kept.line.copy"), { n: adSets }),
    pages,
    audiences: outcome,
  };
}

/** RC2's "Replicated from {source name}, {date}. Launch runs the checks first." */
export function replicatedDraftLine(
  provenance: ReplicateProvenance,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): string {
  const parts = zoneParts(new Date(provenance.at), timezone);
  return fillWords(word("replicate.draft.line"), {
    "source name": provenance.sourceName,
    date: formatDay(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`, timezone),
  });
}
