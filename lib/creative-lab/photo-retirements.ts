/**
 * Press photos retired for an event: scripts/artist-card.mts refuses them in --pick and leaves them out of --scan.
 * Nothing in Storage, Drive or the database changes; the rows stay, for other events and for the record.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

export type PhotoRetirement = { eventCode: string; assetIds: readonly string[]; ruledBy: string; ruledOn: string; why: string };

// Ruled by Matas 18 Nov 2026: Luke Dean's management asked that only their new press photos (18 Nov) be used on
// P26-BDAY. These are the 35 photos imported on 9 Nov ("Photo 14-06-2026, …"). The two name lockups
// (LUKE_DEAN_BLK.png 29c71d59…, LUKE_DEAN_WHT.png e0b55973…) are not photos and stay usable.
export const PHOTO_RETIREMENTS: readonly PhotoRetirement[] = [
  {
    eventCode: "P26-BDAY",
    ruledBy: "Matas",
    ruledOn: "2026-11-18",
    why: "Luke Dean's management: only the 18 Nov press photos",
    assetIds: [
      "c10cf36c-8494-417a-8b6a-278c008b21a5", "452f9c7e-985e-4410-b759-85586db5f9ab", "0d0a32c1-6937-469a-bf03-bd9384565457",
      "3d1c0ce0-f624-4943-b991-6cb42effb72e", "23cb676e-054a-459a-9419-86ca5a7fbb9b", "025588f1-8226-45f7-91de-0bd2a5cb73b5",
      "f39ee9a9-32d7-4ed2-ad4b-bca73e8ebcf1", "6e6647c2-e03c-43f7-a422-6b3c5ff75261", "9eaeb309-4005-4e06-951e-e5159318b977",
      "b2859257-c977-42b0-9ab5-42370428e8ce", "fea0e08c-6c95-427c-9005-5c340b305d55", "f05853cd-88e8-46d7-ac6c-21a1aef7fcba",
      "3b14fdb5-7dd8-4936-850b-57d9e4bc7d0a", "e5ce064c-cf31-448e-b4ec-4a8df48c0005", "e86f53e2-3f69-473b-bc40-a4072698c850",
      "af899888-4c01-45ff-b670-1e79321dca2a", "4f765770-eb76-433c-aa52-c93177abcb8d", "2a5fcf27-10c0-449c-b9e0-4358edf3527c",
      "16c25423-51e5-4f31-8e4e-ebad5abee305", "8233a5d6-93eb-4f82-847d-d9af9fb298cf", "4431a940-ea24-451a-83c3-df785ab64409",
      "a669bfc0-1788-4e24-860d-f7c90897b68b", "29fb29e4-f632-44bc-9769-972f14ca8577", "0a3221a3-687d-4104-ba7f-cc43ccd922eb",
      "0949fff3-98b2-4b3e-8188-0b26f9d9b73f", "338ae5e0-d6ab-47ad-9877-088fa28f8b6d", "b0966173-f476-44a8-97f0-52b993914d44",
      "1b8adbdb-ba97-4b80-80f3-bb16e95480d1", "238bd0fe-56e7-4504-be4c-9dedd7cbb169", "c89eb13d-87da-4d3f-824d-1f06d8daac57",
      "c4ab18d7-4679-49f2-a4e7-d2cd01a31905", "2fa09211-ae1e-49a0-bcfa-5682ab3cdbfa", "0043e555-a87b-4b44-996a-51e4fc4298cd",
      "2d8bbf38-f9ae-45ab-ab71-5bf97052c395", "a6b60858-1d58-4f38-8c97-f699e1fa4eae",
    ],
  },
];

export function photoRetirement(eventCode: string, assetId: string, list: readonly PhotoRetirement[] = PHOTO_RETIREMENTS): PhotoRetirement | null {
  return list.find((row) => row.eventCode === eventCode && row.assetIds.includes(assetId)) ?? null;
}

export function retiredLine(r: PhotoRetirement): string {
  return `This photo is retired for ${r.eventCode} (${r.ruledBy}, ${r.ruledOn}: ${r.why}) — use one of the new press photos`;
}
