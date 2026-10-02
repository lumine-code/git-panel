/** @babel */
import { createViewModel } from "./helpers/etch";

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

const multiFilePatchWithBuffer = (patchBuffer, ...filePatches) => {
  let currentPatchBuffer = patchBuffer;
  return {
    adoptBuffer: jasmine.createSpy().and.callFake((nextPatchBuffer) => {
      currentPatchBuffer = nextPatchBuffer;
    }),
    getFilePatches: () => filePatches,
    getPatchBuffer: () => currentPatchBuffer,
  };
};

describe("render status across patch refreshes", () => {
  it("preserves an initially expanded changed-file patch", async () => {
    let options;
    const initialPatch = buildFilePatch([diff], { largeDiffThreshold: 10 });
    const container = createViewModel(ChangedFileContainer, {
      largeDiffThreshold: 0,
      relPath: "file.txt",
      stagingStatus: "unstaged",
    });
    container.lastMultiFilePatch = initialPatch;
    container.patchBuffer = initialPatch.getPatchBuffer();
    const repository = {
      getFilePatchForPath: (filePath, nextOptions) => {
        options = nextOptions;
        return Promise.resolve(buildFilePatch([diff], nextOptions.builder));
      },
      hasDiscardHistory: () => Promise.resolve(false),
      isPartiallyStaged: () => Promise.resolve(false),
    };

    const result = await container.fetchData(repository);
    container.prepareData(result);

    expect(options.builder.renderStatusOverrides).toEqual({ "file.txt": EXPANDED });
    expect(options.patchBuffer).toBeUndefined();
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
    const container = createViewModel(ChangedFileContainer, {
      relPath: "file.txt",
      repository,
      stagingStatus: "unstaged",
    });

    const data = await container.fetchData(repository);
    container.prepareData(data);
    container.renderWithData(data);

    expect(container.patchBuffer).toBe(cachedBuffer);
    expect(options.patchBuffer).toBeUndefined();
    expect(cachedPatch.adoptBuffer).not.toHaveBeenCalled();
    container.willDestroy();
  });

  it("adopts a changed-file patch only after its companion data is ready", async () => {
    let resolvePartialStage;
    const partialStage = new Promise((resolve) => {
      resolvePartialStage = resolve;
    });
    const currentBuffer = { name: "current" };
    const nextBuffer = { name: "next" };
    const currentPatch = multiFilePatchWithBuffer(currentBuffer, filePatch("file.txt", EXPANDED));
    const nextPatch = multiFilePatchWithBuffer(nextBuffer, filePatch("file.txt", EXPANDED));
    const repository = {
      getFilePatchForPath: () => Promise.resolve(nextPatch),
      hasDiscardHistory: () => false,
      isPartiallyStaged: () => partialStage,
    };
    const container = createViewModel(ChangedFileContainer, {
      relPath: "file.txt",
      stagingStatus: "unstaged",
    });
    container.lastMultiFilePatch = currentPatch;
    container.patchBuffer = currentBuffer;
    const willUpdate = jasmine.createSpy();
    const didUpdate = jasmine.createSpy();
    const willSub = container.onWillUpdatePatch(willUpdate);
    const didSub = container.onDidUpdatePatch(didUpdate);

    const fetch = container.fetchData(repository);
    await Promise.resolve();

    expect(nextPatch.adoptBuffer).not.toHaveBeenCalled();
    expect(willUpdate).not.toHaveBeenCalled();

    resolvePartialStage(false);
    const data = await fetch;

    expect(data.multiFilePatch).toBe(nextPatch);
    expect(nextPatch.adoptBuffer).not.toHaveBeenCalled();
    expect(willUpdate).not.toHaveBeenCalled();

    container.prepareData(data);

    expect(nextPatch.adoptBuffer).toHaveBeenCalledOnceWith(currentBuffer);
    expect(willUpdate).toHaveBeenCalledTimes(1);
    expect(didUpdate).toHaveBeenCalledOnceWith(nextPatch);
    willSub.dispose();
    didSub.dispose();
  });

  it("uses the live statuses from the current commit preview on its next refresh", async () => {
    let options;
    const container = createViewModel(CommitPreviewContainer, {});
    container.state.renderStatusOverrides = { "remembered.txt": COLLAPSED };
    container.lastMultiFilePatch = multiFilePatch(
      filePatch("expanded.txt", EXPANDED),
      filePatch("deferred.txt", DEFERRED),
      filePatch("removed.txt", REMOVED),
    );
    const repository = {
      getStagedChangesPatch: (nextOptions) => {
        options = nextOptions;
        return Promise.resolve(multiFilePatchWithBuffer({ name: "next" }));
      },
    };

    const data = await container.fetchData(repository);
    container.prepareData(data);

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
    const refreshedBuffer = { name: "refreshed" };
    const refreshedPatch = multiFilePatchWithBuffer(
      refreshedBuffer,
      filePatch("file.txt", EXPANDED),
    );
    let callCount = 0;
    const repository = {
      getStagedChangesPatch: (nextOptions) => {
        options = nextOptions;
        return Promise.resolve(callCount++ === 0 ? cachedPatch : refreshedPatch);
      },
      isLoading: () => false,
    };
    const container = createViewModel(CommitPreviewContainer, { repository });

    const initialData = await container.fetchData(repository);
    container.prepareData(initialData);
    container.renderResult(initialData);
    const refreshedData = await container.fetchData(repository);

    expect(container.patchBuffer).toBe(cachedBuffer);
    expect(options.patchBuffer).toBeUndefined();
    expect(refreshedData.multiFilePatch).toBe(refreshedPatch);
    expect(refreshedPatch.adoptBuffer).not.toHaveBeenCalled();

    container.prepareData(refreshedData);

    expect(refreshedPatch.adoptBuffer).toHaveBeenCalledOnceWith(cachedBuffer);
    container.willDestroy();
  });
});
