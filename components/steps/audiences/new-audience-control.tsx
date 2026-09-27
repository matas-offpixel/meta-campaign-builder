"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import type { CustomAudience, CustomAudienceGroup } from "@/lib/types";
import { useFetchPixels } from "@/lib/hooks/useMeta";
import {
  BULK_WEBSITE_EVENT_LABELS,
  BULK_WEBSITE_PIXEL_EVENTS,
  clampWebsiteRetentionDays,
  type BulkWebsitePixelEvent,
} from "@/lib/audiences/bulk-website-types";
import {
  META_AUDIENCE_WRITES_DISABLED_MESSAGE,
  attachCreatedAudienceToGroup,
  creatorAudienceWritesOpen,
  defaultPixelAudienceName,
} from "@/lib/audiences/creator-audience";
import { normalizeWebsitePixelUrlContains } from "@/lib/audiences/pixel-url-contains";
import { rowsFromCustomerPaste } from "@/lib/customer-audience/paste";
import {
  chunkData,
  hashAudienceBatch,
  type MatchSchema,
} from "@/lib/customer-audience/hash-client";
import { StatusLine } from "@/components/steps/step-surface";

type Kind = "pixel" | "customer" | null;

interface NewAudienceControlProps {
  /** When omitted, the control reads GET /api/audiences/writes-enabled. */
  writesEnabled?: boolean;
  adAccountId?: string;
  clientId?: string;
  campaignName?: string;
  groups: CustomAudienceGroup[];
  selectedGroupId: string | null;
  onAttached: (groups: CustomAudienceGroup[], groupId: string) => void;
  onCreated: (audience: CustomAudience) => void;
}

export function NewAudienceControl({
  writesEnabled: writesEnabledProp,
  adAccountId,
  clientId,
  campaignName = "",
  groups,
  selectedGroupId,
  onAttached,
  onCreated,
}: NewAudienceControlProps) {
  const [writesEnabled, setWritesEnabled] = useState<boolean | null>(
    writesEnabledProp ?? null,
  );
  const [kind, setKind] = useState<Kind>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (writesEnabledProp !== undefined) {
      setWritesEnabled(writesEnabledProp);
      return;
    }
    let cancelled = false;
    fetch("/api/audiences/writes-enabled")
      .then(async (res) => {
        const json = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setWritesEnabled(json.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setWritesEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [writesEnabledProp]);

  const open = creatorAudienceWritesOpen(writesEnabled === true);

  function land(created: { id: string; name: string }, type: CustomAudience["type"]) {
    const attached = attachCreatedAudienceToGroup(groups, selectedGroupId, created);
    onAttached(attached.groups, attached.groupId);
    onCreated({ id: created.id, name: created.name, type });
    setKind(null);
    setMenuOpen(false);
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!open}
        onClick={() => {
          if (!open) return;
          setMenuOpen((value) => !value);
          setKind(null);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        New audience
      </Button>
      {writesEnabled === false && (
        <StatusLine className="text-xs text-muted-foreground">
          {META_AUDIENCE_WRITES_DISABLED_MESSAGE}
        </StatusLine>
      )}
      {open && menuOpen && kind === null && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setKind("pixel")}>
            Website (pixel)
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setKind("customer")}>
            Customer list
          </Button>
        </div>
      )}
      {open && kind === "pixel" && (
        <PixelAudienceForm
          adAccountId={adAccountId}
          clientId={clientId}
          campaignName={campaignName}
          onCancel={() => setKind(null)}
          onCreated={(created) => land(created, "pixel")}
        />
      )}
      {open && kind === "customer" && (
        <CustomerListForm
          adAccountId={adAccountId}
          onCancel={() => setKind(null)}
          onCreated={(created) => land(created, "other")}
        />
      )}
    </div>
  );
}

function PixelAudienceForm({
  adAccountId,
  clientId,
  campaignName,
  onCancel,
  onCreated,
}: {
  adAccountId?: string;
  clientId?: string;
  campaignName: string;
  onCancel: () => void;
  onCreated: (created: { id: string; name: string }) => void;
}) {
  const pixels = useFetchPixels(adAccountId);
  const [pixelId, setPixelId] = useState("");
  const [event, setEvent] = useState<BulkWebsitePixelEvent>("PageView");
  const [retention, setRetention] = useState(180);
  const [urlText, setUrlText] = useState("");
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = useMemo(
    () => defaultPixelAudienceName({ campaignName, retentionDays: retention, pixelEvent: event }),
    [campaignName, retention, event],
  );

  useEffect(() => {
    if (!nameDirty) setName(suggested);
  }, [suggested, nameDirty]);

  useEffect(() => {
    if (!pixelId && pixels.data[0]?.id) setPixelId(pixels.data[0].id);
  }, [pixelId, pixels.data]);

  async function submit() {
    if (submitting) return;
    if (!clientId) {
      setError("Select a client in Account Setup before creating a pixel audience.");
      return;
    }
    if (!pixelId) {
      setError("Pick a pixel.");
      return;
    }
    const audienceName = name.trim();
    if (!audienceName) {
      setError("Name the audience.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/audiences/bulk-website/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          pixelId,
          pixelEvents: [event],
          urlKeywords: normalizeWebsitePixelUrlContains(urlText),
          retentions: [clampWebsiteRetentionDays(retention)],
          createOnMeta: true,
          name: audienceName,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        successes?: { metaAudienceId: string | null; name: string }[];
        failures?: { error: string }[];
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Could not create the pixel audience");
      }
      const metaId = json.successes?.[0]?.metaAudienceId;
      if (!metaId) {
        throw new Error(json.failures?.[0]?.error ?? "Meta did not return an audience id");
      }
      onCreated({ id: metaId, name: json.successes?.[0]?.name || audienceName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the pixel audience");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Website (pixel)</span>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">
          Close
        </button>
      </div>
      <label className="block text-xs font-medium">
        Pixel
        <select
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
        >
          <option value="">{pixels.loading ? "Loading pixels…" : "Select a pixel"}</option>
          {pixels.data.map((pixel) => (
            <option key={pixel.id} value={pixel.id}>
              {pixel.name} ({pixel.id})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium">
        Event
        <select
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={event}
          onChange={(e) => setEvent(e.target.value as BulkWebsitePixelEvent)}
        >
          {BULK_WEBSITE_PIXEL_EVENTS.map((value) => (
            <option key={value} value={value}>
              {BULK_WEBSITE_EVENT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <Input
        label="Retention (days, max 180)"
        type="number"
        min={1}
        max={180}
        value={retention}
        onChange={(e) => setRetention(Number(e.target.value))}
      />
      <label className="block text-xs font-medium">
        URL contains (optional)
        <textarea
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          rows={2}
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder="https://example.com/tickets"
        />
      </label>
      <Input
        label="Name"
        value={name}
        onChange={(e) => {
          setNameDirty(true);
          setName(e.target.value);
        }}
      />
      {error && <StatusLine tone="alert" className="text-xs text-destructive">{error}</StatusLine>}
      <Button type="button" size="sm" onClick={() => void submit()} disabled={submitting || !adAccountId}>
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Create pixel audience
      </Button>
    </div>
  );
}

function CustomerListForm({
  adAccountId,
  onCancel,
  onCreated,
}: {
  adAccountId?: string;
  onCancel: () => void;
  onCreated: (created: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<{ schema: MatchSchema[]; rows: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const rows = rowsFromCustomerPaste(paste);
    if (rows.length === 0) {
      setPreview(null);
      return;
    }
    const includeEmail = rows.some((row) => Boolean(row.email));
    const includePhone = rows.some((row) => Boolean(row.phone));
    void hashAudienceBatch(rows, includeEmail, includePhone).then((hashed) => {
      if (cancelled) return;
      setPreview({ schema: hashed.schema, rows: hashed.data.length });
    });
    return () => {
      cancelled = true;
    };
  }, [paste]);

  async function submit() {
    if (submitting) return;
    if (!adAccountId) {
      setError("Select an ad account first.");
      return;
    }
    const audienceName = name.trim();
    if (!audienceName) {
      setError("Name the audience.");
      return;
    }
    const rows = rowsFromCustomerPaste(paste);
    const includeEmail = rows.some((row) => Boolean(row.email));
    const includePhone = rows.some((row) => Boolean(row.phone));
    const hashed = await hashAudienceBatch(rows, includeEmail, includePhone);
    if (hashed.data.length === 0) {
      setError("No valid emails or phones after normalisation.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const chunks = chunkData(hashed.data);
      const sessionId = Math.floor(Math.random() * 2_147_483_647);
      let audienceId: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        const res = await fetch("/api/meta/customer-audience-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adAccountId,
            mode: i === 0 ? "create" : "append",
            audienceId,
            audienceName: i === 0 ? audienceName : undefined,
            schema: hashed.schema,
            data: chunks[i],
            chunkIndex: i,
            totalChunks: chunks.length,
            sessionId,
            estimatedTotal: hashed.data.length,
          }),
        });
        const json = (await res.json()) as { error?: string; audienceId?: string };
        if (!res.ok) throw new Error(json.error ?? "Upload failed");
        if (i === 0) audienceId = json.audienceId;
      }
      if (!audienceId) throw new Error("Meta did not return an audience id");
      console.info(
        `[creator-audience] customer list hashed emails=${hashed.emailCount} phones=${hashed.phoneCount} rows=${hashed.data.length}`,
      );
      onCreated({ id: audienceId, name: audienceName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Customer list</span>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">
          Close
        </button>
      </div>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="block text-xs font-medium">
        Emails and phones
        <textarea
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          rows={5}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"one email or phone per line"}
        />
      </label>
      {preview && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{preview.rows} row{preview.rows === 1 ? "" : "s"}</Badge>
          {preview.schema.map((column) => (
            <Badge key={column} variant="outline">{column}</Badge>
          ))}
        </div>
      )}
      {error && <StatusLine tone="alert" className="text-xs text-destructive">{error}</StatusLine>}
      <Button type="button" size="sm" onClick={() => void submit()} disabled={submitting || !adAccountId}>
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Upload customer list
      </Button>
    </div>
  );
}
