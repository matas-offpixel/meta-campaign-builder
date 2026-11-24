import {
  codesDisagree,
  isReplaceableEventCodePrefix,
  replaceEventCodePrefix,
} from "../campaign-event.ts";
import { parseBracketedEventCode } from "../insights/meta-event-code-match.ts";
import type { CampaignDraft } from "../types.ts";

import {
  buildReferenceTerms,
  displayLink,
  linkKey,
  signupSlug,
  textHasTerm,
  type ReferenceTerm,
} from "./references.ts";
import type {
  GuardEvent,
  GuardField,
  GuardFinding,
  KeptLink,
  LaunchCheck,
  LaunchCheckFix,
  LaunchGuardResult,
  VenueDefault,
  VenueDefaults,
} from "./types.ts";
import { accountDigits, venueKeyOf } from "./venue-defaults.ts";
import { LAUNCH_GUARD_WORDS as W } from "./words.ts";

/**
 * The pre-launch check (brief R4; record RC3). Pure: the caller loads the
 * event, the venue defaults (`loadVenueDefaults`) and the client's other
 * shows (`loadLaunchGuardContext`). Six checks, run in this order:
 * pixel, account, another show, name, artist caption, link. Blockers come
 * first in that order, then the link warning.
 */
export function checkLaunchReferences(
  draft: CampaignDraft,
  event: GuardEvent | null,
  venueDefaults: VenueDefaults,
  otherEvents: readonly GuardEvent[],
): LaunchGuardResult {
  if (!event) return { checks: [], blockers: 0, warnings: 0, eventCode: null };
  const code = event.code ?? event.name ?? "";
  const checks: LaunchCheck[] = [
    ...checkVenueNotSet(event, venueDefaults),
    ...checkPixel(draft, event, code, venueDefaults),
    ...checkAccount(draft, event, code, venueDefaults),
    ...checkOtherShows(draft, event, venueDefaults, otherEvents),
    ...checkNameCode(draft, event),
    ...checkArtistCaptions(draft, event),
    ...checkLink(draft, event),
  ];
  const ordered = [
    ...checks.filter((check) => check.severity === "blocker"),
    ...checks.filter((check) => check.severity === "warning"),
  ];
  return {
    checks: ordered,
    blockers: ordered.filter((check) => check.severity === "blocker").length,
    warnings: ordered.filter((check) => check.severity === "warning").length,
    eventCode: event.code,
  };
}

// ── words ──────────────────────────────────────────────────────────────

/** Replaces `{name}` placeholders. A value not given leaves the brace as is. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/**
 * A row of the word list by key, or null while the TSV doesn't have it yet.
 * Ops' rulings of 24 Nov (#1359 amendment) add one-ad rows (`{key}.one`)
 * and the venue-missing rows; their text comes only from the re-exported
 * TSV, never from here.
 */
export function word(key: string): string | null {
  return (W as Record<string, string>)[key] ?? null;
}

/** The one-ad row when n is 1 and the list has it, else the row itself. */
export function byCount(key: keyof typeof W, n: number): string {
  return (n === 1 ? word(`${key}.one`) : null) ?? W[key];
}

const last4 = (id: string) => id.slice(-4);

/** Up to four names, then "… and {n} more". */
export function listNames(names: readonly string[], max = 4): string {
  const unique = [...new Set(names.filter(Boolean))];
  const shown = unique.slice(0, max).join(", ");
  const rest = unique.length - max;
  return rest > 0 ? `${shown} ${fill(W["launch.evidence.more"], { n: rest })}` : shown;
}

export function countLine(result: Pick<LaunchGuardResult, "blockers" | "warnings">): string[] {
  const lines: string[] = [];
  if (result.blockers > 0) lines.push(fill(W["launch.count.fix"], { n: result.blockers }));
  if (result.warnings > 0) lines.push(fill(W["launch.count.check"], { n: result.warnings }));
  if (lines.length === 0) lines.push(W["launch.count.clean"]);
  return lines;
}

export function cleanLine(code: string | null): string {
  return fill(W["launch.clean.line"], { code: code ?? "" });
}

/** "Launch · {n} to fix" while a blocker is left, else null (the button keeps its own label). */
export function blockedLaunchLabel(blockers: number): string | null {
  return blockers > 0 ? fill(W["launch.button.blocked"], { n: blockers }) : null;
}

// ── 0. venue not set (warning) ─────────────────────────────────────────

/** The venue-missing rows (ops' ruling 4). The key names follow the re-exported TSV. */
export const VENUE_NOT_SET_KEY = "venue_not_set";

/**
 * The event's venue has no ad account or no pixel stored (and the event sets
 * none of its own), so the pixel or account check can't run on it. A
 * warning, never a blocker, until every venue is seeded (ops' ruling 4).
 */
function checkVenueNotSet(event: GuardEvent, venue: VenueDefaults): LaunchCheck[] {
  const account = venue.eventVenue?.adAccountId ?? venue.override.adAccountId;
  const pixel = venue.eventVenue?.pixelId ?? venue.override.pixelId;
  if (account && pixel) return [];
  const name = venue.eventVenue?.name ?? event.venueName ?? event.code ?? "";
  return [
    {
      key: "venue_not_set",
      severity: "warning",
      label: word(`${VENUE_NOT_SET_KEY}.key`) ?? "",
      sentence: fill(word(VENUE_NOT_SET_KEY) ?? "", { venue: name }),
      evidence: fill(word(`${VENUE_NOT_SET_KEY}.evidence`) ?? "", { venue: name }),
      fixes: [],
      findings: [
        ...(account ? [] : [{ field: "ad_account" as const, adName: null, value: "" }]),
        ...(pixel ? [] : [{ field: "pixel" as const, adName: null, value: "" }]),
      ],
    },
  ];
}

// ── 1. pixel ───────────────────────────────────────────────────────────

function launchableAdSetNames(draft: CampaignDraft): string[] {
  return (draft.adSetSuggestions ?? []).filter((set) => set.enabled).map((set) => set.name);
}

function adSetsEvidence(names: readonly string[]): string {
  const value = names.length === 1 ? names[0]! : `all ${names.length}`;
  return W["pixel_not_venue.evidence"].replace("{all n | names}", value);
}

function checkPixel(
  draft: CampaignDraft,
  event: GuardEvent,
  code: string,
  venue: VenueDefaults,
): LaunchCheck[] {
  // Attach to existing ad sets creates none, so no pixel is sent.
  if ((draft.settings.wizardMode ?? "new") === "attach_adset") return [];
  const current = (draft.settings.metaPixelId || draft.settings.pixelId || "").trim();
  const right = venue.override.pixelId ?? venue.eventVenue?.pixelId ?? null;
  if (!current || !right || current === right) return [];
  const owner = venue.venues.find((row) => row.pixelId === current) ?? null;
  const useOverrideWords = venue.override.pixelId != null || owner == null;
  const sentence = useOverrideWords
    ? fill(W["pixel_not_venue.override"], { "last 4": last4(current), code, "right last 4": last4(right) })
    : fill(W["pixel_not_venue"], {
        "last 4": last4(current),
        venue: owner!.name,
        code,
        "event venue": venue.eventVenue?.name ?? event.venueName ?? "",
        "right last 4": last4(right),
      });
  const names = launchableAdSetNames(draft);
  return [
    {
      key: "pixel_not_venue",
      severity: "blocker",
      label: W["pixel_not_venue.key"],
      sentence,
      evidence: names.length > 0 ? adSetsEvidence(names) : "",
      fixes: [
        { action: "set_pixel", label: fill(W["pixel_not_venue.fix"], { "right last 4": last4(right) }), pixelId: right },
      ],
      findings: [{ field: "pixel", adName: null, value: current }],
    },
  ];
}

// ── 2. account ─────────────────────────────────────────────────────────

function accountLabel(id: string, venues: readonly VenueDefault[]): string {
  return venues.find((row) => row.adAccountId === id)?.adAccountName ?? `…${last4(id)}`;
}

function checkAccount(
  draft: CampaignDraft,
  event: GuardEvent,
  code: string,
  venue: VenueDefaults,
): LaunchCheck[] {
  const current = accountDigits(draft.settings.metaAdAccountId || draft.settings.adAccountId);
  const venueAccount = venue.eventVenue?.adAccountId ?? null;
  const eventAccount = accountDigits(event.metaAdAccountId);
  // The event's account is "the one set for {code}" when it differs from the
  // venue's, or when the client has no venue values at all.
  const override = venue.override.adAccountId ?? (venueAccount ? null : eventAccount);
  const right = override ?? venueAccount;
  if (!current || !right || current === right) return [];
  const rightLabel = accountLabel(right, venue.venues);
  const sentence = override
    ? fill(W["account_not_venue.override"], { account: accountLabel(current, venue.venues), code, "right account": rightLabel })
    : fill(W["account_not_venue"], {
        account: accountLabel(current, venue.venues),
        "event venue": venue.eventVenue?.name ?? event.venueName ?? "",
        code,
        "right account": rightLabel,
      });
  return [
    {
      key: "account_not_venue",
      severity: "blocker",
      label: W["account_not_venue.key"],
      sentence,
      evidence: fill(W["account_not_venue.evidence"], { "campaign name": draft.settings.campaignName ?? "" }),
      fixes: [
        { action: "set_account", label: fill(W["account_not_venue.fix"], { "right account": rightLabel }), adAccountId: `act_${right}` },
      ],
      findings: [{ field: "ad_account", adName: null, value: current }],
    },
  ];
}

// ── 3. another show ────────────────────────────────────────────────────

interface ScannedText {
  field: GuardField;
  /** The ad's name, or the audience's own name for an audience. */
  adName: string;
  text: string;
}

/** Every link, primary text, headline, ad name and audience name in the draft. */
export function scanDraftTexts(draft: CampaignDraft): ScannedText[] {
  const out: ScannedText[] = [];
  for (const creative of draft.creatives ?? []) {
    const adName = creative.name || "Untitled ad";
    if (creative.destinationUrl) out.push({ field: "link", adName, text: creative.destinationUrl });
    for (const caption of creative.captions ?? []) {
      if (caption.text) out.push({ field: "primary_text", adName, text: caption.text });
    }
    if (creative.headline) out.push({ field: "headline", adName, text: creative.headline });
    if (creative.name) out.push({ field: "ad_name", adName, text: creative.name });
  }
  const audienceNames = new Set<string>();
  const a = draft.audiences;
  for (const group of a?.pageGroups ?? []) audienceNames.add(group.name);
  for (const group of a?.customAudienceGroups ?? []) {
    audienceNames.add(group.name);
    for (const name of Object.values(group.audienceNames ?? {})) audienceNames.add(name);
  }
  for (const group of a?.interestGroups ?? []) audienceNames.add(group.name);
  for (const group of a?.selectedPagesLookalikeGroups ?? []) audienceNames.add(group.name);
  for (const set of draft.adSetSuggestions ?? []) {
    if (set.enabled) audienceNames.add(set.name);
  }
  for (const name of audienceNames) {
    if (name?.trim()) out.push({ field: "audience_name", adName: name, text: name });
  }
  return out;
}

const UNIT: Record<GuardField, { one: string; many: string; evidence: string }> = {
  link: { one: "ad", many: "ads", evidence: "Links" },
  headline: { one: "headline", many: "headlines", evidence: "Headlines" },
  primary_text: { one: "primary text", many: "primary texts", evidence: "Primary text" },
  ad_name: { one: "ad name", many: "ad names", evidence: "Ad names" },
  audience_name: { one: "audience name", many: "audience names", evidence: "Audience names" },
  pixel: { one: "ad", many: "ads", evidence: "Links" },
  ad_account: { one: "ad", many: "ads", evidence: "Links" },
  campaign_name: { one: "ad", many: "ads", evidence: "Links" },
};

const FIELD_ORDER: readonly GuardField[] = ["link", "headline", "primary_text", "ad_name", "audience_name"];

function otherShowLabel(term: ReferenceTerm, target: GuardEvent, byId: Map<string, GuardEvent>): string {
  const shows = term.eventIds.map((id) => byId.get(id)).filter((show): show is GuardEvent => Boolean(show));
  if (shows.length === 1) {
    const show = shows[0]!;
    const sameName = show.name && target.name && show.name.trim().toLowerCase() === target.name.trim().toLowerCase();
    return (sameName ? show.code : show.name) ?? show.code ?? "another show";
  }
  // A venue or city several shows share: name the venue.
  return shows[0]?.venueName ?? term.value;
}

function checkOtherShows(
  draft: CampaignDraft,
  event: GuardEvent,
  venue: VenueDefaults,
  others: readonly GuardEvent[],
): LaunchCheck[] {
  const venueOf = (show: GuardEvent) => {
    const key = venueKeyOf(show.venueKey) ?? venueKeyOf(show.venueName);
    return venue.venues.find((row) => row.key === key) ?? null;
  };
  const terms = buildReferenceTerms(event, others, venueOf);
  if (terms.length === 0) return [];
  const byId = new Map(others.map((show) => [show.id, show]));
  // One finding per (term, field): the texts it was found in.
  const groups = new Map<string, { term: ReferenceTerm; field: GuardField; hits: GuardFinding[] }>();
  for (const scanned of scanDraftTexts(draft)) {
    // One term per show per text: the most specific (domain before slug before code …).
    // A term inside a value already found in this text ("Newcastle" inside
    // "paulvandyk-newcastle.com") is the same reference, not a second one.
    const claimed = new Set<string>();
    const matched: string[] = [];
    for (const term of terms) {
      // Artist page-engager audiences are reused across shows on purpose
      // (R6's audience templates): an artist's name in an audience name is
      // targeting, not a leftover. Codes, slugs, domains, venues and cities
      // in an audience name still count.
      if (scanned.field === "audience_name" && term.kind === "artist") continue;
      if (term.eventIds.every((id) => claimed.has(id))) continue;
      const lower = term.value.toLowerCase();
      if (matched.some((value) => value.includes(lower))) continue;
      if (!textHasTerm(scanned.text, term)) continue;
      for (const id of term.eventIds) claimed.add(id);
      matched.push(lower);
      const key = `${term.kind}:${term.value.toLowerCase()}|${scanned.field}`;
      const group = groups.get(key) ?? { term, field: scanned.field, hits: [] };
      group.hits.push({ field: scanned.field, adName: scanned.adName, value: term.value });
      groups.set(key, group);
    }
  }
  const sorted = [...groups.values()].sort(
    (a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) || b.hits.length - a.hits.length,
  );
  return sorted.map(({ term, field, hits }) => {
    const n = hits.length;
    const unit = UNIT[field];
    const values = {
      "other show": otherShowLabel(term, event, byId),
      value: term.value,
      n,
    };
    const sentence =
      n === 1
        ? fill(W["other_show_reference.one"], values).replace(
            "{ad | headline | primary text | ad name | audience name}",
            unit.one,
          )
        : fill(W["other_show_reference"], values).replace(
            "{ads | headlines | primary texts | ad names | audience names}",
            unit.many,
          );
    const evidence = W["other_show_reference.evidence"]
      .replace("{Links | Headlines | Primary text | Ad names | Audience names}", unit.evidence)
      .replace("{up to 4 ad names}", listNames(hits.map((hit) => hit.adName ?? "")));
    const fixLabel = fill(W["other_show_reference.fix"], { n }).replace("{ads | …}", n === 1 ? unit.one : unit.many);
    return {
      key: "other_show_reference" as const,
      severity: "blocker" as const,
      label: W["other_show_reference.key"],
      sentence,
      evidence,
      fixes: [{ action: "show_ads" as const, label: fixLabel, field }],
      findings: hits,
    };
  });
}

// ── 4. name ────────────────────────────────────────────────────────────

function checkNameCode(draft: CampaignDraft, event: GuardEvent): LaunchCheck[] {
  if ((draft.settings.wizardMode ?? "new") !== "new") return [];
  const name = draft.settings.campaignName ?? "";
  const eventCode = (event.code ?? "").trim();
  const nameCode = parseBracketedEventCode(name);
  if (!eventCode || !nameCode || !isReplaceableEventCodePrefix(nameCode)) return [];
  if (!codesDisagree(nameCode, eventCode)) return [];
  const corrected = replaceEventCodePrefix(name, eventCode);
  return [
    {
      key: "name_code_mismatch",
      severity: "blocker",
      label: W["name_code_mismatch.key"],
      sentence: fill(W["name_code_mismatch"], { "name code": nameCode, code: eventCode }),
      evidence: fill(W["name_code_mismatch.evidence"], { "campaign name": name }),
      fixes: [{ action: "rename", label: fill(W["name_code_mismatch.fix"], { "corrected name": corrected }), name: corrected }],
      findings: [{ field: "campaign_name", adName: null, value: name }],
    },
  ];
}

// ── 5. artist caption ──────────────────────────────────────────────────

/**
 * Blocks an ad whose primary text is an artist-voice caption with no
 * recorded OK from the artist's team (RC7). A stub until R8b's caption
 * approval columns exist: it returns nothing.
 *
 * TODO(R8b): read the caption approval state (voice, approved_by,
 * approved_at, channel, edited after the OK) for each creative's primary
 * text and return one check per artist, worded with
 * `renderArtistCaptionCheck`.
 */
export function checkArtistCaptions(draft: CampaignDraft, event: GuardEvent): LaunchCheck[] {
  void draft;
  void event;
  return [];
}

/** The artist-caption check's words, for R8b's detector (and the RC-C frame). */
export function renderArtistCaptionCheck(input: {
  artist: string;
  adNames: readonly string[];
  captionLabels: string;
}): LaunchCheck {
  return {
    key: "artist_caption_not_approved",
    severity: "blocker",
    label: W["artist_caption_not_approved.key"],
    sentence: fill(byCount("artist_caption_not_approved", input.adNames.length), {
      artist: input.artist,
      n: input.adNames.length,
    }),
    evidence: fill(W["artist_caption_not_approved.evidence"], { "caption labels": input.captionLabels }),
    fixes: [{ action: "open_captions", label: W["artist_caption_not_approved.fix"] }],
    findings: input.adNames.map((adName) => ({ field: "primary_text" as const, adName, value: input.captionLabels })),
  };
}

// ── 6. link (warning) ──────────────────────────────────────────────────

/** Every URL that is this event's own page: signup, ticket link, its crqln.com/l/ page. */
export function eventPageKeys(event: GuardEvent): Set<string> {
  const keys = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const key = linkKey(raw);
    if (key) keys.add(key);
  };
  add(event.signupUrl);
  add(event.ticketUrl);
  const slug = signupSlug(event);
  if (slug) add(`https://crqln.com/l/${slug}`);
  if (event.cirqlinPageSlug) add(`https://crqln.com/l/${event.cirqlinPageSlug}`);
  return keys;
}

export function keptLinksOf(draft: CampaignDraft): KeptLink[] {
  return draft.settings.launchGuard?.keptLinks ?? [];
}

function checkLink(draft: CampaignDraft, event: GuardEvent): LaunchCheck[] {
  const page = event.signupUrl || event.ticketUrl;
  if (!page) return [];
  const own = eventPageKeys(event);
  const kept = new Set(keptLinksOf(draft).map((row) => linkKey(row.url)).filter(Boolean) as string[]);
  const byLink = new Map<string, { url: string; hits: GuardFinding[] }>();
  for (const creative of draft.creatives ?? []) {
    const key = linkKey(creative.destinationUrl);
    if (!key || own.has(key) || kept.has(key)) continue;
    const group = byLink.get(key) ?? { url: creative.destinationUrl.trim(), hits: [] };
    group.hits.push({ field: "link", adName: creative.name || null, value: creative.destinationUrl });
    byLink.set(key, group);
  }
  const [useLabel, keepLabel] = W["link_not_event.fix"].split(" · ");
  return [...byLink.values()]
    .sort((a, b) => b.hits.length - a.hits.length)
    .map(({ url, hits }) => ({
      key: "link_not_event" as const,
      severity: "warning" as const,
      label: W["link_not_event.key"],
      sentence: fill(byCount("link_not_event", hits.length), {
        url: displayLink(url),
        n: hits.length,
        "signup url": displayLink(page),
      }),
      evidence: W["link_not_event.evidence"],
      fixes: [
        { action: "use_event_page" as const, label: useLabel!, from: url, to: page },
        { action: "keep_link" as const, label: keepLabel!, url },
      ],
      findings: hits,
    }));
}

// ── fixes ──────────────────────────────────────────────────────────────

/**
 * Applies a fix to the draft. "Show the n ads" and "Open captions" move
 * the operator and change nothing, so they return the draft as it was.
 */
export function applyLaunchCheckFix(
  draft: CampaignDraft,
  fix: LaunchCheckFix,
  context: { keptBy: string; now: Date },
): CampaignDraft {
  switch (fix.action) {
    case "set_pixel":
      return { ...draft, settings: { ...draft.settings, metaPixelId: fix.pixelId, pixelId: fix.pixelId } };
    case "set_account":
      return {
        ...draft,
        settings: { ...draft.settings, metaAdAccountId: fix.adAccountId, adAccountId: fix.adAccountId },
      };
    case "rename":
      return { ...draft, settings: { ...draft.settings, campaignName: fix.name } };
    case "use_event_page": {
      const from = linkKey(fix.from);
      return {
        ...draft,
        creatives: draft.creatives.map((creative) =>
          linkKey(creative.destinationUrl) === from ? { ...creative, destinationUrl: fix.to } : creative,
        ),
      };
    }
    case "keep_link":
      return keepLink(draft, fix.url, context.keptBy, context.now);
    default:
      return draft;
  }
}

/** Ruling (b): store who kept the link and when, in the draft's settings. */
export function keepLink(draft: CampaignDraft, url: string, keptBy: string, now: Date): CampaignDraft {
  const key = linkKey(url);
  const rest = keptLinksOf(draft).filter((row) => linkKey(row.url) !== key);
  return {
    ...draft,
    settings: {
      ...draft.settings,
      launchGuard: {
        ...draft.settings.launchGuard,
        keptLinks: [...rest, { url: url.trim(), keptBy, keptAt: now.toISOString() }],
      },
    },
  };
}
