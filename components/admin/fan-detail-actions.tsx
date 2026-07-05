"use client";

import { useState } from "react";

import {
  anonymizeFanSignup,
  softDeleteFanSignup,
} from "@/lib/actions/fan-signups";
import { AdminButton } from "@/components/admin/ui/button";

/**
 * components/admin/fan-detail-actions.tsx — the Danger Zone for the fan
 * detail view (OP909 PR 6). Delete (soft) and Anonymise (irreversible) each
 * open a Supreme-styled confirm dialog before submitting the matching server
 * action. Both post the signup id + a same-origin redirect back to the list.
 */

type Pending = "delete" | "anonymize" | null;

export function FanDetailActions({
  signupId,
  listHref,
  disabled,
}: {
  signupId: string;
  listHref: string;
  disabled: boolean;
}) {
  const [pending, setPending] = useState<Pending>(null);

  if (disabled) {
    return (
      <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#999]">
        This fan has been removed — no further actions.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <AdminButton variant="secondary" onClick={() => setPending("anonymize")}>
        anonymise
      </AdminButton>
      <AdminButton variant="destructive" onClick={() => setPending("delete")}>
        delete
      </AdminButton>

      {pending && (
        <ConfirmDialog
          kind={pending}
          signupId={signupId}
          listHref={listHref}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

const COPY: Record<
  Exclude<Pending, null>,
  { title: string; body: string; confirm: string; action: typeof softDeleteFanSignup }
> = {
  delete: {
    title: "Delete this signup?",
    body: "The row is hidden from your fan table, exports and analytics. It's a soft delete — the record is kept so a re-signup still de-dupes.",
    confirm: "delete signup",
    action: softDeleteFanSignup,
  },
  anonymize: {
    title: "Anonymise this fan?",
    body: "This permanently erases the email, phone, social handles and attribution for this signup. It cannot be undone. Aggregate stats (country, dates) are kept. Use this for a GDPR erasure request.",
    confirm: "anonymise permanently",
    action: anonymizeFanSignup,
  },
};

function ConfirmDialog({
  kind,
  signupId,
  listHref,
  onCancel,
}: {
  kind: Exclude<Pending, null>;
  signupId: string;
  listHref: string;
  onCancel: () => void;
}) {
  const copy = COPY[kind];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <div className="w-full max-w-md border-[0.5px] border-black bg-white p-6">
        <h2 className="admin-heading text-[20px] leading-tight">{copy.title}</h2>
        <p className="mt-3 font-[family-name:var(--admin-mono)] text-[12px] leading-relaxed text-[#444]">
          {copy.body}
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <AdminButton variant="secondary" type="button" onClick={onCancel}>
            cancel
          </AdminButton>
          <form action={copy.action}>
            <input type="hidden" name="signup_id" value={signupId} />
            <input type="hidden" name="redirect_to" value={listHref} />
            <AdminButton variant="destructive" type="submit">
              {copy.confirm}
            </AdminButton>
          </form>
        </div>
      </div>
    </div>
  );
}
