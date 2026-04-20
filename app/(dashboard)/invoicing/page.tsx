import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { InvoicingDashboard } from "@/components/invoicing/invoicing-dashboard";
import {
  listInvoicesWithRefsServer,
  listQuotesWithRefsServer,
} from "@/lib/db/invoicing-server";
import { createClient } from "@/lib/supabase/server";

export default async function InvoicingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [invoices, quotes] = await Promise.all([
    listInvoicesWithRefsServer(user.id),
    listQuotesWithRefsServer(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Invoicing"
        description="Quotes, invoices, payment status — your money in one place."
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <InvoicingDashboard invoices={invoices} quotes={quotes} />
      </main>
    </>
  );
}
