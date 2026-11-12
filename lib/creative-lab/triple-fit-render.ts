/**
 * A made triple-fit ("Triple-fit · #{n}") rendered as T1 arrangement B.
 * The window, the three parts, the length, the one sound and the seam
 * check are #1187's rules. This file only loads the source clip's render
 * copy, paints the layers, and asks Lambda for composition TripleFitOnClip.
 */

import { dirname } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import type { TripleFitOnClipProps } from "../../src/remotion/compositions/TripleFitOnClip.tsx";
import { KIT_SHADOW, textOverlay, trimToInk, type Piece, type Placement } from "./artist-card.ts";
import { approvedClaim, type WarningRow } from "./claim-approval.ts";
import { KIT_RED, KIT_WHITE, renderCardLine } from "./claim-slot.ts";
import { indexFonts, requireFont, type FontEntry } from "./kit-font.ts";
import { providedFace } from "./kit-faces.ts";
import { deleteLambdaRender, renderCompositionViaLambda, requireLambdaServeUrl, type LambdaDeps } from "./lambda.ts";
import type { ServiceRoleDb } from "./load.ts";
import type { Probe } from "./mp4-probe.ts";
import { renderSourceAsset } from "./render-source.ts";
import { withKitFace } from "./t1-lambda.ts";
import { FORMAT_SIZE } from "./t1-video-frame.ts";
import {
  T1C,
  clipBands,
  planClipLayout,
  planVideoClaim,
  type ClipLayout,
  type MeasureCap,
  type VideoClaimPlan,
} from "./t1-video.ts";
import {
  TF_LINES,
  partPlacements,
  partWindow,
  tripleFitLength,
  tripleFitSound,
  tripleFitTypeChecks,
  tripleFitUpscale,
} from "./triple-fit.ts";
import { renderVideoBands } from "./video-bands.ts";

const OUTPUT = FORMAT_SIZE["9:16"];
const REF_CAP = 100;

type Row = Record<string, unknown>;

export type TripleFitHooks = {
  /** Test seam. Production typesets the name, date and claim in the kit face. */
  arrange?: (input: { artistName: string; dateLine: string; claimText: string }) => Promise<ClipLayout>;
  /** Test seam. Production paints bands, the top block and the claim. */
  paint?: (layout: ClipLayout) => Promise<{ bands: Buffer; top: Buffer; claim: Buffer | null }>;
  /** Test seam. A fake Remotion client, so tests never call Lambda. */
  lambda?: LambdaDeps;
  deleteRender?: (target: { bucketName: string; lambdaRenderId: string }) => Promise<void>;
};

export type TripleFitRendered = {
  bytes: Uint8Array;
  renderMs: number;
  estimatedCostUsd: number | null;
  estimatedCostDisplay: string | null;
  width: number;
  height: number;
  durationSeconds: number;
  props: TripleFitOnClipProps;
};

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

async function one(db: ServiceRoleDb, table: string, id: string): Promise<Row | null> {
  const q = db.from(table) as unknown as {
    select(columns: string): {
      eq(column: string, value: unknown): { maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> };
    };
  };
  const { data, error } = await q.select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function rows(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const q = db.from(table) as unknown as {
    select(columns: string): {
      eq(column: string, value: unknown): Promise<{ data: Row[] | null; error: { message: string } | null }>;
    };
  };
  const { data, error } = await q.select("*").eq(column, value);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

type KitPieceRecord = { role: string; label: string; file: string; cap_px: number };

/**
 * O54: the clip carries the kit's logo and the kit's date line, verbatim.
 * The date is the info piece whose label names a day ("SUNDAY 27TH DECEMBER"),
 * never a reformatted ISO date.
 */
export function clipKitPieces(pieces: readonly KitPieceRecord[]): { lockup: KitPieceRecord; date: KitPieceRecord } {
  const lockup = pieces.find((piece) => piece.role === "logo");
  const date = pieces.find((piece) => piece.role === "info" && /DAY\b/i.test(piece.label));
  if (!lockup || !date) throw new Error("This event's kit has no lockup or date line");
  return { lockup, date };
}

/**
 * The stored logo layer is the lockup drawn over a translucent oval. The
 * oval's centre is under alpha 64; the wordmark and the script sit above it.
 * The lockup on the clip is that ink, which is what the triple-fit drafts draw.
 */
const LOCKUP_INK_ALPHA = 64;

export async function lockupInk(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 3; i < out.length; i += 4) {
    if (out[i]! < LOCKUP_INK_ALPHA) {
      out[i - 3] = 0;
      out[i - 2] = 0;
      out[i - 1] = 0;
      out[i] = 0;
    }
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

function kitStorage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("This event's kit needs storage credentials");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }).storage.from("campaign-assets");
}

/** The event's static kit when it has one, otherwise the only kit stored for it. */
async function eventKit(eventId: string): Promise<{ lockup: Piece; date: Piece }> {
  const bucket = kitStorage();
  const root = `kits/${eventId}`;
  const listed = await bucket.list(root, { limit: 100 });
  if (listed.error) throw new Error(`This event's kit: ${listed.error.message}`);
  const slugs = (listed.data ?? []).map((entry) => entry.name).filter((name) => name && !name.includes("."));
  const slug = slugs.find((name) => name.endsWith("-static")) ?? slugs[0];
  if (!slug) throw new Error("This event has no kit");
  const base = `${root}/${slug}`;
  const json = await bucket.download(`${base}/pieces.json`);
  if (json.error || !json.data) throw new Error(`This event's kit: ${json.error?.message ?? "no pieces"}`);
  const kit = JSON.parse(await json.data.text()) as { pieces: KitPieceRecord[] };
  const picked = clipKitPieces(kit.pieces);
  const piece = async (record: KitPieceRecord, ink: boolean): Promise<Piece> => {
    const file = await bucket.download(`${base}/${record.file}`);
    if (file.error || !file.data) throw new Error(`This event's kit: ${file.error?.message ?? record.file}`);
    const raw = ink ? await lockupInk(Buffer.from(await file.data.arrayBuffer())) : Buffer.from(await file.data.arrayBuffer());
    const trimmed = await trimToInk(raw);
    return { png: trimmed.png, width: trimmed.width, height: trimmed.height, capPx: Math.min(record.cap_px, trimmed.height), label: record.label };
  };
  return { lockup: await piece(picked.lockup, true), date: await piece(picked.date, false) };
}

async function measured<T>(face: FontEntry, run: (measure: MeasureCap) => T): Promise<T> {
  const cache = new Map<string, number>();
  for (let pass = 0; pass < 8; pass += 1) {
    const missing = new Set<string>();
    const measure: MeasureCap = (line, cap) => {
      const width = cache.get(line);
      if (width == null) {
        missing.add(line);
        return line.length * 0.35 * cap;
      }
      return (width * cap) / REF_CAP;
    };
    const out = run(measure);
    if (!missing.size) return out;
    for (const line of missing) cache.set(line, (await renderCardLine(line, KIT_WHITE, REF_CAP, face)).width);
  }
  throw new Error("measuring did not settle");
}

async function pieceAt(label: string, capPx: number, face: FontEntry): Promise<Piece> {
  const set = await renderCardLine(label, KIT_WHITE, capPx, face);
  return { png: set.png, width: set.width, height: set.height, capPx, label };
}

/** Bands, the top block and the claim, at 1080 × 1920. No guide, no draft stamp. */
export async function buildTripleFitLayers(layout: ClipLayout, face: FontEntry | null): Promise<{ bands: Buffer; top: Buffer; claim: Buffer | null }> {
  const failed = tripleFitTypeChecks(layout).find((check) => !check.ok);
  if (failed) throw new Error(failed.why ?? TF_LINES.arrangementB);
  const raw = renderVideoBands(layout.size.width, layout.size.height, clipBands(layout));
  const bands = await sharp(Buffer.from(raw), { raw: { width: layout.size.width, height: layout.size.height, channels: 4 } }).png().toBuffer();
  const topPieces = [layout.pieces.lockup, layout.pieces.name, layout.pieces.date].filter((piece): piece is NonNullable<typeof piece> => piece != null);
  const top = await textOverlay(topPieces.map((piece) => piece.piece), topPieces.map((piece) => piece.at), layout.size, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  if (!layout.claim.length) return { bands, top, claim: null };
  if (!face) throw new Error("A triple-fit claim needs the kit face");
  const claimPieces: Piece[] = [];
  const places: Placement[] = [];
  for (const line of layout.claim) {
    const set = await renderCardLine(line.text, line.color === "red" ? KIT_RED : KIT_WHITE, line.capPx, face);
    claimPieces.push({ png: set.png, width: set.width, height: set.height, capPx: line.capPx, label: line.text });
    places.push({
      label: line.text,
      left: Math.round((layout.size.width - set.width) / 2),
      top: Math.round(line.capTop - set.capTopRow),
      width: set.width,
      height: set.height,
      scale: 1,
      short: false,
      stepped: false,
      belowFloor: false,
    });
  }
  const claim = await textOverlay(claimPieces, places, layout.size, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  return { bands, top, claim };
}

async function arrangeWithFace(
  db: ServiceRoleDb,
  source: Row,
  eventId: string,
  claimText: string,
  signUrl: (bucket: string, objectPath: string) => Promise<string>,
): Promise<{ layout: ClipLayout; face: FontEntry }> {
  const event = eventId ? await one(db, "events", eventId) : null;
  const artist = await one(db, "creative_lab_artists", text(source, "artist_id"));
  const artistName = text(artist, "name").toUpperCase();
  if (!artistName) throw new Error("This clip has no artist name");
  if (!eventId) throw new Error("This event has no kit");
  const kitPieces = await eventKit(eventId);
  const clientId = text(event, "client_id");
  const kit = providedFace(clientId, "BootzyCondensedTM-Regular");
  if (!kit) throw new Error("Held — BootzyCondensedTM-Regular didn't load for this render · retry");
  const face = await withKitFace(
    { postscriptName: kit.postscriptName, path: kit.storage.path },
    {
      signUrl: async (bucket, path) => {
        try {
          return await signUrl(bucket, path);
        } catch {
          return null;
        }
      },
      fetchBytes: async (url) => {
        const res = await fetch(url);
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      },
    },
    async (file) => requireFont(kit.postscriptName, indexFonts(dirname(file))),
  );
  const name = await pieceAt(artistName, T1C.nameCap * OUTPUT.height, face);
  const claim = claimText
    ? await measured(face, (measure) => planVideoClaim(claimText, measure))
    : null;
  if (claim && "held" in claim) throw new Error(claim.held);
  return { layout: planClipLayout({ lockup: kitPieces.lockup, name, date: kitPieces.date, claim: claim as VideoClaimPlan | null }, "9:16", "B"), face };
}

const dataUri = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

/** The event's approved ladder claim, or none. Caption text is not a claim. */
async function ladderClaim(db: ServiceRoleDb, eventId: string): Promise<string> {
  if (!eventId) return "";
  const warnings = await rows(db, "ticket_warnings", "event_id", eventId);
  const source = approvedClaim(warnings.map((row): WarningRow => ({
    id: text(row, "id"),
    claim: text(row, "claim"),
    format: row.format == null ? null : String(row.format),
    state: text(row, "state"),
    approved_by: row.approved_by == null ? null : String(row.approved_by),
    approved_at: row.approved_at == null ? null : String(row.approved_at),
    runs_from: row.runs_from == null ? null : String(row.runs_from),
    runs_to: row.runs_to == null ? null : String(row.runs_to),
  })), new Date());
  return source.kind === "approved" ? source.claim : "";
}

/**
 * Render one made triple-fit. The footage is the source clip's render copy
 * (render_asset_id, else creative_asset_id), never a 4K Drive master.
 */
export async function renderTripleFitClip(input: {
  db: ServiceRoleDb;
  clip: Row;
  signUrl: (bucket: string, objectPath: string) => Promise<string>;
  probe: (url: string) => Promise<Probe>;
  serveUrl?: string;
  hooks?: TripleFitHooks;
}): Promise<TripleFitRendered> {
  const sourceId = text(input.clip, "triple_fit_source_id");
  if (!sourceId) throw new Error("This clip is not a triple-fit");
  const source = await one(input.db, "creative_lab_clips", sourceId);
  if (!source) throw new Error("The triple-fit source clip is missing");
  const { assetId } = renderSourceAsset(source);
  const asset = await one(input.db, "creative_assets", assetId);
  const storagePath = text(asset, "storage_path");
  if (!storagePath) throw new Error("clip has no source asset");
  const signed = await input.signUrl(text(asset, "storage_bucket") || "campaign-assets", storagePath);
  const meta = await input.probe(signed);
  const size = { width: meta.width, height: meta.height };
  const cropX = source.crop_focus_x == null ? 0.5 : Number(source.crop_focus_x);
  const cropY = source.crop_focus_y == null ? 0.5 : Number(source.crop_focus_y);
  const window = partWindow(size, cropX, cropY);
  const upscale = tripleFitUpscale(size, cropX, cropY);
  if (!upscale.ok) throw new Error(upscale.line);
  const inS = source.in_s == null || source.in_s === "" ? 0 : Number(source.in_s);
  const outS = source.out_s == null || source.out_s === "" ? inS + meta.durationInSeconds : Number(source.out_s);
  const length = tripleFitLength(inS, outS);
  if (!length.ok) throw new Error(length.line);
  const status = text(source, "audio_status") || "original";
  const sound = tripleFitSound({
    hasAudio: status !== "replaced",
    audioMatch: source.audio_match === true,
    audioStatus: status,
  });
  const parts = partPlacements(size, window, sound.muted);
  if (parts.length !== 3) throw new Error("A triple-fit is three parts");
  if (!sound.muted && parts.filter((part) => !part.muted).length !== 1) throw new Error("A triple-fit plays the clip's sound once");

  const eventId = text(source, "event_id") || text(input.clip, "event_id");
  const claimText = await ladderClaim(input.db, eventId);
  const arranged = input.hooks?.arrange
    ? { layout: await input.hooks.arrange({ artistName: "", dateLine: "", claimText }), face: null }
    : await arrangeWithFace(input.db, source, eventId, claimText, input.signUrl);
  const failed = tripleFitTypeChecks(arranged.layout).find((check) => !check.ok);
  if (failed) throw new Error(failed.why ?? TF_LINES.arrangementB);
  const painted = input.hooks?.paint
    ? await input.hooks.paint(arranged.layout)
    : await buildTripleFitLayers(arranged.layout, arranged.face);
  const props: TripleFitOnClipProps = {
    clipUrl: signed,
    sourceWidth: size.width,
    sourceHeight: size.height,
    window,
    inS,
    fps: meta.fps || 30,
    durationInSeconds: length.seconds,
    muted: sound.muted,
    bandsUrl: dataUri(painted.bands),
    topUrl: dataUri(painted.top),
    claimUrl: painted.claim ? dataUri(painted.claim) : null,
    guideUrl: null,
  };
  const output = await renderCompositionViaLambda({
    composition: "TripleFitOnClip",
    inputProps: props as unknown as Record<string, unknown>,
    muted: sound.muted,
    frameCount: Math.max(1, Math.round(length.seconds * (meta.fps || 30))),
  }, requireLambdaServeUrl(input.serveUrl), input.hooks?.lambda);
  const remove = input.hooks?.lambda ? input.hooks.deleteRender : deleteLambdaRender;
  if (remove) await remove({ bucketName: output.bucketName, lambdaRenderId: output.lambdaRenderId }).catch(() => {});
  return {
    bytes: output.bytes,
    renderMs: output.renderMs,
    estimatedCostUsd: output.estimatedCostUsd,
    estimatedCostDisplay: output.estimatedCostDisplay,
    width: OUTPUT.width,
    height: OUTPUT.height,
    durationSeconds: length.seconds,
    props,
  };
}
