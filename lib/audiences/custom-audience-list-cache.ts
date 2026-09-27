import type { CustomAudience } from "../types.ts";

const cache = new Map<string, CustomAudience[]>();

/** Keep a just-created audience in the account list until Meta's GET includes it. */
export function rememberCustomAudience(
  adAccountId: string,
  audience: CustomAudience,
): CustomAudience[] {
  const prev = cache.get(adAccountId) ?? [];
  const next = [audience, ...prev.filter((row) => row.id !== audience.id)];
  cache.set(adAccountId, next);
  return next;
}

export function cachedCustomAudiences(adAccountId: string): CustomAudience[] {
  return cache.get(adAccountId) ?? [];
}

/** Server list wins on id. Rows we created that Meta has not listed yet stay. */
export function mergeCustomAudienceList(
  adAccountId: string,
  server: CustomAudience[],
): CustomAudience[] {
  const prev = cache.get(adAccountId) ?? [];
  const serverIds = new Set(server.map((row) => row.id));
  const pending = prev.filter((row) => !serverIds.has(row.id));
  const merged = [...pending, ...server];
  cache.set(adAccountId, merged);
  return merged;
}
