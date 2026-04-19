"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClientsFilters } from "@/components/dashboard/clients/clients-filters";
import { useWriteParams } from "@/components/dashboard/_shared/use-write-params";
import { type ClientRow } from "@/lib/db/clients";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";

export function ClientsList({
  clients,
  filtersActive,
}: {
  clients: ClientRow[];
  /** True when any of ?status/?q is set. */
  filtersActive: boolean;
}) {
  const router = useRouter();
  const { writeParams } = useWriteParams();

  const clearFilters = () =>
    writeParams((p) => {
      p.delete("status");
      p.delete("q");
    });

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
        <div className="mx-auto max-w-6xl space-y-4">
          <ClientsFilters />

          {clients.length === 0 ? (
            filtersActive ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium">
                  No clients match these filters.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try widening the search or clearing one of the filters.
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            ) : (
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
            )
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
                        {c.types.length > 0 &&
                          c.types.join(", ") !== c.primary_type && (
                            <span>{c.types.join(" · ")}</span>
                          )}
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
