/**
 * Read copy for the ads a run just saw, then fill whatever Graph did
 * not return from snapshots and drafts. Read-only against Meta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyLaunchMetaCode } from "../meta/launch-error-classify.ts";
import type { GraphMultiGet } from "./fetch.ts";
import {
  AD_COPY_FIELDS,
  chunkAdIds,
  copyWriteDecision,
  draftCopy,
  emptyCopy,
  graphCopyIsUseful,
  needsCopyRead,
  parseAdCopyBatch,
  presentAdIds,
  snapshotCopies,
  type AdCopyFields,
  type AdCopySource,
  type StoredAdCopy,
} from "./copy.ts";
import { chunkLookupIds, selectIn } from "./id-lookup.ts";

const PAGE = 1000;

export type CopyCaptureStatus = "ok" | "rate_limited" | "auth_error" | "error";

export type CopyCaptureResult = {
  status: CopyCaptureStatus;
  calls: number;
  written: number;
  error?: string;
  /** The table is not applied yet. Insights still succeed. */
  skippedReason?: "no_table";
};

export type SeenAd = { metaAdId: string; adName: string | null };

type CopyInsert = AdCopyFields & {
  metaAdId: string;
  adAccountId: string;
  source: AdCopySource;
  fetchedAt: string;
};

function errorCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = errorCode(err);
  if (code === undefined) return message;
  return `Meta code=${code}: ${message}`;
}

function missingTable(message: string): boolean {
  return /ad_copy/i.test(message) && /does not exist|schema cache|could not find the table/i.test(message);
}

function rowOf(insert: CopyInsert): Record<string, unknown> {
  return {
    meta_ad_id: insert.metaAdId,
    ad_account_id: insert.adAccountId,
    creative_id: insert.creativeId,
    bodies: insert.bodies,
    titles: insert.titles,
    descriptions: insert.descriptions,
    link_caption: insert.linkCaption,
    call_to_action: insert.callToAction,
    effective_object_story_id: insert.effectiveObjectStoryId,
    source: insert.source,
    fetched_at: insert.fetchedAt,
  };
}

async function readStored(db: SupabaseClient, ids: readonly string[]): Promise<{ stored: Map<string, StoredAdCopy>; missingTable: boolean; error?: string }> {
  const stored = new Map<string, StoredAdCopy>();
  const { rows, error } = await selectIn(
    (chunk) => db.from("ad_copy").select("meta_ad_id, source, fetched_at").in("meta_ad_id", chunk),
    ids,
  );
  for (const row of rows as { meta_ad_id?: string; source?: string; fetched_at?: string }[]) {
    if (!row.meta_ad_id || !row.source || !row.fetched_at) continue;
    if (row.source !== "graph" && row.source !== "lab" && row.source !== "snapshot" && row.source !== "draft") continue;
    stored.set(row.meta_ad_id, { source: row.source, fetchedAt: row.fetched_at });
  }
  if (error) {
    if (missingTable(error)) return { stored, missingTable: true, error };
    return { stored, missingTable: false, error };
  }
  return { stored, missingTable: false };
}

async function writeCopies(db: SupabaseClient, rows: readonly CopyInsert[]): Promise<string | null> {
  if (rows.length === 0) return null;
  // One POST, as before. A Graph page is 50 ads and that body is small;
  // the URL limit only applies to the `.in()` reads.
  const { error } = await db.from("ad_copy").upsert(rows.map(rowOf), { onConflict: "meta_ad_id" });
  return error ? error.message : null;
}

async function snapshotFallbacks(db: SupabaseClient, wanted: ReadonlySet<string>): Promise<Map<string, AdCopyFields>> {
  const found = new Map<string, AdCopyFields>();
  if (wanted.size === 0) return found;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("active_creatives_snapshots").select("payload").range(from, from + PAGE - 1);
    if (error) {
      console.error(`[ad-copy] snapshot read failed: ${error.message}`);
      return found;
    }
    const rows = (data ?? []) as { payload?: unknown }[];
    for (const row of rows) {
      for (const [id, copy] of snapshotCopies(row.payload)) {
        if (wanted.has(id) && !found.has(id)) found.set(id, copy);
      }
    }
    if (found.size === wanted.size || rows.length < PAGE) break;
  }
  return found;
}

async function draftFallbacks(db: SupabaseClient, wanted: readonly string[]): Promise<Map<string, AdCopyFields>> {
  const found = new Map<string, AdCopyFields>();
  if (wanted.length === 0) return found;
  const launched: { meta_ad_id: string; draft_id: string; creative_name: string | null }[] = [];
  for (const chunk of chunkLookupIds(wanted)) {
    const { data, error } = await db
      .from("launched_ads")
      .select("meta_ad_id, draft_id, creative_name")
      .in("meta_ad_id", chunk);
    if (error) {
      console.error(`[ad-copy] launched_ads read failed: ${error.message}`);
      return found;
    }
    for (const row of (data ?? []) as { meta_ad_id?: string; draft_id?: string | null; creative_name?: string | null }[]) {
      if (row.meta_ad_id && row.draft_id) {
        launched.push({ meta_ad_id: row.meta_ad_id, draft_id: row.draft_id, creative_name: row.creative_name ?? null });
      }
    }
  }
  const draftIds = [...new Set(launched.map((row) => row.draft_id))];
  const drafts = new Map<string, unknown>();
  for (const chunk of chunkLookupIds(draftIds)) {
    const { data, error } = await db.from("campaign_drafts").select("id, draft_json").in("id", chunk);
    if (error) {
      console.error(`[ad-copy] campaign_drafts read failed: ${error.message}`);
      return found;
    }
    for (const row of (data ?? []) as { id?: string; draft_json?: unknown }[]) {
      if (row.id) drafts.set(row.id, row.draft_json);
    }
  }
  for (const row of launched) {
    if (found.has(row.meta_ad_id)) continue;
    const copy = draftCopy(drafts.get(row.draft_id), row.creative_name, row.meta_ad_id);
    if (copy) found.set(row.meta_ad_id, copy);
  }
  return found;
}

export async function captureAccountCopy(args: {
  db: SupabaseClient;
  multiGet: GraphMultiGet;
  adAccountId: string;
  ads: readonly SeenAd[];
  now: Date;
}): Promise<CopyCaptureResult> {
  const ads = [...new Map(args.ads.map((ad) => [ad.metaAdId, ad])).values()];
  if (ads.length === 0) return { status: "ok", calls: 0, written: 0 };

  const read = await readStored(args.db, ads.map((ad) => ad.metaAdId));
  if (read.missingTable) {
    console.error(`[ad-copy] ${read.error}; skipping capture until migration 206 is applied`);
    return { status: "ok", calls: 0, written: 0, skippedReason: "no_table", error: read.error };
  }
  if (read.error) return { status: "error", calls: 0, written: 0, error: read.error };

  const due = ads.filter((ad) => needsCopyRead(read.stored.get(ad.metaAdId), args.now));
  const fetched = new Map<string, AdCopyFields>();
  const answered = new Set<string>();
  let calls = 0;
  let stop: { status: CopyCaptureStatus; error: string } | null = null;

  for (const chunk of chunkAdIds(due.map((ad) => ad.metaAdId))) {
    calls++;
    let body: unknown;
    try {
      body = await args.multiGet("/", { ids: chunk.join(","), fields: AD_COPY_FIELDS });
    } catch (err) {
      const kind = classifyLaunchMetaCode(errorCode(err));
      const status: CopyCaptureStatus = kind === "rate_limit" ? "rate_limited" : kind === "auth" ? "auth_error" : "error";
      stop = { status, error: errorText(err) };
      break;
    }
    for (const id of presentAdIds(body)) answered.add(id);
    for (const [id, copy] of parseAdCopyBatch(body)) fetched.set(id, copy);
  }

  const fetchedAt = args.now.toISOString();
  const writes: CopyInsert[] = [];
  const useful = new Set<string>();
  for (const [id, copy] of fetched) {
    if (!graphCopyIsUseful(copy)) continue;
    useful.add(id);
    if (copyWriteDecision(read.stored.get(id), "graph", args.now) === "skip") continue;
    writes.push({ ...copy, metaAdId: id, adAccountId: args.adAccountId, source: "graph", fetchedAt });
  }

  // A fallback fills an ad Graph answered without copy, and only when
  // that ad has no row. A rate limit leaves unread ids for the next
  // run. An answered ad that nobody can fill is stored empty so it is
  // not read again for 30 days.
  if (!stop) {
    const gaps = due
      .map((ad) => ad.metaAdId)
      .filter((id) => answered.has(id) && !useful.has(id) && !read.stored.has(id));
    const filled = new Set<string>();
    if (gaps.length > 0) {
      const wanted = new Set(gaps);
      const fromSnapshot = await snapshotFallbacks(args.db, wanted);
      const still = gaps.filter((id) => !fromSnapshot.has(id));
      const fromDraft = await draftFallbacks(args.db, still);
      for (const id of gaps) {
        const copy = fromSnapshot.get(id) ?? fromDraft.get(id);
        if (!copy) continue;
        const source: AdCopySource = fromSnapshot.has(id) ? "snapshot" : "draft";
        if (copyWriteDecision(read.stored.get(id), source, args.now) === "skip") continue;
        filled.add(id);
        writes.push({ ...copy, metaAdId: id, adAccountId: args.adAccountId, source, fetchedAt });
      }
    }
    const touch: string[] = [];
    for (const id of due.map((ad) => ad.metaAdId)) {
      if (!answered.has(id) || useful.has(id) || filled.has(id)) continue;
      if (read.stored.has(id)) {
        touch.push(id);
        continue;
      }
      const copy = fetched.get(id) ?? emptyCopy();
      writes.push({ ...copy, metaAdId: id, adAccountId: args.adAccountId, source: "graph", fetchedAt });
    }
    for (const chunk of chunkLookupIds(touch)) {
      const { error } = await args.db.from("ad_copy").update({ fetched_at: fetchedAt }).in("meta_ad_id", chunk);
      if (error) console.error(`[ad-copy] fetched_at refresh failed: ${error.message}`);
    }
  }

  const writeError = await writeCopies(args.db, writes);
  if (writeError && missingTable(writeError)) {
    console.error(`[ad-copy] ${writeError}; skipping capture until migration 206 is applied`);
    return { status: "ok", calls, written: 0, skippedReason: "no_table", error: writeError };
  }
  if (stop) return { status: stop.status, calls, written: writeError ? 0 : writes.length, error: writeError ?? stop.error };
  if (writeError) return { status: "error", calls, written: 0, error: writeError };
  return { status: "ok", calls, written: writes.length };
}
