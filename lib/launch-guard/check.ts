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
  IdentityOwnership,
  KeptIdentity,
  KeptLink,
  LaunchCheck,
  LaunchCheckFix,
  LaunchCheckSeverity,
  LaunchGuardResult,
  LiveIdentity,
  VenueDefault,
  VenueDefaults,
} from "./types.ts";
import { accountDigits, venueKeyOf } from "./venue-defaults.ts";
import { LAUNCH_GUARD_WORDS as W } from "./words.ts";

/**
 * The pre-launch check (brief R4; record RC3). Pure: the caller loads the
 * event, the venue defaults (`loadVenueDefaults`), the client's other
 * shows and who holds the draft's page and Instagram account
 * (`loadLaunchGuardContext`). Checks run in this order: venue not set,
 * pixel, account, another show, name, artist caption, page, Instagram,
 * link. Blockers come first in that order, then the warnings.
 */
export function checkLaunchReferences(
  draft: CampaignDraft,
  event: GuardEvent | null,
  venueDefaults: VenueDefaults,
  otherEvents: readonly GuardEvent[],
  ownership: IdentityOwnership | null = null,
  live: LiveIdentity | null = null,
): LaunchGuardResult {
  if (!event) return { checks: [], blockers: 0, warnings: 0, eventCode: null };
  const code = event.code ?? event.name ?? "";
  const otherShows = checkOtherShows(draft, event, venueDefaults, otherEvents);
  // A link already blocked as another show's isn't warned about again (RC-C).
  const blockedLinks = new Set(
    otherShows.flatMap((check) =>
      check.findings.filter((hit) => hit.field === "link").map((hit) => linkKey(hit.source ?? hit.value)),
    ).filter(Boolean) as string[],
  );
  const pageChecks = checkPageOwner(draft, event, code, ownership, live);
  // RC8a: one field, one line. A field page_other_client fires on gets no live-ads warning.
  const firedFields = new Set(
    pageChecks.flatMap((check) => check.findings.map((hit) => hit.field)).filter((f) => f === "page" || f === "instagram"),
  );
  const checks: LaunchCheck[] = [
    ...checkVenueNotSet(event, venueDefaults),
    ...checkPixel(draft, event, code, venueDefaults),
    ...checkAccount(draft, event, code, venueDefaults),
    ...otherShows,
    ...checkNameCode(draft, event),
    ...checkArtistCaptions(draft, event),
    ...pageChecks,
    ...checkIdentityNotLive(draft, live, ownership, firedFields),
    ...checkLink(draft, event, blockedLinks),
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

/** A row of the word list by key, or null when the list has none. */
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

/**
 * The event's venue has no ad account or no pixel stored (and the event sets
 * none of its own), so the pixel or account check can't run on it. A
 * warning until every venue is seeded (ops' ruling 4); RC3 makes it a
 * blocker once Brixton is seeded. Both missing reads the plain row, one
 * missing its `.account` or `.pixel` row.
 */
/**
 * venue_not_set's severity. RC3: a warning until every venue is set; flip
 * this to "blocker" once Electric Brixton is seeded (ops, 24 Nov).
 */
export const VENUE_NOT_SET_SEVERITY: LaunchCheckSeverity = "warning";

function checkVenueNotSet(event: GuardEvent, venue: VenueDefaults): LaunchCheck[] {
  const account = venue.eventVenue?.adAccountId ?? venue.override.adAccountId;
  const pixel = venue.eventVenue?.pixelId ?? venue.override.pixelId;
  if (account && pixel) return [];
  const name = venue.eventVenue?.name ?? event.venueName ?? event.code ?? "";
  const row = !account && !pixel ? W["venue_not_set"] : !account ? W["venue_not_set.account"] : W["venue_not_set.pixel"];
  return [
    {
      key: "venue_not_set",
      severity: VENUE_NOT_SET_SEVERITY,
      label: W["venue_not_set.key"],
      sentence: fill(row, { venue: name }),
      evidence: W["venue_not_set.evidence"],
      fixes: [{ action: "open_venue_card", label: W["venue_not_set.fix"], clientId: event.clientId }],
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

/** Meta's name for the account, else "…{last 4}". */
function accountLabel(id: string, venues: readonly VenueDefault[]): string {
  return venues.find((row) => row.adAccountId === id)?.adAccountName ?? `…${last4(id)}`;
}

/**
 * "{Meta account name} ({venue})": Meta's name, then our venue in brackets
 * (RC3). An account no venue holds has no venue to name, so the brackets go.
 */
function accountWithVenue(template: string, id: string, venues: readonly VenueDefault[]): string {
  const owner = venues.find((row) => row.adAccountId === id);
  const filled = fill(template, { "Meta account name": accountLabel(id, venues) });
  return owner ? fill(filled, { venue: owner.name }) : filled.replace(" ({venue})", "");
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
    ? fill(accountWithVenue(W["account_not_venue.override"], current, venue.venues), {
        code,
        "right Meta account name": rightLabel,
      })
    : fill(accountWithVenue(W["account_not_venue"], current, venue.venues), {
        "event venue": venue.eventVenue?.name ?? event.venueName ?? "",
        code,
        "right Meta account name": rightLabel,
      });
  return [
    {
      key: "account_not_venue",
      severity: "blocker",
      label: W["account_not_venue.key"],
      sentence,
      evidence: fill(W["account_not_venue.evidence"], { "campaign name": draft.settings.campaignName ?? "" }),
      fixes: [
        {
          action: "set_account",
          label: fill(W["account_not_venue.fix"], { "right Meta account name": rightLabel }),
          adAccountId: `act_${right}`,
          names: [rightLabel],
        },
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
  page: { one: "ad", many: "ads", evidence: "Links" },
  instagram: { one: "ad", many: "ads", evidence: "Links" },
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
      group.hits.push({
        field: scanned.field,
        adName: scanned.adName,
        value: term.value,
        ...(scanned.text !== term.value ? { source: scanned.text } : {}),
      });
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
    const fixLabel =
      n === 1
        ? W["other_show_reference.fix.one"].replace("{ad | headline | …}", unit.one)
        : fill(W["other_show_reference.fix"], { n }).replace("{ads | …}", unit.many);
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
      sentence: fill(W["name_code_mismatch"], { "full code in the name": nameCode, "full event code": eventCode }),
      evidence: fill(W["name_code_mismatch.evidence"], { "campaign name": name }),
      fixes: [
        {
          action: "rename",
          label: fill(W["name_code_mismatch.fix"], { "corrected name": corrected }),
          name: corrected,
          names: [corrected],
        },
      ],
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

// ── 6. page and Instagram ──────────────────────────────────────────────

interface IdentityUse {
  /** Set on the draft's settings, so every ad carries it. */
  all: boolean;
  adNames: string[];
}

/**
 * Which page and Instagram the page checks read (open with ops, 24 Nov).
 * "settings_and_ads" (as ruled): the settings' page and Instagram count for
 * every ad, and each ad's own identity counts for that ad.
 * "ads": each ad's own identity, which is what the launch sends; the
 * settings' fields count only when no ad carries one. On the 40 recent
 * Electric drafts every page_other_client hit came from the settings
 * fields (24 Nov).
 */
export const IDENTITY_SOURCE: "settings_and_ads" | "ads" = "settings_and_ads";

/**
 * Every Facebook page and Instagram account the draft would run from (see
 * IDENTITY_SOURCE): the settings' page and Instagram (every ad) and each
 * creative's own identity.
 */
export function draftIdentities(draft: CampaignDraft): {
  pages: Map<string, IdentityUse>;
  instagram: Map<string, IdentityUse>;
} {
  const pages = new Map<string, IdentityUse>();
  const instagram = new Map<string, IdentityUse>();
  const note = (map: Map<string, IdentityUse>, id: string | null | undefined, adName: string | null) => {
    const key = (id ?? "").trim();
    if (!key) return;
    const row = map.get(key) ?? { all: false, adNames: [] };
    if (adName == null) row.all = true;
    else if (!row.adNames.includes(adName)) row.adNames.push(adName);
    map.set(key, row);
  };
  const creatives = draft.creatives ?? [];
  const adsHave = (pick: (c: (typeof creatives)[number]) => string | undefined) => creatives.some((c) => Boolean(pick(c)?.trim()));
  const settingsCount = (adsCarryIt: boolean) => IDENTITY_SOURCE === "settings_and_ads" || !adsCarryIt;
  if (settingsCount(adsHave((c) => c.identity?.pageId))) note(pages, draft.settings.metaPageId, null);
  if (settingsCount(adsHave((c) => c.identity?.instagramActorId || c.identity?.instagramAccountId))) {
    note(instagram, draft.settings.metaIGAccountId, null);
  }
  for (const creative of creatives) {
    const adName = creative.name || "Untitled ad";
    note(pages, creative.identity?.pageId, adName);
    note(instagram, creative.identity?.instagramActorId || creative.identity?.instagramAccountId, adName);
  }
  return { pages, instagram };
}

function identityEvidence(use: IdentityUse, adCount: number): string {
  const [allForm, someForm] = W["page_other_client.evidence"].split(" | ");
  if (use.all || use.adNames.length >= adCount) return fill(allForm!, { n: adCount });
  return fill(someForm!, { n: use.adNames.length, "up to 4 ad names": listNames(use.adNames) });
}

/**
 * page_other_client (RC3): the draft runs from a Facebook page or an
 * Instagram account another client holds, and this event's client doesn't.
 * A page or account stored as an artist's never fires: ads often run from
 * artist pages on purpose. Page and Instagram are separate checks.
 */
function checkPageOwner(
  draft: CampaignDraft,
  event: GuardEvent,
  code: string,
  ownership: IdentityOwnership | null,
  live: LiveIdentity | null,
): LaunchCheck[] {
  if (!ownership) return [];
  const { pages, instagram } = draftIdentities(draft);
  const adCount = (draft.creatives ?? []).length;
  const client = ownership.clientName ?? "";
  const out: LaunchCheck[] = [];
  const kinds = [
    { kind: "page" as const, uses: pages },
    { kind: "instagram" as const, uses: instagram },
  ];
  for (const { kind, uses } of kinds) {
    for (const [id, use] of uses) {
      const owner = ownership.owners.find((row) => row.kind === kind && row.id === id);
      if (!owner || owner.ownClient || owner.artist || owner.otherClients.length === 0) continue;
      const other = owner.otherClients[0]!;
      // RC8a: the live ads' page is the answer, when it is known, different and not another client's.
      const liveField = kind === "page" ? live?.page : live?.instagram;
      const answer = liveField && !liveField.otherClient && liveField.id !== id ? liveField : null;
      const liveName = liveField ? liveField.name ?? liveField.id : null;
      const baseEvidence = identityEvidence(use, adCount);
      const evidence =
        liveField && liveName && !liveField.otherClient && (use.all || use.adNames.length >= adCount)
          ? kind === "page"
            ? fill(W["page_other_client.evidence.live"], { n: adCount, "live page": liveName })
            : fill(W["page_other_client.instagram.evidence.live"], { n: adCount, "live handle": liveName })
          : baseEvidence;
      const changeFix: LaunchCheckFix = {
        action: "change_identity",
        label: kind === "page" ? W["page_other_client.fix"] : W["page_other_client.instagram.fix"],
        field: kind,
        where: use.all ? "settings" : "creatives",
      };
      const liveFix: LaunchCheckFix | null = answer
        ? {
            action: "use_live_identity",
            label:
              kind === "page"
                ? fill(W["page_other_client.fix.live"], { "live page": answer.name ?? answer.id })
                : fill(W["page_other_client.instagram.fix.live"], { "live handle": answer.name ?? answer.id }),
            field: kind,
            from: id,
            to: answer.id,
            names: [kind === "page" ? (answer.name ?? answer.id) : `@${answer.name ?? answer.id}`],
          }
        : null;
      const sentence =
        kind === "page"
          ? fill(W["page_other_client"], { page: owner.name ?? id, "other client": other, code, client })
          : fill(W["page_other_client.instagram"], { handle: owner.name ?? id, "other client": other, code, client });
      out.push({
        key: "page_other_client",
        severity: "blocker",
        label: kind === "page" ? W["page_other_client.key"] : W["page_other_client.instagram.key"],
        sentence,
        evidence,
        fixes: liveFix ? [liveFix, changeFix] : [changeFix],
        findings: use.all
          ? [{ field: kind, adName: null, value: id }]
          : use.adNames.map((adName) => ({ field: kind, adName, value: id })),
      });
    }
  }
  // Pages before Instagram, each in the order the draft holds them.
  return out;
}

// ── 7. the live ads' page (warning, RC8) ───────────────────────────────

/** The page and Instagram the draft would relaunch from: its settings, else its first ad's. */
export function draftRunsFrom(draft: CampaignDraft): { page: string | null; instagram: string | null } {
  const first = (draft.creatives ?? [])[0]?.identity;
  if (IDENTITY_SOURCE === "ads") {
    return {
      page: first?.pageId?.trim() || draft.settings.metaPageId?.trim() || null,
      instagram:
        first?.instagramActorId?.trim() || first?.instagramAccountId?.trim() || draft.settings.metaIGAccountId?.trim() || null,
    };
  }
  return {
    page: draft.settings.metaPageId?.trim() || first?.pageId?.trim() || null,
    instagram:
      draft.settings.metaIGAccountId?.trim() || first?.instagramActorId?.trim() || first?.instagramAccountId?.trim() || null,
  };
}

export function keptIdentityOf(draft: CampaignDraft, field: "page" | "instagram"): KeptIdentity | null {
  return draft.settings.launchGuard?.keptIdentity?.[field] ?? null;
}

/**
 * identity_not_live (RC8): a published draft's page or Instagram isn't the
 * one most live ads use. A warning per field, never a blocker. Silent with
 * no live read (unpublished, or the read failed), on a field
 * page_other_client fires on (RC8a), and on a field kept at its current id.
 */
function checkIdentityNotLive(
  draft: CampaignDraft,
  live: LiveIdentity | null,
  ownership: IdentityOwnership | null,
  fired: ReadonlySet<string>,
): LaunchCheck[] {
  if (!live || draft.status !== "published") return [];
  const runs = draftRunsFrom(draft);
  const out: LaunchCheck[] = [];
  for (const kind of ["page", "instagram"] as const) {
    const draftId = runs[kind];
    const liveField = live[kind];
    if (!draftId || !liveField || liveField.id === draftId || fired.has(kind)) continue;
    if (keptIdentityOf(draft, kind)?.id === draftId) continue;
    const draftName =
      live.draftNames[draftId] ?? ownership?.owners.find((row) => row.kind === kind && row.id === draftId)?.name ?? draftId;
    const liveName = liveField.name ?? liveField.id;
    const at = keptAtLabel(live.readAt);
    const evidence =
      liveField.count === 1
        ? fill(W["identity_not_live.evidence.one"], { "date, time": at })
        : fill(W["identity_not_live.evidence"], { "date, time": at, n: liveField.count });
    const fixes: LaunchCheckFix[] = [];
    if (!liveField.otherClient) {
      fixes.push({
        action: "use_live_identity",
        label:
          kind === "page"
            ? fill(W["identity_not_live.fix"], { "live page": liveName })
            : fill(W["identity_not_live.instagram.fix"], { "live handle": liveName }),
        field: kind,
        from: draftId,
        to: liveField.id,
        names: [kind === "page" ? liveName : `@${liveName}`],
      });
    }
    fixes.push({
      action: "keep_identity",
      label:
        kind === "page"
          ? fill(W["identity_not_live.keep"], { "draft page": draftName })
          : fill(W["identity_not_live.instagram.keep"], { "draft handle": draftName }),
      field: kind,
      id: draftId,
      names: [kind === "page" ? draftName : `@${draftName}`],
    });
    out.push({
      key: "identity_not_live",
      severity: "warning",
      label: W["identity_not_live.key"],
      sentence:
        kind === "page"
          ? fill(W["identity_not_live"], { "draft page": draftName, "live page": liveName })
          : fill(W["identity_not_live.instagram"], { "draft handle": draftName, "live handle": liveName }),
      evidence,
      fixes,
      findings: [{ field: kind, adName: null, value: draftId }],
    });
  }
  return out;
}

/** "Page kept by …" / "Instagram kept by …" under the list, while the draft still holds the kept id. */
export function keptIdentityLines(draft: CampaignDraft): string[] {
  const runs = draftRunsFrom(draft);
  const lines: string[] = [];
  for (const kind of ["page", "instagram"] as const) {
    const kept = keptIdentityOf(draft, kind);
    if (!kept || kept.id !== runs[kind]) continue;
    const name = kept.name ?? kept.id;
    lines.push(
      kind === "page"
        ? fill(W["identity_not_live.kept"], { name: kept.keptBy, "date, time": keptAtLabel(kept.keptAt), "draft page": name })
        : fill(W["identity_not_live.instagram.kept"], {
            name: kept.keptBy,
            "date, time": keptAtLabel(kept.keptAt),
            "draft handle": name,
          }),
    );
  }
  return lines;
}

// ── 7. link (warning) ──────────────────────────────────────────────────

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

const KEPT_AT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "{date, time}" for kept lines and the live read: "Tue 24 Nov, 15:02", London time (RC-I). */
export function keptAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(KEPT_AT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}

/**
 * The muted lines under the list (RC3): one per kept link an ad still uses.
 * A kept link no ad uses any more says nothing, and a changed link is
 * checked again.
 */
export function keptLinkLines(draft: CampaignDraft): string[] {
  const inUse = new Set((draft.creatives ?? []).map((creative) => linkKey(creative.destinationUrl)).filter(Boolean));
  return keptLinksOf(draft)
    .filter((row) => inUse.has(linkKey(row.url)))
    .map((row) =>
      fill(W["link_not_event.kept"], { name: row.keptBy, "date, time": keptAtLabel(row.keptAt), url: displayLink(row.url) }),
    );
}

function checkLink(draft: CampaignDraft, event: GuardEvent, blocked: ReadonlySet<string> = new Set()): LaunchCheck[] {
  const page = event.signupUrl || event.ticketUrl;
  if (!page) return [];
  const own = eventPageKeys(event);
  const kept = new Set(keptLinksOf(draft).map((row) => linkKey(row.url)).filter(Boolean) as string[]);
  const byLink = new Map<string, { url: string; hits: GuardFinding[] }>();
  for (const creative of draft.creatives ?? []) {
    const key = linkKey(creative.destinationUrl);
    if (!key || own.has(key) || kept.has(key) || blocked.has(key)) continue;
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
    case "use_live_identity":
      return takeIdentity(draft, fix.field, fix.from, fix.to);
    case "keep_identity":
      return keepIdentity(draft, fix.field, fix.id, fix.names?.[0]?.replace(/^@/, "") ?? null, context.keptBy, context.now);
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

/**
 * "Use the live ads' page / Instagram" (RC8, RC8a): the draft takes the live
 * ads' id, on its settings and on every ad that held the old one. The draft
 * only, never Meta.
 */
export function takeIdentity(draft: CampaignDraft, field: "page" | "instagram", from: string, to: string): CampaignDraft {
  if (field === "page") {
    return {
      ...draft,
      settings: { ...draft.settings, metaPageId: to },
      creatives: draft.creatives.map((creative) =>
        creative.identity?.pageId === from ? { ...creative, identity: { ...creative.identity, pageId: to } } : creative,
      ),
    };
  }
  return {
    ...draft,
    settings: { ...draft.settings, metaIGAccountId: to },
    creatives: draft.creatives.map((creative) => {
      const identity = creative.identity;
      if (!identity || (identity.instagramAccountId !== from && identity.instagramActorId !== from)) return creative;
      return { ...creative, identity: { ...identity, instagramAccountId: to, instagramActorId: to } };
    }),
  };
}

/** "Keep {draft page}" (RC8): store who kept which page or Instagram, and when. */
export function keepIdentity(
  draft: CampaignDraft,
  field: "page" | "instagram",
  id: string,
  name: string | null,
  keptBy: string,
  now: Date,
): CampaignDraft {
  const launchGuard = draft.settings.launchGuard ?? {};
  return {
    ...draft,
    settings: {
      ...draft.settings,
      launchGuard: {
        ...launchGuard,
        keptIdentity: { ...launchGuard.keptIdentity, [field]: { id, name, keptBy, keptAt: now.toISOString() } },
      },
    },
  };
}
