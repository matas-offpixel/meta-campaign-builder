import { NewPageForm } from "@/components/admin/new-page-form";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { listEventsWithoutPage } from "@/lib/db/client-admin";

/** Create-page flow (OP909 Phase 3): existing event or new event + page. */
export default async function NewPagePage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const eventOptions = await listEventsWithoutPage(membership.clientId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-heading text-2xl tracking-wide">New landing page</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach a page to an existing event, or set up a new event.
      </p>
      <div className="mt-6">
        <NewPageForm eventOptions={eventOptions} />
      </div>
    </div>
  );
}
