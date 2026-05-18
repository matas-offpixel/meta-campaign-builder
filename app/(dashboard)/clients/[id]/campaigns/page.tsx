import { redirect } from "next/navigation";

/**
 * `/clients/[id]/campaigns` — convenience deep-link.
 *
 * The campaigns surface lives inside `ClientDetail`'s tab shell so it
 * shares the same nav row as Overview / Events / Ticketing / D2C /
 * Creatives Templates / Invoicing. Rather than duplicate the loader
 * pyramid in a parallel page, we redirect into the existing tab via
 * `?tab=campaigns`.
 *
 * Internal nav between tabs (within `ClientDetail`) stays in local
 * `useState` so cross-tab state isn't lost on click.
 */
interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClientCampaignsRoutePage({ params }: Props) {
  const { id } = await params;
  redirect(`/clients/${id}?tab=campaigns`);
}
