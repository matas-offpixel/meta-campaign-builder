import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ClientForm } from "@/components/dashboard/clients/client-form";
import { PageHeader } from "@/components/dashboard/page-header";

export default function NewClientPage() {
  return (
    <>
      <PageHeader
        title="New client"
        description="Promoter, venue, brand, artist or festival."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            All clients
          </Link>
          <ClientForm mode="create" />
        </div>
      </main>
    </>
  );
}
