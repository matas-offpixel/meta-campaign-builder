/**
 * lib/meta/ig-identity-guard.ts
 *
 * Pure decision logic for "is the operator-picked Instagram account actually
 * authorised to run ads on this ad account?".
 *
 * Background (task #96, 2026-07-27/28):
 *   `resolveIgActorForAdAccount` used to substitute the FIRST actor from
 *   `GET /act_{id}/instagram_accounts` whenever the picked IG wasn't in that
 *   list. The substitution was logged as a warning and otherwise invisible, so
 *   a creative built for @electricstudiossheff shipped as @shuffa_uk. Sending
 *   an ad under the wrong client's handle is a trust incident, so the only
 *   acceptable outcomes are "ship exactly what the operator picked" or "refuse
 *   to launch".
 *
 * The block-vs-allow rule is deliberately asymmetric:
 *
 *   Block ONLY on positive evidence of a mismatch — the ad account returned a
 *   non-empty authoritative actor list AND the picked id is absent from both
 *   that list and the page-level list.
 *
 * Absence of evidence never blocks. An empty or unfetchable actor list means
 * the app OAuth token can't see the assets (narrower visibility than Ads
 * Manager — the whole reason BM Asset Sync exists), not that the pick is
 * wrong. Blocking on that would break every agency setup where the IG is
 * linked to the Page but not registered as a BM asset on the ad account
 * (PR #567, 4thefans WC26) and would regress PR #602, where a transient empty
 * list caused the operator's pick to be dropped entirely.
 */

/** Minimal shape of an IG account as returned by Meta's actor/account lists. */
export interface IgActorRef {
  id: string;
  username?: string;
}

export type IgIdentityVerdict =
  /** The picked id is present in an authoritative list — safe to send. */
  | { status: "authorised"; igId: string; via: "ad_account" | "page_level" }
  /**
   * Positive evidence the pick is wrong: the ad account published a non-empty
   * actor list and the picked id is in neither it nor the page-level list.
   */
  | { status: "mismatch"; igId: string; adAccountActors: IgActorRef[] }
  /**
   * No authoritative list available (empty, unfetchable, or the picked id is
   * page-linked only and we had no page list). Never blocks — the launch
   * proceeds with the operator's pick.
   */
  | { status: "unverified"; igId: string; reason: string };

export interface EvaluateIgIdentityInput {
  /** The IG id that will actually be sent to Meta. */
  pickedIgId: string;
  /**
   * `GET /act_{adAccountId}/instagram_accounts`. Pass `null` when the call
   * failed — that is materially different from a successful empty response,
   * though both are treated as "unverified".
   */
  adAccountActors: IgActorRef[] | null;
  /**
   * IG ids linked to the creative's Facebook Page, from
   * `GET /{pageId}/instagram_accounts`. Pass `null` when unavailable.
   */
  pageIgIds?: string[] | null;
}

export function evaluateIgIdentity(input: EvaluateIgIdentityInput): IgIdentityVerdict {
  const { pickedIgId, adAccountActors, pageIgIds } = input;

  if (!pickedIgId) {
    return { status: "unverified", igId: "", reason: "no Instagram id selected" };
  }

  if (adAccountActors?.some((a) => a.id === pickedIgId)) {
    return { status: "authorised", igId: pickedIgId, via: "ad_account" };
  }

  // Page-level linkage is a valid authorisation path for agency setups where
  // the IG is linked to the Page but is not a BM asset on the ad account.
  if (pageIgIds?.includes(pickedIgId)) {
    return { status: "authorised", igId: pickedIgId, via: "page_level" };
  }

  if (adAccountActors === null) {
    return {
      status: "unverified",
      igId: pickedIgId,
      reason: "ad account instagram_accounts lookup failed",
    };
  }

  if (adAccountActors.length === 0) {
    return {
      status: "unverified",
      igId: pickedIgId,
      reason: "ad account returned no authorised Instagram accounts",
    };
  }

  return { status: "mismatch", igId: pickedIgId, adAccountActors };
}

/** One blocked creative, ready to be rendered into the aggregated error. */
export interface IgMismatchEntry {
  /** Ad / creative name, for operator orientation. */
  creativeName: string;
  pageId?: string;
  pageName?: string;
  pickedIgId: string;
  /** Handle for the picked id when known — makes the message readable. */
  pickedUsername?: string;
  adAccountActors: IgActorRef[];
}

export interface IgMismatchLinkContext {
  /** Business Manager id, when known — deep-links straight to the right BM. */
  businessId?: string;
}

function handle(username: string | undefined, fallbackId: string): string {
  if (!username) return fallbackId;
  return username.startsWith("@") ? username : `@${username}`;
}

/** `/business-managers` deep link for granting the IG asset to the app. */
export function buildIgGrantUrl(ctx?: IgMismatchLinkContext): string {
  const base = "/business-managers?tab=ig-accounts";
  return ctx?.businessId ? `${base}&bm=${ctx.businessId}` : base;
}

/**
 * One actionable line per blocked creative. Names the picked handle, the
 * handles the ad account WILL accept, and the remediation link — everything
 * the operator needs without opening Vercel logs.
 */
export function describeIgMismatch(
  entry: IgMismatchEntry,
  ctx?: IgMismatchLinkContext,
): string {
  const picked = handle(entry.pickedUsername, entry.pickedIgId);
  const authorised = entry.adAccountActors
    .map((a) => handle(a.username, a.id))
    .join(", ");
  const pageLabel = entry.pageName ?? entry.pageId;

  return (
    `"${entry.creativeName}": Instagram ${picked} isn't authorised on this ad account` +
    (pageLabel ? ` (page ${pageLabel})` : "") +
    `. Authorised accounts: ${authorised || "(none)"}. ` +
    `Grant it via ${buildIgGrantUrl(ctx)} or pick an IG from the authorised list.`
  );
}

/**
 * Aggregate every mismatch into one preflight failure, deduped by
 * creative + picked id so a 40-ad launch doesn't emit 40 identical lines.
 */
export function describeIgMismatches(
  entries: IgMismatchEntry[],
  ctx?: IgMismatchLinkContext,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of entries) {
    const key = `${entry.creativeName}::${entry.pickedIgId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(describeIgMismatch(entry, ctx));
  }
  return lines;
}

/**
 * Single-line audit record for every IG resolution decision, so a future
 * wrong-handle report can be traced in Vercel without a repro.
 */
export function formatIgResolutionAudit(record: {
  stage: string;
  pageId?: string;
  adAccountId?: string;
  pickedIgId?: string;
  resolvedIgId?: string;
  source: string;
  adAccountAvailable: IgActorRef[] | null;
}): string {
  const available =
    record.adAccountAvailable === null
      ? "(lookup failed)"
      : record.adAccountAvailable.length === 0
        ? "(empty)"
        : record.adAccountAvailable
            .map((a) => `${a.id}${a.username ? `(@${a.username.replace(/^@/, "")})` : ""}`)
            .join(",");

  return (
    `[ig-identity-audit] stage=${record.stage} ` +
    `adAccount=${record.adAccountId ?? "(none)"} ` +
    `page=${record.pageId ?? "(none)"} ` +
    `pickedIgId=${record.pickedIgId || "(none)"} ` +
    `resolvedIgId=${record.resolvedIgId || "(none)"} ` +
    `source=${record.source} ` +
    `adAccountAvailable=[${available}]`
  );
}
