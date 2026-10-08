/**
 * MML (Multi Media Launcher) routes. MML is the product name for what the
 * code and tables still call a plan (`campaign_plans`, `lib/plan/*`).
 *
 * `/plans` and `/plan/[id]` were the routes until M1; they stay reachable
 * as permanent redirects so bookmarks, Slack links and `?drawer=f|tt|g`
 * deep links keep working. Next appends the incoming query string to the
 * destination; the fragment never reaches the server and the browser
 * re-applies it after the redirect.
 *
 * Imported by `next.config.ts`, so this file stays dependency-free.
 */

export const MML_LIST_PATH = "/mml";
export const MML_NEW_ID = "new";

export function mmlPlanHref(planId: string): string {
  return `${MML_LIST_PATH}/${planId}`;
}

export const MML_NEW_HREF = mmlPlanHref(MML_NEW_ID);

/** `/mml`, `/mml/*`, and the legacy `/plans` and `/plan/*` before they redirect. */
export function mmlNavMatch(pathname: string): boolean {
  return (
    pathname === MML_LIST_PATH ||
    pathname.startsWith(`${MML_LIST_PATH}/`) ||
    pathname === "/plans" ||
    pathname.startsWith("/plan/")
  );
}

export interface MmlLegacyRedirect {
  source: string;
  destination: string;
  permanent: true;
}

export const MML_LEGACY_REDIRECTS: readonly MmlLegacyRedirect[] = [
  { source: "/plans", destination: MML_LIST_PATH, permanent: true },
  { source: "/plan/:id", destination: `${MML_LIST_PATH}/:id`, permanent: true },
];
