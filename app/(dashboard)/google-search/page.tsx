import { redirect } from "next/navigation";

/**
 * The Google Search plans index was originally served here (/google-search)
 * but the left-nav "Google Ads" link has always pointed to /google-ads.
 *
 * The canonical list is now at /google-ads (which uses the session-bound
 * server client and queries google_search_plans correctly). Redirect here
 * to avoid a divergent stale page.
 *
 * The wizard at /google-search/[id] is unaffected.
 */
export default function GoogleSearchRedirectPage() {
  redirect("/google-ads");
}
