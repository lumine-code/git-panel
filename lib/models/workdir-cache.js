/** @babel */
import path from "path";
import fs from "fs/promises";

import CompositeGitStrategy from "../composite-git-strategy";
import { toNativePathSep } from "../helpers";

/**
 * Locate the nearest git working directory above a given starting point, caching results.
 */
export default class WorkdirCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.known = new Map();
  }

  async find(startPath) {
    const cached = this.known.get(startPath);
    if (cached !== undefined) {
      return cached;
    }

    const workDir = await this.revParse(startPath);

    if (this.known.size >= this.maxSize) {
      this.known.clear();
    }
    this.known.set(startPath, workDir);

    return workDir;
  }

  invalidate() {
    this.known.clear();
  }

  async revParse(startPath) {
    let startDir;
    try {
      startDir = (await fs.stat(startPath)).isDirectory()
        ? startPath
        : path.dirname(startPath);

      // Within a git worktree, return a non-empty string containing the path to the worktree root.
      // Throw if a gitdir, outside of a worktree, or startDir does not exist.
      const topLevel = await CompositeGitStrategy.create(startDir)
        .exec(["rev-parse", "--show-toplevel"])
        .catch((e) => {
          if (/this operation must be run in a work tree/.test(e.stdErr)) {
            return null;
          }
          throw e;
        });
      if (topLevel !== null) {
        return toNativePathSep(topLevel.trim());
      }

      // Within a gitdir, return the absolute path to the gitdir.
      // Outside of a gitdir or worktree, throw.
      const gitDir = await CompositeGitStrategy.create(startDir).exec([
        "rev-parse",
        "--absolute-git-dir",
      ]);
      return this.revParse(path.resolve(gitDir, ".."));
    } catch (e) {
      if (e.stdErr && /dubious ownership/.test(e.stdErr)) {
        const cmdMatch = e.stdErr.match(/git config --global --add safe\.directory '([^']+)'/);
        const detail = cmdMatch
          ? `To fix this, run:\n\ngit config --global --add safe.directory '${cmdMatch[1]}'`
          : e.stdErr;
        atom.notifications.addError("Git: dubious ownership", {
          description: `Git refused to open the repository at <code>${startDir || startPath}</code> due to a directory ownership mismatch. This commonly occurs when accessing WSL paths from Windows. You can also enable <strong>Allow dubious ownership</strong> in the git-panel settings.`,
          detail,
          dismissable: true,
        });
        return null;
      }
      /* istanbul ignore if */
      if (atom.config.get("git-panel.reportCannotLocateWorkspaceError")) {
        // eslint-disable-next-line no-console
        console.error(
          `Unable to locate git workspace root for ${startPath}. Expected if ${startPath} is not in a git repository.`,
          e,
        );
      }
      return null;
    }
  }
}
