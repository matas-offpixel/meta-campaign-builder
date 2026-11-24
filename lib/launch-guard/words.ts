/**
 * The launch checks' words (design record 2026-11-24-campaign-creator-replicate,
 * RC3). Every string is copied from the record's word list
 * (scratch/campaign-replicate/words-rc-2026-11-24.tsv; a copy sits in
 * __tests__/fixtures and words.test.ts fails on any difference). Braces are
 * values, filled by fill(); "a | b" is one of those, chosen by context in
 * render.ts. Never edit a string here without a new record.
 */

export const LAUNCH_GUARD_WORDS = {
  // Review & launch
  "launch.count.fix": "● {n} to fix before launch",
  // Review & launch
  "launch.count.check": "● {n} to check",
  // Review & launch
  "launch.count.clean": "● Nothing to fix",
  // Review & launch
  "launch.clean.line": "Account, pixel, link and names match {code}.",
  // Review & launch
  "launch.button.blocked": "Launch · {n} to fix",
  // Any check
  "launch.evidence.more": "… and {n} more",
  // Check, blocker
  "pixel_not_venue.key": "Pixel",
  // Check, blocker
  "pixel_not_venue": "Pixel …{last 4} is {venue}’s. {code} is at {event venue} (…{right last 4}).",
  // Check, blocker (event override set)
  "pixel_not_venue.override": "Pixel …{last 4} isn’t the one set for {code} (…{right last 4}).",
  // Check, blocker
  "pixel_not_venue.evidence": "Ad sets: {all n | names}",
  // Check, blocker
  "pixel_not_venue.fix": "Use …{right last 4}",
  // Check, blocker
  "account_not_venue.key": "Account",
  // Check, blocker
  "account_not_venue": "Account {account} isn’t {event venue}’s. {code} runs on {right account}.",
  // Check, blocker (event override set)
  "account_not_venue.override": "Account {account} isn’t the one set for {code} ({right account}).",
  // Check, blocker
  "account_not_venue.evidence": "Campaign: {campaign name}",
  // Check, blocker
  "account_not_venue.fix": "Use {right account}",
  // Check, blocker
  "other_show_reference.key": "Another show",
  // Check, blocker
  "other_show_reference": "Still points to {other show}: {value} in {n} {ads | headlines | primary texts | ad names | audience names}.",
  // Check, blocker
  "other_show_reference.one": "Still points to {other show}: {value} in 1 {ad | headline | primary text | ad name | audience name}.",
  // Check, blocker
  "other_show_reference.evidence": "{Links | Headlines | Primary text | Ad names | Audience names} in: {up to 4 ad names}",
  // Check, blocker
  "other_show_reference.fix": "Show the {n} {ads | …}",
  // Check, blocker
  "name_code_mismatch.key": "Name",
  // Check, blocker
  "name_code_mismatch": "The campaign name says {name code}. This event is {code}.",
  // Check, blocker
  "name_code_mismatch.evidence": "{campaign name}",
  // Check, blocker
  "name_code_mismatch.fix": "Rename to {corrected name}",
  // Check, blocker
  "artist_caption_not_approved.key": "Artist caption",
  // Check, blocker
  "artist_caption_not_approved": "Artist-voice caption with no OK from {artist}’s team: {n} ads.",
  // Check, blocker
  "artist_caption_not_approved.evidence": "Primary text in: {caption labels}",
  // Check, blocker
  "artist_caption_not_approved.fix": "Open captions",
  // Check, warning
  "link_not_event.key": "Link",
  // Check, warning
  "link_not_event": "Link isn’t this event’s page: {url} in {n} ads. The event’s page is {signup url}.",
  // Check, warning
  "link_not_event.evidence": "Set by hand? Mark it in creative setup and this goes.",
  // Check, warning
  "link_not_event.fix": "Use the event’s page · Keep this link",
} as const;

export type LaunchGuardWordKey = keyof typeof LAUNCH_GUARD_WORDS;
