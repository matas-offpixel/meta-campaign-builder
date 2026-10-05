import type { CampaignDraft, WizardMode } from "../types.ts";
import {
  audienceAccountMismatch,
  collectAudienceAccountRefs,
  foreignAudienceRefusals,
} from "../audiences/audience-account.ts";
import { withActPrefix, withoutActPrefix } from "./ad-account-id.ts";
import {
  assetAccountChecks,
  collectAdImageHashes,
  refuseForeignAssets,
  videoIdsProvenOnAnotherAccount,
  type AssetAccountCheck,
} from "./asset-account-preflight.ts";

type AudienceRows = Record<string, { account_id?: string } | undefined>;

export interface AccountScopeReads {
  graphGet?: (
    path: string,
    params: Record<string, string>,
    token: string,
  ) => Promise<unknown>;
  graphMultiGet?: (
    path: string,
    params: { ids: string; fields: string },
    token: string,
  ) => Promise<AudienceRows>;
  listVideoScopes?: (
    supabase: unknown,
    platformIds: string[],
  ) => Promise<
    | { ok: true; rows: { platformId: string; scope: string }[] }
    | { ok: false; tableMissing: boolean; error: string }
  >;
  /** Absolute paging.next URL. It already carries the token; do not log it. */
  fetchNext?: (url: string) => Promise<unknown>;
  /**
   * Ad-account id → display name. Used only after an audience mismatch,
   * so image-hash reads are not asked for names.
   */
  listAccountNames?: (token: string) => Promise<ReadonlyMap<string, string>>;
}

async function defaultGraphGet(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<unknown> {
  const { graphGetWithToken } = await import("./client.ts");
  return graphGetWithToken(path, params, token);
}

async function defaultGraphMultiGet(
  path: string,
  params: { ids: string; fields: string },
  token: string,
): Promise<AudienceRows> {
  const { graphMultiGetByIds } = await import("./graph-multi-get.ts");
  return graphMultiGetByIds<{ account_id?: string }>(path, params, token);
}

async function defaultListVideoScopes(
  supabase: unknown,
  platformIds: string[],
): Promise<
  | { ok: true; rows: { platformId: string; scope: string }[] }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const { listMetaChannelScopes } = await import("../creatives/asset-registry.ts");
  return listMetaChannelScopes(supabase, platformIds);
}

function namesFromAdAccounts(body: unknown): Map<string, string> {
  const data = (body as { data?: Array<{ id?: string; name?: string; account_id?: string }> } | null)
    ?.data;
  const names = new Map<string, string>();
  if (!Array.isArray(data)) return names;
  for (const row of data) {
    const name = row?.name?.trim();
    if (!name) continue;
    if (row.account_id) names.set(withoutActPrefix(String(row.account_id)), name);
    if (row.id) names.set(withoutActPrefix(String(row.id)), name);
  }
  return names;
}

async function defaultListAccountNames(token: string): Promise<ReadonlyMap<string, string>> {
  const body = await defaultGraphGet(
    "/me/adaccounts",
    { fields: "id,name,account_id", limit: "200" },
    token,
  );
  return namesFromAdAccounts(body);
}

/** Audience checks create ad sets. Attach-to-ad-set launches do not. */
export function launchSendsAudiences(mode: WizardMode): boolean {
  return mode === "new" || mode === "attach_campaign";
}

async function fetchGraphNext(url: string): Promise<unknown> {
  const res = await fetch(url);
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
}

/**
 * One batched audience read and a paged image read, then one registry read
 * for videos. A thrown read is unverified and does not refuse. A mismatch
 * returns before any campaign, ad set, or creative POST.
 */
export async function foreignAccountLaunchError(args: {
  draft: CampaignDraft;
  adAccountId: string;
  token: string;
  supabase: unknown;
  userId: string;
  /** Omitted means the draft's mode, and a missing draft mode means a new campaign. */
  wizardMode?: WizardMode;
} & AccountScopeReads): Promise<string | null> {
  const problems: string[] = [];
  const wizardMode = args.wizardMode ?? args.draft.settings.wizardMode ?? "new";

  if (!launchSendsAudiences(wizardMode)) {
    console.info(`["account-scope-preflight"] audiences skipped: mode=${wizardMode}`);
  } else {
    const refs = collectAudienceAccountRefs(args.draft);
    if (refs.length > 0) {
      try {
        const graphMultiGet = args.graphMultiGet ?? defaultGraphMultiGet;
        const rows = await graphMultiGet(
          "",
          { ids: refs.map((ref) => ref.id).join(","), fields: "id,name,account_id" },
          args.token,
        );
        const accountIdByAudienceId: Record<string, string | undefined> = {};
        for (const ref of refs) {
          const accountId = rows[ref.id]?.account_id;
          if (accountId) accountIdByAudienceId[ref.id] = String(accountId);
        }
        const mismatched = refs.some((ref) => {
          const accountId = accountIdByAudienceId[ref.id];
          return !!accountId && audienceAccountMismatch(accountId, args.adAccountId);
        });
        let accountNames: ReadonlyMap<string, string> | undefined;
        if (mismatched) {
          try {
            const listAccountNames = args.listAccountNames
              ?? (args.graphMultiGet ? null : defaultListAccountNames);
            accountNames = listAccountNames ? await listAccountNames(args.token) : undefined;
          } catch (err) {
            console.error("[account-scope-preflight] ad account name lookup failed:", err);
          }
        }
        const refusal = foreignAudienceRefusals(
          refs,
          accountIdByAudienceId,
          args.adAccountId,
          accountNames,
        );
        if (refusal) problems.push(refusal);
      } catch (err) {
        console.error("[account-scope-preflight] audience account check failed:", err);
      }
    }
  }

  const checks = assetAccountChecks(args.draft);
  const images = checks.filter((check) => check.kind === "image");
  const videos = checks.filter((check) => check.kind === "video");
  const verifiedImages: AssetAccountCheck[] = [];
  let presentHashes = new Set<string>();
  let videoIdsInOtherAccount = new Set<string>();

  if (images.length > 0) {
    try {
      const graphGet = args.graphGet ?? defaultGraphGet;
      const fetchNext = args.fetchNext ?? fetchGraphNext;
      presentHashes = await collectAdImageHashes({
        hashes: images.map((check) => check.key),
        fetchPage: async (query) => {
          if ("next" in query) return fetchNext(query.next);
          return graphGet(
            `/${withActPrefix(args.adAccountId)}/adimages`,
            {
              hashes: JSON.stringify(query.hashes),
              fields: "hash",
              limit: query.limit,
            },
            args.token,
          );
        },
      });
      verifiedImages.push(...images);
    } catch (err) {
      console.error("[account-scope-preflight] adimages account check failed:", err);
    }
  }

  if (videos.length > 0) {
    try {
      const listVideoScopes = args.listVideoScopes ?? defaultListVideoScopes;
      const listed = await listVideoScopes(
        args.supabase,
        [...new Set(videos.map((check) => check.key))],
      );
      if (!listed.ok) {
        console.error("[account-scope-preflight] video registry read failed:", listed.error);
      } else {
        const classified = videoIdsProvenOnAnotherAccount(
          videos,
          listed.rows,
          args.adAccountId,
        );
        for (const id of classified.unverified) {
          console.info(`["account-scope-preflight"] video ${id} unverified`);
        }
        videoIdsInOtherAccount = classified.foreign;
      }
    } catch (err) {
      console.error("[account-scope-preflight] video registry read failed:", err);
    }
  }

  const assetRefusal = refuseForeignAssets({
    checks: [...verifiedImages, ...videos.filter((check) => videoIdsInOtherAccount.has(check.key))],
    presentHashes,
    videoIdsInOtherAccount,
  });
  if (assetRefusal) problems.push(assetRefusal);
  return problems.length > 0 ? problems.join(" ") : null;
}
