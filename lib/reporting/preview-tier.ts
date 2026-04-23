/**
 * Which tier of `extractPreview`'s waterfall resolved the preview
 * `image_url`. Kept in a stand-alone file so `CreativePreview` in
 * `active-creatives-group` can reference it without a circular import
 * through `creative-preview-extract`.
 */
export type PreviewTier =
  | "link_data_picture"
  | "video_data_image_url"
  | "top_image_url"
  | "top_thumbnail_url"
  | "child_attachment_cover"
  | "afs_image_url"
  | "afs_video_thumb"
  | "video_id_graph_fallback"
  | "none";
