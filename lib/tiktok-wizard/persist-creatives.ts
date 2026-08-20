import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";
import {
  appendUploadedTikTokCreatives,
  type TikTokUploadedCreativeInput,
} from "./creative-items.ts";

export async function commitUploadedTikTokCreatives(input: {
  readItems: () => TikTokCreativeDraft[];
  writeItems: (items: TikTokCreativeDraft[]) => Promise<void>;
  upload: TikTokUploadedCreativeInput;
  baseName: string;
  adText: string;
  displayName: string;
  landingPageUrl: string;
  cta: string;
  newId?: () => string;
}): Promise<TikTokCreativeDraft[]> {
  const items = appendUploadedTikTokCreatives({
    existing: input.readItems(),
    uploads: [input.upload],
    baseName: input.baseName,
    adText: input.adText,
    displayName: input.displayName,
    landingPageUrl: input.landingPageUrl,
    cta: input.cta,
    newId: input.newId,
  });
  await input.writeItems(items);
  return input.readItems();
}
