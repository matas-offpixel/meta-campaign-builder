/**
 * Google Ads reporting runs under its own tiny concurrency budget. Do not share
 * Meta/TikTok knobs here: each platform has independent rate-limit behaviour.
 */
export const GOOGLE_ADS_CHUNK_CONCURRENCY = 1;
