/** @babel */
// Unit coverage for the discard-history blob choreography, with the git
// primitives injected as fakes — no repository needed.
import path from "path";
import DiscardHistory from "../lib/models/discard-history";

describe("DiscardHistory", () => {
  function buildHistory({ createBlob, expandBlobToFile, mergeFile, workdir = "/workdir" } = {}) {
    return new DiscardHistory(
      createBlob || (async () => "created-sha"),
      expandBlobToFile || (async (filePath) => filePath),
      mergeFile || (async () => ({ conflict: false })),
      workdir,
    );
  }

  it("hashes each file only once while undoing a discarded deletion", async () => {
    const createBlobCalls = [];
    const history = buildHistory({
      createBlob: async ({ filePath }) => {
        createBlobCalls.push(filePath);
        return "sha-after";
      },
    });
    // A discard that restored a deleted file: no before blob, only after.
    history.updateHistory({
      wholeFileHistory: [{ "a.txt": { beforeSha: null, afterSha: "sha-after" } }],
    });

    const results = await history.restoreLastDiscardInTempFiles(() => true);

    expect(results.length).toBe(1);
    expect(results[0].deleted).toBe(true);
    expect(results[0].conflict).toBe(false);
    expect(results[0].currentSha).toBe("sha-after");
    // The current working copy is hashed exactly once; the deleted-file branch
    // reuses that sha instead of hashing the same file a second time.
    expect(createBlobCalls).toEqual(["a.txt"]);
  });

  it("expands the before and after blobs in parallel", async () => {
    const started = [];
    let releaseExpands;
    const expandGate = new Promise((resolve) => (releaseExpands = resolve));
    let signalBothStarted;
    const bothStarted = new Promise((resolve) => (signalBothStarted = resolve));
    const history = buildHistory({
      expandBlobToFile: async (filePath, sha) => {
        started.push(sha);
        if (started.length === 2) signalBothStarted();
        await expandGate;
        return filePath;
      },
    });

    const resultPromise = history.expandBlobsToFilesInTempFolder([
      { filePath: "a.txt", beforeSha: "before-sha", afterSha: "after-sha" },
    ]);

    // Under the old sequential awaits this never resolves: the first expansion
    // blocks on the gate and the second one never starts.
    await bothStarted;
    expect(started).toEqual(["before-sha", "after-sha"]);
    releaseExpands();

    const [{ theirsPath, commonBasePath, resultPath }] = await resultPromise;
    expect(path.basename(theirsPath)).toBe("a.txt-before-discard");
    expect(path.basename(commonBasePath)).toBe("a.txt-after-discard");
    expect(path.basename(resultPath)).toBe("~a.txt-merge-result");
  });

  it("keeps the whole-file store and pop round trip intact", async () => {
    const contents = { "a.txt": "one" };
    const history = buildHistory({
      createBlob: async ({ filePath }) => `sha-${contents[path.basename(filePath)]}`,
    });

    const snapshots = await history.storeBeforeAndAfterBlobs(
      ["a.txt"],
      () => true,
      () => {
        contents["a.txt"] = "two";
      },
    );

    expect(snapshots).toEqual({ "a.txt": { beforeSha: "sha-one", afterSha: "sha-two" } });
    expect(history.getLastSnapshots()).toEqual([
      { filePath: "a.txt", beforeSha: "sha-one", afterSha: "sha-two" },
    ]);
    expect(history.popHistory()).toEqual({
      "a.txt": { beforeSha: "sha-one", afterSha: "sha-two" },
    });
    expect(history.hasHistory()).toBe(false);
  });
});
