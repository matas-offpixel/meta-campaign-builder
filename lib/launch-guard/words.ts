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
  "account_not_venue": "Account {Meta account name} ({venue}) isn’t {event venue}’s. {code} runs on {right Meta account name} ({event venue}).",
  // Check, blocker (event override set)
  "account_not_venue.override": "Account {Meta account name} ({venue}) isn’t the one set for {code}: {right Meta account name}.",
  // Check, blocker
  "account_not_venue.evidence": "Campaign: {campaign name}",
  // Check, blocker
  "account_not_venue.fix": "Use {right Meta account name}",
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
  "other_show_reference.fix.one": "Show the {ad | headline | …}",
  // Check, blocker
  "name_code_mismatch.key": "Name",
  // Check, blocker
  "name_code_mismatch": "The campaign name says {full code in the name}. This event is {full event code}.",
  // Check, blocker
  "name_code_mismatch.evidence": "{campaign name}",
  // Check, blocker
  "name_code_mismatch.fix": "Rename to {corrected name}",
  // Check, blocker
  "artist_caption_not_approved.key": "Artist caption",
  // Check, blocker
  "artist_caption_not_approved": "Artist-voice caption with no OK from {artist}’s team: {n} ads.",
  // Check, blocker
  "artist_caption_not_approved.one": "Artist-voice caption with no OK from {artist}’s team: 1 ad.",
  // Check, blocker
  "artist_caption_not_approved.evidence": "Primary text in: {caption labels}",
  // Check, blocker
  "artist_caption_not_approved.fix": "Open captions",
  // Check, warning
  "link_not_event.key": "Link",
  // Check, warning
  "link_not_event": "Link isn’t this event’s page: {url} in {n} ads. The event’s page is {signup url}.",
  // Check, warning
  "link_not_event.one": "Link isn’t this event’s page: {url} in 1 ad. The event’s page is {signup url}.",
  // Check, warning
  "link_not_event.evidence": "Set by hand? Mark it in creative setup and this goes.",
  // Check, warning
  "link_not_event.fix": "Use the event’s page · Keep this link",
  // Review & launch, under the list
  "link_not_event.kept": "Link kept by {name}, {date, time}: {url}",
  // Check, warning
  "identity_not_live.key": "Live ads",
  // Check, warning
  "identity_not_live": "This draft runs from {draft page}; the live ads run from {live page}. Relaunching uses the draft’s.",
  // Check, warning
  "identity_not_live.instagram": "This draft runs on Instagram as @{draft handle}; the live ads run as @{live handle}. Relaunching uses the draft’s.",
  // Check, warning
  "identity_not_live.evidence": "Read from the live ads at {date, time}: {n} ads",
  // Check, warning
  "identity_not_live.evidence.one": "Read from the live ads at {date, time}: 1 ad",
  // Check, warning
  "identity_not_live.fix": "Use the live ads’ page: {live page}",
  // Check, warning
  "identity_not_live.instagram.fix": "Use the live ads’ Instagram: @{live handle}",
  // Check, warning
  "identity_not_live.keep": "Keep {draft page}",
  // Check, warning
  "identity_not_live.instagram.keep": "Keep @{draft handle}",
  // Review & launch, under the list
  "identity_not_live.kept": "Page kept by {name}, {date, time}: {draft page}",
  // Review & launch, under the list
  "identity_not_live.instagram.kept": "Instagram kept by {name}, {date, time}: @{draft handle}",
  // Any Instagram value Meta won’t give a username for, in place of @{handle}
  "identity.instagram.unnamed": "account {id}",
  // Check, blocker (live ads’ page known, not another client’s)
  "page_other_client.fix.live": "Use the live ads’ page: {live page}",
  // Check, blocker (live ads’ Instagram known, not another client’s)
  "page_other_client.instagram.fix.live": "Use the live ads’ Instagram: @{live handle}",
  // Check, blocker (live ads’ page known)
  "page_other_client.evidence.live": "Ads: all {n} · the live ads run from {live page}",
  // Check, blocker (live ads’ Instagram known)
  "page_other_client.instagram.evidence.live": "Ads: all {n} · the live ads run as @{live handle}",
  // Check, blocker
  "page_other_client.key": "Page",
  // Check, blocker
  "page_other_client": "Ads run from {page}, which is {other client}’s page. {code} is {client}’s show.",
  // Check, blocker
  "page_other_client.instagram.key": "Instagram",
  // Check, blocker
  "page_other_client.instagram": "Ads run on Instagram as @{handle}, {other client}’s account. {code} is {client}’s show.",
  // Check, blocker
  "page_other_client.evidence": "Ads: all {n} | {n} ads: {up to 4 ad names}",
  // Check, blocker
  "page_other_client.fix": "Change the page",
  // Check, blocker
  "page_other_client.instagram.fix": "Change the Instagram account",
  // Check, warning (blocker once every venue is set)
  "venue_not_set.key": "Venue",
  // Check, warning
  "venue_not_set": "{venue} has no account or pixel stored, so this draft’s account and pixel can’t be checked. Set them on the venue card.",
  // Check, warning
  "venue_not_set.account": "{venue} has no account stored, so this draft’s account can’t be checked. Set it on the venue card.",
  // Check, warning
  "venue_not_set.pixel": "{venue} has no pixel stored, so this draft’s pixel can’t be checked. Set it on the venue card.",
  // Check, warning
  "venue_not_set.evidence": "Until every venue is set, this is a warning.",
  // Check, warning
  "venue_not_set.fix": "Open the venue card",
} as const;

export type LaunchGuardWordKey = keyof typeof LAUNCH_GUARD_WORDS;
