import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteDetail } from "@/components/invoicing/quote-detail";
import { getClientByIdServer } from "@/lib/db/clients-server";
import {
  getQuoteByIdServer,
  listInvoicesForQuoteServer,
} from "@/lib/db/invoicing-server";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const quote = await getQuoteByIdServer(id);
  if (!quote || quote.user_id !== user.id) notFound();

  const [invoices, client] = await Promise.all([
    listInvoicesForQuoteServer(id),
    getClientByIdServer(quote.client_id),
  ]);

  const autoConvert = sp.convert === "1";

  return (
    <>
      <PageHeader
        title={`Quote ${quote.quote_number}`}
        description={`${client?.name ?? "—"} · ${quote.event_name}`}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <QuoteDetail
          quote={quote}
          invoices={invoices}
          clientName={client?.name ?? "Unknown client"}
          autoConvert={autoConvert}
        />
      </main>
    </>
  );
}
