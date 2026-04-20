"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BillingMode } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Per-client billing settings.
//
// Two mutually exclusive modes:
//
//   per_event  — the standard pricing tiers apply. Custom overrides let
//                this client bypass the £0.80–£0.90 tier rates and the
//                £750 minimum (e.g. DHB on £0.70/ticket).
//   retainer   — flat monthly fee. Quotes for this client switch to a
//                "monthly fee × months" model and the calculator is
//                bypassed entirely.
//
// All writes go through PATCH /api/clients/[id]. The route was extended
// in this build to whitelist the five billing columns added in
// migration 021.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  initial: {
    billing_model: BillingMode;
    custom_rate_per_ticket: number | null;
    custom_minimum_fee: number | null;
    retainer_monthly_fee: number | null;
    retainer_started_at: string | null;
  };
}

function toInputString(value: number | null): string {
  return value == null ? "" : String(value);
}

export function BillingSection({ clientId, initial }: Props) {
  const router = useRouter();

  const [billingModel, setBillingModel] = useState<BillingMode>(
    initial.billing_model,
  );
  const [customRate, setCustomRate] = useState(
    toInputString(initial.custom_rate_per_ticket),
  );
  const [customMinimum, setCustomMinimum] = useState(
    toInputString(initial.custom_minimum_fee),
  );
  const [retainerFee, setRetainerFee] = useState(
    toInputString(initial.retainer_monthly_fee),
  );
  const [retainerStartedAt, setRetainerStartedAt] = useState(
    initial.retainer_started_at ?? "",
  );

  const [snapshot, setSnapshot] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Empty-string vs null normalisation matches what the API does — both
  // route to a SQL NULL, which means "use the tier default".
  function parseNumeric(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  const dirty =
    billingModel !== snapshot.billing_model ||
    parseNumeric(customRate) !== snapshot.custom_rate_per_ticket ||
    parseNumeric(customMinimum) !== snapshot.custom_minimum_fee ||
    parseNumeric(retainerFee) !== snapshot.retainer_monthly_fee ||
    (retainerStartedAt || null) !== (snapshot.retainer_started_at ?? null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const ratePerTicket = parseNumeric(customRate);
      const minimumFee = parseNumeric(customMinimum);
      const monthlyRetainer = parseNumeric(retainerFee);

      if (ratePerTicket != null && (ratePerTicket <= 0 || ratePerTicket > 50)) {
        throw new Error(
          "Custom rate/ticket must be a positive number up to £50.",
        );
      }
      if (minimumFee != null && minimumFee < 0) {
        throw new Error("Custom minimum fee can't be negative.");
      }
      if (monthlyRetainer != null && monthlyRetainer < 0) {
        throw new Error("Retainer monthly fee can't be negative.");
      }
      if (billingModel === "retainer" && (monthlyRetainer ?? 0) <= 0) {
        throw new Error(
          "Retainer mode requires a monthly fee greater than £0.",
        );
      }

      const payload: Record<string, unknown> = {
        billing_model: billingModel,
        custom_rate_per_ticket: ratePerTicket,
        custom_minimum_fee: minimumFee,
        retainer_monthly_fee: monthlyRetainer,
        retainer_started_at: retainerStartedAt || null,
      };

      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as
        | { ok: true; client: Record<string, unknown> }
        | { ok: false; error: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          "ok" in json && !json.ok && json.error
            ? json.error
            : "Failed to save billing settings.",
        );
      }
      setSnapshot({
        billing_model: billingModel,
        custom_rate_per_ticket: ratePerTicket,
        custom_minimum_fee: minimumFee,
        retainer_monthly_fee: monthlyRetainer,
        retainer_started_at: retainerStartedAt || null,
      });
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save billing settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="font-heading text-base tracking-wide">Billing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          How this client is billed. Switching modes only affects new
          quotes — historical quotes keep the billing snapshot they were
          created with.
        </p>
      </div>

      {/* Model toggle */}
      <div className="flex flex-wrap gap-2">
        <ModeButton
          active={billingModel === "per_event"}
          onClick={() => setBillingModel("per_event")}
          label="Per Event"
          hint="Standard tier pricing"
        />
        <ModeButton
          active={billingModel === "retainer"}
          onClick={() => setBillingModel("retainer")}
          label="Retainer"
          hint="Flat monthly fee"
        />
      </div>

      {billingModel === "retainer" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            id="billing-retainer-fee"
            label="Monthly retainer fee (£)"
            type="number"
            min={0}
            step="0.01"
            value={retainerFee}
            onChange={(e) => setRetainerFee(e.target.value)}
            placeholder="e.g. 1500"
          />
          <Input
            id="billing-retainer-started-at"
            label="Retainer started"
            type="date"
            value={retainerStartedAt}
            onChange={(e) => setRetainerStartedAt(e.target.value)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            id="billing-custom-rate"
            label="Custom rate/ticket (blank = tier default £0.80–£0.90)"
            type="number"
            min={0}
            step="0.01"
            value={customRate}
            onChange={(e) => setCustomRate(e.target.value)}
            placeholder="e.g. 0.70"
          />
          <Input
            id="billing-custom-minimum"
            label="Custom minimum fee (blank = £750)"
            type="number"
            min={0}
            step="0.01"
            value={customMinimum}
            onChange={(e) => setCustomMinimum(e.target.value)}
            placeholder="e.g. 500"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving}
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save billing
        </Button>
        {savedAt && !dirty && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-[180px] rounded-md border px-4 py-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary-light"
          : "border-border-strong bg-background hover:bg-muted"
      }`}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </button>
  );
}
