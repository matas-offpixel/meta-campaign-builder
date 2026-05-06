export interface AudiencePageLike {
  id: string;
  name?: string;
  slug?: string;
}

export function filterPagesByQuery<T extends AudiencePageLike>(
  pages: T[],
  rawQuery: string,
): T[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => {
    const name = (p.name ?? "").toLowerCase();
    const slug = (p.slug ?? "").toLowerCase();
    const id = String(p.id ?? "").toLowerCase();
    return name.includes(q) || slug.includes(q) || id.includes(q);
  });
}
