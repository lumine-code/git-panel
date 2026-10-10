/** @babel */
import path from "path";
import PatchDocument from "../lib/models/patch-document";

describe("patch document identity", () => {
  it("round-trips every source kind through the same URI matcher", () => {
    const workdir = path.join(__dirname, "zażółć + percent%2Fproject");
    const documents = [
      PatchDocument.file(workdir, path.join("nested", "a %2F + ż.txt"), "unstaged"),
      PatchDocument.file(workdir, "staged.txt", "staged"),
      PatchDocument.staged(workdir),
      PatchDocument.commit(workdir, "feature/a%2F+ż"),
    ];
    for (const document of documents) {
      const uri = document.getURI();
      expect(PatchDocument.fromURI(uri)).toEqual(document);
      const match = PatchDocument.uriPattern.matches(uri);
      expect(match.ok()).toBe(true);
      expect(match.getURI()).toBe(uri);
      expect(match.getParams()).toEqual({ document });
      expect(Object.isFrozen(document)).toBe(true);
    }
  });

  it("derives titles, permissions and stage from the current source", () => {
    const file = PatchDocument.file(__dirname, "a.txt", "unstaged");
    const staged = PatchDocument.staged(__dirname);
    const commit = PatchDocument.commit(__dirname, "abc");
    expect(file.getTitle()).toBe("Unstaged Changes: a.txt");
    expect(staged.getTitle()).toBe("Staged Changes");
    expect(commit.getTitle()).toBe("Commit: abc");
    expect(file.getStagingStatus()).toBe("unstaged");
    expect(staged.getStagingStatus()).toBe("staged");
    expect(commit.getStagingStatus()).toBeNull();
    expect(file.isReadOnly()).toBe(false);
    expect(staged.isReadOnly()).toBe(false);
    expect(commit.isReadOnly()).toBe(true);
  });

  it("rejects incomplete and unknown patch document URIs", () => {
    for (const uri of [
      "lumine-git://patch/file/unstaged?workdir=repo",
      "lumine-git://patch/file/unknown/a.txt?workdir=repo",
      "lumine-git://patch/commit?workdir=repo",
      "lumine-git://patch/commit/abc/extra?workdir=repo",
      "lumine-git://patch/staged-all/extra?workdir=repo",
      "lumine-git://patch/unknown?workdir=repo",
      "lumine-git://patch/file/unstaged/a.txt",
      "lumine-git://patch/file/unstaged/a.txt?workdir=",
      "lumine-git://file-patch/a.txt?workdir=repo&stagingStatus=unstaged",
      "lumine-git://commit-preview?workdir=repo",
      "lumine-git://commit-detail?workdir=repo&sha=abc",
    ]) {
      expect(PatchDocument.fromURI(uri)).withContext(uri).toBeNull();
      expect(PatchDocument.uriPattern.matches(uri).ok()).withContext(uri).toBe(false);
    }
  });

  it("rejects invalid source descriptors at construction", () => {
    for (const create of [
      () => PatchDocument.file("", "a.txt", "unstaged"),
      () => PatchDocument.file(__dirname, "", "staged"),
      () => PatchDocument.file(__dirname, "a.txt", "unknown"),
      () => PatchDocument.commit(__dirname, ""),
      () => new PatchDocument({ kind: "unknown", workingDirectory: __dirname }),
      () =>
        new PatchDocument({
          kind: "commit",
          workingDirectory: __dirname,
          sha: "abc",
          relPath: "a.txt",
        }),
    ])
      expect(create).toThrowError(TypeError);
  });
});
