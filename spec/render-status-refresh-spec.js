/** @babel */
import { createViewModel } from "./helpers/etch.js";
import PatchContainer from "../lib/containers/patch-container.js";
import PatchDocument from "../lib/models/patch-document.js";
import { buildFilePatch, buildMultiFilePatch } from "../lib/models/patch/index.js";
import { COLLAPSED, DEFERRED, EXPANDED, REMOVED } from "../lib/models/patch/patch.js";

const diff = (text = "after") => ({
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
      lines: ["-before", `+${text}`],
    },
  ],
});

const filePatch = (filePath, renderStatus) => ({
  getPath: () => filePath,
  getRenderStatus: () => renderStatus,
  isPresent: () => true,
});

const multiFilePatch = (...filePatches) => ({ getFilePatches: () => filePatches });

describe("render status across patch refreshes", () => {
  const containers = [],
    sources = [];
  const own = (source) => {
    sources.push(source);
    return source;
  };
  const create = (document, props = {}) => {
    const container = createViewModel(PatchContainer, { document, ...props });
    containers.push(container);
    return container;
  };
  afterEach(() => {
    while (containers.length) containers.pop().willDestroy();
    while (sources.length) sources.pop().dispose();
  });

  it("preserves an initially expanded changed-file patch", async () => {
    let options;
    const initialPatch = own(buildFilePatch([diff()], { largeDiffThreshold: 10 }));
    const container = create(PatchDocument.file(import.meta.dirname, "file.txt", "unstaged"), {
      largeDiffThreshold: 0,
    });
    container.lastMultiFilePatch = initialPatch;
    container.patchBuffer = initialPatch.getPatchBuffer();
    const repository = {
      getFilePatchForPath: (_filePath, nextOptions) => {
        options = nextOptions;
        return own(buildFilePatch([diff()], nextOptions.builder));
      },
      hasDiscardHistory: () => false,
      isPartiallyStaged: () => false,
    };
    const result = await container.fetchData(repository);
    container.prepareData(result);
    expect(options.builder.renderStatusOverrides).toEqual({ "file.txt": EXPANDED });
    expect(options.patchBuffer).toBeUndefined();
    expect(result.multiFilePatch.getFilePatches()[0].getRenderStatus()).toBe(EXPANDED);
    expect(result.multiFilePatch.getBuffer().isEmpty()).toBe(false);
  });

  it("owns a cloned changed-file snapshot while keeping the cached source independent", async () => {
    let options;
    const source = own(buildFilePatch([diff()]));
    spyOn(source, "adoptBuffer").and.callThrough();
    const repository = {
      getFilePatchForPath: (_path, nextOptions) => {
        options = nextOptions;
        return source;
      },
      hasDiscardHistory: () => false,
      isLoading: () => false,
      isPartiallyStaged: () => false,
    };
    const container = create(PatchDocument.file(import.meta.dirname, "file.txt", "unstaged"), {
      repository,
    });
    const data = await container.fetchData(repository);
    container.prepareData(data);
    container.renderWithData(data);
    expect(data.multiFilePatch).not.toBe(source);
    expect(container.patchBuffer).toBe(data.multiFilePatch.getPatchBuffer());
    expect(data.multiFilePatch.getBuffer()).not.toBe(source.getBuffer());
    expect(options.patchBuffer).toBeUndefined();
    expect(source.adoptBuffer).not.toHaveBeenCalled();
    container.willDestroy();
    expect(source.isDisposed()).toBe(false);
    expect(source.getBuffer().isDestroyed()).toBe(false);
  });

  it("adopts a changed-file patch only after its companion data is ready", async () => {
    let resolvePartialStage;
    const partialStage = new Promise((resolve) => {
      resolvePartialStage = resolve;
    });
    const initial = own(buildFilePatch([diff("current")]));
    const next = own(buildFilePatch([diff("next")]));
    const repository = {
      getFilePatchForPath: () => initial,
      hasDiscardHistory: () => false,
      isLoading: () => false,
      isPartiallyStaged: () => false,
    };
    const container = create(PatchDocument.file(import.meta.dirname, "file.txt", "unstaged"), {
      repository,
    });
    const initialData = await container.fetchData(repository);
    container.prepareData(initialData);
    container.renderWithData(initialData);
    const currentBuffer = container.patchBuffer;
    const willUpdate = jasmine.createSpy("will update"),
      didUpdate = jasmine.createSpy("did update");
    const willSub = container.onWillUpdatePatch(willUpdate),
      didSub = container.onDidUpdatePatch(didUpdate);
    repository.getFilePatchForPath = () => next;
    repository.isPartiallyStaged = () => partialStage;
    const fetch = container.fetchData(repository);
    await Promise.resolve();
    expect(currentBuffer.getBuffer().getText()).toContain("current");
    expect(willUpdate).not.toHaveBeenCalled();
    resolvePartialStage(false);
    const data = await fetch;
    expect(currentBuffer.getBuffer().getText()).toContain("current");
    expect(willUpdate).not.toHaveBeenCalled();
    container.prepareData(data);
    expect(data.multiFilePatch.getPatchBuffer()).toBe(currentBuffer);
    expect(currentBuffer.getBuffer().getText()).toContain("next");
    expect(next.getBuffer()).not.toBe(currentBuffer.getBuffer());
    expect(willUpdate).toHaveBeenCalledTimes(1);
    expect(didUpdate).toHaveBeenCalledOnceWith(data.multiFilePatch);
    willSub.dispose();
    didSub.dispose();
  });

  it("uses the live statuses from the current staged-all preview on its next refresh", async () => {
    let options;
    const container = create(PatchDocument.staged(import.meta.dirname));
    container.state.renderStatusOverrides = { "remembered.txt": COLLAPSED };
    container.lastMultiFilePatch = multiFilePatch(
      filePatch("expanded.txt", EXPANDED),
      filePatch("deferred.txt", DEFERRED),
      filePatch("removed.txt", REMOVED),
    );
    const repository = {
      getStagedChangesPatch: (nextOptions) => {
        options = nextOptions;
        return own(buildMultiFilePatch([]));
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

  it("refreshes staged-all snapshots in the live buffer without changing either cached source", async () => {
    let options;
    const initial = own(buildMultiFilePatch([diff("cached")]));
    const refreshed = own(buildMultiFilePatch([diff("refreshed")]));
    let calls = 0;
    const repository = {
      getStagedChangesPatch: (nextOptions) => {
        options = nextOptions;
        return calls++ === 0 ? initial : refreshed;
      },
      isLoading: () => false,
    };
    const container = create(PatchDocument.staged(import.meta.dirname), { repository });
    const initialData = await container.fetchData(repository);
    container.prepareData(initialData);
    container.renderWithData(initialData);
    const liveBuffer = container.patchBuffer;
    const data = await container.fetchData(repository);
    expect(options.patchBuffer).toBeUndefined();
    expect(data.multiFilePatch).toBe(refreshed);
    expect(liveBuffer.getBuffer().getText()).toContain("cached");
    container.prepareData(data);
    expect(data.multiFilePatch.getPatchBuffer()).toBe(liveBuffer);
    expect(liveBuffer.getBuffer().getText()).toContain("refreshed");
    expect(initial.getBuffer().getText()).toContain("cached");
    expect(refreshed.getBuffer()).not.toBe(liveBuffer.getBuffer());
  });
});
