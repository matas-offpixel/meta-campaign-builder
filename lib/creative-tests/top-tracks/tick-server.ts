/**
 * The Top tracks tick's real dependencies: Storage, the kit face from the
 * private kit-fonts bucket (O52, name-checked per render), the kit's
 * pieces when uploaded, face detection, Remotion Lambda (TopTracks,
 * silent), ffmpeg and the creative-asset registry. Loaded by the render
 * tick only; tick.ts is tested with fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { KIT_RED } from "../../creative-lab/claim-slot.ts";
import { detectFaces, faceGeometry } from "../../creative-lab/face-detect.ts";
import { KIT_FACES } from "../../creative-lab/kit-faces.ts";
import { readFontFaces, type FontEntry } from "../../creative-lab/kit-font.ts";
import { KIT_FONT_BUCKET, withKitFace } from "../../creative-lab/t1-lambda.ts";
import { upsertRegisteredAsset } from "../../creatives/asset-registry.ts";
import { fingerprintFile } from "../../creatives/stream-file.ts";
import { muxSnippet } from "../audio-ffmpeg.ts";
import { AUDIO_BUCKET } from "../audio-intake.ts";
import { storageDeps } from "../snippet-server.ts";
import { TOP_TRACKS } from "./reel.ts";
import type { TickDeps } from "./tick.ts";

type Service = SupabaseClient;

/** Where a client's kit pieces would live (scripts/psd-kit.mts's shape): not uploaded for any client yet. */
export function kitPiecesPath(clientId: string): string {
  return `${clientId}/pieces/pieces.json`;
}

export function tickDeps(db: Service): TickDeps {
  const storage = storageDeps(db);
  return {
    download: storage.download,
    upload: storage.upload,
    async withFace(clientId, run) {
      const kit = KIT_FACES.find((f) => f.clientId === clientId);
      if (!kit) throw new Error("This client's kit has no provided face (O51).");
      return withKitFace(
        { postscriptName: kit.postscriptName, path: kit.storage.path },
        {
          async signUrl(bucket, p, ttl) {
            const { data } = await db.storage.from(bucket).createSignedUrl(p, ttl);
            return data?.signedUrl ?? null;
          },
          async fetchBytes(url) {
            const res = await fetch(url);
            return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
          },
        },
        async (file) => {
          const meta = readFontFaces(new Uint8Array(readFileSync(file))).find((f) => f.postscriptName === kit.postscriptName)!;
          const entry: FontEntry = { ...meta, file: path.basename(file), path: file, trial: meta.trialName };
          return run(entry);
        },
      );
    },
    async kitPieces(clientId) {
      const { data } = await db.storage.from(KIT_FONT_BUCKET).download(kitPiecesPath(clientId));
      if (!data) return null;
      const json = JSON.parse(await data.text()) as { pieces: { role: string; label: string; file: string }[] };
      const lockup = json.pieces.find((p) => p.role === "logo");
      const date = json.pieces.find((p) => p.role === "info" && /DAY\b/i.test(p.label));
      if (!lockup || !date) return null;
      const read = async (file: string) => {
        const r = await db.storage.from(KIT_FONT_BUCKET).download(`${clientId}/pieces/${file}`);
        if (!r.data) throw new Error(`kit piece ${file} is missing`);
        return Buffer.from(await r.data.arrayBuffer());
      };
      return { lockupPng: await read(lockup.file), datePng: await read(date.file), dateText: date.label, accentHex: KIT_RED };
    },
    async faceOf(photo) {
      const faces = await detectFaces(photo);
      const main = faces.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!main) return null;
      const g = (await faceGeometry(photo, [main]))[0];
      return g ? { box: g.box, eyeY: g.eyeY, headTopY: g.headTopY, chinY: g.chinY } : null;
    },
    uprightPhoto: async (bytes) => sharp(Buffer.from(bytes)).rotate().jpeg({ quality: 95 }).toBuffer(),
    async renderSilent(props, durationS) {
      const { renderCompositionViaLambda, requireLambdaServeUrl } = await import("../../creative-lab/lambda.ts");
      const out = await renderCompositionViaLambda({ composition: "TopTracks", inputProps: props as Record<string, unknown>, muted: true, frameCount: Math.round(durationS * TOP_TRACKS.fps) }, requireLambdaServeUrl());
      return { bytes: out.bytes, renderMs: out.renderMs };
    },
    mux: muxSnippet,
    async register(row, storagePath, filePath, fileName, durationS) {
      const identity = await fingerprintFile(filePath);
      const registered = await upsertRegisteredAsset(db, { userId: row.user_id, identity, filename: fileName, mediaKind: "video", aspectRatio: "9:16", durationSeconds: durationS, storageBucket: AUDIO_BUCKET, storagePath });
      if (!registered.ok) throw new Error(registered.error);
      return registered.asset.id;
    },
  };
}
