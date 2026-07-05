import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { getPixelHealth } from "@/lib/db/client-admin";
import { getCrmConnectionSummary } from "@/lib/db/crm-connections";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/admin/[clientSlug]/integrations/page.tsx — integrations hub.
 * Meta Pixel (Phase 7) + Bird & Mailchimp (Phase 8).
 */
export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const db = createServiceRoleClient();
  const [pixel, bird, mailchimp] = await Promise.all([
    getPixelHealth(membership.clientId),
    getCrmConnectionSummary(db, membership.clientId, "bird"),
    getCrmConnectionSummary(db, membership.clientId, "mailchimp"),
  ]);
  const pixelReady = Boolean(pixel?.pixelId && pixel.capiTokenConfigured);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-heading text-2xl tracking-wide">Integrations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect the services your landing pages feed into.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link
          href={`/admin/${membership.clientSlug}/integrations/meta-pixel`}
          className="group rounded-md border border-border bg-card p-5 transition-colors hover:border-foreground/30"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Meta Pixel</h2>
            {pixelReady ? (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                connected
              </span>
            ) : pixel?.pixelId ? (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                partial
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                not set up
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Send signups to your ad account as CompleteRegistration events —
            browser pixel + Conversions API.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
            Configure <ArrowRight className="h-3 w-3" />
          </span>
        </Link>

        <Link
          href={`/admin/${membership.clientSlug}/integrations/bird`}
          className="group rounded-md border border-border bg-card p-5 transition-colors hover:border-foreground/30"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-medium">WhatsApp (Bird)</h2>
            <CrmBadge
              status={bird?.status ?? null}
              configured={bird?.config.apiKeyConfigured ?? false}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Route fan signups into your WhatsApp community — announcements,
            presale reminders and the welcome autoresponder.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
            Configure <ArrowRight className="h-3 w-3" />
          </span>
        </Link>

        <Link
          href={`/admin/${membership.clientSlug}/integrations/mailchimp`}
          className="group rounded-md border border-border bg-card p-5 transition-colors hover:border-foreground/30"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Mailchimp</h2>
            <CrmBadge
              status={mailchimp?.status ?? null}
              configured={mailchimp?.config.apiKeyConfigured ?? false}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Route fan signups into your email audience and event campaigns.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
            Configure <ArrowRight className="h-3 w-3" />
          </span>
        </Link>
      </div>
    </div>
  );
}

function CrmBadge({
  status,
  configured,
}: {
  status: string | null;
  configured: boolean;
}) {
  if (status === "error") {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        error
      </span>
    );
  }
  if (configured) {
    return (
      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
        connected
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      not set up
    </span>
  );
}
