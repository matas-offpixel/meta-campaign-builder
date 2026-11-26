/**
 * lib/mcp/lab/words.ts — what the M3d-b Lab tools (list_tracks,
 * set_track_drop, list_clips, set_clip_owner) tell Claude. render_package's
 * picks.trackId refuses on M4's ruled needs row (#1388), so it adds none.
 *
 * Three kinds of string:
 *   - rows from design's lists, word for word, imported from where they
 *     already live: the Lab's own Snippet words (lib/creative-tests/snippet.ts:
 *     DROP_FOUND, dropSetBy, NO_CLEAR_DROP, cantUseText), the MCP's
 *     (claude.mcp.event.refused.unknown / .other_account / .code, claude.mcp.done);
 *   - design's corrected rows (verdict of 26 Nov on #1390), word for word, in
 *     LAB_RULED;
 *   - PENDING DESIGN: every string with no row yet. Each is in
 *     LAB_FOR_DESIGN with its key, where it shows and the builder's
 *     candidate; the PR body's "For design" table is that list. When design
 *     rules them, the ruled words replace the candidates here and the
 *     entries leave LAB_FOR_DESIGN.
 *
 * No raw error (a database error, a Drive or ffmpeg message) is ever put in
 * one of these. Claude gets names, counts, ids and links.
 *
 * Relative imports only (node:test).
 */
import { EVENT_WORDS } from "../meta/words.ts";
import { DROP_FOUND, NO_CLEAR_DROP, cantUseText, dropSetBy, mmss } from "../../creative-tests/snippet.ts";

export interface PendingWord {
  key: string;
  where: string;
  candidate: string;
}

/** Every PENDING DESIGN string, in one list (the PR body's "For design" table). */
export const LAB_FOR_DESIGN: PendingWord[] = [];

/** Registers a PENDING DESIGN string and returns its template. */
function pending(key: string, where: string, candidate: string): string {
  LAB_FOR_DESIGN.push({ key, where, candidate });
  return candidate;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
const n1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// ── Rows from design's lists (word for word) ─────────────────────────────────

export const LAB_ROWS = {
  /** claude.mcp.event.refused.unknown */
  unknownEvent: (code: string) => EVENT_WORDS.refusedUnknown(code),
  /** claude.mcp.event.refused.other_account */
  otherAccount: EVENT_WORDS.refusedOtherAccount,
  /** claude.mcp.event.refused.code */
  badCode: EVENT_WORDS.refusedCode,
  /** CT4: "Drop found by the Lab" / "Drop set by {first name}" / "No clear drop found. …" (the Snippet tab's line). */
  dropFound: DROP_FOUND,
  dropSetBy,
  noClearDrop: NO_CLEAR_DROP,
  /** AU1: "Can't use this file: {reason}". */
  cantUse: cantUseText,
} as const;

// ── Design's corrected rows (26 Nov verdict on #1390, word for word) ─────────

export const LAB_RULED = {
  /** claude.mcp.lab.scanned; {new} is newFiles(n). */
  scanned: "Read {artist}’s Audio folder: {new}.",
  /** claude.mcp.lab.owner.unknown_clip, one id. */
  ownerUnknownClip: "Refused: {id} isn’t one of {code}’s clips. Get the ids from list_clips. Nothing was changed.",
  /** claude.mcp.lab.owner.unknown_clip, more than one; {ids} joined with “, ”. */
  ownerUnknownClips: "Refused: {ids} aren’t {code}’s clips. Get the ids from list_clips. Nothing was changed.",
  /** claude.mcp.lab.owner.bad_name; {names} joined with “, ”. */
  ownerBadName: "Refused: the owner must be promoter or one of {code}’s lineup: {names}. Nothing was changed.",
} as const;

/** lab.scanned's {new}: never "1 new files". */
export const newFiles = (n: number) => (n === 0 ? "no new files" : n === 1 ? "1 new file" : `${n} new files`);

// ── PENDING DESIGN ───────────────────────────────────────────────────────────

const T = {
  noLineup: pending(
    "claude.mcp.lab.no_lineup",
    "Told to Claude, list_tracks / list_clips on a show with no Lab lineup",
    "{code} has no Lab lineup yet, so there’s no act’s Audio folder to read. Add the lineup in the Lab first.",
  ),
  unknownArtist: pending(
    "claude.mcp.lab.unknown_artist",
    "Told to Claude, an act not in the show’s Lab lineup; {names} joined with “, ”",
    "Refused: {artist} isn’t in {code}’s lineup. The lineup is {names}. Nothing was changed.",
  ),
  driveOff: pending(
    "claude.mcp.lab.drive_off",
    "Told to Claude, list_tracks when Drive isn’t connected",
    "Drive isn’t connected here, so the Audio folder wasn’t read: these are the files already in the Lab.",
  ),
  notOwnerNoScan: pending(
    "claude.mcp.lab.not_owner_no_scan",
    "Told to Claude, list_tracks on another account’s show",
    "This show belongs to another account, so its Audio folder wasn’t read: these are the files already in the Lab.",
  ),
  scanFailed: pending(
    "claude.mcp.lab.scan_failed",
    "Told to Claude, list_tracks, new files that couldn’t be read in (count only)",
    "{files} in {artist}’s Audio folder couldn’t be read in. Open the Snippet tab to see why.",
  ),
  noTracks: pending("claude.mcp.lab.no_tracks", "Told to Claude, list_tracks with no audio files", "No audio files for {code} yet. Put WAV, AIFF, FLAC or MP3 files in 02 Source / Audio / {artist} in Drive."),
  flagged: pending("claude.mcp.lab.track.flagged", "list_tracks, a rights-flagged track’s line", "Flagged: {flag}. Only Matas clears it, in the Lab."),
  trackUnknown: pending("claude.mcp.lab.drop.unknown", "Told to Claude, set_track_drop with a track id not on the show", "Refused: no track with id {id} on {code}. Get the ids from list_tracks. Nothing was changed."),
  trackUnusable: pending("claude.mcp.lab.drop.unusable", "Told to Claude, set_track_drop on a file that fails AU1", "Refused: {track} can’t take a drop: {reason}. Nothing was changed."),
  trackFlagged: pending("claude.mcp.lab.drop.flagged", "Told to Claude, set_track_drop on a rights-flagged track", "Refused: {track} is flagged ({flag}), so it can’t take a drop until Matas clears it in the Lab. Nothing was changed."),
  trackOutside: pending("claude.mcp.lab.drop.outside", "Told to Claude, set_track_drop with seconds outside the track", "Refused: {track} is {len} s long. Give the drop in seconds from 0 to {len}. Nothing was changed."),
  dropDone: pending("claude.mcp.lab.drop.done", "Told to Claude, set_track_drop saved; {before} is “not set” or m:ss", "Done: {track} · drop {before} → {after} ({s} s), set by hand. The window moves with it. Only the app changed; nothing went to Meta."),
  dropSame: pending("claude.mcp.lab.drop.same", "Told to Claude, set_track_drop at the drop already set", "Nothing changed: {track}’s drop is already at {after}."),
  dropFailed: pending("claude.mcp.lab.drop.failed", "Told to Claude, the drop save failed", "The drop couldn’t be saved. Try again. Nothing was changed."),
  clipsNone: pending("claude.mcp.lab.clips.none", "Told to Claude, list_clips with no clips", "No Lab clips for {code}’s lineup yet."),
  clipOtherClient: pending("claude.mcp.lab.clip.why.other_client", "list_clips, why a clip can’t be used here", "another client’s promoter footage"),
  clipShort: pending("claude.mcp.lab.clip.why.short", "list_clips, why a clip can’t be used here", "shorter than a cut"),
  ownerOtherClient: pending(
    "claude.mcp.lab.owner.other_client",
    "Told to Claude, set_clip_owner on another client’s footage",
    "Refused: {clip} is {client}’s footage, and only this show’s client’s own clips can be given an owner here. Nothing was changed.",
  ),
  ownerOtherClientUnnamed: pending(
    "claude.mcp.lab.owner.other_client.unnamed",
    "Told to Claude, the same when that client has no name",
    "Refused: {clip} is another client’s footage, and only this show’s client’s own clips can be given an owner here. Nothing was changed.",
  ),
  ownerNoLabArtist: pending(
    "claude.mcp.lab.owner.no_lab_artist",
    "Told to Claude, a lineup act with no Lab artist on the show’s client",
    "Refused: {artist} has no Lab artist on {client} yet, so footage can’t be marked as theirs. Add them in the Lab first. Nothing was changed.",
  ),
  ownerEmpty: pending("claude.mcp.lab.owner.empty", "Told to Claude, set_clip_owner with no clip ids", "Refused: give the clip ids from list_clips. Nothing was changed."),
  ownerSaveFailed: pending("claude.mcp.lab.owner.save_failed", "Told to Claude, set_clip_owner failed before a clip was saved", "The owner couldn’t be saved. Try again. Nothing was changed."),
  ownerDone: pending("claude.mcp.lab.owner.done", "Told to Claude, set_clip_owner saved; {owner} is the client’s name or the act’s", "Done: {clips} now {owner}’s footage. Only the app changed; nothing went to Meta."),
  ownerFailed: pending("claude.mcp.lab.owner.failed", "Told to Claude, the owner save failed part way ({a} of {n} saved)", "{a} of {clips} saved before the save failed. Try again with the rest. Nothing else was changed."),
} as const;

const tracks = (n: number) => (n === 1 ? "1 file" : `${n} files`);
const clips = (n: number) => (n === 1 ? "1 clip is" : `${n} clips are`);

export const LAB_WORDS = {
  noLineup: (code: string) => fill(T.noLineup, { code }),
  unknownArtist: (artist: string, code: string, names: readonly string[]) => fill(T.unknownArtist, { artist, code, names: names.join(", ") }),
  driveOff: T.driveOff,
  notOwnerNoScan: T.notOwnerNoScan,
  scanned: (artist: string, n: number) => fill(LAB_RULED.scanned, { artist, new: newFiles(n) }),
  scanFailed: (artist: string, n: number) => fill(T.scanFailed, { artist, files: tracks(n) }),
  noTracks: (code: string, artist: string) => fill(T.noTracks, { code, artist }),
  flagged: (flag: string) => fill(T.flagged, { flag }),
  trackUnknown: (id: string, code: string) => fill(T.trackUnknown, { id, code }),
  trackUnusable: (track: string, reason: string) => fill(T.trackUnusable, { track, reason }),
  trackFlagged: (track: string, flag: string) => fill(T.trackFlagged, { track, flag }),
  trackOutside: (track: string, len: number) => fill(T.trackOutside, { track, len: n1(len) }),
  dropDone: (track: string, before: number | null, after: number) =>
    fill(T.dropDone, { track, before: before == null ? EVENT_WORDS.notSet : mmss(before), after: mmss(after), s: n1(after) }),
  dropSame: (track: string, after: number) => fill(T.dropSame, { track, after: mmss(after) }),
  dropFailed: T.dropFailed,
  clipsNone: (code: string) => fill(T.clipsNone, { code }),
  clipOtherClient: T.clipOtherClient,
  clipShort: T.clipShort,
  ownerUnknownClip: (ids: readonly string[], code: string) =>
    ids.length === 1 ? fill(LAB_RULED.ownerUnknownClip, { id: ids[0]!, code }) : fill(LAB_RULED.ownerUnknownClips, { ids: ids.join(", "), code }),
  ownerOtherClient: (clip: string, client: string | null) => (client ? fill(T.ownerOtherClient, { clip, client }) : fill(T.ownerOtherClientUnnamed, { clip })),
  ownerBadName: (code: string, names: readonly string[]) => fill(LAB_RULED.ownerBadName, { code, names: names.join(", ") }),
  ownerNoLabArtist: (artist: string, client: string) => fill(T.ownerNoLabArtist, { artist, client }),
  ownerEmpty: T.ownerEmpty,
  ownerDone: (n: number, owner: string) => fill(T.ownerDone, { clips: clips(n), owner }),
  ownerSaveFailed: T.ownerSaveFailed,
  ownerFailed: (a: number, n: number) => fill(T.ownerFailed, { a, clips: n === 1 ? "1 clip" : `${n} clips` }),
} as const;
