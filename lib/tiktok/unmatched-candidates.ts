/**
 * Shared miss alarm for alternate-key walks.
 * A silent null is how `avatar_url` survived on `/identity/get/`.
 */
export function logUnmatchedCandidates(
  context: string,
  keys: readonly string[],
): void {
  console.error(
    `[tiktok/unmatched] ${context} none of [${keys.join(", ")}] matched`,
  );
}
