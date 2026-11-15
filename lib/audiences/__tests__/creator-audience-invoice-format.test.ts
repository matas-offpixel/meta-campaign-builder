import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPixelAudienceName } from "../creator-audience.ts";

/** Electric's invoice format, agreed 13 Oct 2026:
 *  `YYMMDD Event Name | [CODE] <suffix>` — the code is no longer first. */
describe("defaultPixelAudienceName with the invoice campaign format", () => {
  it("finds the event code after a YYMMDD prefix", () => {
    const name = defaultPixelAudienceName({
      campaignName: "261023 Folamour | [NX26-FOLAMOUR] FOLAMOUR - On sale",
      retentionDays: 30,
      pixelEvent: "CompleteRegistration",
    });
    assert.ok(
      name.includes("NX26-FOLAMOUR"),
      `expected the event code in the audience name, got ${name}`,
    );
  });

  it("still finds it in the old leading-bracket format", () => {
    const name = defaultPixelAudienceName({
      campaignName: "[NX26-FOLAMOUR] FOLAMOUR - Signup",
      retentionDays: 30,
      pixelEvent: "CompleteRegistration",
    });
    assert.ok(name.includes("NX26-FOLAMOUR"), name);
  });

  it("falls back to client scope when there is no code at all", () => {
    const name = defaultPixelAudienceName({
      campaignName: "Schak - Nanna Makina",
      retentionDays: 30,
      pixelEvent: "CompleteRegistration",
    });
    // Client scope still brackets the client name — what matters is that
    // no event code was invented from a campaign that carries none.
    assert.ok(!/[A-Z]{2,4}\d{2}-[A-Z0-9]+/.test(name), name);
    assert.ok(name.includes("Schak - Nanna Makina"), name);
  });
});
