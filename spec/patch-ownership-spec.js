/** @babel */
import PatchBuffer from "../lib/models/patch/patch-buffer";
import { buildMultiFilePatch, buildFilePatch } from "../lib/models/patch";

function diff(filePath = "example.txt", oldText = "before token", newText = "after token") {
  return {
    oldPath: filePath,
    newPath: filePath,
    status: "modified",
    oldMode: "100644",
    newMode: "100644",
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: 1,
        newStartLine: 1,
        newLineCount: 1,
        heading: "",
        lines: ["-" + oldText, "+" + newText],
      },
    ],
  };
}

describe("native patch ownership", () => {
  const models = [];
  const buffers = [];
  const leases = [];
  afterEach(() => {
    while (leases.length) leases.pop().dispose();
    while (models.length) models.pop().dispose();
    while (buffers.length) buffers.pop().dispose();
  });
  const own = (model) => {
    models.push(model);
    return model;
  };
  const ranges = (layer) =>
    layer.getMarkers().map((marker) => {
      const range = marker.getRange();
      return [
        [range.start.row, range.start.column],
        [range.end.row, range.end.column],
      ];
    });

  it("releases the construction owner once while a consumer lease keeps a model valid", () => {
    const model = own(buildMultiFilePatch([diff()]));
    const buffer = model.getBuffer();
    expect(buffer.refcount).toBe(1);
    const lease = model.retain();
    leases.push(lease);
    model.dispose();
    model.dispose();
    expect(model.isDisposed()).toBe(false);
    expect(buffer.isDestroyed()).toBe(false);
    expect(model.getFilePatches().length).toBe(1);
    lease.dispose();
    lease.dispose();
    expect(model.isDisposed()).toBe(true);
    expect(buffer.isDestroyed()).toBe(true);
  });

  it("preserves an editor retain when the last model owner is released", () => {
    const model = own(buildMultiFilePatch([diff()]));
    const buffer = model.getBuffer();
    const editor = lumine.workspace.buildTextEditor({ buffer });
    try {
      expect(buffer.refcount).toBe(2);
      model.dispose();
      expect(buffer.refcount).toBe(1);
      expect(buffer.isDestroyed()).toBe(false);
      expect(editor.getText()).toContain("before token");
    } finally {
      editor.destroy();
    }
    expect(buffer.isDestroyed()).toBe(true);
  });

  it("releases adopted source buffers and keeps the reusable target until the final snapshot", () => {
    const previous = own(buildMultiFilePatch([diff()]));
    const target = previous.getPatchBuffer();
    const next = own(buildMultiFilePatch([diff("example.txt", "before token", "latest token")]));
    const source = next.getBuffer();
    next.adoptBuffer(target);
    expect(source.isDestroyed()).toBe(true);
    expect(target.getBuffer().refcount).toBe(2);
    previous.dispose();
    expect(target.getBuffer().isDestroyed()).toBe(false);
    expect(next.toString()).toContain("latest token");
    next.dispose();
    expect(target.getBuffer().isDestroyed()).toBe(true);
  });

  it("publishes one marker-layer update per adoption while keeping exact word ranges", () => {
    const original = own(
      buildMultiFilePatch(Array.from({ length: 20 }, (_, index) => diff(`file-${index}.txt`))),
    );
    const next = own(
      buildMultiFilePatch(
        Array.from({ length: 20 }, (_, index) => diff(`file-${index}.txt`, "old red", "new green")),
      ),
    );
    const target = original.getPatchBuffer();
    const additions = next
      .getWordAdditionLayer()
      .getMarkers()
      .map((marker) => marker.getRange());
    const didUpdate = jasmine.createSpy("adopted word layer");
    const subscription = target.getLayer("word-addition").onDidUpdate(didUpdate);
    try {
      next.adoptBuffer(target);
      expect(didUpdate).toHaveBeenCalledTimes(1);
      expect(
        next
          .getWordAdditionLayer()
          .getMarkers()
          .map((marker) => marker.getRange()),
      ).toEqual(additions);
    } finally {
      subscription.dispose();
    }
  });

  it("forks clone buffers and markers so subset highlighting and adoption cannot change the source", () => {
    const source = own(buildMultiFilePatch([diff("a.txt"), diff("b.txt", "old red", "new green")]));
    const oldWordRanges = ranges(source.getWordAdditionLayer());
    const sourceMarkers = source.getFilePatches().map((file) => file.getMarker());
    const subset = own(source.clone({ filePatches: [source.getFilePatches()[0]] }));
    const sibling = own(source.clone());
    expect(subset.getBuffer()).not.toBe(source.getBuffer());
    expect(ranges(source.getWordAdditionLayer())).toEqual(oldWordRanges);
    const target = new PatchBuffer();
    buffers.push(target);
    sibling.adoptBuffer(target);
    expect(source.getFilePatches().map((file) => file.getMarker())).toEqual(sourceMarkers);
    expect(sourceMarkers.every((marker) => !marker.isDestroyed())).toBe(true);
    expect(ranges(source.getWordAdditionLayer())).toEqual(oldWordRanges);
    subset.dispose();
    sibling.dispose();
    expect(source.getBuffer().isDestroyed()).toBe(false);
  });

  it("releases expansion and collapsed buffers through repeated hide/show and final disposal", () => {
    const allocated = [];
    const originalAcquire = PatchBuffer.prototype.acquire;
    spyOn(PatchBuffer.prototype, "acquire").and.callFake(function () {
      allocated.push(this.getBuffer());
      return originalAcquire.call(this);
    });
    const model = own(buildMultiFilePatch([diff()], { largeDiffThreshold: 0 }));
    const file = model.getFilePatches()[0];
    for (let iteration = 0; iteration < 20; iteration++) {
      model.expandFilePatch(file);
      model.collapseFilePatch(file);
    }
    model.dispose();
    expect(allocated.every((buffer) => buffer.isDestroyed())).toBe(true);
  });

  it("releases builder buffers when malformed input or a deferred expansion fails", () => {
    const disposed = [];
    const originalDispose = PatchBuffer.prototype.dispose;
    spyOn(PatchBuffer.prototype, "dispose").and.callFake(function () {
      disposed.push(this.getBuffer());
      return originalDispose.call(this);
    });
    expect(() => buildFilePatch([diff(), diff(), diff()])).toThrow();
    expect(disposed.every((buffer) => buffer.isDestroyed())).toBe(true);
    const malformed = diff();
    malformed.hunks[0].lines = ["?invalid"];
    const model = own(buildMultiFilePatch([malformed], { largeDiffThreshold: 0 }));
    const before = disposed.length;
    expect(() => model.expandFilePatch(model.getFilePatches()[0])).toThrow();
    expect(disposed.slice(before).every((buffer) => buffer.isDestroyed())).toBe(true);
  });
});
