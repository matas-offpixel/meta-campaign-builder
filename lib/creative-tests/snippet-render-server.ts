/**
 * The snippet render's real dependencies: snippet-server.ts's Storage and
 * ffmpeg, plus Remotion Lambda (StillWithAudio, silent) and the creative
 * asset registry. Loaded by the render tick only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import { fingerprintFile } from "../creatives/stream-file.ts";
import type { DriveApi } from "../drive/client.ts";
import { muxSnippet } from "./audio-ffmpeg.ts";
import { AUDIO_BUCKET } from "./audio-intake.ts";
import { cutDeps, staticCopyUrl } from "./snippet-server.ts";
import type { RenderDeps, SnippetRenderRow } from "./snippet-render.ts";
import { SNIPPET } from "./snippet.ts";

type Service = SupabaseClient;

export function renderDeps(db: Service, drive: DriveApi): RenderDeps {
  return {
    ...cutDeps(db),
    staticUrl: (row: SnippetRenderRow) => staticCopyUrl(db, drive, { eventId: row.event_id, driveFileId: row.static_drive_file_id }),
    async renderStill({ imageUrl, lengthS }) {
      const { renderCompositionViaLambda, requireLambdaServeUrl } = await import("../creative-lab/lambda.ts");
      const out = await renderCompositionViaLambda(
        { composition: "StillWithAudio", inputProps: { imageUrl, durationInSeconds: lengthS, fps: SNIPPET.fps }, muted: true, frameCount: lengthS * SNIPPET.fps },
        requireLambdaServeUrl(),
      );
      return { bytes: out.bytes, renderMs: out.renderMs };
    },
    mux: muxSnippet,
    async register(row, storagePath, filePath) {
      const identity = await fingerprintFile(filePath);
      const registered = await upsertRegisteredAsset(db, {
        userId: row.user_id,
        identity,
        filename: row.file_name ?? `snippet-${row.id}.mp4`,
        mediaKind: "video",
        aspectRatio: "9:16",
        durationSeconds: Number(row.length_s),
        storageBucket: AUDIO_BUCKET,
        storagePath,
      });
      if (!registered.ok) throw new Error(registered.error);
      return registered.asset.id;
    },
  };
}
