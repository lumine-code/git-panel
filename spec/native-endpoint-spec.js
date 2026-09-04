/** @babel */

import GitShellOutStrategy from "../lib/git-shell-out-strategy";

describe("native Git endpoints", () => {
  let strategy;

  beforeEach(() => {
    strategy = new GitShellOutStrategy("/repo");
  });

  afterEach(() => {
    strategy.destroy();
  });

  it("uses an algorithm-neutral empty endpoint for an unborn staged diff", async () => {
    const repository = {
      getStatusSnapshot: () => ({ initialized: true, head: { unborn: true } }),
    };

    expect(await strategy.diffEndpoints(repository, { staged: true })).toEqual({
      from: { type: "empty" },
      to: { type: "index" },
    });
  });

  it("reads stage zero through the explicit index-file API", async () => {
    const getIndexFile = jasmine
      .createSpy("getIndexFile")
      .and.returnValue(Promise.resolve("index contents\n"));
    strategy.getCoreRepository = () => Promise.resolve({ getIndexFile });

    expect(await strategy.readFileFromIndex("a.txt")).toBe("index contents\n");
    expect(getIndexFile).toHaveBeenCalledWith("a.txt");
  });

  it("diffs a root commit from empty without assuming an object-id algorithm", async () => {
    const sha256 = "a".repeat(64);
    const getDiff = jasmine
      .createSpy("getDiff")
      .and.returnValue(Promise.resolve({ schemaVersion: 1, files: [] }));
    strategy.getCoreRepository = () =>
      Promise.resolve({
        getCommits: () =>
          Promise.resolve({
            commits: [
              {
                sha: sha256,
                parents: [],
                subject: "root",
                body: "root\n",
                author: { name: "Author", email: "author@example.com", date: new Date(0) },
              },
            ],
          }),
        getDiff,
      });

    await strategy.getCommits({ includePatch: true });

    expect(getDiff).toHaveBeenCalledWith({
      from: { type: "empty" },
      to: { type: "commit", revision: sha256 },
      detectRenames: false,
      format: "structured",
    });
  });

  it("does not label an unknown revision as an unborn branch", async () => {
    strategy.getCoreRepository = () =>
      Promise.resolve({
        getCommits: () => Promise.resolve({ commits: [] }),
        getStatusSnapshot: () => ({ initialized: true, head: { unborn: false } }),
      });

    expect(await strategy.getCommit("missing")).toBeUndefined();
  });

  it("retains the unborn sentinel when HEAD does not exist", async () => {
    strategy.getCoreRepository = () =>
      Promise.resolve({
        getCommits: () => Promise.resolve({ commits: [] }),
        getStatusSnapshot: () => ({ initialized: true, head: { unborn: true } }),
      });

    expect(await strategy.getHeadCommit()).toEqual({ sha: "", message: "", unbornRef: true });
  });

  it("treats a raced createBlob source like the former Git file error", async () => {
    const missing = new Error("unable to read blob source file");
    missing.code = "ERR_GIT_CREATE_BLOB";
    strategy.runRepositoryOperation = () => Promise.reject(missing);

    expect(await strategy.createBlob({ filePath: "gone.txt" })).toBeNull();
  });

  it("does not hide unrelated createBlob failures", async () => {
    const failure = new Error("object database is read-only");
    failure.code = "ERR_GIT_COMMAND_FAILED";
    strategy.runRepositoryOperation = () => Promise.reject(failure);

    await expectAsync(strategy.createBlob({ filePath: "a.txt" })).toBeRejectedWith(failure);
  });
});
