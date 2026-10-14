/** @babel */
import path from "node:path";

const imageTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
  [".avif", "image/avif"],
]);

export function imageMimeType(file) {
  if (!file.isPresent() || !file.isRegularFile() || !file.getPath()) return null;
  return imageTypes.get(path.extname(file.getPath()).toLowerCase()) || null;
}

export function hasImagePatch(filePatch) {
  return Boolean(imageMimeType(filePatch.getOldFile()) || imageMimeType(filePatch.getNewFile()));
}

export function imageEndpoints(document, commit) {
  if (document.kind === "commit") {
    const revision = commit?.getSha() || document.sha;
    return {
      old: { endpoint: { type: "commit", revision: `${revision}^1` }, label: "Parent" },
      new: { endpoint: { type: "commit", revision }, label: "Commit" },
    };
  }
  if (document.stagingStatus === "staged") {
    return {
      old: { endpoint: { type: "commit", revision: "HEAD" }, label: "HEAD" },
      new: { endpoint: { type: "index" }, label: "Index" },
    };
  }
  return {
    old: { endpoint: { type: "index" }, label: "Index" },
    new: { endpoint: { type: "worktree" }, label: "Working Tree" },
  };
}
