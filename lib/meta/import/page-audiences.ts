/**
 * The four labels `launch-campaign` writes, in `${pageName} — ${label}`.
 * `sanitizeAudienceName` strips the em dash, so Meta stores two spaces.
 */
const ENGAGEMENT_LABELS = [
  "FB Likes",
  "FB Engagement 365d",
  "IG Followers",
  "IG Engagement 365d",
] as const;

const LABEL_PATTERN = ENGAGEMENT_LABELS.map((label) => label.replace(/ /g, "\\ ")).join("|");

const ENGAGEMENT_NAME = new RegExp(`^(.+?)(?: — |  )(${LABEL_PATTERN})$`);

export type PageDerivedName = { page: string; engagement: string };

/** A name this app wrote. Enough to label, not enough to rebuild a page group. */
export function pageDerivedFromName(name: string | null | undefined): PageDerivedName | null {
  const match = name?.trim().match(ENGAGEMENT_NAME);
  if (!match) return null;
  const page = match[1]?.trim() ?? "";
  const engagement = match[2] ?? "";
  if (!page || !engagement) return null;
  return { page, engagement };
}

export function pageDerivedBadge(name: string | null | undefined): string | null {
  const parsed = pageDerivedFromName(name);
  if (!parsed) return null;
  return `page-derived · ${parsed.page}`;
}

/**
 * How many distinct custom audiences carry a page-derived badge.
 * The Pages tab says this when an imported draft has no page groups:
 * the audiences stayed in Custom, which is how the ad set targeted them.
 */
export function importedPageDerivedSentence(
  groups: readonly {
    audienceIds: readonly string[];
    audienceNames?: Readonly<Record<string, string>>;
  }[],
): string | null {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const id of group.audienceIds) {
      if (seen.has(id)) continue;
      if (pageDerivedFromName(group.audienceNames?.[id])) seen.add(id);
    }
  }
  if (seen.size === 0) return null;
  const noun = seen.size === 1 ? "audience is" : "audiences are";
  return `${seen.size} page-derived ${noun} in Custom, as the source ad sets targeted them.`;
}
