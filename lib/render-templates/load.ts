/**
 * lib/render-templates/load.ts — an event's render-package state, read from
 * the database (reads only; the beat grid cache is written by store.ts).
 *
 * Material: the event's Lab lineup's clips from every client, kept only when
 * the event may use them (usableOn: shareable artist footage, or the event's
 * client's own). Another client's promoter footage is never offered; it is
 * counted only so a pick of it can be refused by client (RY3).
 *
 * Relative imports only (node:test).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { clipRights, usableOn } from "../artist-library/rights.ts";
import { isArchivedClientStatus } from "../db/client-status.ts";
import { approvedClaim, type WarningRow } from "../creative-lab/claim-approval.ts";
import { isOnSale } from "../onsale-refresh/on-sale.ts";
import type { BeatGrid } from "./beats.ts";
import { dropOffsetS } from "./montage-plan.ts";
import type { CandidateClip, CandidateTrack, ClaimState, MutedInputs, PackageState, PickedFromElsewhere } from "./package-view.ts";
import type { Stage } from "./words.ts";

export type Db = Pick<SupabaseClient, "from">;
type Row = Record<string, unknown>;

const text = (row: Row | null | undefined, key: string): string => (row?.[key] == null ? "" : String(row[key]));
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function rowsIn(db: Db, table: string, cols: string, column: string, values: readonly string[]): Promise<Row[]> {
  if (!values.length) return [];
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += 200) {
    const res = await db.from(table).select(cols).in(column, values.slice(i, i + 200)).range(0, 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    out.push(...((res.data ?? []) as unknown as Row[]));
  }
  return out;
}

async function rowsEq(db: Db, table: string, cols: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select(cols).eq(column, value).range(0, 999);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as unknown as Row[];
}

export function stageFor(event: { status?: string | null; event_date?: string | null; general_sale_at?: string | null; presale_at?: string | null }, today: string): Stage {
  if (isOnSale({ status: event.status ?? null, event_date: event.event_date ?? null, general_sale_at: event.general_sale_at ?? null } as never, today)) return "on_sale";
  const presale = event.presale_at?.slice(0, 10);
  if (presale && presale <= today) return "presale";
  return "signup";
}

export type EventFacts = {
  id: string;
  userId: string;
  code: string;
  name: string;
  clientId: string;
  clientName: string;
  clientStatus: string | null;
  status: string | null;
  eventDate: string | null;
  venueName: string | null;
  venueCity: string | null;
  driveFolderId: string | null;
  stage: Stage;
};

export async function loadEventFacts(db: Db, eventId: string, today: string): Promise<EventFacts | null> {
  const res = await db
    .from("events")
    .select("id, user_id, event_code, name, client_id, status, event_date, presale_at, general_sale_at, venue_name, venue_city, drive_folder_id")
    .eq("id", eventId)
    .maybeSingle();
  if (res.error) throw new Error(`events: ${res.error.message}`);
  const e = res.data as Row | null;
  if (!e) return null;
  const c = await db.from("clients").select("id, name, status").eq("id", text(e, "client_id")).maybeSingle();
  if (c.error) throw new Error(`clients: ${c.error.message}`);
  const client = c.data as Row | null;
  return {
    id: text(e, "id"),
    userId: text(e, "user_id"),
    code: text(e, "event_code") || text(e, "name"),
    name: text(e, "name"),
    clientId: text(e, "client_id"),
    clientName: text(client, "name"),
    clientStatus: client?.status == null ? null : String(client.status),
    status: e.status == null ? null : String(e.status),
    eventDate: e.event_date == null ? null : String(e.event_date),
    venueName: e.venue_name == null ? null : String(e.venue_name),
    venueCity: e.venue_city == null ? null : String(e.venue_city),
    driveFolderId: e.drive_folder_id == null ? null : String(e.drive_folder_id),
    stage: stageFor(e as never, today),
  };
}

export type LineupEntry = { libraryArtistId: string; name: string; isHeadliner: boolean };

export async function loadLineup(db: Db, eventId: string): Promise<LineupEntry[]> {
  const links = (await rowsEq(db, "event_artists", "artist_id, billing_order, is_headliner, source", "event_id", eventId))
    .filter((r) => text(r, "source") === "lab")
    .sort((a, b) => Number(a.billing_order ?? 0) - Number(b.billing_order ?? 0));
  const artists = await rowsIn(db, "artists", "id, name", "id", links.map((l) => text(l, "artist_id")));
  const names = new Map(artists.map((a) => [text(a, "id"), text(a, "name")]));
  return links.filter((l) => names.get(text(l, "artist_id"))).map((l) => ({ libraryArtistId: text(l, "artist_id"), name: names.get(text(l, "artist_id"))!, isHeadliner: l.is_headliner === true }));
}

export type LoadedClips = { usable: CandidateClip[]; /** every lineup clip, usable or not, by id and Drive id (for picks) */ all: (CandidateClip & { usable: boolean })[] };

/** The lineup's Lab clips from every client, each marked usable on this event or not. */
export async function loadClips(db: Db, event: Pick<EventFacts, "clientId">, lineup: readonly LineupEntry[]): Promise<LoadedClips> {
  const libraryIds = lineup.map((a) => a.libraryArtistId);
  const labByLibrary = await rowsIn(db, "creative_lab_artists", "id, name, client_id, artist_id", "artist_id", libraryIds);
  const labOfClient = await rowsEq(db, "creative_lab_artists", "id, name, client_id, artist_id", "client_id", event.clientId);
  const labArtists = new Map<string, Row>();
  for (const r of [...labByLibrary, ...labOfClient]) labArtists.set(text(r, "id"), r);
  const clientIds = [...new Set([...labArtists.values()].map((r) => text(r, "client_id")))];
  const clients = await rowsIn(db, "clients", "id, name, status", "id", clientIds);
  const clientName = new Map(clients.map((c) => [text(c, "id"), text(c, "name")]));
  const archived = new Set(clients.filter((c) => isArchivedClientStatus(text(c, "status"))).map((c) => text(c, "id")));
  const clips = await rowsIn(
    db,
    "creative_lab_clips",
    "id, artist_id, owner, clip_no, in_s, out_s, creative_asset_id, render_asset_id, source_file_id, triple_fit_source_id",
    "artist_id",
    [...labArtists.keys()],
  );
  const assets = await rowsIn(db, "creative_assets", "id, filename, storage_path, duration_seconds, drive_file_id", "id", clips.map((c) => text(c, "render_asset_id") || text(c, "creative_asset_id")).filter(Boolean));
  const assetOf = new Map(assets.map((a) => [text(a, "id"), a]));
  const libraryName = new Map(lineup.map((a) => [a.libraryArtistId, a]));
  const order = new Map(lineup.map((a, i) => [a.libraryArtistId, i]));
  const all: (CandidateClip & { usable: boolean; order: number; clipNo: number })[] = [];
  for (const c of clips) {
    if (text(c, "triple_fit_source_id")) continue;
    const lab = labArtists.get(text(c, "artist_id"));
    if (!lab) continue;
    const labClient = text(lab, "client_id");
    if (archived.has(labClient)) continue;
    const asset = assetOf.get(text(c, "render_asset_id") || text(c, "creative_asset_id"));
    if (!asset || !text(asset, "storage_path")) continue;
    const owner = text(c, "owner") === "artist" || (!text(c, "owner") && text(c, "artist_id")) ? "artist" : "promoter";
    const lineupArtist = libraryName.get(text(lab, "artist_id"));
    const inS = num(c.in_s) ?? 0;
    const outS = num(c.out_s) ?? inS + (num(asset.duration_seconds) ?? 0);
    all.push({
      id: text(c, "id"),
      name: text(asset, "filename") || `clip ${text(c, "clip_no")}`,
      owner,
      clientId: labClient,
      clientName: clientName.get(labClient) ?? "",
      artistName: owner === "artist" ? lineupArtist?.name ?? text(lab, "name") : null,
      isHeadliner: lineupArtist?.isHeadliner === true,
      inS,
      outS,
      driveFileId: text(c, "source_file_id") || text(asset, "drive_file_id") || null,
      usable: usableOn(clipRights(owner, labClient), event.clientId),
      order: lineupArtist ? order.get(lineupArtist.libraryArtistId)! : lineup.length,
      clipNo: Number(c.clip_no ?? 0),
    });
  }
  all.sort((a, b) => Number(b.isHeadliner) - Number(a.isHeadliner) || a.order - b.order || a.clipNo - b.clipNo);
  // A clip shorter than a cut isn't offered.
  const strip = (c: (typeof all)[number]): LoadedClips["all"][number] => ({
    id: c.id, name: c.name, owner: c.owner, clientId: c.clientId, clientName: c.clientName, artistName: c.artistName,
    isHeadliner: c.isHeadliner, inS: c.inS, outS: c.outS, driveFileId: c.driveFileId, usable: c.usable,
  });
  const allOut = all.map(strip);
  return { usable: allOut.filter((c) => c.usable && c.outS - c.inS >= 0.5).map(({ usable, ...rest }) => (void usable, rest)), all: allOut };
}

/** Picked clips that are another client's promoter footage, counted by that client. */
export function foreignPicks(all: LoadedClips["all"], picks: readonly string[] | undefined): PickedFromElsewhere[] {
  if (!picks?.length) return [];
  const byKey = new Map<string, LoadedClips["all"][number]>();
  for (const c of all) {
    byKey.set(c.id, c);
    if (c.driveFileId) byKey.set(c.driveFileId, c);
  }
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const key of picks) {
    const c = byKey.get(key) ?? byKey.get(driveIdFromLink(key) ?? "");
    if (!c || seen.has(c.id) || c.usable) continue;
    seen.add(c.id);
    counts.set(c.clientName, (counts.get(c.clientName) ?? 0) + 1);
  }
  return [...counts].map(([clientName, count]) => ({ clientName, count }));
}

/** A Drive link's file id, or null. */
export function driveIdFromLink(value: string): string | null {
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(value) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(value);
  return m ? m[1]! : null;
}

export type TrackRow = CandidateTrack & { storagePath: string | null; beatGrid: (BeatGrid & { dropS: number }) | null };

export async function loadTracks(db: Db, eventId: string, lineup: readonly LineupEntry[]): Promise<TrackRow[]> {
  const rows = await rowsEq(db, "creative_lab_audio_files", "id, artist_id, drive_file_name, duration_s, storage_path, unusable_reason, drop_s, drop_source, rights_flag, spotify_title, beat_grid", "event_id", eventId);
  const order = new Map(lineup.map((a, i) => [a.libraryArtistId, i]));
  const names = new Map(lineup.map((a) => [a.libraryArtistId, a.name]));
  return rows
    .filter((r) => !text(r, "unusable_reason") && text(r, "storage_path"))
    .sort((a, b) => (order.get(text(a, "artist_id")) ?? 99) - (order.get(text(b, "artist_id")) ?? 99))
    .map((r) => {
      const dropS = num(r.drop_s);
      const cached = r.beat_grid as (BeatGrid & { dropS: number }) | null;
      const grid = cached && dropS != null && Math.abs(cached.dropS - dropS) < 1e-6 ? cached : null;
      return {
        id: text(r, "id"),
        name: text(r, "spotify_title") || text(r, "drive_file_name"),
        artistName: names.get(text(r, "artist_id")) ?? null,
        dropS,
        dropSource: (text(r, "drop_source") || null) as "lab" | "operator" | null,
        durationS: num(r.duration_s),
        flagged: Boolean(text(r, "rights_flag")),
        dropAtS: grid && dropS != null ? dropOffsetS(grid, dropS) : null,
        storagePath: text(r, "storage_path") || null,
        beatGrid: grid,
      };
    });
}

export async function loadClaim(db: Db, eventId: string, now: Date): Promise<ClaimState> {
  const warnings = (await rowsEq(db, "ticket_warnings", "id, claim, format, state, approved_by, approved_at, runs_from, runs_to", "event_id", eventId)) as unknown as WarningRow[];
  const releases = await rowsEq(db, "event_releases", "state_at", "event_id", eventId);
  const readAt = releases.map((r) => text(r, "state_at")).filter(Boolean).sort().at(-1) ?? null;
  const source = approvedClaim(warnings, now);
  if (source.kind === "approved") {
    const lines = source.claim.split(/\s*\/\s*|\n/).map((l) => l.trim()).filter(Boolean);
    return { state: "ready", text: source.claim, lines, readAt: readAt ?? source.approvedAt };
  }
  return { state: warnings.length ? "none" : "missing", text: null, lines: [], readAt };
}

/** "Sun 27 Dec" from a stored date. */
export function shortDay(date: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

export type LoadDeps = {
  /** The client's kit for this event: a provided face and a stored logo piece. */
  kitReady(eventId: string, clientId: string): Promise<boolean>;
};

export type LoadedPackage = { facts: EventFacts; state: PackageState; clips: LoadedClips; tracks: TrackRow[]; muted: MutedInputs };

export async function loadPackageState(db: Db, eventId: string, deps: LoadDeps, now: Date, today: string): Promise<LoadedPackage | null> {
  const facts = await loadEventFacts(db, eventId, today);
  if (!facts || isArchivedClientStatus(facts.clientStatus)) return null;
  const lineup = await loadLineup(db, eventId);
  const clips = await loadClips(db, facts, lineup);
  const tracks = await loadTracks(db, eventId, lineup);
  const claim = await loadClaim(db, eventId, now);
  const kit = { ready: await deps.kitReady(eventId, facts.clientId) };
  const venue = [facts.venueName, facts.venueCity].filter(Boolean).join(", ") || null;
  const state: PackageState = {
    event: { id: facts.id, code: facts.code, name: facts.name, clientId: facts.clientId, clientName: facts.clientName, stage: facts.stage, date: facts.eventDate, venue },
    lineup: lineup.map((a) => ({ name: a.name, isHeadliner: a.isHeadliner })),
    clips: clips.usable,
    tracks,
    kit,
    claim,
  };
  const lead = lineup.find((a) => a.isHeadliner) ?? lineup[0] ?? null;
  const raw = clips.usable.find((c) => c.artistName === lead?.name && c.owner === "artist" && c.outS - c.inS >= 12);
  const muted: MutedInputs = {
    rawClip: raw?.name ?? null,
    pressShot: null,
    tracks: tracks.filter((t) => t.dropS != null && !t.flagged).length,
    snippets: 0,
    artwork: null,
    details: lead && facts.eventDate && venue ? `${lead.name} · ${shortDay(facts.eventDate)} · ${venue}` : null,
    artistName: lead?.name ?? null,
  };
  return { facts, state, clips, tracks, muted };
}
