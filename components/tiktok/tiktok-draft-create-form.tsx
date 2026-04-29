"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface Option {
  id: string;
  name: string;
  clientId?: string | null;
}

export function TikTokDraftCreateForm({
  clients,
  events,
  initialClientId = "",
  initialEventId = "",
}: {
  clients: Option[];
  events: Option[];
  initialClientId?: string;
  initialEventId?: string;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initialClientId);
  const [eventId, setEventId] = useState(initialEventId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredEvents = clientId
    ? events.filter((event) => event.clientId === clientId)
    : events;

  async function createDraft() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tiktok/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || null,
          eventId: eventId || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; draft: { id: string } }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json && !json.ok ? json.error : "Failed to create draft");
      }
      router.push(`/tiktok-campaign/${json.draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create draft");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-5">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-new-client"
          label="Client"
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value);
            setEventId("");
          }}
          placeholder="Optional client"
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
        />
        <Select
          id="tiktok-new-event"
          label="Event"
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
          placeholder="Optional event"
          options={filteredEvents.map((event) => ({ value: event.id, label: event.name }))}
        />
      </div>
      <Button type="button" onClick={() => void createDraft()} disabled={saving}>
        Create TikTok draft
      </Button>
    </div>
  );
}
