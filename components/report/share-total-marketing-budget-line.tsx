"use client";

import { useCallback, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fmtCurrencyCompact } from "@/lib/dashboard/format";
import { paidMediaExceedsTotalMarketingUserMessage } from "@/lib/db/marketing-budget-validation";

interface Props {
  shareToken: string;
  /** Current allocated total (positive). */
  totalMarketing: number;
  /** Canonical paid cap — for client-side guard only; server is authoritative. */
  paidMediaCap: number;
  onMutated: () => void;
}

export function ShareTotalMarketingBudgetLine({
  shareToken,
  totalMarketing,
  paidMediaCap,
  onMutated,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(totalMarketing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEdit = useCallback(() => {
    setDraft(String(totalMarketing));
    setError(null);
    setEditing(true);
  }, [totalMarketing]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
    setDraft(String(totalMarketing));
  }, [totalMarketing]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError("Enter an amount or use Remove cap.");
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter a valid non-negative number.");
      return;
    }
    if (n > 0 && paidMediaCap > 0 && paidMediaCap > n) {
      setError(paidMediaExceedsTotalMarketingUserMessage(paidMediaCap));
      return;
    }
    const payload =
      n <= 0 ? { total_marketing_budget: null } : { total_marketing_budget: n };

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/by-share-token/${encodeURIComponent(shareToken)}/total-marketing-budget`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      onMutated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [draft, onMutated, paidMediaCap, shareToken]);

  const removeCap = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/by-share-token/${encodeURIComponent(shareToken)}/total-marketing-budget`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_marketing_budget: null }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      onMutated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [onMutated, shareToken]);

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">£</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            className="min-w-[6rem] rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums"
            disabled={saving}
            aria-label="Total marketing budget"
          />
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={cancel}
          >
            Cancel
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            disabled={saving}
            onClick={() => void removeCap()}
          >
            Remove cap
          </button>
        </div>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="group font-heading text-xl tracking-wide tabular-nums">
      <button
        type="button"
        onClick={openEdit}
        className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-sm text-left outline-none ring-offset-background hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{fmtCurrencyCompact(totalMarketing)}</span>
        <span className="text-sm font-normal text-muted-foreground">
          Allocated (total marketing)
        </span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </p>
  );
}
