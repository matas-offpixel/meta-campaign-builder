"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createClient as createSupabase } from "@/lib/supabase/client";
import {
  type ClientRow,
  type ClientType,
  CLIENT_TYPES,
  CLIENT_STATUSES,
  type ClientStatus,
  createClientRow,
  updateClientRow,
  slugify,
} from "@/lib/db/clients";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  initial?: ClientRow;
}

const TYPE_OPTIONS = CLIENT_TYPES.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));

const STATUS_OPTIONS = CLIENT_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));

/**
 * Trim whitespace and strip a single leading "@" from social handles. Empty
 * after normalisation → null so we don't store empty-string placeholders.
 */
function stripHandlePrefix(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@+/, "");
  return trimmed || null;
}

export function ClientForm({ mode, initial }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [primaryType, setPrimaryType] = useState<ClientType>(
    (initial?.primary_type as ClientType | undefined) ?? "promoter",
  );
  const [types, setTypes] = useState<ClientType[]>(
    (initial?.types as ClientType[] | undefined) ?? [],
  );
  const [status, setStatus] = useState<ClientStatus>(
    (initial?.status as ClientStatus | undefined) ?? "active",
  );
  const [metaBusinessId, setMetaBusinessId] = useState(
    initial?.meta_business_id ?? "",
  );
  const [metaAdAccountId, setMetaAdAccountId] = useState(
    initial?.meta_ad_account_id ?? "",
  );
  const [metaPixelId, setMetaPixelId] = useState(initial?.meta_pixel_id ?? "");
  const [tiktokAdAccountId, setTiktokAdAccountId] = useState(
    initial?.tiktok_ad_account_id ?? "",
  );
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState(
    initial?.google_ads_customer_id ?? "",
  );
  const [instagramHandle, setInstagramHandle] = useState(
    initial?.instagram_handle ?? "",
  );
  const [tiktokHandle, setTiktokHandle] = useState(initial?.tiktok_handle ?? "");
  const [facebookPageHandle, setFacebookPageHandle] = useState(
    initial?.facebook_page_handle ?? "",
  );
  const [googleDriveFolderUrl, setGoogleDriveFolderUrl] = useState(
    initial?.google_drive_folder_url ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  useEffect(() => {
    async function init() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    }
    init();
  }, []);

  // Auto-fill slug from name until user edits it explicitly
  useEffect(() => {
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(name));
    }
  }, [name, slugTouched, mode]);

  const toggleType = (t: ClientType) => {
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId && mode === "create") {
      setError("Not signed in.");
      return;
    }
    setSubmitting(true);
    setError(null);

    // Ensure primary_type is part of types[]
    const finalTypes = Array.from(new Set([primaryType, ...types]));

    // Normalise channel + social inputs at the boundary so we never persist
    // empty strings (which would later masquerade as real values) and so the
    // stored shape matches the documented convention from migration 010.
    const channelPayload = {
      meta_business_id: metaBusinessId.trim() || null,
      meta_ad_account_id: metaAdAccountId.trim() || null,
      meta_pixel_id: metaPixelId.trim() || null,
      tiktok_ad_account_id: tiktokAdAccountId.trim() || null,
      // Google Ads customer id: digits only, hyphens stripped.
      google_ads_customer_id:
        googleAdsCustomerId.replace(/\D+/g, "") || null,
      instagram_handle: stripHandlePrefix(instagramHandle),
      tiktok_handle: stripHandlePrefix(tiktokHandle),
      facebook_page_handle: stripHandlePrefix(facebookPageHandle),
      google_drive_folder_url: googleDriveFolderUrl.trim() || null,
    };

    try {
      if (mode === "create" && userId) {
        const created = await createClientRow({
          user_id: userId,
          name: name.trim(),
          slug: slug || slugify(name),
          primary_type: primaryType,
          types: finalTypes,
          status,
          ...channelPayload,
          notes: notes || null,
        });
        if (created) router.push(`/clients/${created.id}`);
      } else if (mode === "edit" && initial) {
        await updateClientRow(initial.id, {
          name: name.trim(),
          slug: slug || slugify(name),
          primary_type: primaryType,
          types: finalTypes,
          status,
          ...channelPayload,
          notes: notes || null,
        });
        router.push(`/clients/${initial.id}`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save client.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          id="client-name"
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Louder, Jackies, Junction 2"
        />
        <Input
          id="client-slug"
          label="Slug"
          required
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          placeholder="louder"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          id="client-primary-type"
          label="Primary type"
          value={primaryType}
          onChange={(e) => setPrimaryType(e.target.value as ClientType)}
          options={TYPE_OPTIONS}
        />
        <Select
          id="client-status"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ClientStatus)}
          options={STATUS_OPTIONS}
        />
      </div>

      <div>
        <p className="text-sm font-medium text-foreground mb-1.5">
          Additional types
        </p>
        <p className="text-xs text-muted-foreground mb-2">
          Select any extra roles this client spans (a venue can also promote,
          etc).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CLIENT_TYPES.map((t) => {
            const checked = types.includes(t) || primaryType === t;
            const isPrimary = primaryType === t;
            return (
              <button
                key={t}
                type="button"
                disabled={isPrimary}
                onClick={() => toggleType(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                  ${
                    checked
                      ? "bg-primary-light text-foreground border border-border-strong"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }
                  ${isPrimary ? "cursor-default opacity-60" : ""}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {isPrimary && " · primary"}
              </button>
            );
          })}
        </div>
      </div>

      <section className="rounded-md border border-border bg-muted/40 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Meta Business assets
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Default Business Portfolio, ad account and Pixel for this client.
            Used by the campaign builder and insights aggregator. Use the
            &ldquo;Verify Meta connection&rdquo; button on the client page to
            confirm the IDs and your token can read them.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-meta-business-id"
              label="Meta Business ID"
              value={metaBusinessId}
              onChange={(e) => setMetaBusinessId(e.target.value)}
              placeholder="741799859254067"
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Business Portfolio ID from Meta Business Manager. Numeric.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-meta-ad-account-id"
              label="Meta Ad Account ID"
              value={metaAdAccountId}
              onChange={(e) => setMetaAdAccountId(e.target.value)}
              placeholder="901661116878308"
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Without the &ldquo;act_&rdquo; prefix. Numeric.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-meta-pixel-id"
              label="Meta Pixel ID"
              value={metaPixelId}
              onChange={(e) => setMetaPixelId(e.target.value)}
              placeholder="488792328522690"
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Numeric Pixel ID from Events Manager.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-muted/40 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Other ad accounts
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            TikTok and Google Ads identifiers used by the multi-channel
            insights aggregator. Leave blank if the client doesn&rsquo;t run on
            that channel.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-tiktok-ad-account-id"
              label="TikTok Ad Account ID"
              value={tiktokAdAccountId}
              onChange={(e) => setTiktokAdAccountId(e.target.value)}
              placeholder="7298765432109876543"
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Numeric advertiser id from TikTok Ads Manager.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-google-ads-customer-id"
              label="Google Ads Customer ID (no hyphens)"
              value={googleAdsCustomerId}
              onChange={(e) => setGoogleAdsCustomerId(e.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Hyphens are stripped automatically — &ldquo;123-456-7890&rdquo;
              is stored as &ldquo;1234567890&rdquo;.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-muted/40 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Socials &amp; assets
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Public-facing handles used for content references and the asset
            folder where briefs / creative live.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-instagram-handle"
              label="Instagram Handle (without @)"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="junction2london"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Leading &ldquo;@&rdquo; is stripped on save.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-tiktok-handle"
              label="TikTok Handle (without @)"
              value={tiktokHandle}
              onChange={(e) => setTiktokHandle(e.target.value)}
              placeholder="junction2"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Leading &ldquo;@&rdquo; is stripped on save.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="client-facebook-page-handle"
              label="Facebook Page Handle"
              value={facebookPageHandle}
              onChange={(e) => setFacebookPageHandle(e.target.value)}
              placeholder="junction2london"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Vanity URL slug or page handle (not the numeric Page ID).
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Input
            id="client-google-drive-folder-url"
            label="Google Drive Folder URL"
            type="url"
            value={googleDriveFolderUrl}
            onChange={(e) => setGoogleDriveFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Full https:// URL to the client&rsquo;s working folder.
          </p>
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="client-notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="client-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm
            focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={submitting || !name.trim()}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "create" ? "Create client" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
