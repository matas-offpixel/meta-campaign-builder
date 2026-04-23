"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  extractTemplateVariableKeys,
  KNOWN_EVENT_VARIABLE_KEYS,
  markdownToBasicHtml,
  substituteTemplateVariables,
} from "@/lib/d2c/event-variables";
import type { D2CTemplate } from "@/lib/d2c/types";

interface EventOption {
  id: string;
  name: string;
}

interface Props {
  clientId: string;
  initialTemplates: D2CTemplate[];
  events: EventOption[];
}

export function D2CTemplateEditor({
  clientId,
  initialTemplates,
  events,
}: Props) {
  const [templates, setTemplates] = useState<D2CTemplate[]>(initialTemplates);
  const [editingId, setEditingId] = useState<string | null>(
    initialTemplates[0]?.id ?? null,
  );
  const [name, setName] = useState(initialTemplates[0]?.name ?? "");
  const [subject, setSubject] = useState(initialTemplates[0]?.subject ?? "");
  const [body, setBody] = useState(initialTemplates[0]?.body_markdown ?? "");
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [previewEventId, setPreviewEventId] = useState<string>(
    events[0]?.id ?? "",
  );
  const [resolvedEventVars, setResolvedEventVars] = useState<Record<
    string,
    string
  > | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const varKeys = useMemo(() => extractTemplateVariableKeys(body), [body]);

  const unknownKeys = useMemo(
    () =>
      varKeys.filter(
        (k) =>
          !KNOWN_EVENT_VARIABLE_KEYS.includes(
            k as (typeof KNOWN_EVENT_VARIABLE_KEYS)[number],
          ),
      ),
    [varKeys],
  );

  const previewHtml = useMemo(() => {
    const merged: Record<string, string> = { ...sampleValues };
    if (resolvedEventVars) {
      for (const k of KNOWN_EVENT_VARIABLE_KEYS) {
        const v = resolvedEventVars[k];
        if (v !== undefined) merged[k] = v;
      }
    }
    const md = substituteTemplateVariables(body, merged);
    return markdownToBasicHtml(md);
  }, [body, sampleValues, resolvedEventVars]);

  function loadTemplate(t: D2CTemplate) {
    setEditingId(t.id);
    setName(t.name);
    setSubject(t.subject ?? "");
    setBody(t.body_markdown);
    setResolvedEventVars(null);
    setError(null);
    setOkMessage(null);
  }

  async function handlePreviewWithEvent() {
    if (!previewEventId) {
      setError("Pick an event for preview.");
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/d2c/preview-vars?eventId=${encodeURIComponent(previewEventId)}`,
      );
      const json = (await res.json()) as {
        ok: boolean;
        variables?: Record<string, string>;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.variables) {
        setError(json.error ?? "Could not load event variables.");
        return;
      }
      setResolvedEventVars(json.variables);
      setOkMessage("Loaded real event variables for preview.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMessage(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/d2c/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId ?? undefined,
          clientId,
          name: name.trim(),
          channel: "email",
          subject: subject.trim() || null,
          bodyMarkdown: body,
          variablesJsonb: varKeys,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        template?: D2CTemplate;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.template) {
        setError(json.error ?? "Save failed.");
        return;
      }
      setTemplates((prev) => {
        const t = json.template!;
        const rest = prev.filter((x) => x.id !== t.id);
        return [t, ...rest];
      });
      loadTemplate(json.template);
      setOkMessage("Template saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email templates</CardTitle>
        <CardDescription>
          Markdown body with{" "}
          <code className="rounded bg-muted px-1">{"{{variable}}"}</code>{" "}
          tokens. Known event fields:{" "}
          {KNOWN_EVENT_VARIABLE_KEYS.join(", ")}.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 px-6 pb-6">
        {templates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={editingId === t.id ? "primary" : "outline"}
                onClick={() => loadTemplate(t)}
              >
                {t.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No templates yet — fill the form below to create one.
          </p>
        )}

        <form className="grid gap-4 lg:grid-cols-2" onSubmit={handleSave}>
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Presale reminder"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">
                Subject (email)
              </span>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Presale opens soon"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">
                Body (markdown)
              </span>
              <textarea
                className="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
              />
            </label>

            {unknownKeys.length > 0 ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Sample values for custom variables
                </p>
                {unknownKeys.map((key) => (
                  <label key={key} className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {`{{${key}}}`}
                    </span>
                    <Input
                      value={sampleValues[key] ?? ""}
                      onChange={(e) =>
                        setSampleValues((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save template"
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Live HTML preview
              </p>
              <div
                className="max-w-none space-y-2 rounded-md bg-card p-3 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>

            {events.length > 0 ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Preview with real event
                </p>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={previewEventId}
                  onChange={(e) => setPreviewEventId(e.target.value)}
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handlePreviewWithEvent()}
                  disabled={loadingPreview}
                >
                  {loadingPreview ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Load event variables"
                  )}
                </Button>
              </div>
            ) : null}

            {error ? (
              <p className="inline-flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            ) : null}
            {okMessage ? (
              <p className="inline-flex items-center gap-1 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                {okMessage}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </Card>
  );
}
