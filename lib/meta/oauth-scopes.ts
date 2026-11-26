/**
 * The Facebook OAuth scopes Off/Pixel asks for: one list for the dialog
 * (lib/facebook-connect.ts, /api/auth/facebook-start) and the settings
 * page's granted-scopes check (lib/settings/connection-status.ts).
 * FACEBOOK_OAUTH_SCOPES, when set, overrides it on a deployment.
 *
 *   pages_show_list        list Pages the user manages
 *   pages_read_engagement  read Page metadata; mints Page tokens for feed and IG media
 *   ads_management         create campaigns, ad sets, ads, creatives, audiences
 *   ads_read               read ad account data
 *   instagram_basic        the linked IG account's profile and media
 *   business_management    BM-owned Pages and IG accounts, the BM tool
 *   pages_manage_metadata  M3c: ask a Page for access from a client's Business
 *                          Manager (POST /{business}/client_pages). "Manage
 *                          Pages" use case, Standard access (Matas, 26 Nov).
 *
 * Pure: no imports.
 */
export const DEFAULT_FACEBOOK_OAUTH_SCOPES =
  "pages_show_list,pages_read_engagement,ads_management,ads_read,instagram_basic,business_management,pages_manage_metadata";

/** The scopes a deployment asks for: FACEBOOK_OAUTH_SCOPES, else the default. */
export function facebookOAuthScopes(env: Record<string, string | undefined> = process.env): string {
  return env.FACEBOOK_OAUTH_SCOPES?.trim() || DEFAULT_FACEBOOK_OAUTH_SCOPES;
}
