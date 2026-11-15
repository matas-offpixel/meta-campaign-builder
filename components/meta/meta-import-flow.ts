import type { MetaImportPickerPayload, MetaImportPickerRow } from "@/lib/meta/import/picker";
import type { MetaImportMeta, MetaImportNotCarried } from "@/lib/meta/import/types";

/** Select all: every row that can be carried. A row with no asset stays unticked. */
export function metaImportSelectAll(rows: readonly MetaImportPickerRow[]): Set<string> {
  return new Set(rows.filter((row) => !row.disabled).map((row) => row.key));
}

export function metaImportDeselectAll(): Set<string> {
  return new Set();
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Picker header: unique creatives, the ads behind them, and how many are ticked. */
export function metaImportPickerHeaderLine(
  picker: Pick<MetaImportPickerPayload, "rows" | "adsRead">,
  ticked: ReadonlySet<string>,
): string {
  const count = picker.rows.filter((row) => !row.disabled && ticked.has(row.key)).length;
  return `${plural(picker.rows.length, "creative", "creatives")} (${plural(picker.adsRead, "ad", "ads")}) · ${count} ticked`;
}

/** "in 15 ad sets" for a picker row. Empty when the creative ran in none. */
export function metaImportRowAdSetsLine(row: Pick<MetaImportPickerRow, "adSets">): string {
  return row.adSets.length > 0 ? `in ${plural(row.adSets.length, "ad set", "ad sets")}` : "";
}

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

/** Save stays disabled until at least one creative is ticked. An event is optional. */
export function metaImportSaveBlocked(ticked: number): boolean {
  return ticked === 0;
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

const META_IMPORT_NAME_HASH = /-[0-9a-f]{32}$/i;

/** Display only. The recorded name, including the hash, stays on the log row. */
export function metaImportDisplayName(name: string): string {
  return name.replace(META_IMPORT_NAME_HASH, "");
}

export type MetaImportPickerDropGroup = {
  reason: string;
  summary: string;
  names: string[];
};

export type MetaImportPickerDropSummary = {
  untickedLine: string | null;
  groups: MetaImportPickerDropGroup[];
};

/**
 * Rows the picker may mention. Disabled rows keep the reason the read already
 * assigned. A carriable row left unticked is `operator_unticked` — counted, not listed.
 */
export function metaImportPickerDropInput(
  rows: readonly Pick<MetaImportPickerRow, "key" | "name" | "disabled" | "unsupportedReason">[],
  ticked: ReadonlySet<string>,
): { name: string; reason: string }[] {
  const input: { name: string; reason: string }[] = [];
  for (const row of rows) {
    if (row.disabled) {
      input.push({ name: row.name, reason: row.unsupportedReason ?? "no_asset_reported" });
      continue;
    }
    if (!ticked.has(row.key)) {
      input.push({ name: row.name, reason: "operator_unticked" });
    }
  }
  return input;
}

function untickedLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 creative unticked" : `${count} creatives unticked`;
}

function dropLead(reason: string, count: number): string {
  const plural = count !== 1;
  const n = plural ? `${count} creatives` : "1 creative";
  if (reason === "no_media_reported") {
    return plural
      ? `${n} have no media on Meta and were skipped`
      : `${n} has no media on Meta and was skipped`;
  }
  if (reason === "no_asset_reported") {
    return plural
      ? `${n} have no asset on Meta and were skipped`
      : `${n} has no asset on Meta and was skipped`;
  }
  if (reason === "post_unreachable") {
    return plural
      ? `${n} could not be read from Meta and were skipped`
      : `${n} could not be read from Meta and was skipped`;
  }
  return plural ? `${n} were skipped (${reason})` : `${n} was skipped (${reason})`;
}

function listedNames(names: readonly string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")}, +${names.length - 3} more`;
}

/** Render lines for the picker. Does not rewrite the rows the import log records. */
export function summariseMetaImportPickerDrops(
  rows: readonly { name: string; reason: string }[],
): MetaImportPickerDropSummary {
  let unticked = 0;
  const byReason = new Map<string, string[]>();
  for (const row of rows) {
    if (row.reason === "operator_unticked") {
      unticked += 1;
      continue;
    }
    const names = byReason.get(row.reason) ?? [];
    names.push(metaImportDisplayName(row.name));
    byReason.set(row.reason, names);
  }
  return {
    untickedLine: untickedLine(unticked),
    groups: [...byReason.entries()].map(([reason, names]) => ({
      reason,
      summary: `${dropLead(reason, names.length)}: ${listedNames(names)}`,
      names,
    })),
  };
}

export function metaImportPickerDropLines(summary: MetaImportPickerDropSummary): string[] {
  return [summary.untickedLine, ...summary.groups.map((group) => group.summary)].filter(
    (line): line is string => line != null,
  );
}

export function metaImportCountsLine(meta: Pick<MetaImportMeta, "creativeCounts"> & {
  adSetCount: number;
}): string {
  const { read, uniqueCreatives, adsRead, carried, notCarried } = meta.creativeCounts;
  const of = uniqueCreatives ?? read;
  const ads = adsRead != null ? ` (${plural(adsRead, "ad", "ads")})` : "";
  return `${meta.adSetCount} ad sets · ${carried} of ${of} creatives carried${ads} · ${notCarried} not carried`;
}
