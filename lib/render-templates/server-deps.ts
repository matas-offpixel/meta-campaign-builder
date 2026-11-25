/**
 * lib/render-templates/server-deps.ts — the real dependencies for render
 * packages: the service-role client's Storage, ffmpeg-static's low-end read,
 * Remotion Lambda (eu-west-2, the caption renders' path), the client's kit
 * face and the event's stored kit, the export Drive account and the artist
 * library's folders. Only the Lab route, the MCP route and the render tick
 * load this; everything it wires is tested with fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import path from "node:path";

import { ensureLibraryFolders } from "../artist-library/library-drive.ts";
import { trimToInk, type Piece } from "../creative-lab/artist-card.ts";
import { indexFonts, requireFont } from "../creative-lab/kit-font.ts";
import { KIT_FACES, providedFace } from "../creative-lab/kit-faces.ts";
import { renderCompositionViaLambda, requireLambdaServeUrl } from "../creative-lab/lambda.ts";
import { probeMp4Bytes } from "../creative-lab/mp4-probe.ts";
import { withKitFace } from "../creative-lab/t1-lambda.ts";
import { lockupInk } from "../creative-lab/triple-fit-render.ts";
import { readEnvelopes, withTempDir } from "../creative-tests/audio-ffmpeg.ts";
import { signedUrl } from "../creative-tests/snippet-server.ts";
import type { DriveApi } from "../drive/client.ts";
import type { DriveDb } from "../drive/db.ts";
import { emptyLog } from "../drive/folders.ts";
import { londonToday } from "../drive/tree.ts";
import { blockLayer } from "./layers.ts";
import type { MontagePlan } from "./montage-plan.ts";
import type { StartDeps } from "./start.ts";
import { PACKAGE_BUCKET, type WorkerDeps } from "./worker.ts";

type Service = SupabaseClient;
type KitPiece = { role: string; label: string; file: string; cap_px: number };

/** The event's stored kit (campaign-assets/kits/{eventId}/{slug}/pieces.json), static slug first. */
async function eventKit(db: Service, eventId: string): Promise<{ base: string; pieces: KitPiece[] } | null> {
  const bucket = db.storage.from(PACKAGE_BUCKET);
  const listed = await bucket.list(`kits/${eventId}`, { limit: 100 });
  if (listed.error) return null;
  const slugs = (listed.data ?? []).map((e) => e.name).filter((n) => n && !n.includes("."));
  const slug = slugs.find((n) => n.endsWith("-static")) ?? slugs[0];
  if (!slug) return null;
  const base = `kits/${eventId}/${slug}`;
  const json = await bucket.download(`${base}/pieces.json`);
  if (json.error || !json.data) return null;
  try {
    const kit = JSON.parse(await json.data.text()) as { pieces?: KitPiece[] };
    return { base, pieces: kit.pieces ?? [] };
  } catch {
    return null;
  }
}

function kitFaceOf(clientId: string) {
  const face = KIT_FACES.find((f) => f.clientId === clientId);
  return face ? providedFace(clientId, face.postscriptName) : null;
}

export function startDeps(db: Service): StartDeps {
  return {
    async kitReady(eventId, clientId) {
      if (!kitFaceOf(clientId)) return false;
      const kit = await eventKit(db, eventId);
      return Boolean(kit?.pieces.some((p) => p.role === "logo"));
    },
    async readLowPcm(storagePath) {
      const { data, error } = await db.storage.from(PACKAGE_BUCKET).download(storagePath);
      if (error || !data) throw new Error(`storage download: ${error?.message ?? "no file"}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      return withTempDir("m4-track-", async (dir) => {
        const file = path.join(dir, path.posix.basename(storagePath) || "track");
        await writeFile(file, bytes);
        return (await readEnvelopes(file)).low;
      });
    },
  };
}

export function workerDeps(db: Service, drive: DriveApi | null, now: () => Date = () => new Date()): WorkerDeps {
  const base = startDeps(db);
  const layerCache = new Map<string, Promise<{ url: string; fromFrame: number; toFrame: number }[]>>();
  return {
    ...base,
    signUrl: (bucket, p) => signedUrl(db, bucket, p),
    async upload(bucket, p, bytes, contentType) {
      const res = await db.storage.from(bucket).upload(p, bytes, { contentType, upsert: true });
      if (res.error) throw new Error(`storage upload: ${res.error.message}`);
    },
    async render(req) {
      const out = await renderCompositionViaLambda(req, requireLambdaServeUrl());
      return { bytes: out.bytes, renderMs: out.renderMs };
    },
    probe: (bytes) => probeMp4Bytes(bytes),
    layers(input) {
      const key = `${input.packageId}:${input.variant}`;
      if (!layerCache.has(key)) layerCache.set(key, buildLayers(db, input));
      return layerCache.get(key)!;
    },
    async latestArt(eventId) {
      const kit = await eventKit(db, eventId);
      return Boolean(kit?.pieces.some((p) => p.role === "logo"));
    },
    drive,
    async libraryRenders(artist) {
      if (!drive) return null;
      const folders = await ensureLibraryFolders(db as unknown as DriveDb, drive, artist, emptyLog());
      return folders?.renders ?? null;
    },
    now,
    today: londonToday(now()),
  };
}

/** The variant's text blocks set in the kit face, stored once per package and variant, signed for the render. */
async function buildLayers(db: Service, input: { packageId: string; eventId: string; clientId: string; variant: "no-text" | "teaser" | "announcement"; plan: MontagePlan }) {
  const blocks = input.plan.texts[input.variant];
  if (!blocks.length) return [];
  const face = kitFaceOf(input.clientId);
  if (!face) throw new Error("the client's kit has no provided face");
  const kit = await eventKit(db, input.eventId);
  const logoRecord = kit?.pieces.find((p) => p.role === "logo") ?? null;
  let lockup: Piece | null = null;
  if (kit && logoRecord) {
    const file = await db.storage.from(PACKAGE_BUCKET).download(`${kit.base}/${logoRecord.file}`);
    if (file.data) {
      const trimmed = await trimToInk(await lockupInk(Buffer.from(await file.data.arrayBuffer())));
      lockup = { png: trimmed.png, width: trimmed.width, height: trimmed.height, capPx: trimmed.height, label: "lockup" };
    }
  }
  return withKitFace(
    { postscriptName: face.postscriptName, path: face.storage.path },
    {
      signUrl: async (bucket, p) => {
        try {
          return await signedUrl(db, bucket, p);
        } catch {
          return null;
        }
      },
      fetchBytes: async (url) => {
        const res = await fetch(url);
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      },
    },
    async (fontFile) => {
      const entry = requireFont(face.postscriptName, indexFonts(dirname(fontFile)));
      const out: { url: string; fromFrame: number; toFrame: number }[] = [];
      for (let i = 0; i < blocks.length; i += 1) {
        const png = await blockLayer(blocks[i]!, entry, blocks[i]!.kind === "close" ? lockup : null);
        const p = `renders/m4/${input.packageId}/layers/${input.variant}-${i}.png`;
        const up = await db.storage.from(PACKAGE_BUCKET).upload(p, png, { contentType: "image/png", upsert: true });
        if (up.error) throw new Error(`storage upload: ${up.error.message}`);
        out.push({ url: await signedUrl(db, PACKAGE_BUCKET, p), fromFrame: blocks[i]!.fromFrame, toFrame: blocks[i]!.toFrame });
      }
      return out;
    },
  );
}
