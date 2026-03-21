"use client";

import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { CampaignSettings } from "@/lib/types";
import { MOCK_CLIENTS, MOCK_AD_ACCOUNTS, MOCK_PIXELS } from "@/lib/mock-data";

interface AccountSetupProps {
  settings: CampaignSettings;
  onChange: (settings: CampaignSettings) => void;
}

export function AccountSetup({ settings, onChange }: AccountSetupProps) {
  const update = (patch: Partial<CampaignSettings>) =>
    onChange({ ...settings, ...patch });

  const filteredAccounts = settings.clientId
    ? MOCK_AD_ACCOUNTS.filter((a) => {
        const client = MOCK_CLIENTS.find((c) => c.id === settings.clientId);
        return client?.adAccountIds.includes(a.id);
      })
    : MOCK_AD_ACCOUNTS;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Account Setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select the client, ad account, and pixel for this campaign.
        </p>
      </div>

      <Card>
        <CardTitle>Client</CardTitle>
        <CardDescription>Optional — filter ad accounts by client.</CardDescription>
        <div className="mt-3">
          <Select
            value={settings.clientId || ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            placeholder="All clients"
            options={[
              { value: "", label: "All clients" },
              ...MOCK_CLIENTS.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Ad Account</CardTitle>
        <CardDescription>Select the Meta ad account for this campaign.</CardDescription>
        <div className="mt-3">
          <Select
            value={settings.adAccountId}
            onChange={(e) => update({ adAccountId: e.target.value })}
            placeholder="Select ad account..."
            options={filteredAccounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.accountId})`,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Pixel</CardTitle>
        <CardDescription>Optional — attach a Meta pixel for conversion tracking.</CardDescription>
        <div className="mt-3">
          <Select
            value={settings.pixelId || ""}
            onChange={(e) => update({ pixelId: e.target.value || undefined })}
            placeholder="Select pixel (optional)..."
            options={[
              { value: "", label: "None" },
              ...MOCK_PIXELS.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.pixelId})`,
              })),
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
