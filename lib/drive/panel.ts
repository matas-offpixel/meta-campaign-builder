/**
 * The Drive panel, the upload's folder question, and the share ask (S16,
 * S22, S23, S25). Pure: the sentences are the record's, and the "now:" line
 * is the routing table (routeRender / the cycle the tick files into).
 *
 * Record: docs/design-record/2026-11-09-creative-lab-clip-selection.html.
 */

import {
  ARTIST_CLIPS_KEY,
  EVENT_KEY,
  EVENT_TREE,
  PRESS_KITS_KEY,
  WINNERS_KEY,
  cycleFolderName,
  cycleKey,
  cycleMondayFor,
  eventFolderName,
  renderStage,
  showWeekMonday,
  type CycleCalendar,
  type FolderKey,
} from "./tree.ts";

export const DRIVE_HEADER = "Drive folder ↗";
export const SETUP_HEADER = "Set up Drive";
export const OPEN_IN_DRIVE = "Open in Drive ↗";
export const SHARE_WITH_PROMOTER = "Share with promoter";
export const SHARE = "Share";
export const NOT_SHARED = "Not shared";
export const UPLOAD_A_FILE = "Upload a file";
export const SIGN_IN_AGAIN = "Sign in again.";
export const UNREADABLE_REQUEST = "That request couldn't be read — reload the page and try again.";
export const PLAN_NOT_ON_ACCOUNT = "That plan isn't on this account.";
export const EVENT_NOT_ON_ACCOUNT = "That event isn't on this account.";
export const RENDER_NOT_ON_EVENT = "That render isn't on this event.";
export const RENDER_NOT_READY = "This render isn't ready to add yet — add it once its row reads Ready.";
export const FOLDER_NOT_IN_TREE = "That folder isn't in this event's tree — choose another.";
export const NO_CLIENT_TREE = "This event has no client, so there's no client folder for the tree — set the client first.";
export const CANCELLED_TREE = "This event is cancelled, so no tree is made for it.";
export const TREE_NOT_MADE = "The tree wasn't made — try again; if it fails twice, check the export account can add folders in Off / Pixel.";

export function archivedClientTree(clientName: string): string {
  return `${clientName} is archived, so no new folders are made for it.`;
}
export const IN_DRIVE = "in Drive";
export const DRIVE_FAILED_LEAD = "Drive copy failed — ";
export const DRIVE_RETRY = "retry";
export const WHICH_FOLDER = "Which folder?";
export const CANCEL = "Cancel";
export const UPLOAD = "Upload";
export const CHANGE = "Change";
export const CHOOSE_ARTIST = "choose artist";
export const ANOTHER_FOLDER = "Another folder in the tree…";
export const FROM_THE_LAB = "From the Lab";
export const LAB_ADD = "Add";
export const LAB_ADDED = "✓ Added";
export const LAB_EMPTY = "No finished renders for this event yet — propose a round in the Creative Lab.";
export const SETUP_TITLE = "Set up Drive";
export const SETUP_INTRO = "This event has no Drive folder yet. Nothing is moved either way.";
export const SETUP_INTRO_NARROW = "Nothing is moved either way.";
export const LINK_TITLE = "Link existing folder";
export const LINK_HINT = "Paste the folder's Drive link.";
export const LINK_NOTE = "Becomes this event's folder as it is. Its files stay where they are and nothing is renamed; the tree's folders are added inside it, empty.";
export const LINK_BUTTON = "Link folder";
export const CREATE_TITLE = "Create the tree";
export const CREATE_HINT = "Makes the standard folders for this event.";
export const CREATE_NOTE = "00 Brief & admin to 06 Post-event and _Winners; on-sale w/c folders follow the payday cadence.";
export const CREATE_BUTTON = "Create the tree";
export const CANT_OPEN_FOLDER = "Can't open that folder — share it with the export account or move it into Off / Pixel, then link it again.";
export const DRIVE_LINK = "Drive ↗";
export const DRIVE_LINK_NARROW = "↗";

export const TOP_LEVEL: readonly { key: FolderKey; name: string }[] = [
  { key: "00", name: "00 Brief & admin" },
  { key: "01", name: "01 Open files" },
  { key: "02", name: "02 Source" },
  { key: "03", name: "03 Creatives" },
  { key: "04", name: "04 D2C" },
  { key: "05", name: "05 Reports" },
  { key: "06", name: "06 Post-event" },
  { key: WINNERS_KEY, name: "_Winners" },
];

const NAME_RULES = ["brief", "contract", "budget", "set times", "clearance"] as const;
const FONT = /\.(ttf|otf|woff2?)$/i;
const DESIGN = /\.(psd|ai)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

export type UploadArtist = { id: string; name: string };

export type UploadFile = {
  name: string;
  /** Set when the file was picked from Clips. */
  fromClips?: boolean;
  /** The Clips artist the file was dropped for, when the name does not say it. */
  artistId?: string | null;
};

export type FolderChoice = {
  key: string;
  label: string;
  artistId: string | null;
  artistName: string | null;
  /** The record's "likely — \"…\" in the name", or null. */
  likely: string | null;
};

export function driveHeaderLabel(hasFolder: boolean): string {
  return hasFolder ? DRIVE_HEADER : SETUP_HEADER;
}

export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}

export function artistFolderMissSentence(folderName: string): string {
  return `A folder in Artist clips matches no artist: '${folderName}' — rename it to the artist's name.`;
}

export function shareStateLine(client: string, shared: boolean): string {
  return shared ? `Shared with ${client}'s contact · view only · Stop sharing` : NOT_SHARED;
}

export function shareConfirm(client: string): string {
  return `Give ${client}'s contact view access to this event's folder?`;
}

/** First click asks. The grant happens on the confirm, never on the first click and never by itself. */
export type SharePhase = "idle" | "asking";

export function nextSharePhase(phase: SharePhase, click: "share" | "stop" | "dismiss"): { phase: SharePhase; call: "share" | "stop" | null } {
  if (click === "stop") return { phase: "idle", call: "stop" };
  if (click === "dismiss") return { phase: "idle", call: null };
  if (phase === "asking") return { phase: "idle", call: "share" };
  return { phase: "asking", call: null };
}

export function winnersLabel(count: number): string {
  return count > 0 ? String(count) : "none yet";
}

export function panelNowLine(input: { status: string | null; eventDate: string | null; today: string; calendar?: CycleCalendar }): string {
  const show = showWeekMonday(input.eventDate);
  if (show && input.today >= show) return "now: 4 Show week";
  if (renderStage(input.status) === "on-sale") {
    const monday = cycleMondayFor(input.today, input.calendar);
    return `now: 3 On sale / ${cycleFolderName(monday)}`;
  }
  return "now: 1 Signup";
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function stageFolder(input: { status: string | null; eventDate: string | null; today: string; calendar?: CycleCalendar }): { key: string; label: string } {
  const show = showWeekMonday(input.eventDate);
  if (show && input.today >= show) return { key: "03/4", label: "03 Creatives / 4 Show week" };
  if (renderStage(input.status) === "on-sale") {
    const monday = cycleMondayFor(input.today, input.calendar);
    return { key: `${cycleKey(monday)}/content`, label: `03 Creatives / 3 On sale / ${cycleFolderName(monday)} / Content` };
  }
  return { key: "03/1", label: "03 Creatives / 1 Signup" };
}

function artistInName(name: string, artists: readonly UploadArtist[]): UploadArtist | null {
  const lower = name.toLowerCase().replace(/[-_]+/g, " ");
  const hits = artists.filter((artist) => artist.name && lower.includes(artist.name.toLowerCase()));
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0] ?? null;
}

function keywordInName(name: string): (typeof NAME_RULES)[number] | null {
  const lower = name.toLowerCase().replace(/[-_]+/g, " ");
  return NAME_RULES.find((word) => lower.includes(word)) ?? null;
}

export function preselectFolder(
  file: UploadFile,
  ctx: { artists: readonly UploadArtist[]; status: string | null; eventDate: string | null; today: string; calendar?: CycleCalendar },
): FolderChoice {
  const named = artistInName(file.name, ctx.artists);
  const stage = stageFolder(ctx);
  if (DESIGN.test(file.name) || FONT.test(file.name)) {
    return { key: "01", label: "01 Open files", artistId: null, artistName: null, likely: null };
  }
  const video = VIDEO.test(file.name) || file.fromClips === true;
  if (video && (file.fromClips || named)) {
    const picked = file.artistId ? ctx.artists.find((artist) => artist.id === file.artistId) ?? null : null;
    const artist = named ?? picked ?? (file.fromClips && ctx.artists.length === 1 ? ctx.artists[0] ?? null : null);
    if (artist) {
      return {
        key: `${ARTIST_CLIPS_KEY}/${artist.id}`,
        label: `02 Source / Artist clips / ${artist.name}`,
        artistId: artist.id,
        artistName: artist.name,
        likely: null,
      };
    }
  }
  const word = keywordInName(file.name);
  if (word) {
    return { key: "00", label: "00 Brief & admin", artistId: null, artistName: null, likely: `likely — "${word}" in the name` };
  }
  if (/press|bios?\b/i.test(file.name)) {
    const artist = named;
    return {
      key: artist ? `${PRESS_KITS_KEY}/${artist.id}` : PRESS_KITS_KEY,
      label: artist ? `02 Source / Press kits / ${artist.name}` : "02 Source / Press kits / choose artist",
      artistId: artist?.id ?? null,
      artistName: artist?.name ?? null,
      likely: null,
    };
  }
  return { key: stage.key, label: stage.label, artistId: null, artistName: null, likely: null };
}

export function clipImportLine(artistName: string): string {
  return `Imports into the Lab as ${artistName}'s clip, after the text check.`;
}

export function usualFolders(
  ctx: { artists: readonly UploadArtist[]; status: string | null; eventDate: string | null; today: string; calendar?: CycleCalendar },
  selected: FolderChoice,
): FolderChoice[] {
  const stage = stageFolder(ctx);
  const artistLabel = selected.artistName && selected.key.startsWith(`${ARTIST_CLIPS_KEY}/`)
    ? selected.label
    : "02 Source / Artist clips / choose artist";
  const pressLabel = selected.artistName && selected.key.startsWith(`${PRESS_KITS_KEY}/`)
    ? selected.label
    : "02 Source / Press kits / choose artist";
  return [
    { key: "00", label: "00 Brief & admin", artistId: null, artistName: null, likely: selected.key === "00" ? selected.likely : null },
    { key: "01", label: "01 Open files", artistId: null, artistName: null, likely: null },
    { key: selected.key.startsWith(`${ARTIST_CLIPS_KEY}/`) ? selected.key : ARTIST_CLIPS_KEY, label: artistLabel, artistId: selected.artistId, artistName: selected.artistName, likely: null },
    { key: selected.key.startsWith(`${PRESS_KITS_KEY}/`) ? selected.key : PRESS_KITS_KEY, label: pressLabel, artistId: null, artistName: null, likely: null },
    { key: "02/venue-crowd", label: "02 Source / Venue & crowd", artistId: null, artistName: null, likely: null },
    { key: stage.key, label: stage.label, artistId: null, artistName: null, likely: null },
    { key: "04", label: "04 D2C", artistId: null, artistName: null, likely: null },
    { key: "05", label: "05 Reports", artistId: null, artistName: null, likely: null },
    { key: "06", label: "06 Post-event", artistId: null, artistName: null, likely: null },
  ];
}

/** Folder paths for "Another folder in the tree…", parent names joined. */
export function otherFolderChoices(): { key: string; label: string }[] {
  const usual = new Set(["00", "01", "02", ARTIST_CLIPS_KEY, PRESS_KITS_KEY, "02/venue-crowd", "03", "04", "05", "06", WINNERS_KEY, EVENT_KEY]);
  const byKey = new Map(EVENT_TREE.map((spec) => [spec.key, spec]));
  const labelOf = (key: string): string => {
    const names: string[] = [];
    let cursor: string | null = key;
    while (cursor && cursor !== EVENT_KEY) {
      const spec = byKey.get(cursor);
      if (!spec) break;
      names.unshift(spec.name);
      cursor = spec.parent;
    }
    return names.join(" / ");
  };
  return EVENT_TREE.filter((spec) => !usual.has(spec.key)).map((spec) => ({ key: spec.key, label: labelOf(spec.key) }));
}

export type PanelRow = { key: string; name: string; folderId: string | null; now: string | null; trailing: string };

export function panelRows(input: {
  folders: readonly { key: string; driveFolderId: string }[];
  winnerCount: number;
  status: string | null;
  eventDate: string | null;
  today: string;
  calendar?: CycleCalendar;
}): PanelRow[] {
  const ids = new Map(input.folders.map((row) => [row.key, row.driveFolderId]));
  const now = panelNowLine(input);
  return TOP_LEVEL.map((row) => ({
    key: row.key,
    name: row.name,
    folderId: ids.get(row.key) ?? null,
    now: row.key === "03" ? now : null,
    trailing: row.key === WINNERS_KEY ? winnersLabel(input.winnerCount) : "↗",
  }));
}

export function labAddedNote(eventName: string, count: number, narrow: boolean): string {
  if (narrow) return `${count} added from the Lab`;
  return `${eventName} · ${count} added from the Lab, each the 9:16 of its creative`;
}

export function folderPlace(clientName: string | null): string {
  const name = clientName?.trim();
  return name ? `Off / Pixel › ${name}` : "Off / Pixel";
}

export function createTreePath(clientName: string, event: { name: string; event_date?: string | null; event_code?: string | null }): string {
  return `Off / Pixel › ${clientName} › ${eventFolderName({ ...event, status: null })}`;
}

export type LabRenderRow = {
  id: string;
  eventId: string;
  status: string;
  driveStatus: string | null;
  roundNo: number;
  createdAt: string;
};

/** This event's finished renders, newest round first. A failed Drive copy still lists. */
export function finishedLabRenders(eventId: string, renders: readonly LabRenderRow[]): LabRenderRow[] {
  return renders
    .filter((row) => row.eventId === eventId && row.status === "done")
    .slice()
    .sort((a, b) => b.roundNo - a.roundNo || b.createdAt.localeCompare(a.createdAt));
}
