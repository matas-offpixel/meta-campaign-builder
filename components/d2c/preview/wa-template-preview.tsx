"use client";

/**
 * components/d2c/preview/wa-template-preview.tsx
 *
 * Reusable Bird-style WhatsApp template preview panel. Renders an approximate
 * phone-message mock with the header artwork, substituted body text, footer,
 * and CTA button. Intentionally low-fi — accurate enough for pre-flight review
 * without reimplementing Bird's full renderer.
 *
 * Extracted here (not inline in the modal) so the future LP-preview work can
 * reuse it directly.
 */

interface WaTemplatePreviewProps {
  /** Full URL for the header artwork image (optional). */
  artworkUrl?: string | null;
  /** Body text with {{var}} tokens already substituted. */
  body: string;
  /** Footer line (optional). */
  footer?: string | null;
  /** CTA button label (optional). */
  buttonText?: string | null;
  /** Resolved CTA URL (optional). */
  buttonUrl?: string | null;
  /** Event name — shown as sender label. */
  senderName?: string | null;
}

export function WaTemplatePreview({
  artworkUrl,
  body,
  footer,
  buttonText,
  buttonUrl,
  senderName,
}: WaTemplatePreviewProps) {
  return (
    <div className="flex justify-center py-2">
      {/* Phone frame */}
      <div className="w-full max-w-xs">
        {/* Sender stub */}
        {senderName && (
          <div className="mb-1 flex items-center gap-2 px-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
              {senderName.slice(0, 2).toUpperCase()}
            </div>
            <span className="truncate text-xs font-medium text-foreground">
              {senderName}
            </span>
          </div>
        )}

        {/* Message bubble */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Header artwork */}
          {artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artworkUrl}
              alt="Event artwork"
              className="aspect-[1.91/1] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-muted">
              <span className="text-xs text-muted-foreground">No artwork</span>
            </div>
          )}

          {/* Body */}
          <div className="px-3 pt-3 pb-1">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {body || <span className="italic text-muted-foreground">No body text</span>}
            </p>
          </div>

          {/* Footer */}
          {footer && (
            <p className="px-3 pb-2 text-[11px] text-muted-foreground">{footer}</p>
          )}

          {/* CTA divider + button */}
          {buttonText && (
            <div className="border-t border-border px-3 py-2">
              {buttonUrl ? (
                <a
                  href={buttonUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center text-sm font-medium text-primary hover:underline"
                >
                  {buttonText}
                </a>
              ) : (
                <span className="block w-full text-center text-sm font-medium text-primary">
                  {buttonText}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Delivery timestamp stub */}
        <p className="mt-1 text-right text-[10px] text-muted-foreground">Preview only</p>
      </div>
    </div>
  );
}
