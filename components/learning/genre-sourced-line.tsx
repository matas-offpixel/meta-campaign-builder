/**
 * GK4's genre-sourced line (frame G3): the finding first, the source under
 * it. Not mounted on any live surface: no reader uses genre rows while every
 * pool is off (GK3). Internal only; never on a share link or client page.
 */
export function GenreSourcedLine({ finding, source }: { finding: string; source?: string | null }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2.5 text-xs text-foreground" data-genre-sourced-line>
      {finding}
      {source ? <span className="mt-1 block text-muted-foreground">{source}</span> : null}
    </p>
  );
}
