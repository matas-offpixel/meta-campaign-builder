import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listInvoicesServer } from "@/lib/db/invoicing-server";
import type { InvoiceStatus } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// /api/invoicing/invoices
//
// GET list. Optional filters:
//   ?status=draft|sent|paid|overdue|cancelled
//   ?client_id=<uuid>
//   ?event_id=<uuid>
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "sent",
  "paid",
  "overdue",
  "cancelled",
];

export async function GET(req: NextRequest) {
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

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const clientId = sp.get("client_id");
  const eventId = sp.get("event_id");

  if (status && !INVOICE_STATUSES.includes(status as InvoiceStatus)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid status. One of: ${INVOICE_STATUSES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const invoices = await listInvoicesServer(user.id, {
    status: (status as InvoiceStatus | null) ?? undefined,
    client_id: clientId ?? undefined,
    event_id: eventId ?? undefined,
  });

  return NextResponse.json({ ok: true, invoices });
}
