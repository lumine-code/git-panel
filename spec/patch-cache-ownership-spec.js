/** @babel */
import { Emitter } from "lumine";
import Present from "../lib/models/repository-states/present";
import Commit from "../lib/models/commit";
import PatchBuffer from "../lib/models/patch/patch-buffer";
import ChangedFileContainer from "../lib/containers/changed-file-container";
import ChangedFileItem from "../lib/items/changed-file-item";
import { flushViews } from "./helpers/etch";

const raw = (text = "after") => ({
  oldPath: "example.txt",
  newPath: "example.txt",
  status: "modified",
  oldMode: "100644",
  newMode: "100644",
  hunks: [
    {
      oldStartLine: 1,
      newStartLine: 1,
      oldLineCount: 1,
      newLineCount: 1,
      heading: "",
      lines: ["-before", "+" + text],
    },
  ],
});

describe("repository snapshot cache ownership", () => {
  let state, emitter;
  const views = [],
    models = [],
    leases = [];
  function createState(strategy = {}) {
    emitter = new Emitter();
    const repository = {
      emitter,
      getWorkingDirectoryPath: () => __dirname,
      getMergeMessage: () => Promise.resolve(null),
      git: {
        fetchCommitMessageTemplate: () => Promise.resolve(null),
        getDiffsForFilePath: () => Promise.resolve([raw()]),
        ...strategy,
      },
    };
    state = new Present(repository);
    repository.state = state;
    return repository;
  }
  afterEach(async () => {
    while (views.length) await views.pop().destroy();
    while (leases.length) leases.pop().dispose();
    while (models.length) models.pop().dispose();
    state?.cache.destroy();
    emitter?.dispose();
  });

  it("releases evicted cache ownership while a shared consumer keeps its model alive", async () => {
    createState();
    const first = await state.getFilePatchForPath("example.txt");
    const second = await state.getFilePatchForPath("example.txt");
    expect(second).toBe(first);
    const buffer = first.getBuffer();
    const lease = first.retain();
    leases.push(lease);
    state.cache.clear();
    expect(first.isDisposed()).toBe(false);
    expect(buffer.isDestroyed()).toBe(false);
    lease.dispose();
    expect(first.isDisposed()).toBe(true);
    expect(buffer.isDestroyed()).toBe(true);
  });

  it("disposes a snapshot built after eviction and rejects the superseded read", async () => {
    let finish;
    createState({
      getDiffsForFilePath: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const acquired = [];
    const original = PatchBuffer.prototype.acquire;
    spyOn(PatchBuffer.prototype, "acquire").and.callFake(function () {
      acquired.push(this.getBuffer());
      return original.call(this);
    });
    const pending = state.getFilePatchForPath("example.txt");
    state.cache.clear();
    finish([raw()]);
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ code: "ABORT_ERR" }));
    expect(acquired.length).toBeGreaterThan(0);
    expect(acquired.every((buffer) => buffer.isDestroyed())).toBe(true);
  });

  it("keeps metadata-only history free of native buffers and releases a lazily opened patch", () => {
    const acquire = spyOn(PatchBuffer.prototype, "acquire").and.callThrough();
    const commits = Array.from({ length: 1000 }, (_, index) => new Commit({ sha: String(index) }));
    models.push(...commits);
    expect(acquire).not.toHaveBeenCalled();
    const patch = commits[0].getMultiFileDiff();
    const buffer = patch.getBuffer();
    expect(acquire).toHaveBeenCalledTimes(1);
    commits[0].dispose();
    expect(buffer.isDestroyed()).toBe(true);
  });

  it("keeps two mounted cache consumers independent through collapse and refresh", async () => {
    let currentRaw = raw();
    const repository = createState({ getDiffsForFilePath: () => Promise.resolve([currentRaw]) });
    Object.assign(repository, {
      isLoading: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getFilePatchForPath: (...args) => state.getFilePatchForPath(...args),
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
    });
    const props = {
      repository,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      itemType: ChangedFileItem,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
    };
    const first = new ChangedFileContainer(props);
    const second = new ChangedFileContainer(props);
    views.push(first, second);
    jasmine.attachToDOM(first.element);
    jasmine.attachToDOM(second.element);
    await flushViews(async () => {});
    const cached = await state.getFilePatchForPath("example.txt");
    const one = first.lastMultiFilePatch,
      two = second.lastMultiFilePatch;
    expect(one.getBuffer()).not.toBe(two.getBuffer());
    expect(one.getBuffer()).not.toBe(cached.getBuffer());
    one.collapseFilePatch(one.getFilePatches()[0]);
    await flushViews(async () => {});
    expect(two.getBuffer().getText()).toContain("after");
    expect(cached.getBuffer().getText()).toContain("after");
    state.cache.clear();
    currentRaw = raw("latest");
    emitter.emit("did-update");
    await flushViews(async () => {});
    expect(first.lastMultiFilePatch.getBuffer()).toBe(one.getBuffer());
    expect(second.lastMultiFilePatch.getBuffer()).toBe(two.getBuffer());
    expect(second.lastMultiFilePatch.getBuffer().getText()).toContain("latest");
    expect(cached.getBuffer().isDestroyed()).toBe(true);
  });
});
