"use client";

import { ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CreativeProviderName,
  CreativeTemplate,
} from "@/lib/creatives/types";

/**
 * components/dashboard/clients/creative-templates-panel.tsx
 *
 * Mirrors `app/(dashboard)/creatives/templates/page.tsx` but as an
 * embeddable client component for the client-detail Creatives
 * Templates tab. The standalone page is preserved (deep linkable) —
 * this just gives Matas one click less when starting from a client.
 *
 * Provider-status flags are read on the server and passed in as props
 * so this stays a pure presentational client component (no env access
 * in the browser).
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
}

export function CreativeTemplatesPanel({ templates, providerStatus }: Props) {
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
                    <p className="px-6 pb-4 text-sm text-muted-foreground">
                      {t.notes}
                    </p>
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
