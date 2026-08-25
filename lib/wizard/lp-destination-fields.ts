/**
 * Every destination-URL input in the Meta + TikTok launch wizards.
 * Each must mount EventPageDestination (picker + paste). That component
 * no longer exposes page creation — wizards consume URLs.
 * Bulk-attach / umbrella are out of scope (follow-up). A new wizard
 * field that is not listed here will fail the field-coverage guard.
 */
export const WIZARD_DESTINATION_URL_FIELDS = [
  {
    id: "meta-creative-destination-url",
    wizard: "meta",
    file: "components/steps/creatives.tsx",
    label: "Destination URL",
  },
  {
    id: "meta-existing-ig-destination-url",
    wizard: "meta",
    file: "components/steps/creatives.tsx",
    label: "Destination URL (optional)",
  },
  {
    id: "meta-existing-fb-destination-url",
    wizard: "meta",
    file: "components/steps/creatives.tsx",
    label: "Destination URL (optional)",
  },
  {
    id: "tiktok-creative-landing-page-url",
    wizard: "tiktok",
    file: "components/tiktok-wizard/steps/creatives.tsx",
    label: "Landing page URL",
  },
] as const;

export type WizardDestinationUrlFieldId =
  (typeof WIZARD_DESTINATION_URL_FIELDS)[number]["id"];
