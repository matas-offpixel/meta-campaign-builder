"use client";

import { useCallback, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  CreativeFieldDescriptor,
  CreativeProviderName,
  CreativeRenderStatus,
  CreativeTemplate,
} from "@/lib/creatives/types";

/**
 * components/dashboard/clients/creative-templates-panel.tsx
 *
 * Embeddable block for the client-detail Creatives tab; mirrors the
 * standalone /creatives/templates page for quick access.
 */

export interface ProviderStatus {
  provider: CreativeProviderName;
  label: string;
  enabled: boolean;
  blurb: string;
  flag: string;
}

interface Props {
  templates: CreativeTemplate[];
  providerStatus: ProviderStatus[];
  clientId: string;
  eventOptions: { id: string; name: string }[];
  canRenderBannerbear: boolean;
}

type CreativeRenderRow = {
  id: string;
  status: CreativeRenderStatus;
  asset_url: string | null;
  error_message: string | null;
  provider_job_id: string | null;
};

const POLL_MAX_MS = 60_000;
const POLL_EVERY_MS = 2000;

function parseFieldsJsonb(raw: unknown): CreativeFieldDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw as CreativeFieldDescriptor[];
}

function BannerbearRenderPanel({
  template,
  clientId,
  eventOptions,
  enabled,
}: {
  template: CreativeTemplate;
  clientId: string;
  eventOptions: { id: string; name: string }[];
  enabled: boolean;
}) {
  const fields = parseFieldsJsonb(template.fields_jsonb);
  const [eventId, setEventId] = useState<string>("");
  const [form, setForm] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    for (const f of fields) {
      s[f.key] = f.defaultValue != null ? String(f.defaultValue) : "";
    }
    return s;
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CreativeRenderRow | null>(null);
  const [doneImageUrl, setDoneImageUrl] = useState<string | null>(null);

  const onField = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const runRender = useCallback(async () => {
    setErr(null);
    setResult(null);
    setDoneImageUrl(null);
    for (const f of fields) {
      if (f.required && !(form[f.key] ?? "").trim()) {
        setErr(`${f.label} is required.`);
        return;
      }
    }
    setBusy(true);
    try {
      const payload = {
        template_id: template.id,
        client_id: clientId,
        event_id: eventId && eventId.length > 0 ? eventId : null,
        fields: { ...form } as Record<string, unknown>,
      };
      const r = await fetch("/api/creatives/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        render_id?: string;
        status?: string;
        provider_job_id?: string;
      };
      if (!r.ok) {
        setErr(j.error ?? `Request failed (${r.status})`);
        return;
      }
      const id = j.render_id;
      if (!id) {
        setErr("No render_id in response");
        return;
      }

      const started = Date.now();
      let last: CreativeRenderRow | null = null;
      while (Date.now() - started < POLL_MAX_MS) {
        await new Promise((res) => setTimeout(res, POLL_EVERY_MS));
        const p = await fetch(`/api/creatives/render/${id}`);
        const data = (await p.json().catch(() => ({}))) as {
          error?: string;
          render?: CreativeRenderRow;
        };
        if (!p.ok) {
          setErr(data.error ?? `Poll failed (${p.status})`);
          return;
        }
        if (data.render) {
          last = data.render;
          if (data.render.status === "done" || data.render.status === "failed") {
            setResult(data.render);
            if (data.render.status === "done" && data.render.asset_url) {
              setDoneImageUrl(data.render.asset_url);
            }
            if (data.render.status === "failed" && data.render.error_message) {
              setErr(data.render.error_message);
            }
            return;
          }
        }
      }
      setResult(last);
      setErr(
        "Timed out after 60s — refresh to check render status, or try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [clientId, eventId, fields, form, template.id]);

  const eventSelectOptions = [
    { value: "", label: "— No event —" },
    ...eventOptions.map((e) => ({ value: e.id, label: e.name })),
  ];

  return (
    <div className="mt-2 border-t border-border pt-3">
      {!open ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!enabled}
          title={
            !enabled
              ? "Set FEATURE_BANNERBEAR and enable Bannerbear for this client."
              : "Fill template fields and render"
          }
          onClick={() => {
            if (enabled) setOpen(true);
          }}
        >
          Render
        </Button>
      ) : (
        <div className="space-y-3">
          {eventSelectOptions.length > 1 ? (
            <Select
              id={`ev-${template.id}`}
              label="Event (optional)"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              options={eventSelectOptions}
            />
          ) : null}
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <label
                htmlFor={`f-${template.id}-${f.key}`}
                className="text-sm font-medium text-foreground"
              >
                {f.label}
                {f.required ? " *" : ""}
              </label>
              <Input
                id={`f-${template.id}-${f.key}`}
                value={form[f.key] ?? ""}
                onChange={(e) => onField(f.key, e.target.value)}
                type={f.type === "image" ? "url" : "text"}
                placeholder={f.type === "image" ? "https://…" : ""}
                disabled={busy}
              />
            </div>
          ))}
          {err ? (
            <p className="text-sm text-destructive">{err}</p>
          ) : null}
          {doneImageUrl ? (
            <div className="mt-2">
              <img
                src={doneImageUrl}
                alt="Rendered"
                className="max-h-64 w-full max-w-md rounded-md border object-contain"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !enabled}
              onClick={() => void runRender()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Rendering…
                </>
              ) : (
                "Start render"
              )}
            </Button>
            {result && !busy ? (
              <span className="text-xs text-muted-foreground">
                Status: {result.status}
                {result.provider_job_id
                  ? ` · job ${result.provider_job_id}`
                  : ""}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!busy) {
                  setOpen(false);
                  setErr(null);
                }
              }}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CreativeTemplatesPanel({
  templates,
  providerStatus,
  clientId,
  eventOptions,
  canRenderBannerbear,
}: Props) {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {providerStatus.map((p) => (
          <Card key={p.provider}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                {p.label}
                <span
                  className={
                    p.enabled
                      ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                      : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  }
                >
                  {p.enabled ? "Enabled" : "Pending"}
                </span>
              </CardTitle>
              <CardDescription>{p.blurb}</CardDescription>
            </CardHeader>
            <div className="px-6 pb-6">
              <Button
                type="button"
                variant="outline"
                disabled={!p.enabled}
                title={
                  p.enabled
                    ? `Connect ${p.label}`
                    : `Pending — set ${p.flag}=true and complete provider onboarding to enable.`
                }
              >
                Connect {p.label}
              </Button>
            </div>
          </Card>
        ))}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Templates
        </h3>
        {templates.length === 0 ? (
          <Card>
            <div className="flex items-center gap-3 px-6 py-6">
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  No templates yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Connect a provider above to register templates, or
                  add a manual template once any provider above is
                  enabled.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <li key={t.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <CardDescription className="capitalize">
                      {t.provider} · {t.channel}
                      {t.aspect_ratios.length > 0
                        ? ` · ${t.aspect_ratios.join(", ")}`
                        : ""}
                    </CardDescription>
                  </CardHeader>
                  {t.notes ? (
                    <p className="px-6 pb-2 text-sm text-muted-foreground">
                      {t.notes}
                    </p>
                  ) : null}
                  {t.provider === "bannerbear" ? (
                    <div className="px-6 pb-4">
                      <BannerbearRenderPanel
                        template={t}
                        clientId={clientId}
                        eventOptions={eventOptions}
                        enabled={canRenderBannerbear}
                      />
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
