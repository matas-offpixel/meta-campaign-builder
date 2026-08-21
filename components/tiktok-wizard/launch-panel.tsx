import { CheckCircle2, ExternalLink, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TikTokLaunchPanelModel } from "@/lib/tiktok-wizard/launch-progress";

export function TikTokLaunchPanel({ model }: { model: TikTokLaunchPanelModel }) {
  return (
    <section
      data-launch-state={model.state}
      className={`rounded-md border p-4 ${model.boxClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {model.state === "in-flight" ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : model.state === "succeeded" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
          ) : (
            <TriangleAlert className="h-5 w-5 text-red-700" />
          )}
          <h3 className="font-heading text-lg">{model.title}</h3>
        </div>
        {model.state === "succeeded" && model.adsManagerUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() =>
              window.open(model.adsManagerUrl!, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {model.adsManagerLabel}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{model.description}</p>

      {model.state === "in-flight" && (
        <ol className="mt-3 space-y-2 text-sm">
          {model.phases.map((phase) => (
            <li key={phase.id} data-phase={phase.id} data-phase-status={phase.status}>
              <span className="font-medium">{phase.label}</span>
              <span className="text-muted-foreground"> — {phase.detail}</span>
            </li>
          ))}
        </ol>
      )}

      {model.state === "succeeded" && (
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Campaign</dt>
            <dd className="text-right font-medium">{model.campaignId ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Ad groups</dt>
            <dd className="text-right font-medium">{model.adGroupCount ?? 0}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Ads</dt>
            <dd className="text-right font-medium">{model.adCount ?? 0}</dd>
          </div>
          {model.launchedAt ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Launched at</dt>
              <dd className="text-right text-muted-foreground">{model.launchedAt}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {model.state === "failed" && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-red-700">{model.errorMessage}</p>
          {model.tiktokMessage && model.tiktokMessage !== model.errorMessage ? (
            <p className="text-muted-foreground">{model.tiktokMessage}</p>
          ) : null}
          {model.requestId ? (
            <p data-request-id={model.requestId} className="font-mono text-xs">
              request_id {model.requestId}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
