import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSceneHintPresets } from "../scene-hint-presets.ts";
import {
  CLUSTER_CHOOSER_PROMPT,
  PERSONA_ROW_INTENTIONAL_EMPTY,
  initialAudienceTab,
  resolveInterestPresetSurface,
  shouldShowCollapsedClusterChooser,
} from "../interest-preset-surface.ts";

describe("resolveInterestPresetSurface — new / unclustered group", () => {
  it("renders the category chooser rather than an empty region", () => {
    const surface = resolveInterestPresetSurface({
      clusterType: undefined,
      name: "",
    });
    assert.equal(surface.kind, "cluster-chooser");
    if (surface.kind !== "cluster-chooser") return;
    assert.equal(surface.prompt, CLUSTER_CHOOSER_PROMPT);
    assert.equal(surface.prompt.length > 0, true);
  });

  it("treats a whitespace clusterType as unset", () => {
    const surface = resolveInterestPresetSurface({
      clusterType: "   ",
      name: "Untitled Group",
    });
    assert.equal(surface.kind, "cluster-chooser");
  });
});

describe("resolveInterestPresetSurface — cluster selected", () => {
  it("selecting a cluster surfaces its scene-hint presets", () => {
    const surface = resolveInterestPresetSurface({
      clusterType: "Music & Nightlife",
      name: "",
    });
    assert.equal(surface.kind, "presets");
    if (surface.kind !== "presets") return;
    assert.equal(surface.clusterLabel, "Music & Nightlife");
    assert.ok(surface.sceneHints.length > 0, "Music cluster must have scene-hint chips");
    const fromModule = getSceneHintPresets({
      clusterLabel: "Music & Nightlife",
    });
    assert.deepEqual(
      surface.sceneHints.map((p) => p.id),
      fromModule.map((p) => p.id),
    );
  });

  it("infers a cluster from a named group so presets still appear", () => {
    const surface = resolveInterestPresetSurface({
      name: "Music & Venues",
    });
    assert.equal(surface.kind, "presets");
    if (surface.kind !== "presets") return;
    assert.equal(surface.clusterLabel, "Music & Nightlife");
    assert.ok(surface.sceneHints.length > 0);
  });
});

describe("persona row — missing clusters are labeled, not blank", () => {
  it("Activities & Culture has no personas and says so", () => {
    const surface = resolveInterestPresetSurface({
      clusterType: "Activities & Culture",
      name: "",
    });
    assert.equal(surface.kind, "presets");
    if (surface.kind !== "presets") return;
    assert.equal(surface.personaPresets.length, 0);
    assert.equal(surface.personaEmptyLabel, PERSONA_ROW_INTENTIONAL_EMPTY);
    assert.ok(surface.sceneHints.length > 0, "scene hints still exist for this cluster");
  });

  it("Media & Entertainment has no personas and says so", () => {
    const surface = resolveInterestPresetSurface({
      clusterType: "Media & Entertainment",
      name: "",
    });
    assert.equal(surface.kind, "presets");
    if (surface.kind !== "presets") return;
    assert.equal(surface.personaPresets.length, 0);
    assert.equal(surface.personaEmptyLabel, PERSONA_ROW_INTENTIONAL_EMPTY);
  });

  it("Fashion still ships persona chips (unchanged matching)", () => {
    const surface = resolveInterestPresetSurface({
      clusterType: "Fashion & Streetwear",
      name: "",
    });
    assert.equal(surface.kind, "presets");
    if (surface.kind !== "presets") return;
    assert.ok(surface.personaPresets.length > 0);
    assert.equal(surface.personaEmptyLabel, null);
  });
});

describe("shouldShowCollapsedClusterChooser", () => {
  it("shows the chooser on a collapsed empty unclustered group", () => {
    assert.equal(
      shouldShowCollapsedClusterChooser({
        name: "",
        interests: [],
      }),
      true,
    );
  });

  it("does not show the collapsed chooser once interests exist", () => {
    assert.equal(
      shouldShowCollapsedClusterChooser({
        name: "",
        interests: [{ id: "1" }],
      }),
      false,
    );
  });

  it("does not show the collapsed chooser once a cluster is set", () => {
    assert.equal(
      shouldShowCollapsedClusterChooser({
        name: "",
        clusterType: "Sports & Live Events",
        interests: [],
      }),
      false,
    );
  });
});

describe("initialAudienceTab", () => {
  it("defaults to pages for a blank campaign", () => {
    assert.equal(
      initialAudienceTab({ interestGroups: [], pageGroups: [] }),
      "pages",
    );
  });

  it("defaults to interests when the draft has interest groups and no pages", () => {
    assert.equal(
      initialAudienceTab({
        interestGroups: [{ id: "g1" }],
        pageGroups: [{ pageIds: [] }],
      }),
      "interests",
    );
  });

  it("stays on pages when page audiences already exist", () => {
    assert.equal(
      initialAudienceTab({
        interestGroups: [{ id: "g1" }],
        pageGroups: [{ pageIds: ["123"] }],
      }),
      "pages",
    );
  });
});
