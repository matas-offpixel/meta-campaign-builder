/**
 * lib/retargeting/destination.ts — one website URL and one set of URL
 * parameters for every ad in a show's two campaigns (Matas, 27 Nov, before
 * NX26-RUDIMENTAL goes live): create_show_campaigns(destination: { link,
 * url_tags }) and plan_retargeting's plan line.
 *
 *   - link replaces the website URL on each copied ad's creative: link_data's
 *     link and its button's link, each carousel card's, video_data's button
 *     link, and asset_feed_spec's link_urls (the per-placement creatives).
 *   - url_tags goes on the creative's url_tags field as Meta takes it, so
 *     {{campaign.name}}, {{adset.name}} and {{ad.name}} stay literal for Meta
 *     to fill in. It replaces the source creative's own url_tags.
 *   - Copy, media, the button's type and the identity (Page, Instagram
 *     account) stay as copied. A creative Meta builds from a post (an
 *     object_story_id and nothing else) has its link in the post, so it can't
 *     take a new one: refused before anything is made.
 *
 * Pure. Relative imports only (node:test).
 */
import { sanitizeCreativeForStrictMode, type MetaCreativePayload } from "../meta/creative.ts";

export type Destination = { link: string; urlTags: string | null };
type Json = Record<string, unknown>;

/** PENDING DESIGN: what's refused about a destination, before anything is made. */
export const DESTINATION_WORDS = {
  badLink: "Refused: the destination link must be a full https:// web address. Nothing was changed.",
  badTags: "Refused: url_tags must be URL parameters like utm_source=meta&utm_medium=paid, with no “?” in front. Nothing was changed.",
  /** plan_retargeting: a destination goes with one show. */
  oneShow: "Refused: a destination is for one show at a time, so give one event code.",
  /** The plan line, after the show's lines. */
  line: (destination: Destination) => `Destination: ${hostOf(destination.link)}${destination.urlTags ? " · with URL parameters" : ""}`,
  /** A copied ad Meta built from a post: its link is the post's. A bare reason: claude.rt.failed adds ". Nothing was changed." */
  fromPost: (ad: string) => `${ad} runs from a post, so its link can’t be changed`,
  /** A carousel: its cards can't be rebuilt in the app's strict set (a bare reason, as fromPost). */
  carousel: (ad: string) => `${ad} is a carousel, so its link can’t be changed here`,
  /** A copied ad's creative that couldn't be read for the new link (a bare reason, as fromPost). */
  unread: (ad: string) => `${ad}’s creative couldn’t be read for the new link`,
  /** create_show_campaigns, asked again with another destination once ads are made. */
  madeWithOther: (code: string, made: Destination | null) =>
    `Refused: ${code}’s ads are already made ${made ? `with ${hostOf(made.link)} as their destination` : "with the copied ads’ own links"}, and changing ads that are made is a separate change. Nothing was changed.`,
} as const;

export function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/** A query string: key=value pairs joined by &, no leading ?, no spaces or #. Braces and the rest stay as written. */
const TAGS = /^[^?&=\s#]+=[^&\s#]*(?:&[^&=\s#]+=[^&\s#]*)*$/;

/** The tools' input, checked: https with a host; url_tags a query string, optional. */
export function validateDestination(input: { link: string; url_tags?: string | null } | null | undefined): { ok: true; destination: Destination | null } | { ok: false; reason: string } {
  if (!input) return { ok: true, destination: null };
  const link = input.link.trim();
  let url: URL | null = null;
  try {
    url = new URL(link);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || !url.hostname.includes(".") || /\s/.test(link)) return { ok: false, reason: DESTINATION_WORDS.badLink };
  const tags = input.url_tags?.trim() || null;
  if (tags && !TAGS.test(tags)) return { ok: false, reason: DESTINATION_WORDS.badTags };
  return { ok: true, destination: { link, urlTags: tags } };
}

/** The same destination, for the ledger key and for "asked again with another one". */
export function destinationKey(destination: Destination | null | undefined): string {
  return destination ? `${destination.link}|${destination.urlTags ?? ""}` : "";
}

/** Meta's label ids belong to the source creative; a new creative links labels by name. */
function labelsByName(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(labelsByName);
  if (!value || typeof value !== "object") return value;
  const out: Json = {};
  for (const [key, inner] of Object.entries(value as Json)) {
    if ((key === "adlabels" || key.endsWith("_label")) && inner) out[key] = Array.isArray(inner) ? inner.map((label) => ({ name: (label as Json).name })) : { name: (inner as Json).name };
    else out[key] = labelsByName(inner);
  }
  return out;
}

/** A button with the new link (its type and anything else kept). */
function button(cta: unknown, link: string): Json | undefined {
  if (!cta || typeof cta !== "object") return undefined;
  const c = cta as { type?: string; value?: Json };
  return { ...c, value: { ...(c.value ?? {}), link } };
}

const pick = (src: Json, keys: readonly string[]): Json => Object.fromEntries(keys.filter((key) => src[key] != null).map((key) => [key, src[key]]));

export class DestinationRefused extends Error {
  readonly kind: "from_post" | "carousel" | "unknown";
  constructor(kind: "from_post" | "carousel" | "unknown") {
    super(kind);
    this.name = "DestinationRefused";
    this.kind = kind;
  }
}

/**
 * A new creative from the source creative (GET name, object_story_spec,
 * asset_feed_spec, url_tags, object_story_id) with only the destination
 * changed. Throws DestinationRefused for a creative built from a post.
 */
export function creativeWithDestination(src: Json, destination: Destination, name: string): Json {
  const oss = (src.object_story_spec ?? null) as Json | null;
  const link = destination.link;
  const identity: Json = oss ? pick(oss, ["page_id", "instagram_user_id", "instagram_actor_id"]) : {};
  let payload: Json;
  // A per-placement or rotation spec (placement rules, or two or more images or videos) is the creative; a bare automatic
  // spec beside a story is Meta's own addition, which the strict set strips, so the story is the creative.
  const afsRaw = (src.asset_feed_spec ?? null) as { asset_customization_rules?: unknown[]; images?: unknown[]; videos?: unknown[] } | null;
  const placementSpec = Boolean(afsRaw && ((afsRaw.asset_customization_rules?.length ?? 0) > 0 || (afsRaw.images?.length ?? 0) >= 2 || (afsRaw.videos?.length ?? 0) >= 2));
  if (afsRaw && (placementSpec || !(oss?.video_data || oss?.link_data))) {
    // The per-placement creatives: every asset, rule, body and title kept; each link the new one (its display URL went with the old site).
    const afs = labelsByName(src.asset_feed_spec) as Json;
    const urls = Array.isArray(afs.link_urls) && afs.link_urls.length ? (afs.link_urls as Json[]) : [{}];
    payload = { name, object_story_spec: identity, asset_feed_spec: { ...afs, link_urls: urls.map((row) => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "display_url")), website_url: link })) } };
  } else if (oss?.video_data) {
    const vd = oss.video_data as Json;
    if (!vd.video_id) throw new DestinationRefused("unknown");
    const video: Json = pick(vd, ["video_id", "image_hash", "message", "title", "link_description"]);
    if (!vd.image_hash && vd.image_url) video.image_url = vd.image_url;
    video.call_to_action = button(vd.call_to_action, link) ?? { type: "LEARN_MORE", value: { link } };
    payload = { name, object_story_spec: { ...identity, video_data: video } };
  } else if (oss?.link_data) {
    const ld = oss.link_data as Json;
    const data: Json = { ...pick(ld, ["image_hash", "message", "name", "description", "caption"]), link };
    if (!ld.image_hash && ld.picture) data.picture = ld.picture;
    // A carousel: the app's strict set leaves out child_attachments (sanitizeCreativeForStrictMode), so its cards can't be rebuilt.
    if (Array.isArray(ld.child_attachments) && ld.child_attachments.length) throw new DestinationRefused("carousel");
    const cta = button(ld.call_to_action, link);
    if (cta) data.call_to_action = cta;
    payload = { name, object_story_spec: { ...identity, link_data: data } };
  } else if (src.object_story_id) {
    throw new DestinationRefused("from_post");
  } else {
    throw new DestinationRefused("unknown");
  }
  if (destination.urlTags) payload.url_tags = destination.urlTags;
  sanitizeCreativeForStrictMode(payload as unknown as MetaCreativePayload);
  return payload;
}
