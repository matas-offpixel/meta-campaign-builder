export function FunnelCreativePacing() {
  return (
    <details className="rounded-lg border border-dashed border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Show top creatives at this stage
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">
        Per-creative pacing overlays will populate here once the stage-specific
        creative benchmark join is enabled. The current release focuses on the
        region and venue funnel summary.
      </p>
    </details>
  );
}
