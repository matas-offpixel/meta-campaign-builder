import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectExpectedProvider } from "../venue-classifier.ts";

describe("detectExpectedProvider", () => {
  const eventbriteCases = [
    "O2 Institute",
    "O2 Academy",
    "O2 Shepherd's Bush Empire",
    "O2 City Hall",
    "O2 Academy Glasgow",
    "Kentish Town Forum",
    "O2 Forum Kentish Town",
  ];

  for (const venue of eventbriteCases) {
    it(`classifies ${venue} as Eventbrite`, () => {
      assert.equal(detectExpectedProvider(venue, null), "eventbrite");
    });
  }

  const unknownCases = ["Central Park", "SWG3", "Depot Mayfield"];

  for (const venue of unknownCases) {
    it(`leaves ${venue} unset`, () => {
      assert.equal(detectExpectedProvider(venue, null), null);
    });
  }
});
