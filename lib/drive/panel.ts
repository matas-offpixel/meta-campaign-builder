/**
 * The Drive panel, the upload's folder question, and the share ask (S16,
 * S22, S23, S25). Pure: the sentences are the record's, and the "now:" line
 * is the routing table (routeRender / the cycle the tick files into).
 *
 * Record: docs/design-record/2026-11-09-creative-lab-clip-selection.html.
 * The creatives row (owner, then type) is docs/design-record/2026-11-11-creative-lab-upload-owner.html
 * (U1–U6): it replaces S23's "w/c {d Mon} / Content", which D3 retired.
 */

import {
  ARTIST_CLIPS_KEY,
  EVENT_KEY,
  EVENT_TREE,
  PRESS_KITS_KEY,
  SHOW_WEEK_KEY,
  TEASER_KEY,
  WINNERS_KEY,
  cycleFolderName,
  cycleKey,
  cycleMondayFor,
  eventFolderName,
  isFilingStage,
  renderStage,
  showWeekMonday,
  typeKey,
  type CycleCalendar,
  type DriveKind,
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
  /** The browser's type for the file. The creatives row's type comes from it when it is certain (U1). */
  mimeType?: string | null;
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
  /** Set on the creatives row (U1, U2): the stage, and the owner and type picked in the row. */
  creatives?: CreativesRow | null;
};

/** One entry of the owner picker: a lineup artist, or the promoter. ref is D5's key part. */
export type OwnerOption = {
  /** "artist:{Lab artist id}", "library:{library artist id}" (a lineup artist with no Lab row yet) or "promoter". */
  ref: string;
  name: string;
  kind: "artist" | "promoter";
};

export type CreativesRow = {
  stageKey: FolderKey;
  /** "03 Creatives / 3 On sale / w/c 23 Nov" */
  stageLabel: string;
  /** The stage's own folder name for "Makes … in {folder}": "w/c 23 Nov", "Teaser", "4 Show week". */
  folderName: string;
  owners: OwnerOption[];
  owner: OwnerOption | null;
  kind: DriveKind | null;
};

// ─── U4's words ──────────────────────────────────────────────────────────────

export const CHOOSE_OWNER = "choose who it's for";
export const CHOOSE_TYPE = "choose Videos or Statics";
export const OWNER_NEEDED = "Choose who it's for — the file goes in their folder for approval.";

export function makesFolderLine(owner: string, type: string, folder: string): string {
  return `Makes ${owner} / ${type} in ${folder} with this upload.`;
}

export function likelyArtistLine(artist: string): string {
  return `likely — "${artist}" in the name`;
}

export function typeFolderName(kind: DriveKind): string {
  return kind === "video" ? "Videos" : "Statics";
}

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

/**
 * The stage an upload's creatives row files into (HU1): this cycle when on
 * sale, 1 Signup / Teaser before, 4 Show week from its Monday. Never a
 * folder that takes the file itself: the owner and type pickers come after.
 */
export function stageFolder(input: { status: string | null; eventDate: string | null; today: string; calendar?: CycleCalendar }): { key: string; label: string; folderName: string } {
  const show = showWeekMonday(input.eventDate);
  if (show && input.today >= show) return { key: SHOW_WEEK_KEY, label: "03 Creatives / 4 Show week", folderName: "4 Show week" };
  if (renderStage(input.status) === "on-sale") {
    const monday = cycleMondayFor(input.today, input.calendar);
    return { key: cycleKey(monday), label: `03 Creatives / 3 On sale / ${cycleFolderName(monday)}`, folderName: cycleFolderName(monday) };
  }
  return { key: TEASER_KEY, label: "03 Creatives / 1 Signup / Teaser", folderName: "Teaser" };
}

/** S23's match: every lineup name in the file name, longest first. */
function artistsInName<T extends { name: string }>(name: string, artists: readonly T[]): T[] {
  const lower = name.toLowerCase().replace(/[-_]+/g, " ");
  const hits = artists.filter((artist) => artist.name && lower.includes(artist.name.toLowerCase()));
  return hits.sort((a, b) => b.name.length - a.name.length);
}

function artistInName(name: string, artists: readonly UploadArtist[]): UploadArtist | null {
  return artistsInName(name, artists)[0] ?? null;
}

function keywordInName(name: string): (typeof NAME_RULES)[number] | null {
  const lower = name.toLowerCase().replace(/[-_]+/g, " ");
  return NAME_RULES.find((word) => lower.includes(word)) ?? null;
}

/**
 * The one lineup artist the file name names, or null (U1): S23's match, the
 * longest name winning over a name inside it ("Enzo" in "Enzo Siragusa").
 * Two different artists named → null: the owner is never guessed. The
 * promoter is never preselected.
 */
export function ownerFromName(name: string, owners: readonly OwnerOption[]): OwnerOption | null {
  const hits = artistsInName(name, owners.filter((owner) => owner.kind === "artist"));
  const distinct = hits.filter((hit, i) => !hits.slice(0, i).some((longer) => longer.name.toLowerCase().includes(hit.name.toLowerCase())));
  return distinct.length === 1 ? distinct[0]! : null;
}

/** The type from the file's MIME when it is certain (U1); anything else is chosen. */
export function kindFromMime(mimeType: string | null | undefined): DriveKind | null {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "static";
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * U3: a finished creative, not source footage — the event's code first, and
 * _9x16 / _4x5 / _1x1 before the extension or _winner (S14). A version after
 * the format (…_9x16_v1.png) still counts.
 */
export function isFinishedCreativeName(name: string, eventCode: string | null | undefined): boolean {
  const code = eventCode?.trim();
  if (!code) return false;
  return new RegExp(`^${escapeRegex(code)}_.*_(9x16|4x5|1x1)(?:_v\\d+)?(?:_winner)?\\.[A-Za-z0-9]+$`).test(name);
}

/** The D5 key a complete creatives row files to, or null while the owner or type is unset. */
export function creativesKey(row: Pick<CreativesRow, "stageKey" | "owner" | "kind">): string | null {
  if (!row.owner || !row.kind) return null;
  return typeKey(`${row.stageKey}/owner/${row.owner.ref}`, row.kind);
}

function creativesLabel(row: CreativesRow): string {
  return `${row.stageLabel} / ${row.owner?.name ?? CHOOSE_OWNER} / ${row.kind ? typeFolderName(row.kind) : CHOOSE_TYPE}`;
}

/** The creatives row as a folder choice. Its key is the D5 key once owner and type are set, the stage key until then. */
export function creativesChoice(row: CreativesRow, likely: string | null = null): FolderChoice {
  return { key: creativesKey(row) ?? row.stageKey, label: creativesLabel(row), artistId: null, artistName: null, likely, creatives: row };
}

/** The picker changed the owner. */
export function withOwner(choice: FolderChoice, ref: string | null): FolderChoice {
  if (!choice.creatives) return choice;
  const owner = ref ? choice.creatives.owners.find((option) => option.ref === ref) ?? null : null;
  return creativesChoice({ ...choice.creatives, owner }, null);
}

/** The picker changed the type. */
export function withKind(choice: FolderChoice, kind: DriveKind | null): FolderChoice {
  if (!choice.creatives) return choice;
  return creativesChoice({ ...choice.creatives, kind }, choice.likely);
}

/** Upload waits while the creatives row's owner or type is unset (U4). */
export function uploadReady(choice: FolderChoice | null | undefined): boolean {
  if (!choice) return false;
  return !choice.creatives || creativesKey(choice.creatives) !== null;
}

/** The line under the creatives row (U4): owner first, then the folder it will make, else nothing. */
export function creativesNote(choice: FolderChoice | null | undefined, folderKeys?: ReadonlySet<string> | null): string | null {
  const row = choice?.creatives;
  if (!row) return null;
  if (!row.owner) return OWNER_NEEDED;
  const key = creativesKey(row);
  if (!key || !row.kind || !folderKeys || folderKeys.has(key)) return null;
  return makesFolderLine(row.owner.name, typeFolderName(row.kind), row.folderName);
}

/** The owner list (HU2): the lineup in billing order, then the promoter. Falls back to the Lab artists given. */
function ownersOf(ctx: { owners?: readonly OwnerOption[] | null; artists: readonly UploadArtist[] }): OwnerOption[] {
  if (ctx.owners) return [...ctx.owners];
  return ctx.artists.map((artist) => ({ ref: `artist:${artist.id}`, name: artist.name, kind: "artist" as const }));
}

/** A fresh creatives row for a stage, owner from the name (exactly one lineup artist) and type from MIME. */
export function stageCreativesChoice(
  stage: { key: string; label: string; folderName: string },
  owners: readonly OwnerOption[],
  file: Pick<UploadFile, "name" | "mimeType"> | null,
): FolderChoice {
  const owner = file ? ownerFromName(file.name, owners) : null;
  const kind = file ? kindFromMime(file.mimeType) : null;
  return creativesChoice(
    { stageKey: stage.key, stageLabel: stage.label, folderName: stage.folderName, owners: [...owners], owner, kind },
    owner ? likelyArtistLine(owner.name.toLowerCase()) : null,
  );
}

export type UploadContext = {
  artists: readonly UploadArtist[];
  status: string | null;
  eventDate: string | null;
  today: string;
  calendar?: CycleCalendar;
  /** The owner picker's list (lineup, then the promoter). Without it, the Lab artists given. */
  owners?: readonly OwnerOption[] | null;
  /** The event's code, for U3's finished-creative names. */
  eventCode?: string | null;
  /** The folder map's keys, for "Makes … with this upload." */
  folderKeys?: readonly string[] | null;
};

export function preselectFolder(file: UploadFile, ctx: UploadContext): FolderChoice {
  const named = artistInName(file.name, ctx.artists);
  const stage = stageFolder(ctx);
  const owners = ownersOf(ctx);
  // U3: a finished creative goes to the creatives row, ahead of S23's Artist clips rule.
  if (isFinishedCreativeName(file.name, ctx.eventCode)) return stageCreativesChoice(stage, owners, file);
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
  return stageCreativesChoice(stage, owners, file);
}

export function clipImportLine(artistName: string): string {
  return `Imports into the Lab as ${artistName}'s clip, after the text check.`;
}

export function usualFolders(ctx: UploadContext, selected: FolderChoice): FolderChoice[] {
  const stage = stageFolder(ctx);
  const artistLabel = selected.artistName && selected.key.startsWith(`${ARTIST_CLIPS_KEY}/`)
    ? selected.label
    : "02 Source / Artist clips / choose artist";
  const pressLabel = selected.artistName && selected.key.startsWith(`${PRESS_KITS_KEY}/`)
    ? selected.label
    : "02 Source / Press kits / choose artist";
  // U5: the … / Content row is gone; the creatives row of U1 / U2 takes its place.
  const creatives = selected.creatives && selected.creatives.stageKey === stage.key ? selected : stageCreativesChoice(stage, ownersOf(ctx), null);
  return [
    { key: "00", label: "00 Brief & admin", artistId: null, artistName: null, likely: selected.key === "00" ? selected.likely : null },
    { key: "01", label: "01 Open files", artistId: null, artistName: null, likely: null },
    { key: selected.key.startsWith(`${ARTIST_CLIPS_KEY}/`) ? selected.key : ARTIST_CLIPS_KEY, label: artistLabel, artistId: selected.artistId, artistName: selected.artistName, likely: null },
    { key: selected.key.startsWith(`${PRESS_KITS_KEY}/`) ? selected.key : PRESS_KITS_KEY, label: pressLabel, artistId: null, artistName: null, likely: null },
    { key: "02/venue-crowd", label: "02 Source / Venue & crowd", artistId: null, artistName: null, likely: null },
    creatives,
    { key: "04", label: "04 D2C", artistId: null, artistName: null, likely: null },
    { key: "05", label: "05 Reports", artistId: null, artistName: null, likely: null },
    { key: "06", label: "06 Post-event", artistId: null, artistName: null, likely: null },
  ];
}

/**
 * A folder picked under "Another folder in the tree…" (U2): a stage that takes
 * creatives (Announcement, Presale live, Reminders, an older cycle…) becomes a
 * creatives row with the same two pickers and never takes the file itself.
 * Any other folder is a plain choice.
 */
export function anotherFolderChoice(
  picked: { key: string; label: string },
  ctx: Pick<UploadContext, "owners" | "artists">,
  file: Pick<UploadFile, "name" | "mimeType"> | null = null,
): FolderChoice {
  if (!isFilingStage(picked.key)) return { key: picked.key, label: picked.label, artistId: null, artistName: null, likely: null };
  const folderName = picked.label.split(" / ").at(-1) ?? picked.label;
  const label = picked.label.startsWith("03 Creatives") ? picked.label : `03 Creatives / ${picked.label}`;
  return stageCreativesChoice({ key: picked.key, label, folderName }, ownersOf(ctx), file);
}

/**
 * Folder paths for "Another folder in the tree…", parent names joined. With
 * the folder map's keys, every cycle but the current one is listed too (U1:
 * an older cycle is reached here, with the same two pickers).
 */
export function otherFolderChoices(opts: { folderKeys?: readonly string[] | null; currentStageKey?: string | null } = {}): { key: string; label: string }[] {
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
  const fixed = EVENT_TREE.filter((spec) => !usual.has(spec.key)).map((spec) => ({ key: spec.key, label: labelOf(spec.key) }));
  const cycles = (opts.folderKeys ?? [])
    .map((key) => /^03\/3\/wc\/(\d{4}-\d{2}-\d{2})$/.exec(key))
    .filter((match): match is RegExpExecArray => Boolean(match) && match![0] !== opts.currentStageKey)
    .sort((a, b) => a[1]!.localeCompare(b[1]!))
    .map((match) => ({ key: match[0], label: `03 Creatives / 3 On sale / ${cycleFolderName(match[1]!)}` }));
  return [...fixed, ...cycles];
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
