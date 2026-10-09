"use client";

import { useState } from "react";

import { Datum, StatusLine } from "@/components/steps/step-surface";
import { Button } from "@/components/ui/button";
import type { CopyAcross } from "@/lib/plan/copy-apply";
import { COPY_FIELDS, COPY_GROUPS } from "@/lib/plan/copy-labels";
import type { CopySuggestions } from "@/lib/plan/copy-suggest";
import type { CTAType } from "@/lib/types";
import { VIZ_TYPE } from "@/lib/viz/tokens";

const EMPTY: CopySuggestions = {
  metaPrimary: [],
  metaHeadlines: [],
  metaDescriptions: [],
  tiktok: [],
  googleHeadlines: [],
  googleDescriptions: [],
};

const CTAS: CTAType[] = ["book_now", "buy_tickets", "learn_more", "sign_up"];

export function MmlCopy({ planId, defaultUrl }: { planId: string; defaultUrl: string }) {
  const [url, setUrl] = useState(defaultUrl);
  const [pageText, setPageText] = useState("");
  const [suggestions, setSuggestions] = useState<CopySuggestions>(EMPTY);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [across, setAcross] = useState<CopyAcross>({
    caption: true,
    url: false,
    cta: false,
    headline: true,
    description: true,
  });
  const [cta, setCta] = useState<CTAType>("book_now");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [droppedLine, setDroppedLine] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<"suggest" | "apply" | null>(null);

  function toggle(key: string) {
    setTicked((current) => ({ ...current, [key]: !current[key] }));
  }

  async function suggest() {
    setBusy("suggest");
    setNotes([]);
    try {
      const response = await fetch(`/api/plan/${planId}/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "suggest", url }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        suggestions?: CopySuggestions;
        droppedLine?: string;
        fetchError?: string | null;
        pageText?: string;
      };
      if (!response.ok || !body.ok || !body.suggestions) {
        setFetchError(body.error ?? "Suggest failed");
        return;
      }
      setSuggestions(body.suggestions);
      setPageText(body.pageText ?? "");
      setFetchError(body.fetchError ?? null);
      setDroppedLine(body.droppedLine ?? "");
      setTicked({});
    } catch {
      setFetchError("Suggest failed");
    } finally {
      setBusy(null);
    }
  }

  function picked(lines: readonly string[], group: string): string[] {
    return lines.filter((_, index) => ticked[`${group}:${index}`]);
  }

  async function apply() {
    setBusy("apply");
    const headlines = picked(suggestions.metaHeadlines, "metaHeadlines");
    const descriptions = picked(suggestions.metaDescriptions, "metaDescriptions");
    const tiktok = picked(suggestions.tiktok, "tiktok");
    try {
      const response = await fetch(`/api/plan/${planId}/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          pageText,
          across,
          selection: {
            metaPrimary: picked(suggestions.metaPrimary, "metaPrimary"),
            metaHeadline: headlines[0] ?? "",
            metaDescription: descriptions[0] ?? "",
            tiktok: tiktok[0] ?? "",
            googleHeadlines: picked(suggestions.googleHeadlines, "googleHeadlines"),
            googleDescriptions: picked(suggestions.googleDescriptions, "googleDescriptions"),
            url,
            cta,
          },
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; notes?: string[] };
      setNotes(body.notes ?? (body.error ? [body.error] : []));
    } catch {
      setNotes(["Apply failed"]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <Datum>Event URL</Datum>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
          className={`w-full border border-border bg-transparent px-2 py-1 ${VIZ_TYPE.body}`}
        />
      </label>
      <Button type="button" size="sm" disabled={busy != null} onClick={() => void suggest()}>
        {busy === "suggest" ? "Suggesting" : "Suggest"}
      </Button>
      {fetchError ? <StatusLine tone="alert">{fetchError}</StatusLine> : null}
      {droppedLine ? <StatusLine tone="alert">{droppedLine}</StatusLine> : null}
      {COPY_GROUPS.map(([key, label]) => {
        const lines = suggestions[key];
        if (lines.length === 0) return null;
        return (
          <fieldset key={key} className="space-y-1">
            <Datum>{label}</Datum>
            {lines.map((line, index) => {
              const id = `${key}:${index}`;
              return (
                <label key={id} className={`flex items-start gap-2 ${VIZ_TYPE.body}`}>
                  <input type="checkbox" checked={Boolean(ticked[id])} onChange={() => toggle(id)} />
                  <span>{line}</span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <fieldset className="flex flex-wrap gap-3">
        {COPY_FIELDS.map(([key, label]) => (
          <label key={key} className={`flex items-center gap-1 ${VIZ_TYPE.body}`}>
            <input
              type="checkbox"
              checked={across[key]}
              onChange={() => setAcross((current) => ({ ...current, [key]: !current[key] }))}
            />
            <Datum>{label}</Datum>
          </label>
        ))}
        <label className={`flex items-center gap-1 ${VIZ_TYPE.body}`}>
          <Datum>CTA</Datum>
          <select value={cta} onChange={(event) => setCta(event.target.value as CTAType)} className="border border-border bg-transparent px-1">
            {CTAS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <Button type="button" size="sm" disabled={busy != null} onClick={() => void apply()}>
        {busy === "apply" ? "Applying" : "Apply"}
      </Button>
      {notes.map((note) => (
        <StatusLine key={note}>{note}</StatusLine>
      ))}
    </div>
  );
}
