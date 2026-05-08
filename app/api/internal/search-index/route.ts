import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { CmdKSearchIndex } from "@/lib/dashboard/cmd-k-search";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [clientsResult, eventsResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, type")
      .order("name", { ascending: true }),
    supabase
      .from("events")
      .select(
        "id, name, slug, event_code, venue_name, venue_city, client_id, event_date, status, clients(name)",
      )
      .order("event_date", { ascending: false, nullsFirst: false })
      .limit(500),
  ]);

  if (clientsResult.error) {
    return NextResponse.json(
      { error: clientsResult.error.message },
      { status: 500 },
    );
  }
  if (eventsResult.error) {
    return NextResponse.json(
      { error: eventsResult.error.message },
      { status: 500 },
    );
  }

  const clients = (clientsResult.data ?? []).map((client) => ({
    kind: "client" as const,
    id: client.id,
    name: client.name ?? "Untitled client",
    slug: client.slug ?? null,
    type: client.type ?? null,
    href: `/clients/${client.id}/dashboard`,
  }));

  const events = (eventsResult.data ?? []).map((event) => {
    const clientRel = event.clients as
      | { name?: string | null }
      | { name?: string | null }[]
      | null;
    const clientName = Array.isArray(clientRel)
      ? (clientRel[0]?.name ?? null)
      : (clientRel?.name ?? null);
    return {
      kind: "event" as const,
      id: event.id,
      name: event.name ?? "Untitled event",
      slug: event.slug ?? null,
      event_code: event.event_code ?? null,
      venue_name: event.venue_name ?? null,
      venue_city: event.venue_city ?? null,
      client_id: event.client_id ?? null,
      client_name: clientName,
      event_date: event.event_date ?? null,
      status: event.status ?? null,
      href: `/events/${event.id}`,
    };
  });

  const payload: CmdKSearchIndex = { clients, events };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
