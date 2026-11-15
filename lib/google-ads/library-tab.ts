/** Search | YouTube on /google-ads. Anything else is Search. */

export type GoogleAdsLibraryTab = "search" | "youtube";

export function googleAdsLibraryTab(value: string | string[] | undefined): GoogleAdsLibraryTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "youtube" ? "youtube" : "search";
}
