/**
 * Public unavailable state for the client portal — used when the token
 * is unknown, disabled, expired, or any backend read fails.
 *
 * Mirrors the event-share `not-found.tsx` neutrality: the same copy
 * for every failure mode so a probing visitor can't fingerprint which
 * tokens ever existed.
 */
export function ClientPortalUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16 text-zinc-900">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Off Pixel
        </p>
        <h1 className="font-heading text-2xl tracking-wide">
          This link is no longer active
        </h1>
        <p className="text-sm text-zinc-600">
          The link may have been disabled by the agency, or it may have
          expired. Get in touch if you were expecting to land here.
        </p>
      </div>
    </main>
  );
}
