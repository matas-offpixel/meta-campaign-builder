"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/viz/info-tip";
import { StatusDot } from "@/components/viz/status-dot";
import { Datum, StatusLine } from "@/components/steps/step-surface";
import {
  armFromFlags,
  currencySymbol,
  type AutomationArm,
  type DecisionRowView,
} from "@/lib/optimisation/automation-ui";
import { formatVizMoment } from "@/lib/viz/format-moment";
import { VIZ_TYPE, type VizStatus } from "@/lib/viz/tokens";

type GatePayload = {
  ok?: boolean;
  enabled?: boolean;
  live?: boolean;
  status?: string;
  lastEvaluatedAt?: string | null;
  decisions?: DecisionRowView[];
  writesEnabled?: boolean;
  skippedReason?: string | null;
  error?: string;
};

const ARM_DOT: Record<AutomationArm, VizStatus> = {
  off: "idle",
  shadow: "in-progress",
  live: "live",
};

const ARMS: Array<{ id: AutomationArm; label: string; tip: string }> = [
  { id: "off", label: "Off", tip: "Default. The tick will not evaluate this campaign." },
  {
    id: "shadow",
    label: "Shadow",
    tip: "Log what the rules would do, change nothing.",
  },
  {
    id: "live",
    label: "Live",
    tip: "Apply budget changes within guardrails.",
  },
];

const ARM_GATE_TIP =
  "Arms the existing tick. Off / Shadow / Live map to optimisation_automation_enabled and optimisation_automation_live. Live also requires the account-level ENABLE_OPTIMISATION_WRITES env gate.";

function formatEvaluatedAt(iso: string | null): string {
  if (!iso) return "Never — no tick has evaluated this draft yet.";
  return formatVizMoment(iso);
}

export function AutomationArmControl({
  draftId,
  currency,
  baseCampaignBudget,
  hardBudgetCeiling,
}: {
  draftId: string;
  currency: string;
  baseCampaignBudget: number;
  hardBudgetCeiling: number;
  /** @deprecated Decisions moved to the decisions sheet. Ignored. */
  showDecisions?: boolean;
}) {
  const [arm, setArm] = useState<AutomationArm>("off");
  const [writesEnabled, setWritesEnabled] = useState<boolean | null>(null);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const sym = currencySymbol(currency);

  const applyPayload = useCallback((json: GatePayload) => {
    setArm(armFromFlags(json.enabled === true, json.live === true));
    setWritesEnabled(json.writesEnabled === true);
    setLastEvaluatedAt(json.lastEvaluatedAt ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/campaigns/${draftId}/automation`)
      .then((res) => res.json() as Promise<GatePayload>)
      .then((json) => {
        if (cancelled) return;
        if (json.ok === false) {
          setError(json.error ?? "Could not load automation state");
          return;
        }
        applyPayload(json);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load automation state");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, applyPayload]);

  const writeArm = useCallback(
    async (next: AutomationArm, confirmLive: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/campaigns/${draftId}/automation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arm: next,
            ...(next === "live" ? { confirmLive } : {}),
          }),
        });
        const json = (await res.json()) as GatePayload & { code?: string };
        if (!res.ok || json.ok === false) {
          setError(json.error ?? "Could not save automation state");
          return;
        }
        applyPayload(json);
        setConfirmOpen(false);
      } catch {
        setError("Could not save automation state");
      } finally {
        setSaving(false);
      }
    },
    [draftId, applyPayload],
  );

  const onSelect = (next: AutomationArm) => {
    if (next === arm || saving) return;
    if (next === "live") {
      setConfirmOpen(true);
      return;
    }
    void writeArm(next, false);
  };

  return (
    <>
      <Card>
        <div className="mb-3 flex items-center gap-1.5">
          <CardTitle className="mb-0">Automation</CardTitle>
          <InfoTip label={ARM_GATE_TIP} />
        </div>

        <div className={`mb-3 flex flex-wrap items-center gap-2 ${VIZ_TYPE.label}`}>
          <span className="text-muted-foreground">ENABLE_OPTIMISATION_WRITES</span>
          <InfoTip label={ARM_GATE_TIP} />
          {writesEnabled === null ? (
            <Badge variant="outline">checking…</Badge>
          ) : writesEnabled ? (
            <Badge variant="success">on</Badge>
          ) : (
            <Badge variant="warning">off (killswitch)</Badge>
          )}
        </div>

        <div className="grid gap-2">
          {ARMS.map((opt) => {
            const isActive = arm === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={loading || saving}
                onClick={() => onSelect(opt.id)}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all
                  ${
                    isActive
                      ? "border-primary bg-primary-light ring-1 ring-primary/20"
                      : "border-border bg-card hover:border-border-strong hover:bg-muted/40"
                  }`}
              >
                <StatusDot status={ARM_DOT[opt.id]} />
                <span className={`${VIZ_TYPE.body} font-medium`}>{opt.label}</span>
                <InfoTip label={opt.tip} />
              </button>
            );
          })}
        </div>

        <StatusLine className={`mt-3 ${VIZ_TYPE.label} text-muted-foreground`}>
          Last optimisation-tick evaluation: {formatEvaluatedAt(lastEvaluatedAt)}
        </StatusLine>

        {error ? (
          <StatusLine tone="alert" className={`mt-2 ${VIZ_TYPE.label} text-destructive`}>
            {error}
          </StatusLine>
        ) : null}
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader onClose={() => setConfirmOpen(false)}>
            <DialogTitle>Arm live writes</DialogTitle>
            <DialogDescription>
              Apply budget changes within guardrails. This still requires{" "}
              <span className="font-mono">ENABLE_OPTIMISATION_WRITES=1</span> on the
              account
              {writesEnabled === false
                ? " — that gate is currently off, so the tick will keep shadowing."
                : writesEnabled
                  ? " — that gate is currently on."
                  : "."}
            </DialogDescription>
          </DialogHeader>
          <div className={`rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 ${VIZ_TYPE.body}`}>
            <Datum className="mb-1 flex items-center gap-1.5 font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              Guardrails that will bound writes
            </Datum>
            <Datum className="text-foreground">
              Base budget {sym}
              {baseCampaignBudget.toLocaleString()} · hard ceiling {sym}
              {hardBudgetCeiling.toLocaleString()}
            </Datum>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void writeArm("live", true)}
            >
              {saving ? "Arming…" : "Confirm Live"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
