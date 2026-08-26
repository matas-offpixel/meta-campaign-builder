export function shortBlockerLabel(message: string, maxWords = 5): string {
  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

export interface BlockerRowModel {
  id: string;
  label: string;
  full: string;
  href: string | null;
}

export function blockerRowFromIssue(issue: {
  id: string;
  message: string;
  href?: string | null;
}): BlockerRowModel {
  return {
    id: issue.id,
    label: shortBlockerLabel(issue.message),
    full: issue.message,
    href: issue.href ?? null,
  };
}
