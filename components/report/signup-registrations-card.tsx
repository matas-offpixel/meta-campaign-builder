import type { RegistrationsCardModel } from "@/lib/dashboard/registrations-card-model";

function fmtInt(n: number): string {
  return n.toLocaleString("en-GB");
}

/**
 * REGISTRATIONS card — Cirqlin counted signups are the primary
 * number when we have a page for the tag. Mailchimp is the
 * secondary line. Cost per signup uses signup-phase spend only.
 */
export function SignupRegistrationsCard({
  model,
}: {
  model: RegistrationsCardModel;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Registrations
      </p>
      <div className="mt-3 space-y-2 text-foreground">
        <p className="font-heading text-xl tracking-wide tabular-nums">
          {model.primary != null ? (
            <>
              {fmtInt(model.primary)}
              {model.primaryCaption ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  {model.primaryCaption}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </p>
        {model.scopeLine ? (
          <p className="text-[11px] text-muted-foreground">{model.scopeLine}</p>
        ) : null}
        {model.cpr ? (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {model.cpr.label}
          </p>
        ) : null}
        {model.mailchimpLine ? (
          <p className="text-[11px] text-muted-foreground">
            {model.mailchimpLine}
          </p>
        ) : null}
        {model.syncFailureLine ? (
          <p className="text-[11px] text-muted-foreground">
            {model.syncFailureLine}
          </p>
        ) : null}
        {model.windowLine ? (
          <p className="text-[11px] text-muted-foreground">
            {model.windowLine}
          </p>
        ) : null}
        {model.fallbackLine ? (
          <p className="text-[11px] text-muted-foreground">
            {model.fallbackLine}
          </p>
        ) : null}
      </div>
    </div>
  );
}
