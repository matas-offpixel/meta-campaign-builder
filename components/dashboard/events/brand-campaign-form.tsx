"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  BRAND_CAMPAIGN_OBJECTIVES,
  createBrandCampaignRow,
  type BrandCampaignObjective,
} from "@/lib/db/events";
import type { TikTokAccount } from "@/lib/types/tiktok";

interface Props {
  clientId: string;
  userId: string;
}

const OBJECTIVE_OPTIONS = BRAND_CAMPAIGN_OBJECTIVES.map((o) => ({
  value: o,
  label: o,
}));

/**
 * Date input string (yyyy-mm-dd) → ISO datetime string anchored at the
 * start of day in the browser's local TZ. Mirrors how `event_form.tsx`
 * handles `event_date` so timezone behaviour is consistent across the
 * two engagement-type forms.
 */
function dateInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(`${local}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function BrandCampaignForm({ clientId, userId }: Props) {
  const router = useRouter();
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccount[]>([]);
  const [tiktokLoading, setTiktokLoading] = useState(true);

  const [name, setName] = useState("");
  const [eventCode, setEventCode] = useState("");
  const [objective, setObjective] = useState<BrandCampaignObjective>(
    BRAND_CAMPAIGN_OBJECTIVES[0],
  );
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tiktokAccountId, setTiktokAccountId] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tiktok/accounts", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { accounts?: TikTokAccount[] };
        if (cancelled) return;
        setTiktokAccounts(json.accounts ?? []);
      } catch {
        // Account picker degrades to empty — non-blocking for the form.
      } finally {
        if (!cancelled) setTiktokLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Give the campaign a name.");
      return;
    }
    const trimmedBudget = budget.trim();
    let budgetNumber: number | null = null;
    if (trimmedBudget) {
      const parsed = Number(trimmedBudget);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Marketing budget must be a positive number.");
        return;
      }
      budgetNumber = parsed;
    }
    const startIso = dateInputToIso(startDate);
    const endIso = dateInputToIso(endDate);
    if (startIso && endIso && new Date(endIso) < new Date(startIso)) {
      setError("End date must be on or after the start date.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createBrandCampaignRow({
        user_id: userId,
        client_id: clientId,
        name: name.trim(),
        event_code: eventCode.trim() || null,
        objective,
        budget_marketing: budgetNumber,
        event_start_at: startIso,
        campaign_end_at: endIso,
        tiktok_account_id: tiktokAccountId || null,
        notes: notes.trim() || null,
      });
      if (created) {
        router.refresh();
        router.push(`/events/${created.id}`);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to create brand campaign.";
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="space-y-4 rounded-md border border-border bg-card p-5">
        <h2 className="font-heading text-base tracking-wide">Basics</h2>

        <Input
          id="brand-code"
          label="Campaign code"
          value={eventCode}
          onChange={(e) => setEventCode(e.target.value)}
          placeholder="[BB26-RIANBRAZIL]"
        />

        <Input
          id="brand-name"
          label="Campaign name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Rian Brazil — UK Awareness"
          required
        />

        <Select
          id="brand-objective"
          label="Objective"
          value={objective}
          onChange={(e) =>
            setObjective(e.target.value as BrandCampaignObjective)
          }
          options={OBJECTIVE_OPTIONS}
        />

        <Input
          id="brand-budget"
          label="Marketing budget (£)"
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="0.00"
        />
      </section>

      <section className="space-y-4 rounded-md border border-border bg-card p-5">
        <h2 className="font-heading text-base tracking-wide">Window</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="brand-start"
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            id="brand-end"
            label="End date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Start maps to <code>event_start_at</code> and end maps to{" "}
          <code>campaign_end_at</code> on the event row. Either or both can
          be left blank and filled in later.
        </p>
      </section>

      <section className="space-y-4 rounded-md border border-border bg-card p-5">
        <h2 className="font-heading text-base tracking-wide">Platform</h2>
        <Select
          id="brand-tiktok-account"
          label="TikTok account"
          value={tiktokAccountId}
          onChange={(e) => setTiktokAccountId(e.target.value)}
          disabled={tiktokLoading}
          options={[
            { value: "", label: "— Use client default —" },
            ...tiktokAccounts.map((a) => ({
              value: a.id,
              label: a.account_name,
            })),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Optional. Determines which TikTok advertiser the manual report
          imports route to. Leave blank to inherit the client default.
        </p>
      </section>

      <section className="space-y-4 rounded-md border border-border bg-card p-5">
        <h2 className="font-heading text-base tracking-wide">Notes</h2>
        <textarea
          id="brand-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Brief, audience guidance, creative direction…"
          rows={4}
          className="w-full resize-y rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create campaign
        </Button>
      </div>
    </form>
  );
}
