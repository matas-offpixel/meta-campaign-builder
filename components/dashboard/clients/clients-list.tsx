"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { createClient as createSupabase } from "@/lib/supabase/client";
import { listClients, type ClientRow } from "@/lib/db/clients";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";

export function ClientsList() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientRow[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const rows = await listClients(user.id);
      setClients(rows);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Promoters, venues, brands, artists and festivals we work with."
        actions={
          <Button onClick={() => router.push("/clients/new")}>
            <Plus className="h-4 w-4" />
            New client
          </Button>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <div className="py-16 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium">No clients yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add your first client to start tracking events and campaigns.
              </p>
              <div className="mt-4">
                <Button onClick={() => router.push("/clients/new")}>
                  <Plus className="h-4 w-4" />
                  New client
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="block rounded-md border border-border bg-card p-4 transition-colors
                    hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {c.name}
                        </p>
                        <StatusPill status={c.status} kind="client" />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">{c.primary_type}</span>
                        {c.types.length > 0 && c.types.join(", ") !== c.primary_type && (
                          <span>{c.types.join(" · ")}</span>
                        )}
                        {c.contact_name && <span>{c.contact_name}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {c.slug}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
