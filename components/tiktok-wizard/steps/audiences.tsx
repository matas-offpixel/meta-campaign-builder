"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  TikTokAudienceCategory,
  TikTokAudienceListItem,
} from "@/lib/tiktok/audience";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

type Tab = "interests" | "behaviours" | "custom" | "lookalikes";

const LOCATION_OPTIONS = [
  { value: "GB", label: "United Kingdom" },
  { value: "IE", label: "Ireland" },
  { value: "US", label: "United States" },
  { value: "BR", label: "Brazil" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "ES", label: "Spain" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "pt", label: "Portuguese" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

export function AudiencesStep({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("interests");
  const [interests, setInterests] = useState<TikTokAudienceCategory[]>([]);
  const [behaviours, setBehaviours] = useState<TikTokAudienceCategory[]>([]);
  const [customAudiences, setCustomAudiences] = useState<TikTokAudienceListItem[]>([]);
  const [savedAudiences, setSavedAudiences] = useState<TikTokAudienceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ageMin, setAgeMin] = useState(String(draft.audiences.ageMin));
  const [ageMax, setAgeMax] = useState(String(draft.audiences.ageMax));

  useEffect(() => {
    const advertiserId = draft.accountSetup.advertiserId;
    if (!advertiserId) return;
    let cancelled = false;
    setLoading(true);
    setWarning(null);
    const selectedParams = draft.audiences.interestCategoryIds
      .map((id) => `selected_id=${encodeURIComponent(id)}`)
      .join("&");
    const suffix = selectedParams ? `&${selectedParams}` : "";
    fetch(
      `/api/tiktok/audience/categories?advertiser_id=${encodeURIComponent(advertiserId)}${suffix}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then(
        (json: {
          ok?: boolean;
          interests?: TikTokAudienceCategory[];
          behaviours?: TikTokAudienceCategory[];
          customAudiences?: TikTokAudienceListItem[];
          savedAudiences?: TikTokAudienceListItem[];
          estimatedReach?: number | null;
          error?: string;
        }) => {
          if (cancelled) return;
          if (!json.ok) {
            setWarning(json.error ?? "TikTok audience data is unavailable.");
          }
          setInterests(json.interests ?? []);
          setBehaviours(json.behaviours ?? []);
          setCustomAudiences(json.customAudiences ?? []);
          setSavedAudiences(json.savedAudiences ?? []);
          if (json.estimatedReach !== undefined) {
            void persist({ estimatedReach: json.estimatedReach ?? null });
          }
        },
      )
      .catch(() => {
        if (!cancelled) setWarning("TikTok audience data is unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.accountSetup.advertiserId, draft.audiences.interestCategoryIds.join("|")]);

  const interestTree = useMemo(() => buildTree(interests), [interests]);

  async function persist(audiences: Partial<TikTokCampaignDraft["audiences"]>) {
    setSaving(true);
    try {
      await onSave({
        audiences: {
          ...draft.audiences,
          ...audiences,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(
    id: string,
    label: string,
    key: "interestCategoryIds" | "behaviourCategoryIds",
    labelKey: "interestCategoryLabels" | "behaviourCategoryLabels",
  ) {
    const current = draft.audiences[key];
    const exists = current.includes(id);
    const next = exists ? current.filter((item) => item !== id) : [...current, id];
    const labels = { ...draft.audiences[labelKey] };
    if (exists) delete labels[id];
    else labels[id] = label;
    await persist({ [key]: next, [labelKey]: labels });
  }

  async function toggleListItem(
    id: string,
    label: string,
    key: "customAudienceIds" | "lookalikeAudienceIds",
    labelKey: "customAudienceLabels" | "lookalikeAudienceLabels",
  ) {
    const current = draft.audiences[key];
    const exists = current.includes(id);
    const next = exists ? current.filter((item) => item !== id) : [...current, id];
    const labels = { ...draft.audiences[labelKey] };
    if (exists) delete labels[id];
    else labels[id] = label;
    await persist({ [key]: next, [labelKey]: labels });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Audiences</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Select TikTok interests, behaviours, custom audiences, lookalikes,
          locations, demographics, and languages.
        </p>
      </div>

      {!draft.accountSetup.advertiserId && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Select an advertiser in Step 0 to load TikTok audience options.
        </p>
      )}

      {warning && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {warning}
        </p>
      )}

      <div className="rounded-md border border-border bg-background p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Targeting summary
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {summaryChips(draft).map((chip) => (
            <span key={chip} className="rounded-full bg-muted px-3 py-1 text-xs text-foreground">
              {chip}
            </span>
          ))}
          {summaryChips(draft).length === 0 && (
            <span className="text-sm text-muted-foreground">No targeting selected yet.</span>
          )}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Estimated reach:{" "}
          {draft.audiences.estimatedReach == null
            ? "—"
            : draft.audiences.estimatedReach.toLocaleString()}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["interests", "behaviours", "custom", "lookalikes"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-md border px-3 py-2 text-sm ${
              activeTab === tab
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      {activeTab === "interests" && (
        <CategoryList
          rows={interestTree}
          selectedIds={draft.audiences.interestCategoryIds}
          disabled={saving || loading}
          empty="No interest categories available."
          onToggle={(row) =>
            void toggleCategory(
              row.id,
              row.label,
              "interestCategoryIds",
              "interestCategoryLabels",
            )
          }
        />
      )}
      {activeTab === "behaviours" && (
        <CategoryList
          rows={behaviours.map((row) => ({ ...row, depth: 0 }))}
          selectedIds={draft.audiences.behaviourCategoryIds}
          disabled={saving || loading}
          empty="No behaviours available for this advertiser."
          onToggle={(row) =>
            void toggleCategory(
              row.id,
              row.label,
              "behaviourCategoryIds",
              "behaviourCategoryLabels",
            )
          }
        />
      )}
      {activeTab === "custom" && (
        <AudienceList
          rows={customAudiences}
          selectedIds={draft.audiences.customAudienceIds}
          disabled={saving || loading}
          empty="No custom audiences available."
          onToggle={(row) =>
            void toggleListItem(
              row.id,
              row.label,
              "customAudienceIds",
              "customAudienceLabels",
            )
          }
        />
      )}
      {activeTab === "lookalikes" && (
        <AudienceList
          rows={savedAudiences}
          selectedIds={draft.audiences.lookalikeAudienceIds}
          disabled={saving || loading}
          empty="No lookalikes available."
          onToggle={(row) =>
            void toggleListItem(
              row.id,
              row.label,
              "lookalikeAudienceIds",
              "lookalikeAudienceLabels",
            )
          }
        />
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Select
          id="tiktok-location"
          label="Add location"
          value=""
          onChange={(event) => {
            const value = event.target.value;
            if (value && !draft.audiences.locationCodes.includes(value)) {
              void persist({ locationCodes: [...draft.audiences.locationCodes, value] });
            }
          }}
          placeholder="Select location"
          options={LOCATION_OPTIONS.filter(
            (option) => !draft.audiences.locationCodes.includes(option.value),
          )}
        />
        <Input
          id="tiktok-age-min"
          label="Age min"
          inputMode="numeric"
          value={ageMin}
          onChange={(event) => setAgeMin(event.target.value)}
          onBlur={() => void persist({ ageMin: clampAge(ageMin, 18) })}
        />
        <Input
          id="tiktok-age-max"
          label="Age max"
          inputMode="numeric"
          value={ageMax}
          onChange={(event) => setAgeMax(event.target.value)}
          onBlur={() => void persist({ ageMax: clampAge(ageMax, 65) })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {draft.audiences.locationCodes.map((code) => (
          <button
            key={code}
            type="button"
            className="rounded-full bg-muted px-3 py-1 text-xs"
            onClick={() =>
              void persist({
                locationCodes: draft.audiences.locationCodes.filter((c) => c !== code),
              })
            }
          >
            {LOCATION_OPTIONS.find((option) => option.value === code)?.label ?? code} ×
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MultiToggle
          title="Gender"
          values={["MALE", "FEMALE", "UNKNOWN"]}
          selected={draft.audiences.genders}
          onChange={(genders) =>
            void persist({
              genders: genders as Array<"MALE" | "FEMALE" | "UNKNOWN">,
            })
          }
        />
        <MultiToggle
          title="Languages"
          values={LANGUAGE_OPTIONS.map((option) => option.value)}
          labels={Object.fromEntries(
            LANGUAGE_OPTIONS.map((option) => [option.value, option.label]),
          )}
          selected={draft.audiences.languages}
          onChange={(languages) => void persist({ languages })}
        />
      </div>
    </div>
  );
}

interface CategoryRow extends TikTokAudienceCategory {
  depth: number;
}

function buildTree(rows: TikTokAudienceCategory[]): CategoryRow[] {
  const byParent = new Map<string | null, TikTokAudienceCategory[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }
  const out: CategoryRow[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const row of byParent.get(parentId) ?? []) {
      out.push({ ...row, depth });
      walk(row.id, depth + 1);
    }
  }
  walk(null, 0);
  return out.length > 0 ? out : rows.map((row) => ({ ...row, depth: 0 }));
}

function CategoryList({
  rows,
  selectedIds,
  disabled,
  empty,
  onToggle,
}: {
  rows: CategoryRow[];
  selectedIds: string[];
  disabled: boolean;
  empty: string;
  onToggle: (row: CategoryRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border bg-background p-2">
      {rows.map((row) => (
        <label
          key={row.id}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          style={{ paddingLeft: `${8 + row.depth * 18}px` }}
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(row.id)}
            disabled={disabled}
            onChange={() => onToggle(row)}
          />
          {row.label}
        </label>
      ))}
    </div>
  );
}

function AudienceList({
  rows,
  selectedIds,
  disabled,
  empty,
  onToggle,
}: {
  rows: TikTokAudienceListItem[];
  selectedIds: string[];
  disabled: boolean;
  empty: string;
  onToggle: (row: TikTokAudienceListItem) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <label
          key={row.id}
          className="flex items-center justify-between rounded-md border border-border bg-background p-3 text-sm"
        >
          <span>
            <span className="block font-medium">{row.label}</span>
            {row.status && (
              <span className="text-xs text-muted-foreground">{row.status}</span>
            )}
          </span>
          <input
            type="checkbox"
            checked={selectedIds.includes(row.id)}
            disabled={disabled}
            onChange={() => onToggle(row)}
          />
        </label>
      ))}
    </div>
  );
}

function MultiToggle({
  title,
  values,
  labels = {},
  selected,
  onChange,
}: {
  title: string;
  values: string[];
  labels?: Record<string, string>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs ${
                active ? "border-primary bg-primary/10 text-primary" : "border-border"
              }`}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((item) => item !== value)
                    : [...selected, value],
                )
              }
            >
              {labels[value] ?? value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function summaryChips(draft: TikTokCampaignDraft): string[] {
  return [
    ...Object.values(draft.audiences.interestCategoryLabels),
    ...Object.values(draft.audiences.behaviourCategoryLabels),
    ...Object.values(draft.audiences.customAudienceLabels),
    ...Object.values(draft.audiences.lookalikeAudienceLabels),
    ...draft.audiences.locationCodes,
    ...draft.audiences.genders,
  ];
}

function tabLabel(tab: Tab): string {
  if (tab === "custom") return "Custom audiences";
  if (tab === "lookalikes") return "Lookalikes";
  return tab[0].toUpperCase() + tab.slice(1);
}

function clampAge(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(18, Math.min(65, parsed));
}
