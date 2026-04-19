import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteForm } from "@/components/invoicing/quote-form";
import { listClientsForQuoteFormServer } from "@/lib/db/invoicing-server";
import { createClient } from "@/lib/supabase/server";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Quote builder. Pre-fills the client when entered from a deep link
 * (`/invoicing/quotes/new?client_id=…`) so the "New quote" button on the
 * client invoicing tab can drop straight into the right context.
 */
export default async function NewQuotePage({ searchParams }: Props) {
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const clients = await listClientsForQuoteFormServer(user.id);

  const rawClient = sp.client_id;
  const defaultClientId = Array.isArray(rawClient) ? rawClient[0] : rawClient;

  return (
    <>
      <PageHeader
        title="New quote"
        description="Capacity × service tier produces a guaranteed fee. Sell-out bonuses are billed as a separate invoice once the show actually sells out."
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <QuoteForm clients={clients} defaultClientId={defaultClientId} />
      </main>
    </>
  );
}
