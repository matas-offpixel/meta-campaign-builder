"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SearchInput } from "@/components/dashboard/_shared/search-input";
import { useWriteParams } from "@/components/dashboard/_shared/use-write-params";
import { createClient as createSupabase } from "@/lib/supabase/client";
import { listClients, type ClientRow } from "@/lib/db/clients";
import { EVENT_STATUSES } from "@/lib/db/events";

/**
 * Filter strip rendered above the /events list. Client component because
 * every control mutates the URL (debounced search, dropdowns, pending-
 * action toggle) and reads ?q=/?client=/?status=/?pendingAction= via
 * useSearchParams. The list rows themselves stay server-rendered.
 *
 * The client dropdown is populated with a one-shot client-side fetch so
 * the dropdown options don't rerender on every URL change. Trade-off:
 * a brief "Loading clients…" placeholder on first paint vs. coupling
 * the entire filter strip to server data.
 */
export function EventsFilters() {
  const searchParams = useSearchParams();
  const { writeParams } = useWriteParams();

  const clientId = searchParams.get("client") ?? "";
  const status = searchParams.get("status") ?? "";
  const q = searchParams.get("q") ?? "";
  const pendingAction = searchParams.get("pendingAction") === "1";

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
    }
    load();
  }, []);

  const setClientId = (next: string) =>
    writeParams((p) => {
      if (!next) p.delete("client");
      else p.set("client", next);
    });

  const setStatus = (next: string) =>
    writeParams((p) => {
      if (!next) p.delete("status");
      else p.set("status", next);
    });

  const setQuery = (next: string) =>
    writeParams((p) => {
      const trimmed = next.trim();
      if (trimmed === "") p.delete("q");
      else p.set("q", trimmed);
    });

  const togglePending = () =>
    writeParams((p) => {
      if (pendingAction) p.delete("pendingAction");
      else p.set("pendingAction", "1");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        aria-label="Filter by client"
        className="rounded-md border border-border bg-card px-2 py-1.5 text-xs focus:border-border-strong focus:outline-none"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        aria-label="Filter by status"
        className="rounded-md border border-border bg-card px-2 py-1.5 text-xs focus:border-border-strong focus:outline-none"
      >
        <option value="">All statuses</option>
        {EVENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>

      <SearchInput
        initialQuery={q}
        writeQuery={setQuery}
        placeholder="Search name or venue…"
        ariaLabel="Search events"
      />

      <button
        type="button"
        onClick={togglePending}
        aria-pressed={pendingAction}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
          pendingAction
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
        }`}
      >
        Pending action
      </button>
    </div>
  );
}
