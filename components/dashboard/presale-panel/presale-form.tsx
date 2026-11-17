"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { addPresaleRelaunch, saveCommunityMemberCount, savePresaleLogFigure } from "@/lib/actions/presale-log";
import type { PresaleLogField } from "@/lib/dashboard/presale/form";

/**
 * The internal entry form (E3). The share link never mounts it.
 * Writes go through lib/actions/presale-log.ts.
 */

export function PresaleForm({ eventId }: { eventId: string }) {
  return (
    <div className="mt-4 space-y-4" data-presale-form>
      <Field eventId={eventId} field="windowStart" label="Window start" type="datetime-local" />
      <Field eventId={eventId} field="soldInWindow" label="Sold in community window" type="number" />
      <Field eventId={eventId} field="avgTicketPrice" label="Average ticket price" type="number" />
      <Field eventId={eventId} field="presaleDayTickets" label="Presale-day tickets" type="number" />
      <Relaunch eventId={eventId} />
      <Members eventId={eventId} />
    </div>
  );
}

function Field({ eventId, field, label, type }: { eventId: string; field: PresaleLogField; label: string; type: string }) {
  const refresh = useRefresh();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const result = await savePresaleLogFigure({ eventId, field, value });
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setValue("");
        refresh();
      }}
    >
      <label className="min-w-0 flex-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <input
          className="mt-1 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm"
          type={type}
          value={value}
          step={type === "number" ? "any" : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" disabled={pending} className="h-8 shrink-0 rounded-md border border-border px-3 text-xs">
        Save
      </button>
      {error ? <p className="text-xs text-destructive sm:basis-full">{error}</p> : null}
    </form>
  );
}

function Relaunch({ eventId }: { eventId: string }) {
  const refresh = useRefresh();
  const [day, setDay] = useState("");
  const [what, setWhat] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await addPresaleRelaunch({ eventId, relaunchedOn: day, whatWeDid: what });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setDay("");
        setWhat("");
        refresh();
      }}
    >
      <p className="text-xs text-muted-foreground">Relaunch</p>
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end">
        <input className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm sm:w-36" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Relaunch date" />
        <input className="w-full min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm" value={what} onChange={(e) => setWhat(e.target.value)} aria-label="What we did" placeholder="What we did" />
        <button type="submit" className="h-8 shrink-0 rounded-md border border-border px-3 text-xs">
          Add
        </button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

function Members({ eventId }: { eventId: string }) {
  const refresh = useRefresh();
  const [day, setDay] = useState("");
  const [members, setMembers] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await saveCommunityMemberCount({ eventId, countedOn: day, members });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setDay("");
        setMembers("");
        refresh();
      }}
    >
      <p className="text-xs text-muted-foreground">Community members</p>
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end">
        <input className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm sm:w-36" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Count date" />
        <input className="w-full min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm" type="number" value={members} onChange={(e) => setMembers(e.target.value)} aria-label="Members" placeholder="Members" />
        <button type="submit" className="h-8 shrink-0 rounded-md border border-border px-3 text-xs">
          Save
        </button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

function useRefresh(): () => void {
  const router = useRouter();
  return () => router.refresh();
}
