"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ClientForm } from "@/components/dashboard/clients/client-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { getClientById, type ClientRow } from "@/lib/db/clients";

interface Props {
  params: Promise<{ id: string }>;
}

export default function EditClientPage({ params }: Props) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientRow | null>(null);

  useEffect(() => {
    async function load() {
      const row = await getClientById(id);
      setClient(row);
      setLoading(false);
    }
    load();
  }, [id]);

  return (
    <>
      <PageHeader
        title={client ? `Edit ${client.name}` : "Edit client"}
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

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !client ? (
            <p className="text-sm text-muted-foreground">Client not found.</p>
          ) : (
            <ClientForm mode="edit" initial={client} />
          )}
        </div>
      </main>
    </>
  );
}
