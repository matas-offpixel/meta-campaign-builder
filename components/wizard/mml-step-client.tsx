"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { InfoTip } from "@/components/viz/info-tip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { Datum, StatusLine } from "@/components/steps/step-surface";
import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import {
  metaAdAccountPickerOptions,
  metaPixelPickerOptions,
} from "@/lib/meta/account-picker-options";
import { useFetchAdAccounts, useFetchPageIdentity, useFetchPages, useFetchPixels } from "@/lib/hooks/useMeta";
import { formatPlanEventDate, planEventPickerRows, type PlanEventOption } from "@/lib/plan/event-picker";
import type { IdentityNameMap } from "@/lib/plan/identity-chips";
import {
  atUsername,
  googleChannelAvailable,
  identityInitial,
  identityLabel,
  preferChannelValue,
  type ChannelHistoryPick,
  type MmlChannelSelection,
} from "@/lib/plan/mml-wizard";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { createClient } from "@/lib/supabase/client";
import { tikTokIdentityFace } from "@/lib/tiktok-wizard/account-setup";
import type { CampaignDraft, CampaignSettings } from "@/lib/types";
import {
  accountSwitchConfirmCopy,
  accountSwitchImpact,
  commitAccountSwitch,
} from "@/lib/wizard/account-switch";

export interface GoogleAdsAccountOption {
  id: string;
  account_name: string | null;
  google_customer_id: string;
}

interface TikTokIdentityOption {
  identity_id: string;
  display_name: string;
  avatar_url: string | null;
  identity_type: string | null;
  identity_bc_id?: string | null;
}

export function MmlStepClient({
  planId,
  events,
  eventId,
  destinationUrl,
  resolved,
  identityNames,
  googleAdsAccounts,
  draft,
  tiktokDraftId,
  googleDraftId,
  channels,
  onChannels,
  onEvent,
  onDestination,
  onSettings,
  onApplyDraft,
  onIdentity,
}: {
  planId: string;
  events: PlanEventOption[];
  eventId: string;
  destinationUrl: string;
  resolved: ResolvedChannelDefaults | null;
  identityNames: IdentityNameMap;
  googleAdsAccounts: GoogleAdsAccountOption[];
  draft: CampaignDraft | null;
  tiktokDraftId: string | null;
  googleDraftId: string | null;
  channels: MmlChannelSelection;
  onChannels: (next: MmlChannelSelection) => void;
  onEvent: (eventId: string) => void;
  onDestination: (url: string) => void;
  onSettings: (settings: CampaignSettings) => void;
  onApplyDraft: (updater: (draft: CampaignDraft) => CampaignDraft) => void;
  onIdentity: (identity: {
    clientId: string | null;
    metaAdAccountId: string | null;
    tiktokAdvertiserId: string | null;
    googleCustomerId: string | null;
  }) => void;
}) {
  const selectedEvent = events.find((event) => event.id === eventId) ?? null;
  const clientId = selectedEvent?.clientId ?? resolved?.clientId ?? null;
  const googleOk = googleChannelAvailable(
    events.find((event) => event.clientId === clientId)?.googleCustomerId,
  );
  const [history, setHistory] = useState<ChannelHistoryPick | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [destination, setDestination] = useState(destinationUrl);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const applied = useRef<string | null>(null);

  useEffect(() => {
    setDestination(destinationUrl);
  }, [destinationUrl]);

  useEffect(() => {
    if (!clientId) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistoryError(null);
    fetch(`/api/plan/channel-history?clientId=${encodeURIComponent(clientId)}`)
      .then(async (res) => {
        const json = (await res.json()) as { ok?: boolean; history?: ChannelHistoryPick; error?: string };
        if (!res.ok || !json.ok || !json.history) throw new Error(json.error ?? "Could not read channel history");
        return json.history;
      })
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : "Could not read channel history");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const settings = draft?.settings;
  const metaAccountId = preferChannelValue(
    settings?.metaAdAccountId || settings?.adAccountId,
    history?.metaAdAccountId,
    resolved?.metaAdAccount.value,
  );
  const pixelId = preferChannelValue(
    settings?.metaPixelId || settings?.pixelId,
    history?.metaPixelId,
    resolved?.metaPixel.value,
  );
  const pageId = preferChannelValue(
    settings?.metaPageId,
    history?.metaPageId,
    resolved?.facebookPage.value,
  );
  const igId = preferChannelValue(
    settings?.metaIGAccountId,
    history?.metaIgAccountId,
    resolved?.instagramActor.value,
  );
  const advertiserId = preferChannelValue(
    null,
    history?.tiktokAdvertiserId,
    resolved?.tiktokAdvertiser.value,
  );
  const identityId = preferChannelValue(
    null,
    history?.tiktokIdentityId,
    resolved?.tiktokIdentity.value?.id,
  );

  useEffect(() => {
    if (!draft || !history || !clientId || applied.current === `${planId}:${clientId}`) return;
    applied.current = `${planId}:${clientId}`;
    const current = draft.settings;
    const next: CampaignSettings = { ...current };
    let changed = false;
    const fill = (empty: boolean, value: string | null, write: () => void) => {
      if (!empty || !value) return;
      write();
      changed = true;
    };
    fill(!(current.metaAdAccountId || current.adAccountId), metaAccountId, () => {
      next.adAccountId = metaAccountId!;
      next.metaAdAccountId = metaAccountId!;
    });
    fill(!(current.metaPixelId || current.pixelId), pixelId, () => {
      next.pixelId = pixelId!;
      next.metaPixelId = pixelId!;
    });
    fill(!current.metaPageId, pageId, () => {
      next.metaPageId = pageId!;
    });
    fill(!current.metaIGAccountId, igId, () => {
      next.metaIGAccountId = igId!;
    });
    if (!current.clientId && clientId) {
      next.clientId = clientId;
      changed = true;
    }
    if (changed) onSettings(next);
    // The fill reads the draft once per client. Later edits must not re-apply history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, history, clientId, planId]);

  const accounts = useFetchAdAccounts();
  const pixels = useFetchPixels(metaAccountId ?? undefined);
  const pages = useFetchPages(metaAccountId ?? undefined);
  const pageIdentity = useFetchPageIdentity(pageId ?? undefined, metaAccountId ?? undefined);
  const [identities, setIdentities] = useState<TikTokIdentityOption[]>([]);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [tiktokAccounts, setTiktokAccounts] = useState<
    { id: string; account_name: string; tiktok_advertiser_id: string | null }[]
  >([]);
  const [tiktokAdvertiser, setTiktokAdvertiser] = useState(advertiserId);
  const [tiktokIdentity, setTiktokIdentity] = useState(identityId);
  const [googleAccountId, setGoogleAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!tiktokDraftId) return;
    let cancelled = false;
    void getTikTokDraft(createClient(), tiktokDraftId).then((loaded) => {
      if (cancelled || !loaded) return;
      if (loaded.accountSetup.advertiserId) setTiktokAdvertiser(loaded.accountSetup.advertiserId);
      if (loaded.accountSetup.identityId) setTiktokIdentity(loaded.accountSetup.identityId);
    });
    return () => {
      cancelled = true;
    };
  }, [tiktokDraftId]);

  useEffect(() => {
    if (!googleDraftId) return;
    let cancelled = false;
    void createClient()
      .from("google_search_plans")
      .select("google_ads_account_id")
      .eq("id", googleDraftId)
      .maybeSingle()
      .then(({ data }) => {
        const id = (data as { google_ads_account_id?: string | null } | null)?.google_ads_account_id;
        if (!cancelled && id) setGoogleAccountId(id);
      });
    return () => {
      cancelled = true;
    };
  }, [googleDraftId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tiktok/accounts")
      .then(async (res) => {
        const json = (await res.json()) as {
          ok?: boolean;
          accounts?: { id: string; account_name: string; tiktok_advertiser_id: string | null }[];
        };
        return json.accounts ?? [];
      })
      .then((rows) => {
        if (!cancelled) setTiktokAccounts(rows);
      })
      .catch(() => {
        if (!cancelled) setTiktokAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tiktokAdvertiser && advertiserId) setTiktokAdvertiser(advertiserId);
  }, [advertiserId, tiktokAdvertiser]);
  useEffect(() => {
    if (!tiktokIdentity && identityId) setTiktokIdentity(identityId);
  }, [identityId, tiktokIdentity]);

  useEffect(() => {
    if (!tiktokAdvertiser) {
      setIdentities([]);
      return;
    }
    let cancelled = false;
    setIdentityError(null);
    fetch(`/api/tiktok/identities?advertiser_id=${encodeURIComponent(tiktokAdvertiser)}`)
      .then(async (res) => {
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          identities?: TikTokIdentityOption[];
        };
        if (!json.ok) throw new Error(json.error ?? "TikTok identities failed");
        return json.identities ?? [];
      })
      .then((rows) => {
        if (!cancelled) setIdentities(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setIdentities([]);
          setIdentityError(err instanceof Error ? err.message : "TikTok identities failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tiktokAdvertiser]);

  const clients = uniqueClients(events);
  const clientEvents = events.filter((event) => event.clientId === clientId);
  const eventOptions = planEventPickerRows(clientId ? clientEvents : events).map((row) => ({
    value: row.id,
    label: row.label,
    sublabel: row.sublabel,
    keywords: row.keywords,
  }));
  const accountOptions = metaAdAccountPickerOptions(accounts.data);
  const pixelOptions = metaPixelPickerOptions(pixels.data);
  const selectedPage = pages.data.find((page) => page.id === pageId);
  const pageName =
    selectedPage?.name?.trim() ||
    pageIdentity.data?.pageName?.trim() ||
    (pageId ? identityNames.facebookPage[pageId]?.trim() : "") ||
    "";
  const pageOptions = [
    ...(pageId && !pages.data.some((page) => page.id === pageId)
      ? [{ value: pageId, label: pageName || pageId, keywords: pageId }]
      : []),
    ...pages.data.map((page) => ({
      value: page.id,
      label: page.name?.trim() || page.id,
      keywords: page.id,
    })),
  ];
  const linkedIg = pageIdentity.data?.ig.state === "linked" ? pageIdentity.data.ig.account : null;
  const igOptions = linkedIg
    ? [
        {
          value: linkedIg.igActorId || linkedIg.id,
          label: atUsername(linkedIg.username) || linkedIg.name || linkedIg.igActorId || linkedIg.id,
        },
      ]
    : igId
      ? [{ value: igId, label: atUsername(identityNames.instagramActor[igId] ?? null) || igId }]
      : [];
  const selectedAccount = accounts.data.find((account) => account.id === metaAccountId);
  const selectedPixel = pixels.data.find((pixel) => pixel.id === pixelId);
  const selectedIdentity = identities.find((row) => row.identity_id === tiktokIdentity);
  const googleOptions = googleAdsAccounts.map((account) => ({
    value: account.id,
    label: account.account_name?.trim() || "Google Ads",
    sublabel: account.google_customer_id,
  }));
  const advertiserName = tiktokAdvertiser
    ? tiktokAccounts.find((row) => row.tiktok_advertiser_id === tiktokAdvertiser)?.account_name?.trim() ||
      identityNames.tiktokAdvertiser[tiktokAdvertiser] ||
      null
    : null;
  const selectedGoogle =
    googleAdsAccounts.find((account) => account.id === googleAccountId) ??
    googleAdsAccounts.find((account) => account.google_customer_id === resolved?.googleAdsCustomer.value) ??
    null;

  useEffect(() => {
    if (googleAccountId || !history?.googleAdsAccountId) return;
    setGoogleAccountId(history.googleAdsAccountId);
  }, [googleAccountId, history?.googleAdsAccountId]);

  const googleCustomerId =
    selectedGoogle?.google_customer_id ?? resolved?.googleAdsCustomer.value ?? null;
  useEffect(() => {
    onIdentity({
      clientId,
      metaAdAccountId: metaAccountId,
      tiktokAdvertiserId: tiktokAdvertiser,
      googleCustomerId,
    });
  }, [onIdentity, clientId, metaAccountId, tiktokAdvertiser, googleCustomerId]);

  function writeSettings(patch: Partial<CampaignSettings>) {
    if (!settings) return;
    onSettings({ ...settings, ...patch });
  }

  function accountName(id: string): string {
    return accounts.data.find((row) => row.id === id)?.name?.trim() || identityNames.metaAdAccount[id] || id;
  }

  function applyAccount(id: string) {
    if (!draft) return;
    onApplyDraft((current) =>
      commitAccountSwitch(current, id, "confirm", { nextAccountName: accountName(id) }),
    );
  }

  function onAccount(id: string) {
    if (!id || !draft) return;
    const impact = accountSwitchImpact(draft);
    if (impact.needsConfirm) {
      setPendingAccountId(id);
      return;
    }
    applyAccount(id);
  }

  async function saveTikTok(nextAdvertiser: string | null, nextIdentity: TikTokIdentityOption | null) {
    if (!tiktokDraftId) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const current = await getTikTokDraft(supabase, tiktokDraftId);
    if (!current) return;
    await upsertTikTokDraft(supabase, tiktokDraftId, {
      ...current,
      userId: user.id,
      accountSetup: {
        ...current.accountSetup,
        advertiserId: nextAdvertiser,
        identityId: nextIdentity?.identity_id ?? current.accountSetup.identityId,
        identityDisplayName: nextIdentity?.display_name ?? current.accountSetup.identityDisplayName,
        identityType:
          (nextIdentity?.identity_type as typeof current.accountSetup.identityType) ??
          current.accountSetup.identityType,
        identityBcId: nextIdentity?.identity_bc_id ?? current.accountSetup.identityBcId,
      },
    });
  }

  async function saveGoogle(accountId: string) {
    if (!googleDraftId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("google_search_plans")
      .update({ google_ads_account_id: accountId })
      .eq("id", googleDraftId);
    if (error) setHistoryError(error.message);
  }

  const pageFace = pageId
    ? identityLabel({
        id: pageId,
        name: pageName,
        noun: "page",
      })
    : null;
  const igUsername = atUsername(linkedIg?.username) || atUsername(selectedPage?.instagramUsername);
  const igFace = igId
    ? identityLabel({
        id: igId,
        name: igUsername || identityNames.instagramActor[igId],
        noun: "Instagram account",
      })
    : null;
  const tiktokName =
    selectedIdentity?.display_name ||
    (tiktokIdentity ? identityNames.tiktokIdentity[tiktokIdentity] : null);
  const tiktokFace = tiktokIdentity
    ? identityLabel({ id: tiktokIdentity, name: tiktokName, noun: "TikTok identity" })
    : null;
  const tiktokAvatar = selectedIdentity
    ? tikTokIdentityFace(selectedIdentity.avatar_url, selectedIdentity.display_name || tiktokName || "")
    : null;
  const accountLabel = metaAccountId
    ? selectedAccount?.name?.trim() || identityNames.metaAdAccount[metaAccountId] || null
    : null;
  const pixelLabel = pixelId
    ? selectedPixel?.name?.trim() || identityNames.metaPixel[pixelId] || null
    : null;
  const pixelFace = pixelId
    ? identityLabel({ id: pixelId, name: pixelLabel, noun: "pixel" })
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardTitle className="flex items-center gap-1">
          Client
          <InfoTip label="The promoter. Accounts follow the value this client has used most, then the saved default." />
        </CardTitle>
        <div className="mt-3">
          <Combobox
            label="Client"
            value={clientId ?? ""}
            onChange={(nextId) => {
              const nextEvent = events.find((event) => event.clientId === nextId);
              onEvent(nextEvent?.id ?? "");
              if (!googleChannelAvailable(nextEvent?.googleCustomerId)) {
                onChannels({ ...channels, google: false });
              }
            }}
            options={clients.map((client) => ({ value: client.id, label: client.name }))}
            placeholder="Select a client"
            emptyText="No matching clients"
          />
        </div>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          Channels
          <InfoTip label="Google appears when this client has a connected Google Ads customer." />
        </CardTitle>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ChannelCard
            platform="meta"
            label="Meta"
            pressed={channels.meta}
            onClick={() => onChannels({ ...channels, meta: !channels.meta })}
          />
          <ChannelCard
            platform="tiktok"
            label="TikTok"
            pressed={channels.tiktok}
            onClick={() => onChannels({ ...channels, tiktok: !channels.tiktok })}
          />
          {googleOk ? (
            <ChannelCard
              platform="google"
              label="Google"
              pressed={channels.google}
              onClick={() => onChannels({ ...channels, google: !channels.google })}
            />
          ) : null}
        </div>
      </Card>

      {channels.meta ? (
        <Card>
          <CardTitle>Meta</CardTitle>
          <div className="mt-3 space-y-4">
            {metaAccountId ? (
              <Face
                imageUrl={null}
                label={accountLabel || `Unknown ad account (${metaAccountId})`}
                caption={metaAccountId}
                unknown={!accountLabel}
                tooltip={accounts.error}
              />
            ) : null}
            <Combobox
              label="Ad account"
              value={metaAccountId ?? ""}
              onChange={onAccount}
              options={accountOptions}
              placeholder="Select an ad account"
              emptyText="No ad accounts"
            />
            {pendingAccountId ? (
              <div className="space-y-2">
                <StatusLine tone="alert" className="text-xs text-destructive">
                  {accountSwitchConfirmCopy(
                    accountSwitchImpact(draft!),
                    accountName(draft?.settings.metaAdAccountId || draft?.settings.adAccountId || ""),
                    accountName(pendingAccountId),
                  )}
                </StatusLine>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                    onClick={() => {
                      applyAccount(pendingAccountId);
                      setPendingAccountId(null);
                    }}
                  >
                    Switch account
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2.5 py-1 text-xs"
                    onClick={() => setPendingAccountId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {pixelId && pixelFace ? (
              <Face
                imageUrl={null}
                label={pixelFace.primary}
                unknown={pixelFace.unknown}
                tooltip={pixels.error}
              />
            ) : null}
            <Combobox
              label="Pixel"
              value={pixelId ?? ""}
              onChange={(id) => writeSettings({ pixelId: id || undefined, metaPixelId: id || undefined })}
              options={pixelOptions}
              placeholder="Select a pixel"
              emptyText="No pixels"
            />
            {pageId && pageFace ? (
              <Face
                imageUrl={selectedPage?.pictureUrl ?? null}
                label={pageFace.primary}
                unknown={pageFace.unknown}
                tooltip={
                  pages.error ??
                  pageIdentity.error ??
                  "This Page was not returned with a name"
                }
              />
            ) : null}
            <Combobox
              label="Facebook Page"
              value={pageId ?? ""}
              onChange={(id) => writeSettings({ metaPageId: id || undefined })}
              options={pageOptions}
              placeholder="Select a Page"
              emptyText="No Pages"
            />
            {igId && igFace ? (
              <Face
                imageUrl={linkedIg?.profilePictureUrl ?? null}
                label={igFace.primary}
                unknown={igFace.unknown}
                tooltip={pageIdentity.error}
              />
            ) : null}
            <Combobox
              label="Instagram"
              value={igId ?? ""}
              onChange={(id) => writeSettings({ metaIGAccountId: id || undefined })}
              options={igOptions}
              placeholder="Select Instagram"
              emptyText="No Instagram account on this Page"
            />
            {accounts.error ? (
              <StatusLine tone="alert" className="text-xs text-destructive">
                {accounts.error}
              </StatusLine>
            ) : null}
          </div>
        </Card>
      ) : null}

      {channels.tiktok ? (
        <Card>
          <CardTitle>TikTok</CardTitle>
          <div className="mt-3 space-y-4">
            {tiktokAdvertiser ? (
              <Face
                imageUrl={null}
                label={advertiserName || `Unknown advertiser (${tiktokAdvertiser})`}
                caption={tiktokAdvertiser}
                unknown={!advertiserName}
                tooltip={null}
              />
            ) : null}
            <Combobox
              label="Advertiser"
              value={tiktokAdvertiser ?? ""}
              onChange={(id) => {
                setTiktokAdvertiser(id);
                const row = identities.find((item) => item.identity_id === tiktokIdentity) ?? null;
                void saveTikTok(id, row);
              }}
              options={tiktokAccounts
                .filter((row) => row.tiktok_advertiser_id)
                .map((row) => ({
                  value: row.tiktok_advertiser_id as string,
                  label: row.account_name || (row.tiktok_advertiser_id as string),
                  sublabel: row.tiktok_advertiser_id as string,
                }))}
              placeholder="Select an advertiser"
              emptyText="No TikTok advertisers"
            />
            {tiktokIdentity && tiktokFace ? (
              <Face
                imageUrl={tiktokAvatar?.kind === "image" ? tiktokAvatar.src : null}
                label={tiktokFace.primary}
                unknown={tiktokFace.unknown}
                tooltip={identityError}
              />
            ) : null}
            <Combobox
              label="Identity"
              value={tiktokIdentity ?? ""}
              onChange={(id) => {
                setTiktokIdentity(id);
                const row = identities.find((item) => item.identity_id === id) ?? null;
                void saveTikTok(tiktokAdvertiser, row);
              }}
              options={identities.map((row) => ({
                value: row.identity_id,
                label: row.display_name || row.identity_id,
              }))}
              placeholder="Select a TikTok identity"
              emptyText="No identities"
            />
            {identityError ? (
              <StatusLine tone="alert" className="text-xs text-destructive">
                {identityError}
              </StatusLine>
            ) : null}
          </div>
        </Card>
      ) : null}

      {channels.google && googleOk ? (
        <Card>
          <CardTitle>Google</CardTitle>
          <div className="mt-3 space-y-3">
            {selectedGoogle ? (
              <Face
                imageUrl={null}
                label={selectedGoogle.account_name?.trim() || "Google Ads"}
                caption={selectedGoogle.google_customer_id}
                unknown={!selectedGoogle.account_name?.trim()}
                tooltip={null}
              />
            ) : null}
            <Combobox
              label="Customer"
              value={selectedGoogle?.id ?? ""}
              onChange={(id) => {
                setGoogleAccountId(id);
                void saveGoogle(id);
              }}
              options={googleOptions}
              placeholder="Select a Google Ads customer"
              emptyText="No Google Ads accounts"
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardTitle className="flex items-center gap-1">
          Event
          <InfoTip label="The show this plan belongs to. The date is the event's show date." />
        </CardTitle>
        <div className="mt-3 space-y-3">
          <Combobox
            label="Event"
            value={eventId}
            onChange={onEvent}
            options={eventOptions}
            placeholder="Select an event"
            emptyText="No matching events"
          />
          <Datum className="text-xs text-muted-foreground">
            Show date {formatPlanEventDate(selectedEvent?.eventDate) ?? "—"}
          </Datum>
          <label className="block text-xs text-muted-foreground">
            Destination URL
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              placeholder="https://"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              onBlur={() => {
                if (destination !== destinationUrl) onDestination(destination);
              }}
            />
          </label>
        </div>
      </Card>

      {historyError ? (
        <StatusLine tone="alert" className="text-xs text-destructive">
          {historyError}
        </StatusLine>
      ) : null}
    </div>
  );
}

function uniqueClients(events: PlanEventOption[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const event of events) {
    if (!event.clientId || seen.has(event.clientId)) continue;
    seen.set(event.clientId, event.clientName?.trim() || "Untitled client");
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function ChannelCard({
  platform,
  label,
  pressed,
  onClick,
}: {
  platform: "meta" | "tiktok" | "google";
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm font-medium transition-colors ${
        pressed ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      <PlatformGlyph platform={platform} />
      {label}
    </button>
  );
}

function Face({
  imageUrl,
  label,
  caption,
  unknown,
  tooltip,
}: {
  imageUrl: string | null;
  label: string;
  caption?: string | null;
  unknown: boolean;
  tooltip: string | null;
}) {
  const initial = unknown ? "?" : identityInitial(label.replace(/^@/, ""));
  return (
    <span className="flex items-center gap-2" title={unknown ? tooltip ?? undefined : undefined}>
      {imageUrl ? (
        // The platform's own profile image. Next/image would require every CDN host.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {initial}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {caption ? <span className="block truncate text-xs text-muted-foreground">{caption}</span> : null}
      </span>
    </span>
  );
}
