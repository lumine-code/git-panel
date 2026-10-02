/** @babel */
import path from "path";

export function metadataDirectories(repository) {
  return [
    ...new Set(
      [repository.getGitDirectoryPath?.(), repository.getCommonDirectoryPath?.()]
        .filter(Boolean)
        .map((directory) => path.normalize(directory)),
    ),
  ];
}

export function containsPath(directory, target) {
  const root = path.normalize(directory);
  const candidate = path.normalize(target);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(prefix);
}

export function relativeMetadataPath(directories, target) {
  let closest = null;
  for (const directory of directories) {
    if (
      containsPath(directory, target) &&
      (closest === null || directory.length > closest.length)
    ) {
      closest = directory;
    }
  }
  return closest === null ? null : path.relative(closest, target);
}

export function isRefPath(relative) {
  return Boolean(
    (relative === "refs" || relative?.startsWith(`refs${path.sep}`)) &&
    !relative.split(path.sep).some((component) => component.endsWith(".lock")),
  );
}

export function isWatchedMetadataPath(relative) {
  return (
    ["config", "config.worktree", "index", "HEAD", "MERGE_HEAD", "packed-refs"].includes(
      relative,
    ) ||
    isRefPath(relative) ||
    isPublishedReftablePath(relative)
  );
}

export function isPublishedReftablePath(relative) {
  return relative === "reftable" || relative === path.join("reftable", "tables.list");
}
