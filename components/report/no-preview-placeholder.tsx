/**
 * Graceful empty states when Meta returns no renderable preview URL
 * (e.g. archived ads with stripped creative on the "maximum"
 * preset). Replaces the grey `ImageOff` icon that read as "error"
 * — these are data-availability gaps, not failures.
 */

/** 64×64 card thumbnail slot in the active-creatives grid. */
export function NoPreviewThumbnailCard() {
  return (
    <div
      className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded border border-dashed border-border/60 bg-muted/40 px-0.5 text-center"
      role="img"
      aria-label="No preview available"
    >
      <span className="text-[9px] font-medium leading-tight text-muted-foreground">
        No preview
      </span>
    </div>
  );
}

/** Large area inside the creative preview modal when no image URL. */
export function NoPreviewModalPlaceholder() {
  return (
    <div
      className="flex h-64 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/60 bg-muted/40 px-4 text-center"
      role="status"
    >
      <p className="text-sm text-muted-foreground">No preview available</p>
      <p className="text-xs text-muted-foreground/80">
        Meta did not return an image for this creative.
      </p>
    </div>
  );
}
