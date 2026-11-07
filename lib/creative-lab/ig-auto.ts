/**
 * Nightly Instagram import. Discovery always runs. Download, the text
 * check and the clip row run only when CREATIVE_LAB_IG_AUTO_IMPORT is
 * exactly "1". The Add button does not read this flag.
 */

export const IG_AUTO_IMPORT_PER_FORTNIGHT = 3;
export const IG_AUTO_CHECKS_PER_RUN = 10;
export const IG_FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

export function igAutoImportEnabled(value: string | undefined = process.env.CREATIVE_LAB_IG_AUTO_IMPORT): boolean {
  return value === "1";
}

/** How many new imports this artist may still take in the fortnight. */
export function fortnightRoom(importedAt: readonly (string | Date)[], now: Date, cap = IG_AUTO_IMPORT_PER_FORTNIGHT): number {
  const cutoff = now.getTime() - IG_FORTNIGHT_MS;
  const recent = importedAt.filter((value) => {
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(time) && time >= cutoff;
  }).length;
  return Math.max(0, cap - recent);
}

export type AutoArtistPlan = {
  artistId: string;
  name: string;
  room: number;
  download: string[];
  check: string[];
  capped: string[];
};

/**
 * Newest-best first is the candidate list already ranked by score.
 * Own-edge rows with a file are the ones that would download. Checks
 * stop at the run cap. Imports stop at the artist's fortnight room.
 */
export function planAutoImport(args: {
  artists: readonly { artistId: string; name: string; importedAt: readonly string[]; candidates: readonly { igMediaId: string; hasFile: boolean; status: string; score: number | null }[] }[];
  now: Date;
  checksLeft?: number;
}): { artists: AutoArtistPlan[]; checks: number } {
  let checks = args.checksLeft ?? IG_AUTO_CHECKS_PER_RUN;
  const artists: AutoArtistPlan[] = [];
  for (const artist of args.artists) {
    const room = fortnightRoom(artist.importedAt, args.now);
    const ranked = [...artist.candidates]
      .filter((row) => row.status === "candidate")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const download: string[] = [];
    const check: string[] = [];
    const capped: string[] = [];
    for (const row of ranked) {
      if (!row.hasFile) continue;
      if (download.length >= room || checks <= 0) {
        capped.push(row.igMediaId);
        continue;
      }
      download.push(row.igMediaId);
      check.push(row.igMediaId);
      checks -= 1;
    }
    artists.push({ artistId: artist.artistId, name: artist.name, room, download, check, capped });
  }
  return { artists, checks: (args.checksLeft ?? IG_AUTO_CHECKS_PER_RUN) - checks };
}
