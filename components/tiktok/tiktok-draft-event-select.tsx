"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { TikTokImportEventSelect } from "@/components/tiktok/tiktok-import-event-select";
import { useFetchEventsForClient } from "@/lib/hooks/useEvents";
import {
  formatTikTokImportEventSuggestion,
  suggestTikTokImportEvent,
} from "@/lib/tiktok/import/event";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

/**
 * Same event select as the import picker, for a draft that was saved
 * without one. A unique `[CODE]` in the campaign name is preselected
 * as a suggestion; attaching it is still the operator's click.
 */
export function TikTokDraftEventSelect({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
}) {
  const { events, loading } = useFetchEventsForClient(draft.clientId);
  const [picked, setPicked] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campaignName =
    draft.importMeta?.sourceCampaignName ?? draft.campaignSetup.campaignName;
  const suggestion = useMemo(
    () => suggestTikTokImportEvent(campaignName, events),
    [campaignName, events],
  );
  const value = picked || suggestion?.eventId || "";
  const options = useMemo(
    () =>
      events.map((event) => ({
        id: event.id,
        name: event.name,
        event_code: event.event_code ?? null,
        event_date: event.event_date,
      })),
    [events],
  );

  async function attach() {
    if (!value) return;
    const selected = options.find((event) => event.id === value);
    setSaving(true);
    setError(null);
    try {
      await onSave({
        eventId: value,
        campaignSetup: {
          ...draft.campaignSetup,
          eventCode: selected?.event_code ?? draft.campaignSetup.eventCode,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/40 p-3">
      <p className="text-sm">
        An event is required to launch. Pick one — a match in the campaign
        name is a suggestion, not a save.
      </p>
      <TikTokImportEventSelect
        id="tiktok-draft-event"
        events={options}
        value={value}
        onChange={setPicked}
        suggestionLabel={
          suggestion
            ? formatTikTokImportEventSuggestion(suggestion.code)
            : null
        }
        disabled={loading || saving || options.length === 0}
        error={error ?? undefined}
      />
      <Button
        type="button"
        size="sm"
        disabled={saving || !value}
        onClick={() => void attach()}
      >
        {saving ? "Saving…" : "Set event"}
      </Button>
    </div>
  );
}
