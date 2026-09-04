"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TikTokDrawer } from "@/components/plan/tiktok-drawer";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import type { LinkedPlanSummary } from "@/lib/plan/linked-plan";
import { createClient } from "@/lib/supabase/client";
import {
  resolveTikTokDraftIdentityBcIdOnLoad,
  tikTokIdentityBcIdIsServerResolvable,
  type TikTokIdentityBcIdResolution,
} from "@/lib/tiktok-wizard/migrate-draft";
import {
  consumeTikTokTemplateAccountNotice,
} from "@/lib/tiktok-wizard/templates";
import { saveTikTokTemplateToDb } from "@/lib/db/tiktok-templates";
import type { TikTokIdentity } from "@/lib/tiktok/identity";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";
import { useTikTokDraft } from "@/lib/wizard/use-tiktok-draft";

export interface TikTokWizardContext {
  eventName?: string | null;
  eventDate?: string | null;
  clientName?: string | null;
  advertiserName?: string | null;
  eventEditPath?: string | null;
  writesEnabled?: boolean;
  writesDisabledReason?: string | null;
  identityBcIdResolution?: TikTokIdentityBcIdResolution;
  flushPendingSaves?: () => Promise<void>;
  readWorkingDraft?: () => TikTokCampaignDraft;
}

export function TikTokWizardShell({
  draft,
  context,
  linkedPlan = null,
}: {
  draft: TikTokCampaignDraft;
  context?: TikTokWizardContext;
  linkedPlan?: LinkedPlanSummary | null;
}) {
  const router = useRouter();
  const controller = useTikTokDraft(draft.id, draft);
  const [identityBcIdResolution, setIdentityBcIdResolution] =
    useState<TikTokIdentityBcIdResolution>("idle");
  const [templateAccountNotice, setTemplateAccountNotice] = useState<string | null>(
    () => consumeTikTokTemplateAccountNotice(draft.id),
  );
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const identityHealStarted = useRef(false);

  useEffect(() => {
    if (identityHealStarted.current) return;
    const current = controller.draftRef.current;
    if (!tikTokIdentityBcIdIsServerResolvable(current)) return;
    const advertiserId = current.accountSetup.advertiserId;
    if (!advertiserId) return;
    identityHealStarted.current = true;
    setIdentityBcIdResolution("pending");
    void resolveTikTokDraftIdentityBcIdOnLoad({
      draft: current,
      fetchIdentities: async () => {
        const res = await fetch(
          `/api/tiktok/identities?advertiser_id=${encodeURIComponent(advertiserId)}`,
        );
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; identities?: TikTokIdentity[] }
          | null;
        return json?.identities ?? [];
      },
      persist: async (next) => {
        await controller.saveDraft({ accountSetup: next.accountSetup });
      },
    }).then((status) => {
      setIdentityBcIdResolution(status === "resolved" ? "idle" : "unresolved");
    });
  }, [controller]);

  async function handleSaveTemplate(name: string, description: string, tags: string[]) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTemplateSaveError("Not signed in");
      return;
    }
    setTemplateSaving(true);
    setTemplateSaveError(null);
    setTemplateSaveSuccess(false);
    try {
      await saveTikTokTemplateToDb(controller.draftRef.current, name, description, tags, user.id);
      setTemplateSaveSuccess(true);
    } catch (err) {
      setTemplateSaveError(
        err instanceof Error ? err.message : "Unknown error saving template",
      );
    } finally {
      setTemplateSaving(false);
    }
  }

  const wizardContext: TikTokWizardContext = {
    ...context,
    identityBcIdResolution,
    flushPendingSaves: controller.flush,
    readWorkingDraft: () => controller.draftRef.current,
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="border-b border-border bg-card px-6 py-2">
        <div className="mx-auto max-w-5xl">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Campaign Library
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-6 py-6">
        {templateAccountNotice ? (
          <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
            {templateAccountNotice}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setTemplateAccountNotice(null)}
            >
              dismiss
            </button>
          </p>
        ) : null}

        <TikTokDrawer
          open
          variant="page"
          controller={controller}
          planId={linkedPlan?.id ?? null}
          wizardContext={wizardContext}
          onClose={() => router.push("/")}
          doneLabel="Campaign Library"
        />

        {!linkedPlan ? (
          <div className="mt-4">
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline"
              onClick={() => {
                setSaveTemplateOpen(true);
                setTemplateSaveSuccess(false);
                setTemplateSaveError(null);
              }}
            >
              Save as template
            </button>
          </div>
        ) : null}
      </main>

      <SaveTemplateModal
        open={saveTemplateOpen}
        saving={templateSaving}
        savedSuccessfully={templateSaveSuccess}
        error={templateSaveError}
        onClose={() => {
          setSaveTemplateOpen(false);
          setTemplateSaveSuccess(false);
          setTemplateSaveError(null);
        }}
        onSave={handleSaveTemplate}
      />
    </div>
  );
}
