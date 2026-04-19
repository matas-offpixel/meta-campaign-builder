import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ClientForm } from "@/components/dashboard/clients/client-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { getClientByIdServer } from "@/lib/db/clients-server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: Props) {
  const { id } = await params;
  const client = await getClientByIdServer(id);
  if (!client) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${client.name}`}
        description="Update client details."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <Link
            href={`/clients/${id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <ClientForm mode="edit" initial={client} />
        </div>
      </main>
    </>
  );
}
