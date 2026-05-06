interface Props {
  /**
   * When the token resolves to a disabled share row, we show slightly
   * clearer copy while keeping the same neutral envelope as unknown tokens.
   */
  variant?: "default" | "share_disabled";
}

/**
 * Public unavailable state for the client portal — used when the token
 * is unknown, disabled, expired, or any backend read fails.
 *
 * Unknown / expiry / server failures share neutral messaging.
 * Confirmed-disabled tokens optionally use {@link Props.variant}
 * `share_disabled` for clearer guidance without exposing whether a
 * random guess ever existed.
 */
export function ClientPortalUnavailable({ variant = "default" }: Props) {
  const disabled = variant === "share_disabled";
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
          {disabled ? (
            <>
              This dashboard link has been turned off. Ask your agency to
              turn sharing back on from their Off Pixel client dashboard if
              you still need access.
            </>
          ) : (
            <>
              The link may have been disabled by the agency, or it may have
              expired. Get in touch if you were expecting to land here.
            </>
          )}
        </p>
      </div>
    </main>
  );
}
