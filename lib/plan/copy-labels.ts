/** Operator-facing lines for section ③. Kept out of the component so a sentence is not a JSX literal. */

export const COPY_FIELDS = [
  ["caption", "Caption"],
  ["url", "URL"],
  ["cta", "CTA"],
  ["headline", "Headline"],
  ["description", "Description"],
] as const;

export const COPY_GROUPS = [
  ["metaPrimary", "Primary text"],
  ["metaHeadlines", "Headlines"],
  ["metaDescriptions", "Descriptions"],
  ["tiktok", "TikTok"],
  ["googleHeadlines", "Google headlines"],
  ["googleDescriptions", "Google descriptions"],
] as const;
