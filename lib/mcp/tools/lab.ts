/**
 * lib/mcp/tools/lab.ts — M3d-b, the show's Lab material (scope mcp:draft,
 * operators): list_tracks, set_track_drop, list_clips, set_clip_owner.
 *
 * Each is the Lab's own path, reached through ctx.lab (lib/mcp/lab-deps.ts):
 *   - list_tracks first reads the act's 02 Source / Audio / {artist} folder
 *     as opening the Snippet tab does (scanArtistAudio), then lists the
 *     show's creative_lab_audio_files in the order render_package takes them
 *     (compareTracks): name, length, usable or why not, the drop and who set
 *     it (the Snippet tab's own line), the rights flag.
 *   - set_track_drop is the Snippet tab's edit { kind: "drop" } (saveAudioEdit,
 *     drop_source operator). Refuses a track not on the show, one that fails
 *     AU1, a rights-flagged one, and seconds outside the track.
 *   - list_clips is render_package's material (loadClips): each clip with
 *     its owner (promoter, the act's name, or unknown when it was never set)
 *     and whether this show may use it.
 *   - set_clip_owner is the Clips card's "Whose footage is this"
 *     (saveClipOwner). Refuses a clip not in the show's material, another
 *     client's footage (its Lab artist's client, and its Drive folders where
 *     it has a Drive file: resolveDriveOwner / mayUseFor), and an owner that
 *     is neither promoter nor one of the show's lineup.
 *
 * App database, Storage and the show's Drive Audio folder only: nothing
 * reaches Meta and nothing spends. Writes need the event to be the caller's
 * (the Lab's routes scope every write to the event's owner).
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { SCOPE_DRAFT } from "../config.ts";
import { requireDraftScope } from "../drafts/common.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import { ToolInputError, type McpLabDeps, type McpTool, type ToolContext } from "../tool-types.ts";
import { LAB_ROWS, LAB_WORDS } from "../lab/words.ts";
import { clientNameOf, loadEventByCode, normaliseCode } from "./shared.ts";
import { compareTracks, loadClips, loadLineup, type LineupEntry } from "../../render-templates/load.ts";
import { mayUseFor, resolveDriveOwner } from "../../drive/file-owner.ts";
import { mmss } from "../../creative-tests/snippet.ts";

type Row = Record<string, unknown>;

const TRACK_COLUMNS = "id, event_id, artist_id, drive_file_name, spotify_title, duration_s, storage_path, unusable_reason, drop_s, drop_source, drop_set_by, rights_flag, created_at";
/** At most this many acts' folders are read in one list_tracks with no act named. */
export const MAX_SCANNED_ACTS = 6;

const text = (row: Row | null | undefined, key: string): string => (row?.[key] == null ? "" : String(row[key]));
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** mcp:draft (the server answers 403 first), and the Lab paths wired. */
export function requireLab(ctx: ToolContext): McpLabDeps {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_DRAFT)) requireDraftScope(ctx);
  if (!ctx.lab) throw new Error("lab deps missing");
  return ctx.lab;
}

interface LabEvent {
  id: string;
  code: string;
  userId: string | null;
  clientId: string | null;
  clientName: string | null;
}

async function loadLabEvent(ctx: ToolContext, value: unknown): Promise<LabEvent> {
  let code: string;
  try {
    code = normaliseCode(value);
  } catch {
    throw new ToolInputError(LAB_ROWS.badCode, { refused: "bad_code" });
  }
  const found = await loadEventByCode(ctx.db, code);
  if (!found) throw new ToolInputError(LAB_ROWS.unknownEvent(code), { code, refused: "event_not_found" });
  const res = await ctx.db.from("events").select("id, user_id, client_id").eq("id", found.primary.id).maybeSingle();
  if (res.error) throw new Error(`events: ${res.error.message}`);
  const row = res.data as { id: string; user_id: string | null; client_id: string | null } | null;
  if (!row) throw new ToolInputError(LAB_ROWS.unknownEvent(code), { code, refused: "event_not_found" });
  return { id: row.id, code: found.primary.event_code ?? code, userId: row.user_id, clientId: row.client_id, clientName: clientNameOf(found.primary) };
}

function requireOwner(ctx: ToolContext, event: LabEvent) {
  if (event.userId !== ctx.userId) throw new ToolInputError(LAB_ROWS.otherAccount, { code: event.code, refused: "not_owner" });
}

function pickAct(lineup: readonly LineupEntry[], artist: unknown, code: string): LineupEntry | null {
  if (typeof artist !== "string" || !artist.trim()) return null;
  const hit = lineup.find((a) => sameName(a.name, artist));
  if (!hit) throw new ToolInputError(LAB_WORDS.unknownArtist(artist.trim(), code, lineup.map((a) => a.name)), { code, refused: "unknown_artist" });
  return hit;
}

async function trackRows(ctx: ToolContext, eventId: string): Promise<Row[]> {
  const res = await ctx.db.from("creative_lab_audio_files").select(TRACK_COLUMNS).eq("event_id", eventId).order("created_at", { ascending: true }).range(0, 999);
  if (res.error) throw new Error(`creative_lab_audio_files: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

/** The runner's --track rule (#1388, lib/render-templates/runner.ts runnerTrack): this show's, read, with a drop, not flagged. */
export function renderableTrack(row: Row, eventId: string): boolean {
  return text(row, "event_id") === eventId && !text(row, "unusable_reason") && Boolean(text(row, "storage_path")) && num(row.drop_s) != null && !text(row, "rights_flag");
}

// ── list_tracks ──────────────────────────────────────────────────────────────

export const listTracksTool: McpTool = {
  name: "list_tracks",
  title: "List a show's tracks",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  description: [
    "Lists a show's audio files in the Lab, in the order render_package takes them: name, length, whether it can be used (and why not), the drop and who set it, and any rights flag.",
    "First reads the act's 02 Source / Audio / {artist} folder in Drive as opening the Snippet tab does, so new files are read in (made on first need; nothing is deleted or moved). Name an act to read only theirs; leave it out for the whole lineup.",
    "Use the ids with set_track_drop, and as render_package's picks.trackId.",
    'Example: list_tracks({ event: "P26-BDAY", artist: "Enzo Siragusa" }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
    artist: z.string().max(120).optional().describe("One act from the show's Lab lineup. Leave out for every act."),
  },
  async run(ctx, args) {
    const lab = requireLab(ctx);
    const event = await loadLabEvent(ctx, args.event);
    const lineup = await loadLineup(ctx.db as never, event.id);
    if (!lineup.length) return { data: { event: event.code, tracks: [], message: LAB_WORDS.noLineup(event.code) }, eventId: event.id, clientId: event.clientId, summary: { code: event.code, lineup: 0 } };
    const act = pickAct(lineup, args.artist, event.code);
    const acts = act ? [act] : lineup.slice(0, MAX_SCANNED_ACTS);

    const notes: string[] = [];
    let added = 0;
    let failed = 0;
    if (event.userId !== ctx.userId) {
      notes.push(LAB_WORDS.notOwnerNoScan);
    } else {
      let driveOff = false;
      for (const a of acts) {
        try {
          const scan = await lab.scanAudio({ userId: ctx.userId, eventId: event.id, artist: { libraryArtistId: a.libraryArtistId, name: a.name } });
          if (!scan.scanned) {
            driveOff = true;
            continue;
          }
          added += scan.added;
          failed += scan.failed;
          if (scan.added) notes.push(LAB_WORDS.scanned(a.name, scan.added));
          if (scan.failed) notes.push(LAB_WORDS.scanFailed(a.name, scan.failed));
        } catch {
          // The folder couldn't be read this time: the files already in are still listed.
          notes.push(LAB_WORDS.scanFailed(a.name, 1));
          failed += 1;
        }
      }
      if (driveOff) notes.push(LAB_WORDS.driveOff);
    }

    const names = new Map(lineup.map((a) => [a.libraryArtistId, a.name]));
    const order = new Map(lineup.map((a, i) => [a.libraryArtistId, i]));
    const rows = (await trackRows(ctx, event.id)).filter((r) => !act || text(r, "artist_id") === act.libraryArtistId).sort(compareTracks(order));
    const setBy = await lab.firstNames(rows.filter((r) => text(r, "drop_source") === "operator").map((r) => text(r, "drop_set_by")).filter(Boolean));
    const tracks = rows.map((r) => {
      const reason = text(r, "unusable_reason");
      const stored = Boolean(text(r, "storage_path"));
      const dropS = num(r.drop_s);
      const flag = text(r, "rights_flag");
      const who = setBy.get(text(r, "drop_set_by"));
      return {
        id: text(r, "id"),
        name: text(r, "spotify_title") || text(r, "drive_file_name"),
        file: text(r, "drive_file_name"),
        artist: names.get(text(r, "artist_id")) ?? null,
        lengthS: num(r.duration_s),
        usable: !reason && stored,
        ...(reason ? { why: LAB_ROWS.cantUse(reason) } : {}),
        drop:
          dropS == null
            ? { s: null, line: LAB_ROWS.noClearDrop }
            : { s: dropS, at: mmss(dropS), line: text(r, "drop_source") === "operator" && who ? LAB_ROWS.dropSetBy(who) : LAB_ROWS.dropFound, setBy: text(r, "drop_source") === "operator" ? "operator" : "lab" },
        ...(flag ? { flagged: LAB_WORDS.flagged(flag) } : {}),
        renderable: renderableTrack(r, event.id),
      };
    });
    if (!tracks.length) notes.push(LAB_WORDS.noTracks(event.code, act?.name ?? lineup[0]!.name));
    return {
      data: { event: event.code, tracks, ...(notes.length ? { notes } : {}) },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, acts: acts.length, scannedAdded: added, scanFailed: failed, tracks: tracks.length, renderable: tracks.filter((t) => t.renderable).length },
    };
  },
};

// ── set_track_drop ───────────────────────────────────────────────────────────

export const setTrackDropTool: McpTool = {
  name: "set_track_drop",
  title: "Set a track's drop",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  failedText: LAB_WORDS.dropFailed,
  description: [
    "Places a track's drop marker, as dragging the marker on the Lab's Snippet tab does: the drop is set by hand and the 16 s window moves with it (4 s before the drop).",
    "App only: nothing goes to Meta. A track that can't be used or is rights-flagged is refused.",
    'Example: set_track_drop({ event: "P26-BDAY", track_id: "<id from list_tracks>", seconds: 58.2 }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
    track_id: z.string().min(1).max(64).describe("The track's id from list_tracks."),
    seconds: z.number().describe("Where the drop lands, in seconds from the start of the track."),
  },
  async run(ctx, args) {
    const lab = requireLab(ctx);
    const event = await loadLabEvent(ctx, args.event);
    requireOwner(ctx, event);
    const id = typeof args.track_id === "string" ? args.track_id.trim() : "";
    const res = await ctx.db.from("creative_lab_audio_files").select(TRACK_COLUMNS).eq("id", id).eq("event_id", event.id).maybeSingle();
    if (res.error) throw new Error(`creative_lab_audio_files: ${res.error.message}`);
    const row = res.data as Row | null;
    if (!row) throw new ToolInputError(LAB_WORDS.trackUnknown(id, event.code), { code: event.code, trackId: id, refused: "track_not_found" });
    const name = text(row, "spotify_title") || text(row, "drive_file_name");
    const reason = text(row, "unusable_reason");
    if (reason) throw new ToolInputError(LAB_WORDS.trackUnusable(name, reason), { code: event.code, trackId: id, refused: "unusable" });
    const flag = text(row, "rights_flag");
    if (flag) throw new ToolInputError(LAB_WORDS.trackFlagged(name, flag), { code: event.code, trackId: id, refused: "flagged" });
    const duration = num(row.duration_s) ?? 0;
    const seconds = Number(args.seconds);
    if (!(duration > 0) || !Number.isFinite(seconds) || seconds < 0 || seconds > duration) {
      throw new ToolInputError(LAB_WORDS.trackOutside(name, duration), { code: event.code, trackId: id, refused: "outside" });
    }
    const after = Math.round(seconds * 1000) / 1000;
    const before = num(row.drop_s);
    if (before != null && Math.abs(before - after) < 1e-6 && text(row, "drop_source") === "operator") {
      return { data: { event: event.code, track: id, message: LAB_WORDS.dropSame(name, after) }, eventId: event.id, clientId: event.clientId, summary: { code: event.code, trackId: id, unchanged: true } };
    }
    const saved = await lab.saveAudioEdit({ userId: ctx.userId, fileId: id, edit: { kind: "drop", dropS: after } });
    if (!saved.ok) throw new ToolInputError(LAB_WORDS.dropFailed, { code: event.code, trackId: id, refused: "save_refused", status: saved.status });
    const now = saved.dropS ?? after;
    return {
      data: { event: event.code, track: id, dropS: now, message: LAB_WORDS.dropDone(name, before, now) },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, trackId: id, before, after: now },
    };
  },
};

// ── list_clips ───────────────────────────────────────────────────────────────

async function rawOwners(ctx: ToolContext, ids: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const res = await ctx.db.from("creative_lab_clips").select("id, owner").in("id", ids.slice(i, i + 200));
    if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
    for (const r of (res.data ?? []) as Row[]) out.set(text(r, "id"), text(r, "owner") || null);
  }
  return out;
}

export const listClipsTool: McpTool = {
  name: "list_clips",
  title: "List a show's clips",
  kind: "draft",
  readOnly: true,
  idempotent: true,
  description: [
    "Lists the Lab clips a show's renders can draw on (its lineup's clips and its client's own footage): each clip's id, name, owner (promoter, the act's name, or unknown when nobody has said) and whether this show may use it.",
    "Use the ids with set_clip_owner, and as render_package's picks.clips.",
    'Example: list_clips({ event: "P26-BDAY" }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
  },
  async run(ctx, args) {
    requireLab(ctx);
    const event = await loadLabEvent(ctx, args.event);
    const lineup = await loadLineup(ctx.db as never, event.id);
    if (!lineup.length) return { data: { event: event.code, clips: [], message: LAB_WORDS.noLineup(event.code) }, eventId: event.id, clientId: event.clientId, summary: { code: event.code, lineup: 0 } };
    const loaded = await loadClips(ctx.db as never, { clientId: event.clientId ?? "" }, lineup);
    const raw = await rawOwners(ctx, loaded.all.map((c) => c.id));
    const clips = loaded.all.map((c) => {
      const short = c.outS - c.inS < 0.5;
      const why = !c.usable ? LAB_WORDS.clipOtherClient : short ? LAB_WORDS.clipShort : null;
      const owner = raw.get(c.id) == null ? "unknown" : c.owner === "promoter" ? "promoter" : (c.artistName ?? "unknown");
      return {
        id: c.id,
        name: c.name,
        owner,
        usable: c.usable && !short,
        ...(why ? { why } : {}),
        ...(ctx.seesClientNames && c.clientId !== event.clientId ? { client: c.clientName || null } : {}),
      };
    });
    return {
      data: { event: event.code, clips, ...(clips.length ? {} : { message: LAB_WORDS.clipsNone(event.code) }) },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, clips: clips.length, usable: clips.filter((c) => c.usable).length, unknownOwner: clips.filter((c) => c.owner === "unknown").length },
    };
  },
};

// ── set_clip_owner ───────────────────────────────────────────────────────────

export const setClipOwnerTool: McpTool = {
  name: "set_clip_owner",
  title: "Say whose footage a clip is",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  failedText: LAB_WORDS.ownerSaveFailed,
  description: [
    "Says whose footage clips are, as the Lab's Clips card does (“Whose footage is this?”): promoter (the show's client's own) or one of the show's lineup by name.",
    "Only this show's client's own clips can be changed here; another client's footage is refused. App only: nothing goes to Meta.",
    'Example: set_clip_owner({ event: "P26-BDAY", clip_ids: ["<id from list_clips>"], owner: "Enzo Siragusa" }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
    clip_ids: z.array(z.string().min(1).max(64)).max(100).describe("Clip ids from list_clips."),
    owner: z.string().min(1).max(120).describe('"promoter", or an act from the show\'s Lab lineup by name.'),
  },
  async run(ctx, args) {
    const lab = requireLab(ctx);
    const event = await loadLabEvent(ctx, args.event);
    requireOwner(ctx, event);
    const ids = [...new Set((Array.isArray(args.clip_ids) ? args.clip_ids : []).map((v) => String(v).trim()).filter(Boolean))];
    if (!ids.length) throw new ToolInputError(LAB_WORDS.ownerEmpty, { code: event.code, refused: "no_clips" });
    const lineup = await loadLineup(ctx.db as never, event.id);
    if (!lineup.length) throw new ToolInputError(LAB_WORDS.noLineup(event.code), { code: event.code, refused: "no_lineup" });

    // The owner: promoter, or a lineup act with a Lab artist on this show's client.
    const ownerArg = String(args.owner ?? "").trim();
    let owner: "promoter" | "artist";
    let artistId: string | null = null;
    let ownerName: string;
    if (sameName(ownerArg, "promoter")) {
      owner = "promoter";
      ownerName = event.clientName ?? "promoter";
    } else {
      const act = lineup.find((a) => sameName(a.name, ownerArg));
      if (!act) throw new ToolInputError(LAB_WORDS.ownerBadName(event.code, lineup.map((a) => a.name)), { code: event.code, refused: "bad_owner" });
      const labRes = await ctx.db.from("creative_lab_artists").select("id, client_id, artist_id").eq("client_id", event.clientId ?? "").eq("artist_id", act.libraryArtistId).limit(1);
      if (labRes.error) throw new Error(`creative_lab_artists: ${labRes.error.message}`);
      const labRow = ((labRes.data ?? []) as Row[])[0];
      if (!labRow) throw new ToolInputError(LAB_WORDS.ownerNoLabArtist(act.name, event.clientName ?? "this client"), { code: event.code, refused: "no_lab_artist" });
      owner = "artist";
      artistId = text(labRow, "id");
      ownerName = act.name;
    }

    // The clips: in this show's material, and this show's client's own.
    const loaded = await loadClips(ctx.db as never, { clientId: event.clientId ?? "" }, lineup);
    const byId = new Map(loaded.all.map((c) => [c.id, c]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new ToolInputError(LAB_WORDS.ownerUnknownClip(missing, event.code), { code: event.code, refused: "clip_not_on_show", clips: missing.length });
    for (const id of ids) {
      const c = byId.get(id)!;
      if (c.clientId !== event.clientId) {
        throw new ToolInputError(LAB_WORDS.ownerOtherClient(c.name, ctx.seesClientNames ? c.clientName || null : null), { code: event.code, refused: "other_client", clipId: id });
      }
    }
    // Where a clip has a Drive file, its folders must not be another client's (lib/drive/file-owner.ts).
    const drive = ctx.draft?.drive() ?? null;
    if (drive) {
      for (const id of ids) {
        const c = byId.get(id)!;
        if (!c.driveFileId) continue;
        const file = await drive.getFile(c.driveFileId);
        const parent = file?.parents?.[0];
        if (!parent) continue;
        const found = await resolveDriveOwner(ctx.db as never, drive, parent);
        if (mayUseFor(found, event.clientId) !== "other_client") continue;
        const named = await ctx.db.from("clients").select("name").in("id", found.clientIds).limit(1);
        const client = ((named.error ? [] : (named.data ?? [])) as Array<{ name: string | null }>)[0]?.name?.trim() || null;
        throw new ToolInputError(LAB_WORDS.ownerOtherClient(c.name, ctx.seesClientNames ? client : null), { code: event.code, refused: "other_client_drive", clipId: id });
      }
    }

    const when = ctx.now.toISOString();
    let saved = 0;
    for (const id of ids) {
      try {
        await lab.saveClipOwner({ userId: ctx.userId, clipId: id, owner, artistId, who: ctx.userId, when });
        saved += 1;
      } catch {
        throw new ToolInputError(saved ? LAB_WORDS.ownerFailed(saved, ids.length) : LAB_WORDS.ownerSaveFailed, { code: event.code, refused: "save_failed", saved, clips: ids.length });
      }
    }
    return {
      data: { event: event.code, clips: ids, owner: owner === "promoter" ? "promoter" : ownerName, message: LAB_WORDS.ownerDone(saved, ownerName) },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, clips: saved, owner, artistId },
    };
  },
};
