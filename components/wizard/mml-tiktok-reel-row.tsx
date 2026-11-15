"use client";

import { useEffect, useState } from "react";

import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import {
  metaCreativeIsSingleVerticalVideo,
  tikTokAdTextFromCaption,
  tikTokCtaForPlanIntent,
} from "@/lib/plan/mml-wizard";
import type { CampaignPlanObjectiveIntent } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/client";
import { tikTokIdentityFace } from "@/lib/tiktok-wizard/account-setup";
import type { AdCreativeDraft } from "@/lib/types";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

interface RouteCell {
  enabled: boolean;
  uploadError: string | null;
}

interface IdentityOption {
  identity_id: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * Collapsed row on a single 9:16 Meta video. On routes the video through
 * the plan's asset routes. Off disables that route and leaves the TikTok
 * creative in place.
 */
export function MmlTikTokReelRow({
  planId,
  objectiveIntent,
  tiktokDraftId,
  creative,
}: {
  planId: string;
  objectiveIntent: CampaignPlanObjectiveIntent;
  tiktokDraftId: string | null;
  creative: AdCreativeDraft;
}) {
  const show = metaCreativeIsSingleVerticalVideo(creative);
  const assetId = singleRegistryAssetId(creative);
  const [enabled, setEnabled] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adText, setAdText] = useState(() => tikTokAdTextFromCaption(metaCaption(creative)));
  const [identityName, setIdentityName] = useState("TikTok");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const draft = tiktokDraftId ? await getTikTokDraft(supabase, tiktokDraftId) : null;
      if (cancelled) return;
      if (draft) {
        const name =
          draft.accountSetup.identityDisplayName?.trim() ||
          draft.accountSetup.identityManualName?.trim() ||
          "TikTok";
        setIdentityName(name);
        const derived = assetId
          ? draft.creatives.items.find((item) => item.derivedFrom === `registry:${assetId}`)
          : null;
        if (derived?.adText.trim()) setAdText(derived.adText);
        const advertiserId = draft.accountSetup.advertiserId;
        const identityId = draft.accountSetup.identityId;
        if (advertiserId && identityId) {
          const res = await fetch(
            `/api/tiktok/identities?advertiser_id=${encodeURIComponent(advertiserId)}`,
          );
          const json = (await res.json().catch(() => null)) as { identities?: IdentityOption[] } | null;
          const match = json?.identities?.find((row) => row.identity_id === identityId);
          if (!cancelled && match) {
            setAvatarUrl(match.avatar_url);
            if (match.display_name.trim()) setIdentityName(match.display_name.trim());
          }
        }
      }
      if (assetId) {
        const res = await fetch(`/api/plan/${planId}/asset-routes`);
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          rows?: { asset: { id: string }; tiktok: RouteCell }[];
        } | null;
        const cell = json?.ok ? json.rows?.find((row) => row.asset.id === assetId)?.tiktok : null;
        if (!cancelled && cell) {
          setEnabled(cell.enabled);
          setUploadError(cell.uploadError);
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, planId, show, tiktokDraftId]);

  if (!show) return null;

  const cta = tikTokCtaForPlanIntent(objectiveIntent);
  const face = tikTokIdentityFace(avatarUrl, identityName);
  const result = !loaded
    ? null
    : localError
      ? localError
      : enabled && uploadError
        ? uploadError
        : enabled
          ? `✓ On TikTok · ${identityName}`
          : null;

  async function persistCopy(text: string) {
    if (!tiktokDraftId || !assetId) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const current = await getTikTokDraft(supabase, tiktokDraftId);
    if (!current) return;
    const key = `registry:${assetId}`;
    let found = false;
    const items = current.creatives.items.map((item) => {
      if (item.derivedFrom !== key) return item;
      found = true;
      return { ...item, adText: text, caption: text, cta };
    });
    if (!found) return;
    const next: TikTokCampaignDraft = {
      ...current,
      creatives: { ...current.creatives, items },
    };
    await upsertTikTokDraft(supabase, tiktokDraftId, { ...next, userId: user.id });
  }

  async function toggle(nextEnabled: boolean) {
    setLocalError(null);
    if (!assetId) {
      setLocalError("This video is not on the plan's asset registry.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/plan/${planId}/asset-routes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, enabled: nextEnabled }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        rows?: { asset: { id: string }; tiktok: RouteCell }[];
      } | null;
      if (!res.ok || !json?.ok) {
        setLocalError(json?.error ?? "Could not update the TikTok route.");
        return;
      }
      const cell = json.rows?.find((row) => row.asset.id === assetId)?.tiktok;
      setEnabled(cell?.enabled ?? nextEnabled);
      setUploadError(cell?.uploadError ?? null);
      if (nextEnabled && !cell?.uploadError) await persistCopy(adText);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="rounded-md border border-border bg-card"
      data-mml-tiktok-reel=""
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
        <PlatformGlyph platform="tiktok" size="sm" />
        Also run on TikTok
      </summary>
      <div className="space-y-3 px-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {face.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={face.src} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {face.initial}
                </span>
              )}
              <span className="text-sm">{identityName}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Also run on TikTok"
              disabled={busy}
              onClick={() => void toggle(!enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                enabled ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Ad text</span>
            <textarea
              value={adText}
              maxLength={100}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setAdText(event.target.value.slice(0, 100))}
              onBlur={() => {
                if (enabled) void persistCopy(adText);
              }}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Call to action: {cta ? ctaLabel(cta) : "None"}
          </p>
          {result ? (
            <p className={`text-sm ${uploadError || localError ? "text-destructive" : ""}`} role="status">
              {result}
            </p>
          ) : null}
        </div>
    </details>
  );
}

function ctaLabel(cta: "BOOK_NOW" | "SIGN_UP" | "LEARN_MORE"): string {
  if (cta === "BOOK_NOW") return "Book now";
  if (cta === "SIGN_UP") return "Sign up";
  return "Learn more";
}

function metaCaption(creative: AdCreativeDraft): string {
  return creative.captions?.find((item) => item.text?.trim())?.text?.trim() || creative.headline?.trim() || "";
}

function singleRegistryAssetId(creative: AdCreativeDraft): string | null {
  const filled = (creative.assetVariations ?? []).flatMap((variation) =>
    variation.assets.filter(
      (asset) =>
        Boolean(asset.videoId?.trim()) ||
        Boolean(asset.assetHash?.trim()) ||
        Boolean(asset.fileName?.trim()) ||
        Boolean(asset.registryAssetId?.trim()),
    ),
  );
  return filled.length === 1 ? filled[0]?.registryAssetId?.trim() || null : null;
}
