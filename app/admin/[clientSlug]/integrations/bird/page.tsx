import Link from "next/link";

import { BirdConnectionForm } from "@/components/admin/crm-connection-forms";
import { CrmStatusPanel } from "@/components/admin/crm-status-panel";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { getCrmConnectionSummary } from "@/lib/db/crm-connections";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/admin/[clientSlug]/integrations/bird/page.tsx — self-service Bird
 * (WhatsApp) credential entry (OP909 Phase 8). Only the non-secret
 * config slice reaches the client; the access key is a presence boolean.
 */
export default async function BirdIntegrationPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const summary = await getCrmConnectionSummary(
    createServiceRoleClient(),
    membership.clientId,
    "bird",
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={`/admin/${membership.clientSlug}/integrations`}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        ← Integrations
      </Link>
      <h1 className="mt-2 font-heading text-2xl tracking-wide">
        WhatsApp (Bird)
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your Bird workspace so fan signups can flow into your
        WhatsApp community messaging — announcements, presale reminders and
        the welcome autoresponder.
      </p>

      <CrmStatusPanel summary={summary} />

      <div className="mt-8">
        <BirdConnectionForm
          config={
            summary?.config ?? {
              apiKeyConfigured: false,
              workspaceId: null,
              channelId: null,
              templateProjectId: null,
              templateVersionId: null,
              serverPrefix: null,
              audienceId: null,
            }
          }
        />
      </div>
    </div>
  );
}
