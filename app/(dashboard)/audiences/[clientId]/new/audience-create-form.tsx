"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SourcePicker, type SourceSelection } from "@/components/audiences/source-picker";
import { FUNNEL_STAGE_PRESETS } from "@/lib/audiences/funnel-presets";
import { buildAudienceName } from "@/lib/audiences/naming";
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
  /** True only when the user has explicitly typed in the name field. */
  const [userEditedName, setUserEditedName] = useState(false);
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

  const campaignNamesForVideoNaming = useMemo(() => {
    if (audienceSubtype !== "video_views") return [];
    const summaries = singleSource.campaignSummaries;
    if (summaries?.length) return summaries.map((c) => c.name);
    if (singleSource.campaignName) return [singleSource.campaignName];
    return [];
  }, [
    audienceSubtype,
    singleSource.campaignName,
    singleSource.campaignSummaries,
  ]);

  const suggestedName = useMemo(
    () =>
      buildAudienceName({
        scope,
        client: { slug: client.slug, name: client.name },
        event:
          scope === "event" && selectedEvent
            ? {
                eventCode: selectedEvent.eventCode,
                name: selectedEvent.name,
              }
            : null,
        subtype: audienceSubtype,
        retentionDays: singleRetention,
        threshold: singleSource.threshold ?? 50,
        campaignNames: campaignNamesForVideoNaming,
      }),
    [
      audienceSubtype,
      campaignNamesForVideoNaming,
      client,
      scope,
      selectedEvent,
      singleRetention,
      singleSource.threshold,
    ],
  );

  // When params change (subtype, retention, threshold, campaigns, scope…),
  // recompute suggestedName. If the user hasn't explicitly typed their own
  // name, keep the field value in sync with the suggestion automatically.
  useEffect(() => {
    if (!userEditedName) {
      setName(suggestedName);
    }
  }, [suggestedName, userEditedName]);

  function handleNameChange(value: string) {
    setUserEditedName(true);
    setName(value);
  }

  function handleResetName() {
    setUserEditedName(false);
    setName(suggestedName);
  }

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
              name: name.trim() || suggestedName,
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
                  name:
                    row.name.trim() ||
                    bundleRowSuggestedName(row, client, events),
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
              setName={handleNameChange}
              suggestedName={suggestedName}
              userEditedName={userEditedName}
              onResetName={handleResetName}
              onPickerRateLimit={handlePickerRateLimit}
            />
          ) : (
            <BundleAudienceEditor
              client={client}
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
  userEditedName,
  onResetName,
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
  userEditedName: boolean;
  onResetName: () => void;
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
      <div className="space-y-1">
        <TextField
          id="audience-name"
          label="Name"
          value={name}
          placeholder={suggestedName}
          onChange={setName}
        />
        {userEditedName ? (
          <p className="text-xs text-muted-foreground">
            Custom name.{" "}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={onResetName}
            >
              Reset to suggested name
            </button>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Auto-suggested — changes with subtype, threshold, and retention.
          </p>
        )}
      </div>
    </div>
  );
}

function BundleAudienceEditor({
  client,
  events,
  rows,
  setRows,
  onPickerRateLimit,
}: {
  client: ClientOption;
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
              placeholder={bundleRowSuggestedName(row, client, events)}
              onChange={(name) => updateRow(row.localId, { name })}
            />
            <SourcePicker
              clientId={client.id}
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

function bundleRowSuggestedName(
  row: AudienceDraftRow,
  client: ClientOption,
  events: EventOption[],
): string {
  const selected =
    row.scope === "event"
      ? events.find((e) => e.id === row.eventId) ?? null
      : null;
  const campaignNames =
    row.audienceSubtype === "video_views"
      ? row.source.campaignSummaries?.length
        ? row.source.campaignSummaries.map((c) => c.name)
        : row.source.campaignName
          ? [row.source.campaignName]
          : []
      : [];
  return buildAudienceName({
    scope: row.scope,
    client: { slug: client.slug, name: client.name },
    event:
      row.scope === "event" && selected
        ? { eventCode: selected.eventCode, name: selected.name }
        : null,
    subtype: row.audienceSubtype,
    retentionDays: row.retentionDays,
    threshold: row.source.threshold ?? 50,
    campaignNames,
  });
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
    name: buildAudienceName({
      scope: initialEventId ? "event" : "client",
      client: { slug: client.slug, name: client.name },
      event: event
        ? { eventCode: event.eventCode, name: event.name }
        : null,
      subtype: preset.audienceSubtype,
      retentionDays: preset.retentionDays,
      threshold:
        preset.audienceSubtype === "video_views"
          ? (preset.defaultSourceMeta as { threshold: number }).threshold
          : undefined,
      campaignNames: [],
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
    const urls = presetPixelUrlLines(meta.urlContains);
    return {
      pixelEvent: String(meta.pixelEvent ?? "PageView"),
      ...(urls.length ? { urlContains: urls } : {}),
      useUrlFilter:
        meta.pixelEvent === "ViewContent" && urls.length > 0,
    };
  }
  return {};
}

function presetPixelUrlLines(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
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
        contextId: source.contextId,
      },
    };
  }
  if (subtype === "website_pixel") {
    const urlFragments = pixelUrlFragmentsForPayload(source);
    return {
      sourceId: source.pixelId ?? "",
      sourceMeta: {
        subtype,
        pixelEvent: source.pixelEvent || "PageView",
        ...(urlFragments?.length ? { urlContains: urlFragments } : {}),
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

function pixelUrlFragmentsForPayload(
  source: SourceSelection,
): string[] | undefined {
  if (!source.useUrlFilter) return undefined;
  const raw = source.urlContains;
  if (raw === undefined || raw === null) return undefined;
  const lines = Array.isArray(raw) ? raw : String(raw).split("\n");
  const parts = lines.map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}
