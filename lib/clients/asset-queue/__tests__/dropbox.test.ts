import { isDropboxFolderUrl, toDirectDownloadUrl } from "../dropbox";

describe("isDropboxFolderUrl", () => {
  it("returns true for /scl/fo/ (folder) URLs", () => {
    expect(isDropboxFolderUrl("https://www.dropbox.com/scl/fo/abc123/key?rlkey=xyz")).toBe(true);
    expect(isDropboxFolderUrl("https://www.dropbox.com/scl/fo/test")).toBe(true);
  });

  it("returns false for /scl/fi/ (single file) URLs", () => {
    expect(isDropboxFolderUrl("https://www.dropbox.com/scl/fi/abc123/file.mp4?rlkey=xyz")).toBe(false);
  });

  it("returns false for legacy /s/ URLs", () => {
    expect(isDropboxFolderUrl("https://www.dropbox.com/s/abc123?dl=0")).toBe(false);
  });

  it("returns false for direct CDN URLs", () => {
    expect(isDropboxFolderUrl("https://dl.dropboxusercontent.com/s/abc123/file.mp4")).toBe(false);
  });
});

describe("toDirectDownloadUrl", () => {
  it("appends ?dl=1 to a share link", () => {
    const url = toDirectDownloadUrl("https://www.dropbox.com/scl/fi/abc/file.mp4?rlkey=xyz");
    expect(url).toContain("dl=1");
  });

  it("replaces existing ?dl=0 with ?dl=1", () => {
    const url = toDirectDownloadUrl("https://www.dropbox.com/s/abc?dl=0");
    expect(url).toContain("dl=1");
    expect(url).not.toContain("dl=0");
  });

  it("returns CDN URLs unchanged", () => {
    const cdn = "https://dl.dropboxusercontent.com/s/abc/file.mp4";
    expect(toDirectDownloadUrl(cdn)).toBe(cdn);
  });

  it("returns malformed URLs as-is", () => {
    expect(toDirectDownloadUrl("not-a-url")).toBe("not-a-url");
  });
});
