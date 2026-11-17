/**
 * GK3's operator status lines on the learning-refresh report (frame G4).
 * One line per job; the lines come from lib/learning/genre/shadow.ts
 * (`genreStatusLines`). Shuffle percentages appear only here.
 */
export function GenrePoolStatus({ lines }: { lines: readonly string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="mt-3 space-y-1.5" data-genre-pool-status>
      {lines.map((line) => (
        <li key={line} className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">
          {line}
        </li>
      ))}
    </ul>
  );
}
