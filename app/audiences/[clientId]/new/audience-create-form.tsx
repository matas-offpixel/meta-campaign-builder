"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SourcePicker, type SourceSelection } from "@/components/audiences/source-picker";
import { FUNNEL_STAGE_PRESETS } from "@/lib/audiences/funnel-presets";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import {
  AUDIENCE_SUBTYPE_LABELS,
  AUDIENCE_SUBTYPES,
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGES,
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

interface AudienceDraftRow {
  localId: string;
  enabled: boolean;
  name: string;
  funnelStage: FunnelStage;
  audienceSubtype: AudienceSubtype;
  retentionDays: number;
  source: SourceSelection;
  scope: "client" | "event";
  eventId: string;
}

export function AudienceCreateForm({
  client,
  events,
  initialEventId,
  initialPresetBundle,
  writesEnabled,
}: {
  client: ClientOption;
  events: EventOption[];
  initialEventId?: string;
  initialPresetBundle?: FunnelStage;
  writesEnabled: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "bundle">(
    initialPresetBundle ? "bundle" : "single",
  );
  const [funnelStage, setFunnelStage] = useState<FunnelStage>(
    initialPresetBundle ?? "top_of_funnel",
  );
  const [audienceSubtype, setAudienceSubtype] =
    useState<AudienceSubtype>("page_engagement_fb");
  const [singleSource, setSingleSource] = useState<SourceSelection>({});
  const [singleRetention, setSingleRetention] = useState(365);
  const [scope, setScope] = useState<"client" | "event">(
    initialEventId ? "event" : "client",
  );
  const [eventId, setEventId] = useState(initialEventId ?? "");
  const [name, setName] = useState("");
  const [bundleRows, setBundleRows] = useState<AudienceDraftRow[]>(() =>
    buildBundleRows(funnelStage, client, events, initialEventId),
  );
  const [saving, setSaving] = useState<"draft" | "write" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerRateLimits, setPickerRateLimits] = useState<Record<string, boolean>>(
    {},
  );

  const handlePickerRateLimit = useCallback(
    (instanceId: string, limited: boolean) => {
      setPickerRateLimits((prev) => {
        const next = { ...prev };
        if (limited) next[instanceId] = true;
        else delete next[instanceId];
        return next;
      });
    },
    [],
  );

  const metaSourceRateLimited = Object.values(pickerRateLimits).some(Boolean);

  useEffect(() => {
    window.localStorage.setItem("lastAudienceClientId", client.id);
  }, [client.id]);

  useEffect(() => {
    setPickerRateLimits({});
  }, [mode]);

  useEffect(() => {
    if (mode === "bundle") {
      setBundleRows(buildBundleRows(funnelStage, client, events, initialEventId));
    }
  }, [client, events, funnelStage, initialEventId, mode]);

  const selectedEvent = events.find((event) => event.id === eventId) ?? null;
  const suggestedName = useMemo(
    () =>
      buildName({
        client,
        event: scope === "event" ? selectedEvent : null,
        subtype: audienceSubtype,
        retentionDays: singleRetention,
      }),
    [audienceSubtype, client, scope, selectedEvent, singleRetention],
  );

  const metaBlocked = !client.metaAdAccountId;

  async function submit(kind: "draft" | "write") {
    setSaving(kind);
    setError(null);
    try {
      const createOnMeta = kind === "write";
      const payload =
        mode === "single"
          ? {
              clientId: client.id,
              eventId: scope === "event" ? eventId || null : null,
              funnelStage,
              audienceSubtype,
              retentionDays: clampRetention(singleRetention),
              name: name || suggestedName,
              ...sourcePayload(audienceSubtype, singleSource),
              createOnMeta,
            }
          : {
              clientId: client.id,
              audiences: bundleRows
                .filter((row) => row.enabled)
                .map((row) => ({
                  clientId: client.id,
                  eventId: row.scope === "event" ? row.eventId || null : null,
                  funnelStage: row.funnelStage,
                  audienceSubtype: row.audienceSubtype,
                  retentionDays: clampRetention(row.retentionDays),
                  name: row.name,
                  ...sourcePayload(row.audienceSubtype, row.source),
                })),
              createOnMeta,
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
        throw new Error(json && !json.ok ? json.error : "Failed to save audiences");
      }
      router.push(`/audiences/${client.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save audiences");
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bound Meta destination
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-3 py-1 text-sm">
            Will be created in: {client.name} ·{" "}
            {client.metaAdAccountId
              ? withActPrefix(client.metaAdAccountId)
              : "No ad account linked"}
          </span>
        </div>
        {metaBlocked && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            This client has no Meta ad account linked. Connect Meta in client
            settings first.
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="space-y-4 rounded-md border border-border bg-card p-4">
          <div>
            <h2 className="font-heading text-lg tracking-wide">Audience shape</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a single custom audience or a signed-off funnel stack.
            </p>
          </div>

          <div className="grid gap-2">
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

          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "single" ? "primary" : "outline"}
              onClick={() => setMode("single")}
            >
              Single
            </Button>
            <Button
              type="button"
              variant={mode === "bundle" ? "primary" : "outline"}
              onClick={() => setMode("bundle")}
            >
              Preset bundle
            </Button>
          </div>

          {mode === "single" && (
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
          )}
        </aside>

        <section className="rounded-md border border-border bg-card p-4">
          {mode === "single" ? (
            <SingleAudienceEditor
              clientId={client.id}
              events={events}
              audienceSubtype={audienceSubtype}
              retentionDays={singleRetention}
              setRetentionDays={setSingleRetention}
              source={singleSource}
              setSource={setSingleSource}
              scope={scope}
              setScope={setScope}
              eventId={eventId}
              setEventId={setEventId}
              name={name}
              setName={setName}
              suggestedName={suggestedName}
              onPickerRateLimit={handlePickerRateLimit}
            />
          ) : (
            <BundleAudienceEditor
              clientId={client.id}
              events={events}
              rows={bundleRows}
              setRows={setBundleRows}
              onPickerRateLimit={handlePickerRateLimit}
            />
          )}
        </section>
      </div>

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
          variant="outline"
          onClick={() => void submit("draft")}
          disabled={saving !== null || metaBlocked}
        >
          {saving === "draft" ? "Saving..." : "Save as draft"}
        </Button>
        {writesEnabled && (
          <Button
            type="button"
            onClick={() => void submit("write")}
            disabled={
              saving !== null || metaBlocked || metaSourceRateLimited
            }
          >
            {saving === "write" ? "Creating..." : "Save + create on Meta"}
          </Button>
        )}
      </div>
    </div>
  );
}

function SingleAudienceEditor({
  clientId,
  events,
  audienceSubtype,
  retentionDays,
  setRetentionDays,
  source,
  setSource,
  scope,
  setScope,
  eventId,
  setEventId,
  name,
  setName,
  suggestedName,
  onPickerRateLimit,
}: {
  clientId: string;
  events: EventOption[];
  audienceSubtype: AudienceSubtype;
  retentionDays: number;
  setRetentionDays: (value: number) => void;
  source: SourceSelection;
  setSource: (value: SourceSelection) => void;
  scope: "client" | "event";
  setScope: (value: "client" | "event") => void;
  eventId: string;
  setEventId: (value: string) => void;
  name: string;
  setName: (value: string) => void;
  suggestedName: string;
  onPickerRateLimit: (instanceId: string, rateLimited: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <SourcePicker
        clientId={clientId}
        subtype={audienceSubtype}
        value={source}
        onChange={setSource}
        sourcePickerInstanceId="single"
        onRateLimitChange={onPickerRateLimit}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <TextField
          id="audience-retention"
          label="Retention days"
          type="number"
          value={String(retentionDays)}
          onChange={(value) => setRetentionDays(clampRetention(Number(value)))}
        />
        <ScopeFields
          events={events}
          scope={scope}
          setScope={setScope}
          eventId={eventId}
          setEventId={setEventId}
        />
      </div>
      <TextField
        id="audience-name"
        label="Name"
        value={name}
        placeholder={suggestedName}
        onChange={setName}
      />
      <p className="text-xs text-muted-foreground">Suggested: {suggestedName}</p>
    </div>
  );
}

function BundleAudienceEditor({
  clientId,
  events,
  rows,
  setRows,
  onPickerRateLimit,
}: {
  clientId: string;
  events: EventOption[];
  rows: AudienceDraftRow[];
  setRows: (rows: AudienceDraftRow[]) => void;
  onPickerRateLimit: (instanceId: string, rateLimited: boolean) => void;
}) {
  function updateRow(localId: string, patch: Partial<AudienceDraftRow>) {
    setRows(rows.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg tracking-wide">Preset detail</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Toggle rows off, edit names/retention, and choose required sources
          before creating the stack.
        </p>
      </div>
      {rows.map((row) => (
        <div
          key={row.localId}
          className={`rounded-md border p-4 ${
            row.enabled ? "border-border bg-background" : "border-border bg-muted/40"
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) =>
                  updateRow(row.localId, { enabled: event.target.checked })
                }
              />
              {AUDIENCE_SUBTYPE_LABELS[row.audienceSubtype]}
            </label>
            <span className="rounded-full bg-muted px-2 py-1 text-xs">
              {row.retentionDays}d
            </span>
          </div>
          <div className="grid gap-3">
            <TextField
              id={`${row.localId}-name`}
              label="Name"
              value={row.name}
              onChange={(name) => updateRow(row.localId, { name })}
            />
            <SourcePicker
              clientId={clientId}
              subtype={row.audienceSubtype}
              value={row.source}
              onChange={(source) => updateRow(row.localId, { source })}
              sourcePickerInstanceId={row.localId}
              onRateLimitChange={onPickerRateLimit}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                id={`${row.localId}-retention`}
                label="Retention days"
                type="number"
                value={String(row.retentionDays)}
                onChange={(value) =>
                  updateRow(row.localId, {
                    retentionDays: clampRetention(Number(value)),
                  })
                }
              />
              <ScopeFields
                events={events}
                scope={row.scope}
                setScope={(scope) => updateRow(row.localId, { scope })}
                eventId={row.eventId}
                setEventId={(eventId) => updateRow(row.localId, { eventId })}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeFields({
  events,
  scope,
  setScope,
  eventId,
  setEventId,
}: {
  events: EventOption[];
  scope: "client" | "event";
  setScope: (scope: "client" | "event") => void;
  eventId: string;
  setEventId: (eventId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <Select
        id={`scope-${eventId || "client"}`}
        label="Scope"
        value={scope}
        onChange={(event) => setScope(event.target.value as "client" | "event")}
        options={[
          { value: "client", label: "Client-wide" },
          { value: "event", label: "Link to event" },
        ]}
      />
      {scope === "event" && (
        <Select
          id={`event-${eventId || "empty"}`}
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

function buildBundleRows(
  stage: FunnelStage,
  client: ClientOption,
  events: EventOption[],
  initialEventId?: string,
): AudienceDraftRow[] {
  const event = events.find((candidate) => candidate.id === initialEventId) ?? null;
  return FUNNEL_STAGE_PRESETS[stage].map((preset) => ({
    localId: preset.id,
    enabled: true,
    name: buildName({
      client,
      event,
      subtype: preset.audienceSubtype,
      retentionDays: preset.retentionDays,
    }),
    funnelStage: stage,
    audienceSubtype: preset.audienceSubtype,
    retentionDays: preset.retentionDays,
    source: sourceFromPreset(preset.defaultSourceMeta),
    scope: initialEventId ? "event" : "client",
    eventId: initialEventId ?? "",
  }));
}

function sourceFromPreset(meta: { subtype: AudienceSubtype } & Record<string, unknown>) {
  if (meta.subtype === "video_views") {
    return { threshold: meta.threshold as SourceSelection["threshold"] };
  }
  if (meta.subtype === "website_pixel") {
    return {
      pixelEvent: String(meta.pixelEvent ?? "PageView"),
      urlContains: typeof meta.urlContains === "string" ? meta.urlContains : "",
      useUrlFilter:
        meta.pixelEvent === "ViewContent" && typeof meta.urlContains === "string",
    };
  }
  return {};
}

function buildName({
  client,
  event,
  subtype,
  retentionDays,
}: {
  client: ClientOption;
  event: EventOption | null;
  subtype: AudienceSubtype;
  retentionDays: number;
}) {
  const prefix = event ? event.eventCode || event.name : client.slug || client.name;
  return `[${prefix}] ${AUDIENCE_SUBTYPE_LABELS[subtype]} ${retentionDays}d`;
}

function sourcePayload(subtype: AudienceSubtype, source: SourceSelection) {
  if (subtype === "video_views") {
    const campaignIds =
      source.campaignIds?.length
        ? source.campaignIds
        : source.campaignId
          ? [source.campaignId]
          : [];
    return {
      sourceId: source.videoIds?.join(",") ?? "",
      sourceMeta: {
        subtype,
        threshold: source.threshold ?? 50,
        campaignId: campaignIds[0],
        campaignIds: campaignIds.length ? campaignIds : undefined,
        campaignName: source.campaignName,
        campaignSummaries: source.campaignSummaries,
        videoIds: source.videoIds ?? [],
      },
    };
  }
  if (subtype === "website_pixel") {
    return {
      sourceId: source.pixelId ?? "",
      sourceMeta: {
        subtype,
        pixelEvent: source.pixelEvent || "PageView",
        urlContains: source.useUrlFilter ? source.urlContains : undefined,
        pixelName: source.pixelName,
      },
    };
  }
  const pageIds =
    source.pageIds?.length
      ? source.pageIds
      : source.sourceId
        ? [source.sourceId]
        : [];
  const primary = source.pageSummaries?.[0];
  return {
    sourceId: pageIds.join(","),
    sourceMeta: {
      subtype,
      pageSlug: primary?.slug ?? source.pageSlug,
      pageName: primary?.name ?? source.sourceName,
      pageIds: pageIds.length ? pageIds : undefined,
    },
  };
}

function clampRetention(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), 365);
}
