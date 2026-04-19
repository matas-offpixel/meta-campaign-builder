import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  buildInvoicePatch,
  getInvoiceById,
  updateInvoice,
} from "@/lib/db/invoicing-server";
import type { InvoiceStatus } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/invoicing/invoices/[id]
//
// Allowed fields: status, issued_date, due_date, paid_date, notes.
//
// Status transitions:
//   draft → sent | cancelled
//   sent  → paid | overdue | cancelled
//   paid / overdue / cancelled → cancelled (lets users undo accidental edits)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["paid", "overdue", "cancelled"],
  paid: ["cancelled"],
  overdue: ["paid", "cancelled"],
  cancelled: [],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const existing = await getInvoiceById(id);
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const patch = buildInvoicePatch(body as Record<string, unknown>);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No updatable fields. Allowed: status, issued_date, due_date, paid_date, notes.",
      },
      { status: 400 },
    );
  }

  if (patch.status) {
    const next = patch.status as InvoiceStatus;
    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(next) && next !== existing.status) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot transition ${existing.status} → ${next}.`,
        },
        { status: 400 },
      );
    }
    // Convenience side-effects so the UI can flip status without also
    // sending the date — keeps the inline "Mark sent / paid" buttons trivial.
    if (next === "sent" && !patch.issued_date && !existing.issued_date) {
      patch.issued_date = new Date().toISOString().slice(0, 10);
    }
    if (next === "paid" && !patch.paid_date && !existing.paid_date) {
      patch.paid_date = new Date().toISOString().slice(0, 10);
    }
  }

  try {
    const updated = await updateInvoice(id, patch);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Update returned no row" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, invoice: updated });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Update failed.",
      },
      { status: 500 },
    );
  }
}
