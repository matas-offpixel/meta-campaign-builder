import type { MetaImportMeta, MetaImportNotCarried } from "@/lib/meta/import/types";

/** Read posts no `carry`, so the route returns the picker and saves nothing. */
export function metaImportReadBody(adAccountId: string, campaignId: string): {
  adAccountId: string;
  campaignId: string;
} {
  return { adAccountId, campaignId };
}

export function metaImportSaveBody(input: {
  adAccountId: string;
  campaignId: string;
  carry: string[];
  eventId: string;
}): {
  adAccountId: string;
  campaignId: string;
  carry: string[];
  eventId: string;
} {
  return {
    adAccountId: input.adAccountId,
    campaignId: input.campaignId,
    carry: input.carry,
    eventId: input.eventId,
  };
}

/** Save stays disabled until an event is chosen and at least one creative is ticked. */
export function metaImportSaveBlocked(eventId: string, ticked: number): boolean {
  return !eventId.trim() || ticked === 0;
}

export function metaImportDraftHref(draftId: string): string {
  return `/campaign/${draftId}`;
}

/**
 * The route's `error` string, unchanged. A missing one is the only case
 * that gets a fallback, and the fallback names the failure rather than
 * saying "Import failed".
 */
export function metaImportErrorText(body: { error?: unknown } | null | undefined): string {
  if (body && typeof body.error === "string" && body.error.trim()) return body.error;
  return "The import route returned no error message.";
}

export function metaImportNotCarriedLine(row: MetaImportNotCarried): string {
  return `${row.name} — ${row.reason}`;
}

export function metaImportCountsLine(meta: Pick<MetaImportMeta, "creativeCounts"> & {
  adSetCount: number;
}): string {
  const { read, carried, notCarried } = meta.creativeCounts;
  return `${meta.adSetCount} ad sets · ${carried} of ${read} creatives carried · ${notCarried} not carried`;
}
