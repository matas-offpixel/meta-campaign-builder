import type { ReactNode } from "react";

import {
  mmlSectionDomId,
  mmlSectionMarker,
  type MmlSectionSpec,
} from "@/lib/plan/mml-sections";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * One numbered section of the MML canvas. `numbered={false}` drops the
 * ① marker, for the client share view where some sections are hidden.
 */
export function MmlSection({
  section,
  numbered = true,
  children,
}: {
  section: MmlSectionSpec;
  numbered?: boolean;
  children: ReactNode;
}) {
  const headingId = `${mmlSectionDomId(section.id)}-heading`;
  return (
    <section
      id={mmlSectionDomId(section.id)}
      data-mml-section={section.id}
      aria-labelledby={headingId}
      className="scroll-mt-6 border-t border-border pt-5 first:border-t-0 first:pt-0"
    >
      <h2
        id={headingId}
        className="flex items-center gap-2 font-heading text-base tracking-wide"
      >
        {numbered ? (
          <span aria-hidden="true" className="text-muted-foreground">
            {mmlSectionMarker(section.n)}
          </span>
        ) : null}
        {section.title}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/** Says what the section will hold and which PR brings it. No controls. */
export function MmlPlaceholderCard({ children }: { children: ReactNode }) {
  return (
    <div
      data-mml-placeholder
      className={`rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 ${VIZ_TYPE.body} text-muted-foreground`}
    >
      {children}
    </div>
  );
}
