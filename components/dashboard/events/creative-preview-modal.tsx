"use client";

import { useEffect } from "react";
import { ExternalLink, ImageOff, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCurrency } from "@/lib/dashboard/format";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

/**
 * components/dashboard/events/creative-preview-modal.tsx
 *
 * Click-to-expand modal for a single creative concept on the
 * internal dashboard panel. Renders the full asset (Instagram embed
 * → video → image → thumbnail), headline / body / CTA, and the
 * group's aggregated metrics. Footer carries the Ads Manager deep
 * link (moved here from the card per PR #40).
 *
 * Hand-rolled rather than wrapping `<Dialog>` because the existing
 * primitive is sized for confirm-style forms (max-w-md) and the
 * spec calls for a content viewer (max-w-3xl, scroll-y, dark
 * backdrop). The escape / scroll-lock / backdrop-click semantics
 * are kept the same so it feels native alongside other modals.
 *
 * Accepts a ConceptGroupRow exclusively. Per-creative_id rows
 * (toggle off in the panel) are wrapped into a single-bucket
 * group on the fly by the caller — keeps this component simple
 * and means there's only one preview shape to render.
 */

interface Props {
  group: ConceptGroupRow;
  /** Ad account id used to scope the Ads Manager deep-link. */
  adAccountId: string | null;
  onClose: () => void;
}

const FB_PLUGIN_BASE = "https://www.facebook.com/plugins/post.php";

function adsManagerUrl(adId: string, adAccountId: string | null): string {
  // selected_ad_ids deep-links straight to the ad row.
  // act_id is required to scope to the right ad account; without
  // it Ads Manager throws an "ambiguous account" interstitial.
  const accountParam = adAccountId
    ? `&act=${encodeURIComponent(adAccountId.replace(/^act_/, ""))}`
    : "";
  return `https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${encodeURIComponent(adId)}${accountParam}`;
}

/**
 * Map Meta's CTA type enum to a human-readable button label.
 * Default branch humanises the enum (UNDER_SCORES → "Under scores")
 * so an unknown CTA still renders something readable instead of a
 * raw all-caps token.
 */
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

export default function CreativePreviewModal({
  group,
  adAccountId,
  onClose,
}: Props) {
  // Escape-to-close + body scroll lock. Mirrors `components/ui/
  // dialog.tsx` so this hand-rolled overlay behaves identically to
  // the rest of the modal-stack.
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
  const headline = preview.headline || group.display_name;
  const body = preview.body || group.representative_body_preview;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Creative preview"
    >
      {/* Backdrop click closes. The inner card stops propagation
          so a stray click inside doesn't dismiss the modal. */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader title={headline ?? "Creative"} onClose={onClose} />

        <div className="space-y-5 p-5">
          <AssetBlock
            preview={preview}
            fallbackImage={fallbackImage}
            altText={headline ?? "Creative preview"}
          />

          <div className="space-y-3">
            {headline && (
              <div className="text-base font-semibold text-foreground">
                {headline}
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

          <MetricsStrip group={group} />
        </div>

        <ModalFooter
          adAccountId={adAccountId}
          adId={group.representative_ad_id}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function ModalHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 font-heading text-lg tracking-wide text-foreground">
          {title}
        </h2>
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
  );
}

function ModalFooter({
  adAccountId,
  adId,
  onClose,
}: {
  adAccountId: string | null;
  adId: string;
  onClose: () => void;
}) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3">
      <a
        href={adsManagerUrl(adId, adAccountId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        Open in Ads Manager
        <ExternalLink className="h-3 w-3" />
      </a>
      <Button variant="outline" size="sm" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function AssetBlock({
  preview,
  fallbackImage,
  altText,
}: {
  preview: ConceptGroupRow["representative_preview"];
  fallbackImage: string | null;
  altText: string;
}) {
  // Asset selection waterfall: Instagram embed > video > image >
  // thumbnail > placeholder. Mirrors the spec — the modal renders
  // the highest-fidelity option Meta gave us in the preview
  // payload, and degrades gracefully when the upstream signal is
  // missing rather than collapsing the whole block.
  if (preview.instagram_permalink_url) {
    const embedSrc = `${FB_PLUGIN_BASE}?href=${encodeURIComponent(
      preview.instagram_permalink_url,
    )}&show_text=false`;
    return (
      <div className="space-y-2">
        <div className="flex justify-center bg-muted">
          <iframe
            src={embedSrc}
            width={500}
            height={500}
            style={{ border: 0, overflow: "hidden" }}
            scrolling="no"
            allowFullScreen
            title="Instagram preview"
          />
        </div>
        <a
          href={preview.instagram_permalink_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View on Instagram
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  if (preview.video_id) {
    // Internal panel only — relies on the user's Meta access token
    // (the share-side modal drops this branch entirely). The /source
    // endpoint 302s to the CDN MP4. If the browser can't load it
    // (token not in scope, video deleted) the <video> element
    // surfaces its built-in "couldn't play" UI; the image / link
    // fallbacks below stay visible underneath via the <a> link.
    const videoSrc = `https://graph.facebook.com/v21.0/${encodeURIComponent(preview.video_id)}/source`;
    return (
      <div className="space-y-2">
        <div className="flex justify-center bg-black">
          <video
            controls
            poster={fallbackImage ?? undefined}
            className="max-h-[60vh] w-full max-w-full"
          >
            <source src={videoSrc} />
          </video>
        </div>
      </div>
    );
  }

  if (preview.image_url) {
    return (
      <div className="flex justify-center bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview.image_url}
          alt={altText}
          className="max-h-[60vh] w-auto object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  if (fallbackImage) {
    return (
      <div className="flex justify-center bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fallbackImage}
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

function MetricsStrip({ group }: { group: ConceptGroupRow }) {
  return (
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
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {group.creative_id_count}× concept
              </Badge>
            )}
          </span>
        }
      />
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
