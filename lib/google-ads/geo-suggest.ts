/**
 * lib/google-ads/geo-suggest.ts
 *
 * @deprecated Use `lib/google-ads/geo-resolve.ts` directly.
 *
 * Backwards-compatibility re-export barrel. All implementations now
 * live in `geo-resolve.ts` which is the single source of truth shared
 * by the push adapter and the live-preview API route.
 *
 * Old names are re-exported so existing imports (tests, campaign-writer)
 * keep compiling without modification during the transition.
 */

export {
  GEO_TARGET_CONSTANTS_MAP as UK_GEO_TARGET_CONSTANTS,
  lookupFallbackGeoConstant,
  resolveGeoLocations,
  type GeoResolution,
} from "./geo-resolve.ts";
