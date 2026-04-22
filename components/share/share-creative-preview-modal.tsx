"use client";

import { useEffect } from "react";
import { ExternalLink, ImageOff, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCurrency } from "@/lib/dashboard/format";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

/**
 * components/share/share-creative-preview-modal.tsx
 *
 * Click-to-expand modal for the public share report. Same visual
 * shell as the dashboard panel's modal but with two surface-specific
 * differences:
 *
 *   1. NO video_id branch. The share viewer has no Meta access
 *      token — hitting `graph.facebook.com/{video_id}/source` would
 *      return 401. We fall back to image_url > thumbnail_url and let
 *      the marketer screenshot or grab the asset directly.
 *   2. NO "Open in Ads Manager" footer. Public viewers don't have
 *      Meta seats; that link would 404 for them.
 *
 * Instagram-embed path stays — Meta's plugin URL is publicly
 * accessible without auth, so client-facing previews of IG-promoted
 * posts render natively. Same CTA mapping + metrics strip otherwise.
 */

interface Props {
  group: ConceptGroupRow;
  onClose: () => void;
}

const FB_PLUGIN_BASE = "https://www.facebook.com/plugins/post.php";

// Public IG post URLs always carry the /p/, /reel/, or /tv/ prefix —
// extract the shortcode and rebuild the canonical /embed/captioned
// URL. Meta's `/plugins/post.php` endpoint expects an FB Graph URL,
// so feeding it an IG permalink renders blank for share viewers.
const IG_PERMALINK_RE = /instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/i;
const FB_HOST_RE = /(?:^|\.)facebook\.com\//i;

/**
 * Build the iframe `src` for a creative preview. Returns `null`
 * when the permalink isn't a recognised IG / FB post URL — caller
 * falls through to the next asset tier (image / thumbnail).
 */
function getEmbedSrc(permalink: string): string | null {
  const ig = permalink.match(IG_PERMALINK_RE);
  if (ig) {
    const [, kind, shortcode] = ig;
    return `https://www.instagram.com/${kind}/${shortcode}/embed/captioned`;
  }
  if (FB_HOST_RE.test(permalink)) {
    return `${FB_PLUGIN_BASE}?href=${encodeURIComponent(permalink)}&show_text=false`;
  }
  return null;
}

function ctaLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  const t = type.trim().toUpperCase();
  switch (t) {
    case "LEARN_MORE":
      return "Learn more";
    case "SHOP_NOW":
      return "Shop now";
    case "BOOK_TRAVEL":
      return "Book now";
    case "SIGN_UP":
      return "Sign up";
    case "GET_OFFER":
      return "Get offer";
    default:
      return t
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");
  }
}

export default function ShareCreativePreviewModal({ group, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const preview = group.representative_preview;
  const fallbackImage =
    preview.image_url || group.representative_thumbnail || null;
  const cta = ctaLabel(preview.call_to_action_type);
  const link = preview.link_url;
  // Title is the group's display_name (already prefers ad.name over
  // the often-template-polluted creative.name). Headline copy from
  // the preview is rendered separately as a body block.
  const title = group.display_name || "Creative";
  const headlineCopy = preview.headline;
  const body = preview.body || group.representative_body_preview;
  const altText = headlineCopy || title;
  const showVariants = group.ad_names.length > 1;
  const variantsHead = group.ad_names.slice(0, 3).join(", ");
  const variantsMore =
    group.ad_names.length > 3 ? ` +${group.ad_names.length - 3} more` : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Creative preview"
    >
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 font-heading text-lg tracking-wide text-foreground">
              {title}
            </h2>
            {showVariants && (
              <div
                className="mt-1 line-clamp-2 text-xs text-muted-foreground"
                title={group.ad_names.join(", ")}
              >
                {group.ad_names.length} ad name variants: {variantsHead}
                {variantsMore}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <ShareAssetBlock
            preview={preview}
            fallbackImage={fallbackImage}
            altText={altText}
          />

          <div className="space-y-3">
            {headlineCopy && (
              <div className="text-base font-semibold text-foreground">
                {headlineCopy}
              </div>
            )}
            {body && (
              <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                {body}
              </div>
            )}
            {cta && (
              <div className="inline-flex items-center gap-2">
                <span className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground">
                  {cta}
                </span>
                {link && (
                  <span className="truncate text-xs text-muted-foreground">
                    {link}
                  </span>
                )}
              </div>
            )}
            {!cta && link && (
              <div className="truncate text-xs text-muted-foreground">
                {link}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-3">
            <Stat label="Spend" value={fmtCurrency(group.spend)} prominent />
            <Stat label="CTR" value={fmtPct(group.ctr)} />
            <Stat label="CPR" value={fmtMoneyOrDash(group.cpr)} />
            <Stat label="Frequency" value={fmtFreq(group.frequency)} />
            <Stat label="Impressions" value={fmtInt(group.impressions)} />
            <Stat
              label="Ads"
              value={
                <span className="inline-flex items-center gap-1.5">
                  {group.ad_count}
                  {group.creative_id_count > 1 && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {group.creative_id_count}× concept
                    </Badge>
                  )}
                </span>
              }
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShareAssetBlock({
  preview,
  fallbackImage,
  altText,
}: {
  preview: ConceptGroupRow["representative_preview"];
  fallbackImage: string | null;
  altText: string;
}) {
  // Asset selection waterfall (share-side has no video tier — viewer
  // has no Meta access token): embed (IG/FB) > image > thumbnail >
  // placeholder. Embed tier falls through when the permalink isn't a
  // recognised IG / FB URL rather than rendering a blank iframe.
  const embedSrc = preview.instagram_permalink_url
    ? getEmbedSrc(preview.instagram_permalink_url)
    : null;
  if (preview.instagram_permalink_url && embedSrc) {
    const isInstagram = IG_PERMALINK_RE.test(preview.instagram_permalink_url);
    return (
      <div className="space-y-2">
        <div className="flex justify-center bg-muted">
          <iframe
            src={embedSrc}
            width={500}
            height={640}
            style={{ border: 0, overflow: "hidden" }}
            scrolling="no"
            allowFullScreen
            title={isInstagram ? "Instagram preview" : "Facebook preview"}
          />
        </div>
        <a
          href={preview.instagram_permalink_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {isInstagram ? "View on Instagram" : "View on Facebook"}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  // Share-side intentionally drops the video_id branch — see file
  // header. preview.image_url is the marketer-supplied source;
  // falls back to thumbnail_url which the dashboard fetcher already
  // collapsed into representative_thumbnail.
  if (preview.image_url || fallbackImage) {
    const src = preview.image_url ?? fallbackImage!;
    return (
      <div className="flex justify-center bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={altText}
          className="max-h-[60vh] w-auto object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="flex h-64 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <ImageOff className="h-8 w-8" />
    </div>
  );
}

function Stat({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: React.ReactNode;
  prominent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={
          prominent
            ? "text-base font-semibold text-foreground"
            : "text-sm text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}
function fmtMoneyOrDash(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtCurrency(v);
}
function fmtFreq(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}
