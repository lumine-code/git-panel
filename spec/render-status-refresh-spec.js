/** @babel */

import ChangedFileContainer from "../lib/containers/changed-file-container";
import CommitPreviewContainer from "../lib/containers/commit-preview-container";
import { buildFilePatch } from "../lib/models/patch";
import { COLLAPSED, DEFERRED, EXPANDED, REMOVED } from "../lib/models/patch/patch";

const diff = {
  oldPath: "file.txt",
  newPath: "file.txt",
  oldMode: "100644",
  newMode: "100644",
  status: "modified",
  hunks: [
    {
      oldStartLine: 1,
      oldLineCount: 1,
      newStartLine: 1,
      newLineCount: 1,
      heading: "",
      lines: [
        { kind: "deleted", text: "before" },
        { kind: "added", text: "after" },
      ],
    },
  ],
};

const filePatch = (filePath, renderStatus) => ({
  getPath: () => filePath,
  getRenderStatus: () => renderStatus,
  isPresent: () => true,
  onDidChangeRenderStatus: () => ({ dispose() {} }),
});

const multiFilePatch = (...filePatches) => ({
  getFilePatches: () => filePatches,
});

const multiFilePatchWithBuffer = (patchBuffer, ...filePatches) => ({
  getFilePatches: () => filePatches,
  getPatchBuffer: () => patchBuffer,
});

describe("render status across patch refreshes", () => {
  it("preserves an initially expanded changed-file patch", async () => {
    let options;
    const initialPatch = buildFilePatch([diff], { largeDiffThreshold: 10 });
    const container = new ChangedFileContainer({
      largeDiffThreshold: 0,
      relPath: "file.txt",
      stagingStatus: "unstaged",
    });
    container.lastMultiFilePatch = initialPatch;
    container.patchBuffer = initialPatch.getPatchBuffer();
    const repository = {
      getFilePatchForPath: (filePath, nextOptions) => {
        options = nextOptions;
        const patch = buildFilePatch([diff], nextOptions.builder);
        patch.adoptBuffer(nextOptions.patchBuffer);
        return Promise.resolve(patch);
      },
      hasDiscardHistory: () => Promise.resolve(false),
      isPartiallyStaged: () => Promise.resolve(false),
    };

    const result = await container.fetchData(repository);

    expect(options.builder.renderStatusOverrides).toEqual({ "file.txt": EXPANDED });
    expect(result.multiFilePatch.getFilePatches()[0].getRenderStatus()).toBe(EXPANDED);
    expect(result.multiFilePatch.getBuffer().isEmpty()).toBe(false);
  });

  it("follows the buffer from a cached changed-file patch", async () => {
    let options;
    const cachedBuffer = { name: "cached" };
    const cachedPatch = multiFilePatchWithBuffer(cachedBuffer, filePatch("file.txt", EXPANDED));
    const repository = {
      getFilePatchForPath: (filePath, nextOptions) => {
        options = nextOptions;
        return Promise.resolve(cachedPatch);
      },
      hasDiscardHistory: () => Promise.resolve(false),
      isLoading: () => false,
      isPartiallyStaged: () => Promise.resolve(false),
    };
    const container = new ChangedFileContainer({
      relPath: "file.txt",
      repository,
      stagingStatus: "unstaged",
    });

    container.renderWithData({ multiFilePatch: cachedPatch });
    await container.fetchData(repository);

    expect(container.patchBuffer).toBe(cachedBuffer);
    expect(options.patchBuffer).toBe(cachedBuffer);
    container.componentWillUnmount();
  });

  it("uses the live statuses from the current commit preview on its next refresh", async () => {
    let options;
    const container = new CommitPreviewContainer({});
    container.state.renderStatusOverrides = { "remembered.txt": COLLAPSED };
    container.lastMultiFilePatch = multiFilePatch(
      filePatch("expanded.txt", EXPANDED),
      filePatch("deferred.txt", DEFERRED),
      filePatch("removed.txt", REMOVED),
    );
    const repository = {
      getStagedChangesPatch: (nextOptions) => {
        options = nextOptions;
        return Promise.resolve(multiFilePatch());
      },
    };

    await container.fetchData(repository);

    expect(options.builder.renderStatusOverrides).toEqual({
      "remembered.txt": COLLAPSED,
      "expanded.txt": EXPANDED,
      "deferred.txt": DEFERRED,
    });
  });

  it("follows the buffer from a cached commit preview", async () => {
    let options;
    const cachedBuffer = { name: "cached" };
    const cachedPatch = multiFilePatchWithBuffer(cachedBuffer, filePatch("file.txt", EXPANDED));
    const repository = {
      getStagedChangesPatch: (nextOptions) => {
        options = nextOptions;
        return Promise.resolve(cachedPatch);
      },
      isLoading: () => false,
    };
    const container = new CommitPreviewContainer({ repository });

    container.renderResult({ multiFilePatch: cachedPatch });
    await container.fetchData(repository);

    expect(container.patchBuffer).toBe(cachedBuffer);
    expect(options.patchBuffer).toBe(cachedBuffer);
    container.componentWillUnmount();
  });
});
