/**
 * lib/d2c/assets/artwork-hosting.ts
 *
 * Publish event artwork at a URL Meta can fetch.
 *
 * Why Supabase Storage and not Bird: **Bird has no usable media-upload API.**
 * All five plausible endpoint shapes were probed against the live workspace
 * and every one fails (`.scratch/probe-media-final.mjs`):
 *
 *   POST /projects/{pid}/media          (multipart request+file)  → 422
 *   PUT  /projects/{pid}/media/{uuid}   (raw octet-stream)        → 422
 *   POST /media                         (workspace-level)         → 404
 *   POST /projects/{pid}/channel-templates/media                  → 422
 *   POST /projects/{pid}/media          (JSON presign + size)     → 422
 *
 * Meta only requires the header image to be fetchable over plain HTTPS, so the
 * existing public-read `landing-page-assets` bucket is sufficient and avoids
 * standing up new infrastructure.
 *
 * Uses the service-role key (server-only). Uploads are upserts keyed on a
 * deterministic object path, so re-running a brief overwrites in place rather
 * than accumulating copies.
 */

import "server-only";

export const ARTWORK_BUCKET = "landing-page-assets";

export class ArtworkHostingError extends Error {
  readonly code = "D2C_ARTWORK_HOSTING_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "ArtworkHostingError";
  }
}

/** Deterministic object path — same brief, same key, so re-runs upsert. */
export function artworkObjectPath(
  brand: string,
  eventSlug: string,
  filename = "artwork.jpg",
): string {
  const clean = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `d2c/${clean(brand)}-${clean(eventSlug)}/${filename}`;
}

export interface UploadArtworkInput {
  bytes: Uint8Array | ArrayBuffer;
  contentType?: string;
  objectPath: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

export interface UploadArtworkResult {
  publicUrl: string;
  objectPath: string;
  bytes: number;
}

/**
 * Upload artwork to the public-read bucket and return its public URL.
 *
 * Verifies the object is anonymously fetchable before returning — an
 * authenticated 200 proves nothing about what Meta's unauthenticated fetcher
 * will see, and a header image Meta cannot fetch fails template review.
 */
export async function uploadEventArtwork(
  input: UploadArtworkInput,
): Promise<UploadArtworkResult> {
  const base = (input.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (input.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!base) throw new ArtworkHostingError("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!key) throw new ArtworkHostingError("SUPABASE_SERVICE_ROLE_KEY is not set.");

  const body = input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : input.bytes;
  if (!body.byteLength) throw new ArtworkHostingError("Refusing to upload zero bytes of artwork.");

  const upload = await fetch(
    `${base}/storage/v1/object/${ARTWORK_BUCKET}/${input.objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": input.contentType ?? "image/jpeg",
        "x-upsert": "true",
        "cache-control": "public, max-age=31536000, immutable",
      },
      body: body as BodyInit,
    },
  );
  if (!upload.ok) {
    throw new ArtworkHostingError(
      `Artwork upload failed (${upload.status}): ${(await upload.text()).slice(0, 300)}`,
    );
  }

  const publicUrl = `${base}/storage/v1/object/public/${ARTWORK_BUCKET}/${input.objectPath}`;

  // Anonymous readback — this is the check that actually matters.
  const anon = await fetch(publicUrl);
  if (!anon.ok) {
    throw new ArtworkHostingError(
      `Artwork uploaded but is not publicly fetchable (${anon.status}) at ${publicUrl}. ` +
        "Meta fetches header images unauthenticated, so this would fail template review.",
    );
  }

  return { publicUrl, objectPath: input.objectPath, bytes: body.byteLength };
}
