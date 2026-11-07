/**
 * Per-ad copy. Graph v26 removed `GET /?ids=`, so the read goes through
 * the Batch API (`graphMultiGetByIds`), which returns the same id-keyed
 * object. One call is at most 50 ad ids. Snapshots and drafts fill an
 * ad that has no row; they never replace a graph row.
 */

export const AD_COPY_BATCH = 50;
export const AD_COPY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The creative fields on each ad. `id` is included so creative_id is filled. */
export const AD_COPY_FIELDS =
  "creative{id,body,title,object_story_spec,asset_feed_spec,effective_object_story_id,call_to_action_type}";

export type AdCopySource = "graph" | "lab" | "snapshot" | "draft";

export type AdCopyFields = {
  creativeId: string | null;
  bodies: string[];
  titles: string[];
  descriptions: string[];
  linkCaption: string | null;
  callToAction: string | null;
  effectiveObjectStoryId: string | null;
};

export type StoredAdCopy = {
  source: AdCopySource;
  fetchedAt: string;
};

export function isAdCopyCaptureEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_AD_COPY_CAPTURE === "1";
}

export function isCopyStale(fetchedAt: string, now: Date): boolean {
  const then = Date.parse(fetchedAt);
  if (!Number.isFinite(then)) return true;
  return now.getTime() - then > AD_COPY_MAX_AGE_MS;
}

/** An ad is read when it has no row, or the row is older than 30 days. */
export function needsCopyRead(existing: StoredAdCopy | undefined, now: Date): boolean {
  if (!existing) return true;
  return isCopyStale(existing.fetchedAt, now);
}

/**
 * Graph may refresh a stale graph row and may replace a fallback.
 * A fallback writes only when the ad has no row at all.
 */
export function copyWriteDecision(
  existing: StoredAdCopy | undefined,
  incoming: AdCopySource,
  now: Date,
): "write" | "skip" {
  if (!existing) return "write";
  if (incoming !== "graph") return "skip";
  if (existing.source !== "graph") return "write";
  return isCopyStale(existing.fetchedAt, now) ? "write" : "skip";
}

export function chunkAdIds(ids: readonly string[], size = AD_COPY_BATCH): string[][] {
  const out: string[][] = [];
  for (let start = 0; start < ids.length; start += size) out.push(ids.slice(start, start + size));
  return out;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pushUnique(out: string[], value: unknown) {
  const trimmed = text(value);
  if (trimmed && !out.includes(trimmed)) out.push(trimmed);
}

/** `{ text }` or a bare string, which both appear on asset_feed_spec. */
function feedEntries(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object" && "text" in entry) return (entry as { text?: unknown }).text;
    return null;
  });
}

type StoryData = {
  name?: unknown;
  message?: unknown;
  description?: unknown;
  caption?: unknown;
  link_description?: unknown;
  call_to_action?: { type?: unknown };
  child_attachments?: Array<{ name?: unknown; message?: unknown; description?: unknown }>;
};

type CreativeNode = {
  id?: unknown;
  body?: unknown;
  title?: unknown;
  call_to_action_type?: unknown;
  effective_object_story_id?: unknown;
  object_story_spec?: {
    link_data?: StoryData;
    video_data?: StoryData;
    template_data?: StoryData;
  };
  asset_feed_spec?: {
    bodies?: unknown;
    titles?: unknown;
    descriptions?: unknown;
    captions?: unknown;
    call_to_action_types?: unknown;
    link_urls?: Array<{ display_url?: unknown }>;
  };
};

function storyParts(data: StoryData | undefined, bodies: string[], titles: string[], descriptions: string[]) {
  if (!data) return;
  pushUnique(bodies, data.message);
  pushUnique(titles, data.name);
  pushUnique(descriptions, data.description);
  pushUnique(descriptions, data.link_description);
  for (const child of data.child_attachments ?? []) {
    pushUnique(bodies, child.message);
    pushUnique(titles, child.name);
    pushUnique(descriptions, child.description);
  }
}

/**
 * Every variant, not the first one. An existing-post creative often has
 * no text; the story id is still kept.
 */
export function parseCreativeCopy(creative: unknown): AdCopyFields | null {
  if (!creative || typeof creative !== "object") return null;
  const node = creative as CreativeNode;
  const bodies: string[] = [];
  const titles: string[] = [];
  const descriptions: string[] = [];
  pushUnique(bodies, node.body);
  pushUnique(titles, node.title);
  const spec = node.object_story_spec;
  storyParts(spec?.link_data, bodies, titles, descriptions);
  storyParts(spec?.video_data, bodies, titles, descriptions);
  storyParts(spec?.template_data, bodies, titles, descriptions);
  const feed = node.asset_feed_spec;
  for (const entry of feedEntries(feed?.bodies)) pushUnique(bodies, entry);
  for (const entry of feedEntries(feed?.titles)) pushUnique(titles, entry);
  for (const entry of feedEntries(feed?.descriptions)) pushUnique(descriptions, entry);

  const linkCaption =
    text(spec?.link_data?.caption) ??
    text(spec?.template_data?.caption) ??
    feedEntries(feed?.captions).map(text).find((value): value is string => Boolean(value)) ??
    (feed?.link_urls ?? []).map((url) => text(url.display_url)).find((value): value is string => Boolean(value)) ??
    null;

  const feedCta = Array.isArray(feed?.call_to_action_types) ? feed.call_to_action_types.map(text).find((value): value is string => Boolean(value)) : null;
  const callToAction =
    text(node.call_to_action_type) ??
    text(spec?.link_data?.call_to_action?.type) ??
    text(spec?.video_data?.call_to_action?.type) ??
    text(spec?.template_data?.call_to_action?.type) ??
    feedCta ??
    null;

  const fields: AdCopyFields = {
    creativeId: text(node.id),
    bodies,
    titles,
    descriptions,
    linkCaption,
    callToAction,
    effectiveObjectStoryId: text(node.effective_object_story_id),
  };
  return fields;
}

/** Text or a post id. A creative id alone is not copy. */
export function graphCopyIsUseful(fields: AdCopyFields): boolean {
  return fields.bodies.length > 0 || fields.titles.length > 0 || fields.descriptions.length > 0 || fields.linkCaption != null || fields.effectiveObjectStoryId != null;
}

export function emptyCopy(): AdCopyFields {
  return {
    creativeId: null,
    bodies: [],
    titles: [],
    descriptions: [],
    linkCaption: null,
    callToAction: null,
    effectiveObjectStoryId: null,
  };
}

/** Ad ids a batch actually returned. An error object is not one of them. */
export function presentAdIds(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const ids: string[] = [];
  for (const [id, node] of Object.entries(body as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    if ("error" in node && !("creative" in node)) continue;
    ids.push(id);
  }
  return ids;
}

/** Id-keyed creatives from one batch. A sub-request error is absent. */
export function parseAdCopyBatch(body: unknown): Map<string, AdCopyFields> {
  const out = new Map<string, AdCopyFields>();
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const id of presentAdIds(body)) {
    const node = (body as Record<string, { creative?: unknown }>)[id];
    const creative = node?.creative;
    const parsed = parseCreativeCopy(typeof creative === "string" ? { id: creative } : creative);
    if (parsed) out.set(id, parsed);
  }
  return out;
}

export type FallbackCopy = AdCopyFields & { metaAdId: string };

/** Representative ad on each snapshot group. A repeated id keeps the first body. */
export function snapshotCopies(payload: unknown): Map<string, FallbackCopy> {
  const out = new Map<string, FallbackCopy>();
  const groups = payload && typeof payload === "object" && Array.isArray((payload as { groups?: unknown }).groups)
    ? (payload as { groups: unknown[] }).groups
    : [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const row = group as {
      representative_ad_id?: unknown;
      representative_body_preview?: unknown;
      representative_headline?: unknown;
      representative_preview?: { body?: unknown; headline?: unknown; call_to_action_type?: unknown };
    };
    const metaAdId = text(row.representative_ad_id);
    if (!metaAdId || out.has(metaAdId)) continue;
    const preview = row.representative_preview;
    const bodies: string[] = [];
    const titles: string[] = [];
    pushUnique(bodies, preview?.body);
    pushUnique(bodies, row.representative_body_preview);
    pushUnique(titles, preview?.headline);
    pushUnique(titles, row.representative_headline);
    if (bodies.length === 0 && titles.length === 0) continue;
    out.set(metaAdId, {
      metaAdId,
      creativeId: null,
      bodies,
      titles,
      descriptions: [],
      linkCaption: null,
      callToAction: text(preview?.call_to_action_type),
      effectiveObjectStoryId: null,
    });
  }
  return out;
}

/**
 * The creative this ad was launched from: its own meta ad id when the
 * draft recorded one, otherwise the creative_name on launched_ads.
 */
export function draftCopy(draftJson: unknown, creativeName: string | null, metaAdId: string): AdCopyFields | null {
  const creatives = draftJson && typeof draftJson === "object" ? (draftJson as { creatives?: unknown }).creatives : null;
  if (!Array.isArray(creatives)) return null;
  const named = creativeName?.trim() || null;
  const match = creatives.find((creative) => {
    if (!creative || typeof creative !== "object") return false;
    const ids = (creative as { metaAdIds?: unknown }).metaAdIds;
    return Array.isArray(ids) && ids.some((id) => text(id) === metaAdId);
  }) ?? creatives.find((creative) => {
    if (!named || !creative || typeof creative !== "object") return false;
    return text((creative as { name?: unknown }).name) === named;
  });
  if (!match || typeof match !== "object") return null;
  const creative = match as {
    name?: unknown;
    headline?: unknown;
    description?: unknown;
    cta?: unknown;
    metaCreativeId?: unknown;
    captions?: Array<{ text?: unknown }>;
    existingPost?: { postId?: unknown };
  };
  const bodies: string[] = [];
  const titles: string[] = [];
  const descriptions: string[] = [];
  for (const caption of creative.captions ?? []) pushUnique(bodies, caption?.text);
  pushUnique(titles, creative.headline);
  pushUnique(descriptions, creative.description);
  const storyId = text(creative.existingPost?.postId);
  if (bodies.length === 0 && titles.length === 0 && descriptions.length === 0 && !storyId) return null;
  return {
    creativeId: text(creative.metaCreativeId),
    bodies,
    titles,
    descriptions,
    linkCaption: null,
    callToAction: text(creative.cta),
    effectiveObjectStoryId: storyId,
  };
}
