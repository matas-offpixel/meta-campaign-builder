import { withoutActPrefix } from "./ad-account-id.ts";
import type { CampaignDraft } from "../types.ts";

/** Graph returns adimages in pages. One request asks for at most this many hashes. */
export const ADIMAGES_HASH_PAGE_LIMIT = 50;

export interface AssetAccountCheck {
  kind: "image" | "video";
  key: string;
  fileName: string;
  creativeName: string;
}

export function hashesInAdImagesResponse(body: unknown): Set<string> {
  const data = (body as { data?: Array<{ hash?: string }> } | null)?.data;
  const hashes = new Set<string>();
  if (!Array.isArray(data)) return hashes;
  for (const row of data) {
    if (row?.hash) hashes.add(row.hash);
  }
  return hashes;
}

export function pagingNextUrl(body: unknown): string | null {
  const next = (body as { paging?: { next?: unknown } } | null)?.paging?.next;
  return typeof next === "string" && next.length > 0 ? next : null;
}

export async function collectAdImageHashes(input: {
  hashes: readonly string[];
  fetchPage: (
    query: { hashes: string[]; limit: string } | { next: string },
  ) => Promise<unknown>;
}): Promise<Set<string>> {
  const present = new Set<string>();
  const unique = [...new Set(input.hashes.filter(Boolean))];
  for (let i = 0; i < unique.length; i += ADIMAGES_HASH_PAGE_LIMIT) {
    const chunk = unique.slice(i, i + ADIMAGES_HASH_PAGE_LIMIT);
    let page = await input.fetchPage({
      hashes: chunk,
      limit: String(ADIMAGES_HASH_PAGE_LIMIT),
    });
    const seenNext = new Set<string>();
    for (;;) {
      for (const hash of hashesInAdImagesResponse(page)) present.add(hash);
      const next = pagingNextUrl(page);
      if (!next || seenNext.has(next)) break;
      seenNext.add(next);
      page = await input.fetchPage({ next });
    }
  }
  return present;
}

/**
 * A video with no registry row is unverified (legacy, imported, or a
 * failed register). A row whose scope is a different ad account is the
 * mismatch. A row in this account, with or without the act_ prefix, is not.
 */
export function videoIdsProvenOnAnotherAccount(
  checks: readonly AssetAccountCheck[],
  rows: readonly { platformId: string; scope: string }[],
  launchAdAccountId: string,
): { foreign: Set<string>; unverified: string[] } {
  const launch = withoutActPrefix(launchAdAccountId);
  const byId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.platformId || !row.scope) continue;
    const scopes = byId.get(row.platformId) ?? new Set<string>();
    scopes.add(withoutActPrefix(row.scope));
    byId.set(row.platformId, scopes);
  }
  const foreign = new Set<string>();
  const unverified: string[] = [];
  for (const check of checks) {
    if (check.kind !== "video") continue;
    const scopes = byId.get(check.key);
    if (!scopes || scopes.size === 0) {
      unverified.push(check.key);
      continue;
    }
    if (!scopes.has(launch)) foreign.add(check.key);
  }
  return { foreign, unverified };
}

export function foreignAssetMessage(
  kind: "Image" | "Video",
  fileName: string,
  creativeName: string,
): string {
  return `${kind} ${fileName} on ${creativeName} was uploaded to a different ad account — re-upload it.`;
}

/**
 * Images: a hash missing after the full adimages walk is not in this
 * account. Videos: only an id proven to sit in a different account.
 * A video with no registry row is not in `videoIdsInOtherAccount`.
 */
export function refuseForeignAssets(input: {
  checks: readonly AssetAccountCheck[];
  presentHashes: ReadonlySet<string>;
  videoIdsInOtherAccount: ReadonlySet<string>;
}): string | null {
  const lines: string[] = [];
  for (const check of input.checks) {
    if (check.kind === "image" && !input.presentHashes.has(check.key)) {
      lines.push(foreignAssetMessage("Image", check.fileName, check.creativeName));
    }
    if (check.kind === "video" && input.videoIdsInOtherAccount.has(check.key)) {
      lines.push(foreignAssetMessage("Video", check.fileName, check.creativeName));
    }
  }
  return lines.length > 0 ? lines.join(" ") : null;
}

export function assetAccountChecks(draft: CampaignDraft): AssetAccountCheck[] {
  const checks: AssetAccountCheck[] = [];
  for (const creative of draft.creatives) {
    const creativeName = creative.name.trim() || "Creative";
    for (const variation of creative.assetVariations) {
      for (const asset of variation.assets) {
        const fileName = asset.fileName?.trim() || creativeName;
        if (creative.mediaType === "video") {
          if (!asset.videoId) continue;
          checks.push({
            kind: "video",
            key: asset.videoId,
            fileName,
            creativeName,
          });
          continue;
        }
        if (!asset.assetHash) continue;
        checks.push({
          kind: "image",
          key: asset.assetHash,
          fileName,
          creativeName,
        });
      }
    }
  }
  return checks;
}
