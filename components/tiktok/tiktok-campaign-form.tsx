"use client";

import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TikTokAccount } from "@/lib/types/tiktok";

const TIKTOK_PINK = "#FF0050";

const OBJECTIVE_OPTIONS = [
  { value: "awareness", label: "Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "conversions", label: "Conversions" },
];

const PLACEMENT_OPTIONS = [
  { value: "auto", label: "Automatic placement" },
  { value: "tiktok", label: "TikTok feed only" },
  { value: "pangle", label: "Pangle audience network" },
];

const GENDER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

/**
 * TikTok campaign builder skeleton — no validation, no persistence.
 *
 * Mirrors the field layout of the Meta budget-schedule step + the ad
 * group / creative split native to TikTok Ads Manager. The "Launch on
 * TikTok" CTA is permanently disabled until the OAuth + Ads API
 * handshake is wired (see `app/api/tiktok/launch/*` — not scaffolded
 * yet because launch contracts will be designed against the live API).
 */
export function TikTokCampaignForm() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("awareness");
  const [budget, setBudget] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("44");
  const [gender, setGender] = useState("all");
  const [interests, setInterests] = useState("");
  const [geo, setGeo] = useState("");
  const [placement, setPlacement] = useState("auto");
  const [caption, setCaption] = useState("");

  useEffect(() => {
    fetch("/api/tiktok/accounts")
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok) setAccounts(json.accounts as TikTokAccount[]);
      })
      .catch(() => undefined);
  }, []);

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="space-y-6"
      aria-label="TikTok campaign form"
    >
      <Section
        title="Account & campaign"
        description="Pick the TikTok account this campaign runs on."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select
            id="tt-account"
            label="TikTok account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Select an account…"
            options={accounts.map((a) => ({
              value: a.id,
              label: a.account_name,
            }))}
          />
          <Input
            id="tt-name"
            label="Campaign name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="J2 Awareness · Aug 2026"
          />
        </div>
        <Select
          id="tt-objective"
          label="Objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          options={OBJECTIVE_OPTIONS}
        />
      </Section>

      <Section
        title="Budget & schedule"
        description="Daily budget × campaign window. Mirrors the Meta wizard's budget step."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            id="tt-budget"
            label="Daily budget (£)"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="50"
          />
          <Input
            id="tt-start"
            label="Start date"
            type="date"
            value={scheduleStart}
            onChange={(e) => setScheduleStart(e.target.value)}
          />
          <Input
            id="tt-end"
            label="End date"
            type="date"
            value={scheduleEnd}
            onChange={(e) => setScheduleEnd(e.target.value)}
          />
        </div>
      </Section>

      <Section
        title="Ad group · targeting & placement"
        description="TikTok-native targeting fields. Geo accepts comma-separated city / region names."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            id="tt-age-min"
            label="Age (min)"
            inputMode="numeric"
            value={ageMin}
            onChange={(e) => setAgeMin(e.target.value)}
          />
          <Input
            id="tt-age-max"
            label="Age (max)"
            inputMode="numeric"
            value={ageMax}
            onChange={(e) => setAgeMax(e.target.value)}
          />
          <Select
            id="tt-gender"
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            options={GENDER_OPTIONS}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="tt-interests"
            label="Interests"
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            placeholder="electronic music, festivals, nightlife"
          />
          <Input
            id="tt-geo"
            label="Geo targeting"
            value={geo}
            onChange={(e) => setGeo(e.target.value)}
            placeholder="London, Manchester, Bristol"
          />
        </div>
        <Select
          id="tt-placement"
          label="Placement"
          value={placement}
          onChange={(e) => setPlacement(e.target.value)}
          options={PLACEMENT_OPTIONS}
        />
      </Section>

      <Section
        title="Creative"
        description="Drop a 9:16 video and write the caption. Upload pipeline plumbs into Meta's existing storage flow once the API is live."
      >
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-6 text-center">
          <Music2
            className="mx-auto mb-2 h-6 w-6"
            style={{ color: TIKTOK_PINK }}
          />
          <p className="text-sm font-medium">Video upload placeholder</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag &amp; drop wiring lands with the Ads API integration.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tt-caption" className="text-sm font-medium">
            Caption
          </label>
          <textarea
            id="tt-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm
              focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Junction 2 returns to Boston Manor Park — tickets out now 🎟️"
          />
        </div>
      </Section>

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="submit"
          disabled
          title="API credentials required"
          style={{ backgroundColor: TIKTOK_PINK }}
        >
          Launch on TikTok
        </Button>
        <p className="text-xs text-muted-foreground">
          API credentials required — connect a TikTok Business account
          in Settings to enable launch.
        </p>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-heading text-base tracking-wide">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
