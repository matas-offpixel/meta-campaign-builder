import type { CampaignDraft } from "../types.ts";

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

export function foreignAssetMessage(
  kind: "Image" | "Video",
  fileName: string,
  creativeName: string,
): string {
  return `${kind} ${fileName} on ${creativeName} was uploaded to a different ad account — re-upload it.`;
}

/**
 * Images: a hash missing from GET /act_{id}/adimages?hashes= is not in this
 * account. Videos: GET /{video_id} is account-agnostic, so a video with no
 * registry row scoped to this account is refused the same way.
 */
export function refuseForeignAssets(input: {
  checks: readonly AssetAccountCheck[];
  presentHashes: ReadonlySet<string>;
  videoIdsInAccount: ReadonlySet<string>;
}): string | null {
  const lines: string[] = [];
  for (const check of input.checks) {
    if (check.kind === "image" && !input.presentHashes.has(check.key)) {
      lines.push(foreignAssetMessage("Image", check.fileName, check.creativeName));
    }
    if (check.kind === "video" && !input.videoIdsInAccount.has(check.key)) {
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
