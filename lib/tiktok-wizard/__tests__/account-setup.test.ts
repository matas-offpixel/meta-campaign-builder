import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  formatTikTokIdentityUsername,
  nextManualIdentityHatchOpen,
  shouldOpenManualIdentityHatch,
  tikTokIdentityFace,
  tikTokIdentityInitial,
  tikTokIdentityOptionView,
} from "../account-setup.ts";

const RESOLVED = {
  identityFailed: false,
  identitiesLength: 1,
  selectedIdentityNeedsType: false,
  loadingDetails: false,
  identitiesLoaded: true,
  hasAdvertiser: true,
} as const;

describe("ManualIdentityHatch — collapsed unless identity is unresolved", () => {
  it("stays collapsed when an identity resolved, on both surfaces", () => {
    assert.equal(shouldOpenManualIdentityHatch(RESOLVED), false);

    const src = readFileSync(
      new URL("../../../components/tiktok-wizard/steps/account-setup.tsx", import.meta.url),
      "utf8",
    );
    const hatchAt = src.indexOf("function ManualIdentityHatch");
    assert.ok(hatchAt > 0, "ManualIdentityHatch is missing");
    const hatch = src.slice(hatchAt, src.indexOf("function TikTokIdentityPicker"));
    assert.doesNotMatch(
      hatch,
      /useIsDrawer/,
      "the hatch must not ask whether it is in a drawer",
    );
    assert.doesNotMatch(
      hatch,
      /if \(!drawer\)/,
      "#924 regression: wizard surface must not dump the hatch open",
    );
    assert.match(hatch, /useState\(autoOpen\)/);
    assert.match(hatch, /operatorTouched/);
    assert.match(hatch, /nextManualIdentityHatchOpen/);
    assert.doesNotMatch(
      hatch,
      /if \(autoOpen\) setOpen\(true\)/,
      "the effect must follow autoOpen both ways, not only open",
    );

    const wizard = readFileSync(
      new URL("../../../components/tiktok-wizard/wizard-shell.tsx", import.meta.url),
      "utf8",
    );
    const drawer = readFileSync(
      new URL("../../../components/plan/tiktok-drawer-details.tsx", import.meta.url),
      "utf8",
    );
    assert.match(wizard, /AccountSetupStep surface="wizard"/);
    assert.match(drawer, /AccountSetupStep surface="drawer"/);
    assert.match(src, /shouldOpenManualIdentityHatch/);
    assert.match(
      src,
      /useState\(\s*Boolean\(draft\.accountSetup\.advertiserId\)/,
      "loadingDetails must start true when an advertiser is already on the draft",
    );
    assert.match(src, /identitiesLoaded/);
    assert.doesNotMatch(
      src,
      /Selected advertiser/,
      "the advertiser id echo box must be gone",
    );
    assert.doesNotMatch(src, /function ReadOnlySummary/);
  });

  it("auto-opens only on the unresolved-identity states", () => {
    assert.equal(
      shouldOpenManualIdentityHatch({ ...RESOLVED, identityFailed: true }),
      true,
    );
    assert.equal(
      shouldOpenManualIdentityHatch({ ...RESOLVED, identitiesLength: 0 }),
      true,
    );
    assert.equal(
      shouldOpenManualIdentityHatch({
        ...RESOLVED,
        selectedIdentityNeedsType: true,
      }),
      true,
    );
    assert.equal(
      shouldOpenManualIdentityHatch({
        ...RESOLVED,
        identitiesLength: 0,
        loadingDetails: true,
      }),
      false,
      "empty while loading is not unresolved yet",
    );
    assert.equal(
      shouldOpenManualIdentityHatch({
        ...RESOLVED,
        identitiesLength: 0,
        identitiesLoaded: false,
        loadingDetails: false,
      }),
      false,
      "empty before the request is not a claim",
    );
    assert.equal(
      shouldOpenManualIdentityHatch({
        ...RESOLVED,
        identitiesLength: 0,
        hasAdvertiser: false,
      }),
      false,
      "no advertiser yet is not an unresolved identity",
    );
  });

  it("follows autoOpen both ways until the operator touches the hatch", () => {
    let open = nextManualIdentityHatchOpen({
      autoOpen: false,
      operatorTouched: false,
      currentlyOpen: false,
    });
    open = nextManualIdentityHatchOpen({
      autoOpen: true,
      operatorTouched: false,
      currentlyOpen: open,
    });
    open = nextManualIdentityHatchOpen({
      autoOpen: false,
      operatorTouched: false,
      currentlyOpen: open,
    });
    assert.equal(open, false, "false → true → false leaves the hatch closed");

    const operatorOpened = nextManualIdentityHatchOpen({
      autoOpen: false,
      operatorTouched: true,
      currentlyOpen: true,
    });
    assert.equal(
      operatorOpened,
      true,
      "an operator-opened hatch stays open when autoOpen goes false",
    );
  });
});

describe("TikTok identity option — a face, then a name", () => {
  it("renders avatar_url when present and the fallback chip when null", () => {
    const withFace = tikTokIdentityOptionView({
      display_name: "Ironworks",
      avatar_url: "https://p16-sign.tiktokcdn-us.com/ironworks.jpg",
      identity_type: "BC_AUTH_TT",
      username: "ironworkslondon",
    });
    assert.deepEqual(withFace.face, {
      kind: "image",
      src: "https://p16-sign.tiktokcdn-us.com/ironworks.jpg",
    });
    assert.equal(withFace.label, "Ironworks");
    assert.equal(withFace.caption, "@ironworkslondon");
    assert.equal(withFace.typeTooltip, "BC_AUTH_TT");
    assert.equal(formatTikTokIdentityUsername("@ironworkslondon"), "@ironworkslondon");

    const missing = tikTokIdentityOptionView({
      display_name: "Ironworks",
      avatar_url: null,
      identity_type: "BC_AUTH_TT",
    });
    assert.deepEqual(missing.face, { kind: "chip", initial: "I" });
    assert.equal(missing.caption, null);
    assert.equal(tikTokIdentityInitial(""), "?");
    assert.deepEqual(tikTokIdentityFace("   ", "Ironworks"), {
      kind: "chip",
      initial: "I",
    });

    const src = readFileSync(
      new URL("../../../components/tiktok-wizard/steps/account-setup.tsx", import.meta.url),
      "utf8",
    );
    assert.match(src, /tikTokIdentityOptionView/);
    assert.match(src, /data-identity-face="image"/);
    assert.match(src, /data-identity-face="chip"/);
    assert.match(src, /view\.caption/);
    assert.match(src, /view\.typeTooltip/);
    assert.doesNotMatch(
      src,
      /display_name\} · \$\{identity\.identity_type/,
      "type must not be welded into the identity label",
    );
    assert.doesNotMatch(
      src,
      /view\.typeCaption/,
      "the row caption is the username, not the authorisation enum",
    );
  });
});
