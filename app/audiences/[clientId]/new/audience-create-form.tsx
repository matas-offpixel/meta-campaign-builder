"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FUNNEL_STAGE_PRESETS } from "@/lib/audiences/funnel-presets";
import {
  AUDIENCE_SUBTYPE_LABELS,
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGES,
  AUDIENCE_SUBTYPES,
} from "@/lib/audiences/metadata";
import type {
  AudienceSubtype,
  FunnelStage,
} from "@/lib/types/audience";

interface ClientOption {
  id: string;
  name: string;
  slug: string | null;
  metaAdAccountId: string | null;
}

interface EventOption {
  id: string;
  name: string;
  eventCode: string | null;
}

type SourceIds = Partial<Record<AudienceSubtype, string>>;

export function AudienceCreateForm({
  client,
  events,
  initialEventId,
  initialPresetBundle,
}: {
  client: ClientOption;
  events: EventOption[];
  initialEventId?: string;
  initialPresetBundle?: FunnelStage;
}) {
  const router = useRouter();
  const [funnelStage, setFunnelStage] = useState<FunnelStage>(
    initialPresetBundle ?? "top_of_funnel",
  );
  const [mode, setMode] = useState<"single" | "bundle">(
    initialPresetBundle ? "bundle" : "single",
  );
  const [audienceSubtype, setAudienceSubtype] =
    useState<AudienceSubtype>("page_engagement_fb");
  const [retentionDays, setRetentionDays] = useState(365);
  const [scope, setScope] = useState<"client" | "event">(
    initialEventId ? "event" : "client",
  );
  const [eventId, setEventId] = useState(initialEventId ?? "");
  const [sourceId, setSourceId] = useState("");
  const [sourceIds, setSourceIds] = useState<SourceIds>({});
  const [videoThreshold, setVideoThreshold] = useState("50");
  const [pixelEvent, setPixelEvent] = useState("PageView");
  const [urlContains, setUrlContains] = useState("");
  const [pageSlug, setPageSlug] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEvent = events.find((event) => event.id === eventId) ?? null;
  const suggestedName = useMemo(() => {
    const prefix =
      scope === "event" && selectedEvent
        ? selectedEvent.eventCode || selectedEvent.name
        : client.slug || client.name;
    return `[${prefix}] ${AUDIENCE_SUBTYPE_LABELS[audienceSubtype]} ${retentionDays}d`;
  }, [audienceSubtype, client.name, client.slug, retentionDays, scope, selectedEvent]);

  const activePresets = FUNNEL_STAGE_PRESETS[funnelStage];

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload =
        mode === "bundle"
          ? {
              clientId: client.id,
              eventId: scope === "event" ? eventId || null : null,
              presetBundle: funnelStage,
              sourceIds,
              sourceMeta: { urlContains: urlContains || undefined },
            }
          : {
              clientId: client.id,
              eventId: scope === "event" ? eventId || null : null,
              funnelStage,
              audienceSubtype,
              retentionDays,
              sourceId,
              sourceMeta: buildSourceMeta(),
              name: name || suggestedName,
            };

      const res = await fetch("/api/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json && !json.ok ? json.error : "Failed to create audience");
      }
      router.push(`/audiences/${client.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create audience");
      setSaving(false);
    }
  }

  function buildSourceMeta() {
    if (audienceSubtype === "video_views") {
      return {
        subtype: audienceSubtype,
        threshold: Number(videoThreshold),
        videoIds: sourceId.split(",").map((id) => id.trim()).filter(Boolean),
      };
    }
    if (audienceSubtype === "website_pixel") {
      return {
        subtype: audienceSubtype,
        pixelEvent,
        urlContains: urlContains || undefined,
      };
    }
    return { subtype: audienceSubtype, pageSlug: pageSlug || undefined };
  }

  function setSourceFor(key: AudienceSubtype, value: string) {
    setSourceIds((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6 rounded-md border border-border bg-card p-5">
      {!client.metaAdAccountId && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This client needs a Meta ad account ID before audience drafts can be created.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <StepLabel step="1" label="Choose funnel stage" />
        <div className="grid gap-2 md:grid-cols-4">
          {FUNNEL_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => setFunnelStage(stage)}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                funnelStage === stage
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background"
              }`}
            >
              {FUNNEL_STAGE_LABELS[stage]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <StepLabel step="2" label="Choose subtype or preset bundle" />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === "single" ? "primary" : "outline"}
            onClick={() => setMode("single")}
          >
            Single audience
          </Button>
          <Button
            type="button"
            variant={mode === "bundle" ? "primary" : "outline"}
            onClick={() => setMode("bundle")}
          >
            Preset bundle ({activePresets.length})
          </Button>
        </div>
        {mode === "single" ? (
          <Select
            id="audience-subtype"
            label="Subtype"
            value={audienceSubtype}
            onChange={(event) =>
              setAudienceSubtype(event.target.value as AudienceSubtype)
            }
            options={AUDIENCE_SUBTYPES.map((subtype) => ({
              value: subtype,
              label: AUDIENCE_SUBTYPE_LABELS[subtype],
            }))}
          />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activePresets.map((preset) => (
              <div
                key={preset.id}
                className="rounded-md border border-border bg-background p-3 text-sm"
              >
                <p className="font-medium">{preset.label}</p>
                <p className="text-xs text-muted-foreground">
                  {AUDIENCE_SUBTYPE_LABELS[preset.audienceSubtype]}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <StepLabel step="3" label="Configure retention and source fields" />
        {mode === "single" ? (
          <SingleSourceFields
            audienceSubtype={audienceSubtype}
            retentionDays={retentionDays}
            setRetentionDays={setRetentionDays}
            sourceId={sourceId}
            setSourceId={setSourceId}
            videoThreshold={videoThreshold}
            setVideoThreshold={setVideoThreshold}
            pixelEvent={pixelEvent}
            setPixelEvent={setPixelEvent}
            urlContains={urlContains}
            setUrlContains={setUrlContains}
            pageSlug={pageSlug}
            setPageSlug={setPageSlug}
          />
        ) : (
          <BundleSourceFields
            sourceIds={sourceIds}
            setSourceFor={setSourceFor}
            urlContains={urlContains}
            setUrlContains={setUrlContains}
          />
        )}
      </section>

      <section className="space-y-3">
        <StepLabel step="4" label="Scope" />
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            id="audience-scope"
            label="Audience scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as "client" | "event")}
            options={[
              { value: "client", label: "Client-wide" },
              { value: "event", label: "Link to event" },
            ]}
          />
          {scope === "event" && (
            <Select
              id="audience-event"
              label="Event"
              value={eventId}
              onChange={(event) => setEventId(event.target.value)}
              placeholder="Choose event"
              options={events.map((event) => ({
                value: event.id,
                label: event.eventCode
                  ? `${event.eventCode} · ${event.name}`
                  : event.name,
              }))}
            />
          )}
        </div>
      </section>

      {mode === "single" && (
        <section className="space-y-3">
          <StepLabel step="5" label="Naming" />
          <TextField
            id="audience-name"
            label="Audience name"
            value={name}
            placeholder={suggestedName}
            onChange={setName}
          />
          <p className="text-xs text-muted-foreground">
            Suggested: {suggestedName}
          </p>
        </section>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/audiences/${client.id}`)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !client.metaAdAccountId}
        >
          {saving ? "Creating..." : "Create draft audience"}
        </Button>
      </div>
    </div>
  );
}

function SingleSourceFields({
  audienceSubtype,
  retentionDays,
  setRetentionDays,
  sourceId,
  setSourceId,
  videoThreshold,
  setVideoThreshold,
  pixelEvent,
  setPixelEvent,
  urlContains,
  setUrlContains,
  pageSlug,
  setPageSlug,
}: {
  audienceSubtype: AudienceSubtype;
  retentionDays: number;
  setRetentionDays: (value: number) => void;
  sourceId: string;
  setSourceId: (value: string) => void;
  videoThreshold: string;
  setVideoThreshold: (value: string) => void;
  pixelEvent: string;
  setPixelEvent: (value: string) => void;
  urlContains: string;
  setUrlContains: (value: string) => void;
  pageSlug: string;
  setPageSlug: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField
        id="audience-retention"
        label="Retention days"
        type="number"
        value={String(retentionDays)}
        onChange={(value) => setRetentionDays(Number(value))}
      />
      <TextField
        id="audience-source"
        label={audienceSubtype === "video_views" ? "Video IDs" : "Source ID"}
        value={sourceId}
        placeholder={
          audienceSubtype === "website_pixel"
            ? "Pixel ID"
            : audienceSubtype === "video_views"
              ? "Comma-separated video IDs"
              : "Page or IG account ID"
        }
        onChange={setSourceId}
      />
      {audienceSubtype === "video_views" && (
        <Select
          id="audience-video-threshold"
          label="Video threshold"
          value={videoThreshold}
          onChange={(event) => setVideoThreshold(event.target.value)}
          options={[25, 50, 75, 95, 100].map((value) => ({
            value: String(value),
            label: `${value}%`,
          }))}
        />
      )}
      {audienceSubtype === "website_pixel" && (
        <>
          <Select
            id="audience-pixel-event"
            label="Pixel event"
            value={pixelEvent}
            onChange={(event) => setPixelEvent(event.target.value)}
            options={["PageView", "ViewContent", "InitiateCheckout", "Purchase"].map(
              (value) => ({ value, label: value }),
            )}
          />
          <TextField
            id="audience-url-contains"
            label="URL contains"
            value={urlContains}
            placeholder="Optional site-specific URL filter"
            onChange={setUrlContains}
          />
        </>
      )}
      {audienceSubtype.startsWith("page_") && (
        <TextField
          id="audience-page-slug"
          label="Page slug"
          value={pageSlug}
          placeholder="Optional"
          onChange={setPageSlug}
        />
      )}
    </div>
  );
}

function BundleSourceFields({
  sourceIds,
  setSourceFor,
  urlContains,
  setUrlContains,
}: {
  sourceIds: SourceIds;
  setSourceFor: (key: AudienceSubtype, value: string) => void;
  urlContains: string;
  setUrlContains: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField
        id="bundle-fb-source"
        label="FB page ID"
        value={sourceIds.page_engagement_fb ?? ""}
        onChange={(value) => {
          setSourceFor("page_engagement_fb", value);
          setSourceFor("page_followers_fb", value);
        }}
      />
      <TextField
        id="bundle-ig-source"
        label="IG account ID"
        value={sourceIds.page_engagement_ig ?? ""}
        onChange={(value) => {
          setSourceFor("page_engagement_ig", value);
          setSourceFor("page_followers_ig", value);
        }}
      />
      <TextField
        id="bundle-video-source"
        label="Video IDs"
        value={sourceIds.video_views ?? ""}
        placeholder="Comma-separated video IDs"
        onChange={(value) => setSourceFor("video_views", value)}
      />
      <TextField
        id="bundle-pixel-source"
        label="Pixel ID"
        value={sourceIds.website_pixel ?? ""}
        onChange={(value) => setSourceFor("website_pixel", value)}
      />
      <TextField
        id="bundle-url-contains"
        label="URL contains"
        value={urlContains}
        placeholder="Optional for mid-funnel ViewContent"
        onChange={setUrlContains}
      />
    </div>
  );
}

function StepLabel({ step, label }: { step: string; label: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      Step {step}: {label}
    </h2>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border-strong bg-background px-3 text-sm font-normal text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}
