/** Stable signature for “fetch settled for this campaign set + video id set”. */
export function videoPickerAutoSelectSignature(
  campaignKey: string,
  videoIds: string[],
): string {
  return `${campaignKey}|${videoIds.slice().sort().join(",")}`;
}
