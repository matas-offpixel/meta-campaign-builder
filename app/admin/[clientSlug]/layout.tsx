import { AdminShell } from "@/components/admin/admin-shell";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { getClientBranding } from "@/lib/db/client-admin";

/**
 * app/admin/[clientSlug]/layout.tsx
 *
 * Shell layout for the client dashboard (OP909). Lives at the
 * [clientSlug] level — NOT app/admin/layout.tsx — so /admin/login,
 * /admin/auth/* and the pre-existing operator pages
 * (/admin/render-test etc, which are static segments and win routing
 * precedence) stay chrome-free.
 *
 * requireClientContext(slug) here is the defence-in-depth layer behind
 * the proxy: it re-verifies session + membership + slug match on every
 * server render, so a stale/bypassed middleware can never leak another
 * tenant's chrome.
 */
export default async function ClientAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const branding = await getClientBranding(
    membership.clientId,
    membership.clientName,
  );

  return (
    <AdminShell
      clientSlug={membership.clientSlug}
      clientName={membership.clientName}
      accent={branding.accent}
    >
      {children}
    </AdminShell>
  );
}
