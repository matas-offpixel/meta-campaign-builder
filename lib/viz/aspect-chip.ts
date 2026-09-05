/** A ratio (`9:16`) or `—`. Never `OTHER` / unknown tokens. */
export function aspectChipRatio(ratio: string | null | undefined): string {
  const trimmed = (ratio ?? "").trim();
  if (/^\d+:\d+$/.test(trimmed)) return trimmed;
  return "—";
}
