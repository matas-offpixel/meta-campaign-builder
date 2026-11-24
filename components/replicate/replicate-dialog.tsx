"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog } from "@/components/ui/dialog";
import {
  ReplicatePickPanel,
  ReplicateShell,
  ReplicateSummaryPanel,
  type ReplicatePickEvent,
  type ReplicateSummary,
} from "@/components/replicate/replicate-panels";
import { listReplicateTargets, previewReplicateToEvent, replicateToEvent } from "@/lib/actions/replicate-to-event";
import { REPLICATE_WORDS } from "@/lib/replicate/words";

/**
 * "Replicate to event…" (RC1 · RC2). Step 1 picks the event; step 2 shows
 * what changes and what's kept, from previewReplicateToEvent (nothing saved);
 * "Create draft" saves through replicateToEvent and opens the new draft.
 * Nothing launches: the draft's launch runs the checks (R4).
 *
 * Picking the campaign's own event makes a plain duplicate, through the
 * caller's `onDuplicate`.
 */

type ErrorCode = "not_signed_in" | "not_operator" | "draft_not_found" | "event_not_found" | "save_failed";

function errorText(code: ErrorCode, message?: string): string {
  // Plain errors, not ruled words: the record has none for these.
  switch (code) {
    case "not_signed_in":
      return "Sign in again.";
    case "not_operator":
      return "Operators only.";
    case "draft_not_found":
      return "Campaign not found.";
    case "event_not_found":
      return "Event not found.";
    default:
      return message ?? "Could not save the draft.";
  }
}

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export function ReplicateDialog({
  draftId,
  open,
  onClose,
  onDuplicate,
}: {
  draftId: string;
  open: boolean;
  onClose: () => void;
  /** The source's own event picked: a plain duplicate. */
  onDuplicate: () => void;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<ReplicatePickEvent[] | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReplicateSummary | null>(null);
  const [answers, setAnswers] = useState<Record<string, "keep" | "change">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEvents(null);
    setSummary(null);
    setPicked(null);
    setAnswers({});
    setError(null);
    listReplicateTargets(draftId, londonToday()).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(errorText(res.error));
        setEvents([]);
        return;
      }
      setClientName(res.clientName);
      setEvents(res.events);
    });
    return () => {
      cancelled = true;
    };
  }, [open, draftId]);

  const pickedEvent = events?.find((e) => e.id === picked) ?? null;

  async function next() {
    if (!pickedEvent) return;
    if (pickedEvent.isSource) {
      onClose();
      onDuplicate();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await previewReplicateToEvent(draftId, pickedEvent.id);
      if (!res.ok) {
        setError(errorText(res.error, res.message));
        return;
      }
      setSummary(res);
      setAnswers({});
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!pickedEvent) return;
    setBusy(true);
    setError(null);
    try {
      const res = await replicateToEvent(draftId, pickedEvent.id);
      if (!res.ok) {
        setError(errorText(res.error, res.message));
        return;
      }
      onClose();
      router.push(`/campaign/${res.draftId}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} panelClassName="max-w-2xl">
      <div className="max-h-[88vh] overflow-y-auto">
        <ReplicateShell title={summary ? summary.title : REPLICATE_WORDS["replicate.title"]} onClose={onClose}>
          {summary ? (
            <ReplicateSummaryPanel
              summary={summary}
              answers={answers}
              onAnswer={(pageId, answer) => setAnswers((a) => ({ ...a, [pageId]: answer }))}
              onBack={() => setSummary(null)}
              onCreate={() => void create()}
              busy={busy}
              error={error}
            />
          ) : (
            <ReplicatePickPanel
              clientName={clientName}
              events={events ?? []}
              query={query}
              onQuery={setQuery}
              picked={picked}
              onPick={setPicked}
              onCancel={onClose}
              onNext={() => void next()}
              busy={busy || events === null}
              error={error}
            />
          )}
        </ReplicateShell>
      </div>
    </Dialog>
  );
}

