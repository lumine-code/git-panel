/** @babel */
import path from "path";
import { URIPattern, nonURIMatch } from "../lumine/uri-pattern-core";

const pattern = new URIPattern("lumine-git://patch/{kind}/{target...}?workdir={workingDirectory}");
const isText = (value) => typeof value === "string" && value.length > 0 && !value.includes("\0");

// A patch's source is independent of the pane and renderer displaying it.
export default class PatchDocument {
  static file(workingDirectory, relPath, stagingStatus) {
    return new this({ kind: "file", workingDirectory, relPath, stagingStatus });
  }

  static staged(workingDirectory) {
    return new this({ kind: "staged-all", workingDirectory, stagingStatus: "staged" });
  }

  static commit(workingDirectory, sha) {
    return new this({ kind: "commit", workingDirectory, sha });
  }

  static fromURI(uri) {
    const match = pattern.matches(uri);
    return match.ok() ? this.fromParams(match.getParams()) : null;
  }

  static fromParams({ kind, target, workingDirectory } = {}) {
    if (!isText(workingDirectory) || !Array.isArray(target) || !target.every(isText)) return null;
    if (kind === "file" && target.length >= 2 && ["staged", "unstaged"].includes(target[0]))
      return this.file(workingDirectory, path.join(...target.slice(1)), target[0]);
    if (kind === "staged-all" && target.length === 0) return this.staged(workingDirectory);
    if (kind === "commit" && target.length === 1) return this.commit(workingDirectory, target[0]);
    return null;
  }

  static uriPattern = {
    matches(uri) {
      const document = PatchDocument.fromURI(uri);
      return document
        ? {
            ok: () => true,
            getURI: () => uri,
            getParams: () => ({ document }),
          }
        : nonURIMatch;
    },
  };

  constructor({ kind, workingDirectory, relPath = null, stagingStatus = null, sha = null }) {
    if (!isText(workingDirectory)) throw new TypeError("A patch requires a working directory");
    if (kind === "file") {
      if (!isText(relPath) || !["staged", "unstaged"].includes(stagingStatus) || sha !== null)
        throw new TypeError("A file patch requires a path and staging status");
    } else if (kind === "staged-all") {
      if (relPath !== null || sha !== null || stagingStatus !== "staged")
        throw new TypeError("A staged patch contains all staged changes");
    } else if (kind === "commit") {
      if (!isText(sha) || relPath !== null || stagingStatus !== null)
        throw new TypeError("A commit patch requires a revision");
    } else {
      throw new TypeError("Unknown patch document kind");
    }
    this.kind = kind;
    this.workingDirectory = workingDirectory;
    this.relPath = relPath;
    this.stagingStatus = stagingStatus;
    this.sha = sha;
    Object.freeze(this);
  }

  getURI() {
    const target =
      this.kind === "file"
        ? `/${this.stagingStatus}/${encodeURIComponent(this.relPath)}`
        : this.kind === "commit"
          ? `/${encodeURIComponent(this.sha)}`
          : "";
    return `lumine-git://patch/${this.kind}${target}?workdir=${encodeURIComponent(this.workingDirectory)}`;
  }

  getTitle() {
    if (this.kind === "commit") return `Commit: ${this.sha}`;
    const status = this.stagingStatus === "staged" ? "Staged" : "Unstaged";
    return this.kind === "file" ? `${status} Changes: ${this.relPath}` : "Staged Changes";
  }

  getIconName() {
    return this.kind === "commit" ? "git-commit" : this.kind === "staged-all" ? "tasklist" : null;
  }

  getStagingStatus() {
    return this.stagingStatus;
  }

  isReadOnly() {
    return this.kind === "commit";
  }
}
