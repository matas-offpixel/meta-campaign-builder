/**
 * lib/mcp/folder-in/words.ts — what upload_to_event_folder (M3d-c) tells
 * Claude.
 *
 * PENDING DESIGN: every row below is a candidate, keyed
 * claude.mcp.folder_in.*, listed in the PR body's "For design" table. None
 * is on a screen; Claude relays them in chat. Refusals end "Nothing was
 * changed." Names, counts, ids and links only: never a raw Drive or
 * database error.
 *
 * Reused as written: claude.mcp.event.refused.code / .unknown /
 * .other_account (lib/mcp/meta/words.ts EVENT_WORDS).
 *
 * Relative imports only (node:test).
 */

/** PENDING DESIGN — claude.mcp.folder_in.* */
export const FOLDER_IN_WORDS = {
  /** claude.mcp.folder_in.done: {file} copied or uploaded into {folder}. */
  done: (file: string, folder: string, link: string) => `Done: ${file} is in ${folder}. Drive: ${link}`,
  /** claude.mcp.folder_in.already: a retry of the same file into the same folder. */
  already: (file: string, folder: string, link: string) => `Nothing changed: ${file} is already in ${folder}. Drive: ${link}`,
  /** claude.mcp.folder_in.read_in.clip: a clip in 02 Source / Artist clips / {artist}; the Drive pickup (every 15 min) reads it in (Matas, 26 Nov: "Yes, read them in."). */
  readInClip: (artist: string) => `The Drive pickup reads it in as ${artist}’s clip on the show within 15 minutes.`,
  /** claude.mcp.folder_in.read_in.track: a track in 02 Source / Audio / {artist}; the Snippet tab's scan (and list_tracks) reads it in. */
  readInTrack: (artist: string) => `It’s read in as ${artist}’s track the next time the Snippet tab opens or list_tracks runs.`,
  /** claude.mcp.folder_in.refused.folder: the folder text isn't one of the five. */
  refusedFolder:
    "Refused: the folder must be 01 Open files, 3 On sale, 02 Source / Artist clips / {artist}, 02 Source / Audio / {artist} or w/c {d Mon} / {owner} / Videos or Statics. Nothing was changed.",
  /** claude.mcp.folder_in.refused.outside_tree: a folder id that isn't this show's. */
  refusedOutsideTree: (code: string) => `Refused: that folder isn’t in ${code}’s Drive folders. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.not_made: the show's tree doesn't have that folder yet. */
  refusedNotMade: (folder: string) => `Refused: ${folder} isn’t made in this show’s Drive folders yet. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.no_tree: the event has no Drive folder. */
  refusedNoTree: (code: string) => `Refused: ${code} has no Drive folders yet. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.artist: {artist} isn't on the show's Lab lineup. */
  refusedArtist: (artist: string, names: string) =>
    names ? `Refused: ${artist} isn’t on this show’s lineup (${names}). Nothing was changed.` : `Refused: ${artist} isn’t on this show’s lineup, and the lineup is empty. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.cycle: no w/c folder of that name on this show. */
  refusedCycle: (cycle: string) => `Refused: this show has no ${cycle} folder. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.cycle_twice: two w/c folders share the name (two years). */
  refusedCycleTwice: (cycle: string) => `Refused: this show has two ${cycle} folders. Give the Monday as w/c YYYY-MM-DD. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.owner: no {owner} folder under that w/c. */
  refusedOwner: (owner: string, cycle: string, names: string) =>
    names ? `Refused: ${cycle} has no ${owner} folder (it has ${names}). Nothing was changed.` : `Refused: ${cycle} has no owner folders yet. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.source: give exactly one of drive_file_id and storage_path. */
  refusedSource: "Refused: give a Drive file id or a Storage path, one of them. Nothing was changed.",
  /** claude.mcp.folder_in.refused.source_outside: the Drive file isn't in the Off/Pixel shared drive. */
  refusedSourceOutside: (id: string) => `Refused: file ${id} isn’t in the Off/Pixel shared drive. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.source_folder: the Drive id is a folder or a shortcut. */
  refusedSourceFolder: (id: string) => `Refused: ${id} is a folder or a shortcut, not a file. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.other_client (mirrors claude.mcp.attach.other_client). */
  refusedOtherClient: (name: string, client: string) =>
    `Refused: ${name} is in ${client}’s folders, and only this show’s client’s own files or the artist library can go in its folders. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.other_client.unnamed */
  refusedOtherClientUnnamed: (name: string) =>
    `Refused: ${name} is in another client’s folders, and only this show’s client’s own files or the artist library can go in its folders. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.owner_unknown (mirrors claude.mcp.attach.owner_unknown). */
  refusedOwnerUnknown: (name: string) =>
    `Refused: ${name} isn’t under an event, a client’s folder or 00 Artist Library, so whose it is can’t be told. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.storage: the Storage path isn't on one of this show's drafts. */
  refusedStorage: "Refused: that Storage path isn’t a file on one of this show’s drafts. Nothing was changed.",
  /** claude.mcp.folder_in.refused.kind: a video into Statics, a photo into Videos, a non-audio file into Audio. */
  refusedKind: (name: string, folder: string, want: string) => `Refused: ${name} isn’t ${want}, so it can’t go in ${folder}. Nothing was changed.`,
  want: { video: "a video", static: "a photo", audio: "an audio file" } as Record<string, string>,
  /** claude.mcp.folder_in.refused.too_large: a Storage file over the picker's cap. */
  refusedTooLarge: (name: string, mb: number) => `Refused: ${name} is over ${mb} MB. Nothing was changed.`,
  /** claude.mcp.folder_in.refused.no_drive: the export Drive isn't set up on this deployment. */
  refusedNoDrive: "Refused: Drive isn’t set up in Off/Pixel. Nothing was changed.",
  /** claude.mcp.folder_in.failed: Drive or Storage failed. */
  failed: "The file couldn’t be put in the folder. Try again: a file already there isn’t copied twice. Nothing was changed.",
  /** claude.mcp.folder_in.refused.scope */
  refusedScope: "Refused: this connection can only read. Reconnect Off/Pixel in Claude and allow draft changes. Nothing was changed.",
} as const;

export const FOLDER_IN_DESCRIPTION = [
  "Puts one file into a folder of a show's Drive tree, as the Off/Pixel service account: 01 Open files, 3 On sale, 02 Source / Artist clips / {artist}, 02 Source / Audio / {artist}, or w/c {d Mon} / {owner} / Videos | Statics (an owner folder the filing already made).",
  "The file is a Drive file id from the Off/Pixel shared drive (copied; the original stays where it is) or a Storage path on one of the show's drafts (uploaded). Only the show's client's own files or the artist library.",
  "It never shares, moves, renames or deletes anything, and makes no folders: a folder the show doesn't have yet is refused.",
  "A clip in Artist clips and a track in Audio are read into the Lab like a file dropped there by hand.",
  'Example: upload_to_event_folder({ event_code: "ES27-ENZOSIRAGUSA", folder: "w/c 30 Nov / Enzo Siragusa / Videos", drive_file_id: "1AbC…" }).',
].join(" ");
