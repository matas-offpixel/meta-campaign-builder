import { redirect } from "next/navigation";
import { ImageIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { listCreativeTemplatesForUser } from "@/lib/db/creative-templates";
import {
  isBannerbearEnabled,
  isCanvaEnabled,
  isPlacidEnabled,
  type CreativeProviderName,
} from "@/lib/creatives/types";

/**
 * Creative templates index. Lists existing templates and surfaces
 * each provider's connection state. With every provider flag off
 * (default), the connect buttons are disabled with a clear "pending
 * approval" tooltip — flipping the flag enables them as a one-line
 * change in production.
 *
 * No connect-flow is implemented in this PR — the Canva OAuth
 * callback, Bannerbear API key entry, and Placid API key entry land
 * in their respective follow-up PRs once accounts are provisioned.
 */
export default async function CreativeTemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const templates = await listCreativeTemplatesForUser(supabase);

  const providerStatus: Array<{
    provider: CreativeProviderName;
    label: string;
    enabled: boolean;
    blurb: string;
    flag: string;
  }> = [
    {
      provider: "canva",
      label: "Canva Autofill",
      enabled: isCanvaEnabled(),
      flag: "FEATURE_CANVA_AUTOFILL",
      blurb:
        "Brand templates with autofill via Canva Connect. Requires Canva Enterprise approval.",
    },
    {
      provider: "bannerbear",
      label: "Bannerbear",
      enabled: isBannerbearEnabled(),
      flag: "FEATURE_BANNERBEAR",
      blurb:
        "Lightweight image / video render API. Self-serve account, no enterprise gate.",
    },
    {
      provider: "placid",
      label: "Placid",
      enabled: isPlacidEnabled(),
      flag: "FEATURE_PLACID",
      blurb:
        "Template-based render API with similar surface area to Bannerbear.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Creative templates"
        description="Connect a render provider, register templates, and autofill assets per event."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-8">
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
      </main>
    </>
  );
}
