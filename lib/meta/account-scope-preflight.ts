import type { CampaignDraft } from "@/lib/types";
import {
  collectAudienceAccountRefs,
  foreignAudienceRefusals,
} from "@/lib/audiences/audience-account";
import { graphGetWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { withActPrefix, withoutActPrefix } from "@/lib/meta/ad-account-id";
import { listMetaPlatformIdsInScope } from "@/lib/creatives/asset-registry";
import {
  assetAccountChecks,
  hashesInAdImagesResponse,
  refuseForeignAssets,
  type AssetAccountCheck,
} from "@/lib/meta/asset-account-preflight";

/**
 * One batched audience read and one batched image read, then a single
 * registry read for videos. A mismatch returns before any campaign,
 * ad set, or creative POST.
 */
export async function foreignAccountLaunchError(args: {
  draft: CampaignDraft;
  adAccountId: string;
  token: string;
  supabase: unknown;
  userId: string;
}): Promise<string | null> {
  const problems: string[] = [];

  const refs = collectAudienceAccountRefs(args.draft);
  if (refs.length > 0) {
    try {
      const rows = await graphMultiGetByIds<{ account_id?: string }>(
        "",
        { ids: refs.map((ref) => ref.id).join(","), fields: "id,name,account_id" },
        args.token,
      );
      const accountIdByAudienceId: Record<string, string | undefined> = {};
      for (const ref of refs) {
        const accountId = rows[ref.id]?.account_id;
        if (accountId) accountIdByAudienceId[ref.id] = String(accountId);
      }
      const refusal = foreignAudienceRefusals(refs, accountIdByAudienceId, args.adAccountId);
      if (refusal) problems.push(refusal);
    } catch (err) {
      console.error("[launch-campaign] audience account check failed:", err);
      problems.push(
        "Could not verify which ad account these audiences belong to. Launch was not sent.",
      );
    }
  }

  const checks = assetAccountChecks(args.draft);
  const images = checks.filter((check) => check.kind === "image");
  const videos = checks.filter((check) => check.kind === "video");
  const verified: AssetAccountCheck[] = [];
  let presentHashes = new Set<string>();
  let videoIdsInAccount = new Set<string>();

  if (images.length > 0) {
    try {
      const body = await graphGetWithToken<unknown>(
        `/${withActPrefix(args.adAccountId)}/adimages`,
        {
          hashes: JSON.stringify([...new Set(images.map((check) => check.key))]),
          fields: "hash",
        },
        args.token,
      );
      presentHashes = hashesInAdImagesResponse(body);
      verified.push(...images);
    } catch (err) {
      console.error("[launch-campaign] adimages account check failed:", err);
      problems.push(
        "Could not verify which ad account these images belong to. Launch was not sent.",
      );
    }
  }

  if (videos.length > 0) {
    const scopes = [...new Set([args.adAccountId, withoutActPrefix(args.adAccountId)].filter(Boolean))];
    const listed = await listMetaPlatformIdsInScope(
      args.supabase,
      args.userId,
      scopes,
      [...new Set(videos.map((check) => check.key))],
    );
    if (!listed.ok) {
      if (!listed.tableMissing) {
        console.error("[launch-campaign] video registry account check failed:", listed.error);
        problems.push(
          "Could not verify which ad account these videos belong to. Launch was not sent.",
        );
      }
    } else {
      videoIdsInAccount = new Set(listed.platformIds);
      verified.push(...videos);
    }
  }

  const assetRefusal = refuseForeignAssets({
    checks: verified,
    presentHashes,
    videoIdsInAccount,
  });
  if (assetRefusal) problems.push(assetRefusal);
  return problems.length > 0 ? problems.join(" ") : null;
}
