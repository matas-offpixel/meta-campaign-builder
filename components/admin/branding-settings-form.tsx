"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  updateClientBranding,
  type UpdateBrandingState,
} from "@/lib/actions/update-client-branding";

/**
 * components/admin/branding-settings-form.tsx
 *
 * Org/brand settings form (OP909 Phase 2). Plain form + server action via
 * useActionState — saving/saved/error states inline. Prefilled from the
 * client_landing_pages row the server page loads via RLS.
 */

export interface BrandingFormInitial {
  clientName: string;
  clientSlug: string;
  logoStyle: "box_logo" | "wordmark";
  boxLogoText: string;
  brandColor: string;
  privacyPolicyUrl: string;
  brandInstagramUrl: string;
  brandTiktokUrl: string;
  showOffPixelAttribution: boolean;
}

const INITIAL_STATE: UpdateBrandingState = { status: "idle", errors: {} };

export function BrandingSettingsForm({
  initial,
}: {
  initial: BrandingFormInitial;
}) {
  const [state, formAction, pending] = useActionState(
    updateClientBranding,
    INITIAL_STATE,
  );
  const [logoStyle, setLogoStyle] = useState(initial.logoStyle);
  const [brandColor, setBrandColor] = useState(
    initial.brandColor || "#E5322D",
  );
  const [hasBrandColor, setHasBrandColor] = useState(
    initial.brandColor.length > 0,
  );

  const err = state.errors;

  return (
    <form action={formAction} className="space-y-8">
      {/* ── Brand identity ─────────────────────────────────────────── */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Brand identity
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Client name" value={initial.clientName} />
          <ReadOnlyField
            label="URL slug"
            value={initial.clientSlug}
            hint="Changing this would break existing page URLs — contact Off/Pixel."
          />
        </div>

        <div className="mt-5">
          <span className="block text-sm font-medium">Logo style</span>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="logo_style"
                value="box_logo"
                checked={logoStyle === "box_logo"}
                onChange={() => setLogoStyle("box_logo")}
              />
              Box logo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="logo_style"
                value="wordmark"
                checked={logoStyle === "wordmark"}
                onChange={() => setLogoStyle("wordmark")}
              />
              Wordmark
            </label>
          </div>
          {err.logo_style && <FieldError message={err.logo_style} />}
        </div>

        {logoStyle === "box_logo" && (
          <div className="mt-4 max-w-xs">
            <label className="block text-sm font-medium" htmlFor="box_logo_text">
              Box logo text
            </label>
            <input
              id="box_logo_text"
              name="box_logo_text"
              type="text"
              defaultValue={initial.boxLogoText}
              maxLength={16}
              placeholder={initial.clientName}
              className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Shown inside the colored box on your pages. Keep it short — 8
              characters or fewer fits best.
            </p>
            {err.box_logo_text && <FieldError message={err.box_logo_text} />}
          </div>
        )}

        <div className="mt-5 max-w-xs">
          <span className="block text-sm font-medium">Brand color</span>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="color"
              value={brandColor}
              onChange={(e) => {
                setBrandColor(e.target.value);
                setHasBrandColor(true);
              }}
              className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-background"
              aria-label="Brand color picker"
            />
            <input
              type="text"
              value={hasBrandColor ? brandColor : ""}
              onChange={(e) => {
                setBrandColor(e.target.value);
                setHasBrandColor(e.target.value.trim().length > 0);
              }}
              placeholder="Auto (from artwork)"
              className="h-9 flex-1 rounded-md border border-border-strong bg-background px-3 font-mono text-sm"
            />
          </div>
          {/* What actually submits: empty string = clear = auto accent. */}
          <input
            type="hidden"
            name="brand_color"
            value={hasBrandColor ? brandColor : ""}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Used when a page&apos;s artwork palette isn&apos;t available.
            Leave empty to always derive from artwork.
          </p>
          {err.brand_color && <FieldError message={err.brand_color} />}
        </div>

        <div className="mt-5 max-w-md">
          <label
            className="block text-sm font-medium"
            htmlFor="privacy_policy_url"
          >
            Privacy policy URL
          </label>
          <input
            id="privacy_policy_url"
            name="privacy_policy_url"
            type="url"
            defaultValue={initial.privacyPolicyUrl}
            placeholder="https://yourcompany.com/privacy"
            className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Linked from the signup consent line. Must be https.
          </p>
          {err.privacy_policy_url && (
            <FieldError message={err.privacy_policy_url} />
          )}
        </div>
      </section>

      {/* ── Brand socials ──────────────────────────────────────────── */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Brand socials
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Defaults for the social icons on your landing pages. Each page can
          override them individually.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor="brand_instagram_url_default"
            >
              Instagram URL
            </label>
            <input
              id="brand_instagram_url_default"
              name="brand_instagram_url_default"
              type="url"
              defaultValue={initial.brandInstagramUrl}
              placeholder="https://instagram.com/yourbrand"
              className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
            />
            {err.brand_instagram_url_default && (
              <FieldError message={err.brand_instagram_url_default} />
            )}
          </div>
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor="brand_tiktok_url_default"
            >
              TikTok URL
            </label>
            <input
              id="brand_tiktok_url_default"
              name="brand_tiktok_url_default"
              type="url"
              defaultValue={initial.brandTiktokUrl}
              placeholder="https://tiktok.com/@yourbrand"
              className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
            />
            {err.brand_tiktok_url_default && (
              <FieldError message={err.brand_tiktok_url_default} />
            )}
          </div>
        </div>
      </section>

      {/* ── Attribution ────────────────────────────────────────────── */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Attribution
        </h2>
        <label className="mt-3 flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            name="show_off_pixel_attribution"
            defaultChecked={initial.showOffPixelAttribution}
          />
          Show &ldquo;Product by Off/Pixel&rdquo; in the page footer
        </label>
      </section>

      {/* ── Submit ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save settings"
          )}
        </button>
        {state.status === "saved" && !pending && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Saved
          </span>
        )}
        {err._form && <FieldError message={err._form} />}
      </div>
    </form>
  );
}

function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <span className="block text-sm font-medium">{label}</span>
      <p className="mt-1.5 flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}
