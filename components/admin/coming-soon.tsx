/**
 * Placeholder body for admin sections whose phase hasn't shipped yet
 * (see docs/ADMIN_DASHBOARD_ARCHITECTURE.md phase log). Server-safe.
 */
export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-heading text-2xl tracking-wide">{title}</h1>
      <div className="mt-6 rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
