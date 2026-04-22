import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * `/clients/[id]/settings` is the legacy entry point for the
 * ticketing + D2C connection panels. As of Item #2 those panels live
 * on the client detail page itself behind dedicated tabs, so this
 * route just permanently redirects to the consolidated view. The
 * Ticketing tab is the closest analogue to the prior page (which
 * opened with the ticketing panel above D2C).
 *
 * Direct sidebar / bookmark traffic continues to land on the new
 * tabbed UI without breaking.
 */
export default async function ClientSettingsRedirect({ params }: Props) {
  const { id } = await params;
  redirect(`/clients/${id}?tab=ticketing`);
}
