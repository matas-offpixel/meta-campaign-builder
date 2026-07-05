import Link from "next/link";

import { MailchimpConnectionForm } from "@/components/admin/crm-connection-forms";
import { CrmStatusPanel } from "@/components/admin/crm-status-panel";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { getCrmConnectionSummary } from "@/lib/db/crm-connections";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/admin/[clientSlug]/integrations/mailchimp/page.tsx — self-service
 * Mailchimp credential entry (OP909 Phase 8).
 */
export default async function MailchimpIntegrationPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const summary = await getCrmConnectionSummary(
    createServiceRoleClient(),
    membership.clientId,
    "mailchimp",
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={`/admin/${membership.clientSlug}/integrations`}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        ← Integrations
      </Link>
      <h1 className="mt-2 font-heading text-2xl tracking-wide">Mailchimp</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your Mailchimp account so fan signups can be routed into
        your email audience and event campaigns.
      </p>

      <CrmStatusPanel summary={summary} />

      <div className="mt-8">
        <MailchimpConnectionForm
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
