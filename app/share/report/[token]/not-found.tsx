/**
 * Public 404 for unknown / disabled / expired share tokens.
 *
 * Single neutral surface for all three failure modes so a probing
 * attacker can't distinguish "token never existed" from "token was
 * revoked". No internal IDs rendered.
 */
export default function ShareNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Off Pixel
        </p>
        <h1 className="font-heading text-2xl tracking-wide text-foreground">
          This report is no longer available
        </h1>
        <p className="text-sm text-muted-foreground">
          The link may have been disabled by the agency, or it may have expired.
          Get in touch if you were expecting to see numbers here.
        </p>
      </div>
    </main>
  );
}
