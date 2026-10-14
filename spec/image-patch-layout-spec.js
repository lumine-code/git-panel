/** @babel */
import path from "node:path";
import { Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view.js";
import PatchDocument from "../lib/models/patch-document.js";
import { buildMultiFilePatch } from "../lib/models/patch/index.js";
import { COLLAPSED } from "../lib/models/patch/patch.js";
import { flushViews } from "./helpers/etch.js";

// A valid 160 × 260 PNG makes intrinsic image sizing exceed the loading placeholder.
const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAAEECAYAAACvNT9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKqSURBVHhe7dIhAQAgAMAwwlKJmGQATwBuJmauP+baByrjDfCTAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZDUBZareAsRKPnKAAAAAElFTkSuQmCC",
  "base64",
);

const shorterImageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAEBSURBVHhe7dIhAQAgAMAwwlKJmGQATwBuJmauP+baByrjDfCTAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQ1AWzkNq/EtPcGgAAAABJRU5ErkJggg==",
  "base64",
);

// A 1-bit 640 × 1000 PNG exercises fitting tall images without a fixed height cap.
const largeImageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAoAAAAPoAQAAAABmZnINAAAAZElEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8Gg8dwABRPNwIgAAAABJRU5ErkJggg==",
  "base64",
);

function imageDiff(filePath = "image.png", overrides = {}) {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    binary: true,
    hunks: [],
    ...overrides,
  };
}

function textDiff(filePath) {
  return {
    ...imageDiff(filePath),
    binary: false,
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: 2,
        newStartLine: 1,
        newLineCount: 2,
        heading: "",
        lines: [" same", "-before", "+after"],
      },
    ],
  };
}

describe("image previews in mounted patch layouts", () => {
  let view, container, stylesheet, repository;
  const patches = [];
  const workingDirectory = path.dirname(import.meta.filename);

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1000px; height: 600px;";
    jasmine.attachToDOM(container);
    repository = {
      getWorkingDirectoryPath: () => workingDirectory,
      readFileAtEndpoint: jasmine.createSpy("read image version").and.resolveTo(imageBytes),
    };
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
    container.remove();
    stylesheet.dispose();
  });

  function own(patch) {
    patches.push(patch);
    return patch;
  }

  function build(diffs, options = {}) {
    return own(buildMultiFilePatch(diffs, { largeDiffThreshold: Infinity, ...options }));
  }

  async function paint() {
    await flushViews(() => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const pending = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(pending);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function mount(patch, layout, props = {}) {
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      document: PatchDocument.file(workingDirectory, "image.png", "unstaged"),
      repository,
      initialDiffView: layout,
      surfaceKind: "file",
      stagingStatus: "unstaged",
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      selectedRows: new Set(),
      selectionMode: "hunk",
      selectedRowsChanged: () => {},
      toggleRows: jasmine.createSpy("stage image rows"),
      discardRows: jasmine.createSpy("discard image rows"),
      toggleFile: jasmine.createSpy("stage image file"),
      toggleModeChange: () => {},
      toggleSymlinkChange: () => {},
      openFile: () => {},
      surface: () => {},
      undoLastDiscard: () => {},
      diveIntoMirrorPatch: () => {},
      ...props,
    });
    container.append(view.element);
    await paint();
    await paint();
  }

  function previews() {
    return Array.from(view.element.querySelectorAll(".git-panel-ImagePatchView"));
  }

  function urls() {
    return Array.from(
      view.element.querySelectorAll(".git-panel-ImagePatchView img"),
      (img) => img.src,
    );
  }

  function fileBlock(filePatch) {
    const pair = view.refSideBySide.getOr(null);
    if (pair) {
      const record = pair.sharedHeaderRecords.get(filePatch);
      return { element: record.element, spacers: Object.values(record.spacers) };
    }
    const decoration = view.fileHeaderDecorations.get(filePatch);
    return { element: decoration.content, spacers: [decoration.spacer] };
  }

  async function loaded(imageCount = 2) {
    await globalThis.waitForFrames(
      () => {
        const images = Array.from(view.element.querySelectorAll(".git-panel-ImagePatchView img"));
        return (
          images.length === imageCount &&
          images.every((img) => img.complete && img.naturalWidth > 0)
        );
      },
      { description: "binary image versions to decode" },
    );
    await paint();
    await globalThis.waitForFrames(
      () =>
        view.props.multiFilePatch.getFilePatches().every((filePatch) => {
          const { element, spacers } = fileBlock(filePatch);
          return spacers.every(
            (spacer) =>
              Math.abs(parseFloat(spacer.style.height) - element.getBoundingClientRect().height) <
              0.5,
          );
        }),
      { description: "image headers and both native spacer heights to agree" },
    );
    await paint();
  }

  function reads() {
    return repository.readFileAtEndpoint.calls
      .allArgs()
      .map(([filePath, endpoint]) => [filePath, endpoint]);
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`shows external binary patches without image sources in ${layout}`, async () => {
      const patch = build([imageDiff()]);
      await mount(patch, layout, { repository: null, document: null, readOnly: true });

      const { element } = fileBlock(patch.getFilePatches()[0]);
      expect(patch.getBuffer().isEmpty()).toBe(true);
      expect(element.querySelector(".git-panel-FilePatchView-header").textContent).toContain(
        "image.png",
      );
      expect(element.querySelector(".git-panel-FilePatchView-message").textContent).toBe(
        "Binary file changed",
      );
      expect(view.element.textContent).not.toContain("No changes to display");
      expect(previews()).toEqual([]);
      expect(view.element.querySelector("img")).toBeNull();
      expect(repository.readFileAtEndpoint).not.toHaveBeenCalled();
    });

    it(`keeps unsupported binary files visible without invoking the image loader in ${layout}`, async () => {
      const patch = build([imageDiff("opaque.bin")]);
      await mount(patch, layout);

      const { element } = fileBlock(patch.getFilePatches()[0]);
      expect(patch.getBuffer().isEmpty()).toBe(true);
      expect(element.querySelector(".git-panel-FilePatchView-header").textContent).toContain(
        "opaque.bin",
      );
      expect(element.querySelector(".git-panel-FilePatchView-message").textContent).toBe(
        "Binary file changed",
      );
      expect(previews()).toEqual([]);
      expect(repository.readFileAtEndpoint).not.toHaveBeenCalled();
    });

    it(`shows both binary versions above an empty text buffer in ${layout}`, async () => {
      const patch = build([imageDiff()]);
      const [filePatch] = patch.getFilePatches();
      await mount(patch, layout);
      await loaded();

      expect(patch.getBuffer().isEmpty()).toBe(true);
      expect(previews().length).toBe(1);
      expect(view.element.textContent).not.toContain("No changes to display");
      expect(reads()).toEqual([
        ["image.png", { type: "index" }],
        ["image.png", { type: "worktree" }],
      ]);
      const block = fileBlock(filePatch).element;
      expect(block.querySelector(".git-panel-FilePatchView-header")).not.toBeNull();
      expect(block.querySelector(".git-panel-ImagePatchView")).toBe(previews()[0]);
      if (layout === "side-by-side") {
        const [oldSide, newSide] = previews()[0].querySelectorAll("figure");
        expect([oldSide.dataset.side, newSide.dataset.side]).toEqual(["old", "new"]);
        expect(oldSide.textContent).toContain("Index");
        expect(newSide.textContent).toContain("Working Tree");
        expect(oldSide.getBoundingClientRect().right).toBeLessThanOrEqual(
          newSide.getBoundingClientRect().left,
        );
        expect(previews()[0].querySelector('input[type="range"]')).toBeNull();
        expect(previews()[0].querySelector('[role="slider"]')).toBeNull();
      } else {
        expect(previews()[0].querySelector(".git-panel-ImagePatchView-comparison")).not.toBeNull();
        expect(previews()[0].querySelectorAll("figure.git-panel-ImagePatchView-side").length).toBe(
          0,
        );
        expect(previews()[0].querySelector('input[type="range"]')).toBeNull();
        expect(
          previews()[0].querySelector('.git-panel-ImagePatchView-divider[role="slider"]'),
        ).not.toBeNull();
        expect(previews()[0].textContent).toContain("Index");
        expect(previews()[0].textContent).toContain("Working Tree");
      }
      for (const img of previews()[0].querySelectorAll("img")) {
        expect(img.src.startsWith("blob:")).toBe(true);
        expect(img.naturalWidth).toBe(160);
        expect(img.naturalHeight).toBe(260);
        if (layout === "unified") {
          expect(img.getBoundingClientRect().width).toBeLessThanOrEqual(img.naturalWidth + 0.01);
          expect(img.getBoundingClientRect().height).toBeLessThanOrEqual(img.naturalHeight + 0.01);
        }
      }
      const stageButton = block.querySelector('[title="Stage File"]');
      expect(stageButton).not.toBeNull();
      await flushViews(() => stageButton.click());
      expect(view.props.toggleFile).toHaveBeenCalledOnceWith(filePatch);
      expect(view.props.toggleRows).not.toHaveBeenCalled();
      expect(view.element.querySelector(".git-panel-HunkHeaderView")).toBeNull();
    });

    for (const surface of ["staged", "commit"]) {
      it(`uses ${surface} endpoints and retains its file controls in ${layout}`, async () => {
        const document =
          surface === "staged"
            ? PatchDocument.staged(workingDirectory)
            : PatchDocument.commit(workingDirectory, "selected-commit");
        const patch = build([imageDiff()]);
        await mount(patch, layout, {
          document,
          stagingStatus: document.getStagingStatus(),
          surfaceKind: surface === "commit" ? "commit" : "staged-all",
          readOnly: document.isReadOnly(),
        });
        await loaded();
        expect(reads()).toEqual(
          surface === "staged"
            ? [
                ["image.png", { type: "commit", revision: "HEAD" }],
                ["image.png", { type: "index" }],
              ]
            : [
                ["image.png", { type: "commit", revision: "selected-commit^1" }],
                ["image.png", { type: "commit", revision: "selected-commit" }],
              ],
        );
        expect(view.element.querySelector('[title="Unstage File"]') !== null).toBe(
          surface === "staged",
        );
        expect(
          view.element.querySelector(".git-panel-FilePatchView-header .btn-group") === null,
        ).toBe(surface === "commit");
      });
    }

    it(`keeps absent versions and renamed paths distinct in ${layout}`, async () => {
      const patch = build([
        imageDiff("added.png", { oldPath: null, oldMode: null, status: "added" }),
        imageDiff("deleted.png", { newPath: null, newMode: null, status: "deleted" }),
        imageDiff("old-name.png", { newPath: "new-name.png", status: "renamed" }),
      ]);
      await mount(patch, layout, { surfaceKind: "staged-all" });
      await loaded(4);
      const [added, deleted, renamed] = previews();
      expect(previews().length).toBe(3);
      expect(added.querySelector('[data-side="old"] img')).toBeNull();
      expect(added.textContent).toContain("File absent in this version");
      expect(deleted.querySelector('[data-side="new"] img')).toBeNull();
      expect(deleted.textContent).toContain("File absent in this version");
      expect(renamed.querySelector('[data-side="old"] img').alt).toBe("Old: old-name.png");
      expect(renamed.querySelector('[data-side="new"] img').alt).toBe("New: new-name.png");
      expect(added.querySelector('input[type="range"]')).toBeNull();
      expect(deleted.querySelector('input[type="range"]')).toBeNull();
      expect(added.querySelector('[role="slider"]')).toBeNull();
      expect(deleted.querySelector('[role="slider"]')).toBeNull();
      if (layout === "unified") {
        expect(added.querySelectorAll("figure").length).toBe(1);
        expect(deleted.querySelectorAll("figure").length).toBe(1);
      }
      expect(renamed.querySelector('[role="slider"]') !== null).toBe(layout === "unified");
      expect(renamed.querySelector('input[type="range"]')).toBeNull();
      expect(reads()).toEqual([
        ["added.png", { type: "worktree" }],
        ["deleted.png", { type: "index" }],
        ["old-name.png", { type: "index" }],
        ["new-name.png", { type: "worktree" }],
      ]);
      expect(patch.getBuffer().isEmpty()).toBe(true);
    });

    it(`remeasures image headers and spacers between text files after decoding in ${layout}`, async () => {
      const pending = [];
      repository.readFileAtEndpoint.and.callFake(
        () => new Promise((resolve) => pending.push(resolve)),
      );
      const patch = build([
        textDiff("before.txt"),
        imageDiff(),
        textDiff("after.txt"),
        imageDiff("binary.bin"),
      ]);
      await mount(patch, layout, { surfaceKind: "staged-all" });
      const [, imagePatch] = patch.getFilePatches();
      const initialHeight = fileBlock(imagePatch).element.getBoundingClientRect().height;
      expect(pending.length).toBe(2);
      expect(previews().length).toBe(1);
      expect(patch.getBuffer().getText()).toContain("before\nafter");

      pending.forEach((resolve) => resolve(imageBytes));
      await loaded();
      const { element, spacers } = fileBlock(imagePatch);
      expect(element.getBoundingClientRect().height).toBeGreaterThan(initialHeight + 100);
      for (const spacer of spacers)
        expect(parseFloat(spacer.style.height)).toBeCloseTo(
          element.getBoundingClientRect().height,
          0,
        );
      expect(view.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(2);
      expect(view.getNavigationHeaders().map((header) => header.text)).toEqual([
        "before.txt",
        "image.png",
        "after.txt",
        "binary.bin",
      ]);
      expect(reads().map(([filePath]) => filePath)).toEqual(["image.png", "image.png"]);
    });

    it(`reads only expanded images and removes their preview when collapsed in ${layout}`, async () => {
      const patch = build([imageDiff()], { renderStatusOverrides: { "image.png": COLLAPSED } });
      const [filePatch] = patch.getFilePatches();
      await mount(patch, layout, { surfaceKind: "staged-all" });
      expect(repository.readFileAtEndpoint).not.toHaveBeenCalled();
      expect(previews()).toEqual([]);

      await flushViews(() => view.changePatchRenderStatus(filePatch, true));
      await loaded();
      const originalURLs = urls();
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(2);
      await flushViews(() => view.changePatchRenderStatus(filePatch, false));
      await paint();
      expect(previews()).toEqual([]);
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(2);
      expect(
        repository.readFileAtEndpoint.calls.allArgs().every(([, , { signal }]) => signal.aborted),
      ).toBe(true);

      await flushViews(() => view.changePatchRenderStatus(filePatch, true));
      await loaded();
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(4);
      expect(urls().every((url) => !originalURLs.includes(url))).toBe(true);
    });

    it(`refreshes cloned image patches and reloads each layout without duplicate previews in ${layout}`, async () => {
      const patch = build([imageDiff()]);
      await mount(patch, layout);
      await loaded();
      const initialURLs = urls();
      const snapshot = own(patch.clone());
      await flushViews(() => view.update({ ...view.props, multiFilePatch: snapshot }));
      await loaded();
      expect(previews().length).toBe(1);
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(4);
      const refreshedURLs = urls();
      expect(refreshedURLs.every((url) => !initialURLs.includes(url))).toBe(true);

      await flushViews(() => view.update({ ...view.props, selectedRows: new Set() }));
      await paint();
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(4);
      const nextLayout = layout === "unified" ? "side-by-side" : "unified";
      await flushViews(() => view.didChangeDiffView(nextLayout));
      await loaded();
      expect(previews().length).toBe(1);
      expect(view.state.diffView).toBe(nextLayout);
      expect(previews()[0].querySelector(".git-panel-ImagePatchView-comparison") !== null).toBe(
        nextLayout === "unified",
      );
      expect(previews()[0].querySelector('[role="slider"]') !== null).toBe(
        nextLayout === "unified",
      );
      expect(previews()[0].querySelector('input[type="range"]')).toBeNull();
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(6);
      expect(urls().every((url) => !refreshedURLs.includes(url))).toBe(true);
      expect(snapshot.getBuffer().isEmpty()).toBe(true);
    });
  }

  it("shows a single unified image when its other version is unavailable", async () => {
    repository.readFileAtEndpoint.and.callFake(async (_filePath, endpoint) =>
      endpoint.type === "index" ? null : imageBytes,
    );
    await mount(build([imageDiff()]), "unified");
    await loaded(1);
    const preview = previews()[0];
    expect(preview.querySelector('[data-side="old"] img')).toBeNull();
    expect(preview.querySelector('[data-side="new"] img')).not.toBeNull();
    expect(preview.textContent).toContain("Image unavailable");
    expect(preview.querySelector('input[type="range"]')).toBeNull();
    expect(preview.querySelector('[role="slider"]')).toBeNull();
    expect(preview.querySelectorAll("figure").length).toBe(1);
    expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(2);
  });

  it("shows a single unified image when a rename has an unsupported old format", async () => {
    const patch = build([imageDiff("old.bin", { newPath: "new.png", status: "renamed" })]);
    await mount(patch, "unified");
    await loaded(1);
    const preview = previews()[0];
    expect(preview.querySelector('[data-side="old"] img')).toBeNull();
    expect(preview.querySelector('[data-side="new"] img').alt).toBe("New: new.png");
    expect(preview.textContent).toContain("This version is not a supported image");
    expect(preview.querySelector('input[type="range"]')).toBeNull();
    expect(preview.querySelector('[role="slider"]')).toBeNull();
    expect(preview.querySelectorAll("figure").length).toBe(1);
    expect(reads()).toEqual([["new.png", { type: "worktree" }]]);
  });

  it("fits large unequal unified images to the viewport at one scale capped at their natural size", async () => {
    repository.readFileAtEndpoint.and.callFake(async (_filePath, endpoint) =>
      endpoint.type === "index" ? largeImageBytes : shorterImageBytes,
    );
    await mount(build([imageDiff()]), "unified");
    await loaded();
    const preview = previews()[0];
    const comparison = preview.querySelector(".git-panel-ImagePatchView-comparison");
    const stage = preview.querySelector(".git-panel-ImagePatchView-stage");
    const oldLayer = preview.querySelector(".git-panel-ImagePatchView-oldLayer");
    const oldImage = preview.querySelector('[data-side="old"] img');
    const newImage = preview.querySelector('[data-side="new"] img');
    expect(comparison).not.toBeNull();
    const oldBounds = oldImage.getBoundingClientRect();
    const newBounds = newImage.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    expect(oldImage.naturalHeight).toBe(1000);
    expect(newImage.naturalHeight).toBe(90);
    expect(oldBounds.left).toBeCloseTo(newBounds.left, 0);
    expect(oldBounds.top).toBeCloseTo(newBounds.top, 0);
    expect(oldBounds.left).toBeCloseTo(stageBounds.left, 0);
    expect(oldBounds.top).toBeCloseTo(stageBounds.top, 0);
    expect(stageBounds.width).toBeCloseTo(oldBounds.width, 0);
    expect(stageBounds.height).toBeCloseTo(oldBounds.height, 0);
    expect(oldLayer.getBoundingClientRect().height).toBeCloseTo(stageBounds.height, 0);
    expect(oldBounds.width / 640).toBeCloseTo(newBounds.width / 160, 2);
    expect(oldBounds.width / oldBounds.height).toBeCloseTo(640 / 1000, 2);
    expect(newBounds.width / newBounds.height).toBeCloseTo(160 / 90, 2);
    expect(stageBounds.height).toBeGreaterThan(360);
    const viewport = preview.querySelector(".git-panel-ImagePatchView-viewport");
    const panel = view.element.querySelector(".git-panel-FilePatchView-container");
    const remainingHeight =
      panel.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top;
    expect(stageBounds.height).toBeGreaterThan(remainingHeight * 0.8);
    expect(stageBounds.width).toBeLessThanOrEqual(viewport.clientWidth);

    container.style.cssText = "display: flex; width: 1400px; height: 1400px;";
    await paint();
    await globalThis.waitForFrames(
      () => stage.getBoundingClientRect().height > stageBounds.height + 100,
      { description: "image canvas to expand with the patch viewport" },
    );
    await loaded();
    const expandedHeight = stage.getBoundingClientRect().height;
    expect(expandedHeight).toBeCloseTo(1000, 0);
    expect(stage.getBoundingClientRect().width).toBeCloseTo(640, 0);
    expect(oldImage.getBoundingClientRect().height).toBeLessThanOrEqual(
      oldImage.naturalHeight + 0.01,
    );
    expect(newImage.getBoundingClientRect().height).toBeLessThanOrEqual(
      newImage.naturalHeight + 0.01,
    );
    expect(
      oldImage.getBoundingClientRect().width / oldImage.getBoundingClientRect().height,
    ).toBeCloseTo(640 / 1000, 2);
    expect(
      newImage.getBoundingClientRect().width / newImage.getBoundingClientRect().height,
    ).toBeCloseTo(160 / 90, 2);

    container.style.cssText = "display: flex; width: 300px; height: 320px;";
    await paint();
    await globalThis.waitForFrames(
      () => stage.getBoundingClientRect().height < expandedHeight - 150,
      { description: "image canvas to fit the smaller patch viewport" },
    );
    await loaded();
    const resized = stage.getBoundingClientRect();
    expect(resized.width).toBeLessThanOrEqual(viewport.clientWidth);
    expect(resized.bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom + 1);
    expect(
      oldImage.getBoundingClientRect().width / oldImage.getBoundingClientRect().height,
    ).toBeCloseTo(640 / 1000, 2);
    expect(
      newImage.getBoundingClientRect().width / newImage.getBoundingClientRect().height,
    ).toBeCloseTo(160 / 90, 2);
    expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(2);
    expect(view.props.toggleRows).not.toHaveBeenCalled();
  });

  it("drags the unified divider directly and retains accessible keyboard controls", async () => {
    await mount(build([imageDiff()]), "unified");
    await loaded();
    const preview = previews()[0];
    const stage = preview.querySelector(".git-panel-ImagePatchView-stage");
    const divider = preview.querySelector('.git-panel-ImagePatchView-divider[role="slider"]');
    const oldLayer = preview.querySelector(".git-panel-ImagePatchView-oldLayer");
    expect(divider).not.toBeNull();
    expect(preview.querySelector('input[type="range"]')).toBeNull();
    expect(divider.tabIndex).toBe(0);
    expect(divider.classList.contains("native-key-bindings")).toBe(false);
    expect(divider.getAttribute("aria-valuemin")).toBe("0");
    expect(divider.getAttribute("aria-valuemax")).toBe("100");
    expect(divider.getAttribute("aria-valuenow")).toBe("50");
    expect(divider.getAttribute("aria-valuetext")).toContain("50%");
    let captured = false;
    // Synthetic PointerEvents cannot acquire browser capture, so spy on that boundary.
    spyOn(divider, "setPointerCapture").and.callFake(() => {
      captured = true;
    });
    spyOn(divider, "hasPointerCapture").and.callFake(() => captured);
    spyOn(divider, "releasePointerCapture").and.callFake(() => {
      captured = false;
    });
    const bounds = stage.getBoundingClientRect();
    const event = (type, fraction, options = {}) =>
      new PointerEvent(type, {
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: bounds.left + bounds.width * fraction,
        clientY: bounds.top + bounds.height / 2,
        bubbles: true,
        cancelable: true,
        ...options,
      });
    const down = event("pointerdown", 0.5);
    await flushViews(() => divider.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(divider.setPointerCapture).toHaveBeenCalledOnceWith(7);
    expect(document.activeElement).toBe(divider);
    await flushViews(() => divider.dispatchEvent(event("pointermove", 0.75)));
    expect(Number(divider.getAttribute("aria-valuenow"))).toBeCloseTo(75, 0);
    expect(parseFloat(oldLayer.style.clipPath.match(/inset\(\S+\s+([\d.]+)%/)[1])).toBeCloseTo(
      25,
      0,
    );
    await flushViews(() => divider.dispatchEvent(event("pointermove", 1.2)));
    expect(divider.getAttribute("aria-valuenow")).toBe("100");
    expect(oldLayer.style.clipPath).toContain("0%");
    await flushViews(() => divider.dispatchEvent(event("pointermove", -0.2)));
    expect(divider.getAttribute("aria-valuenow")).toBe("0");
    expect(oldLayer.style.clipPath).toContain("100%");
    await flushViews(() => divider.dispatchEvent(event("pointerup", -0.2, { buttons: 0 })));
    expect(divider.releasePointerCapture).toHaveBeenCalledOnceWith(7);
    await flushViews(() => divider.dispatchEvent(event("pointermove", 0.8, { buttons: 0 })));
    expect(divider.getAttribute("aria-valuenow")).toBe("0");

    for (const [key, value] of [
      ["ArrowRight", 1],
      ["Home", 0],
      ["End", 100],
      ["PageDown", 90],
      ["PageUp", 100],
      ["ArrowLeft", 99],
    ]) {
      const keyboard = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await flushViews(() => divider.dispatchEvent(keyboard));
      expect(keyboard.defaultPrevented).toBe(true);
      expect(divider.getAttribute("aria-valuenow")).toBe(String(value));
      expect(divider.getAttribute("aria-valuetext")).toContain(`${value}%`);
    }
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      await flushViews(() => divider.dispatchEvent(tab));
      expect(tab.defaultPrevented).toBe(false);
      expect(divider.getAttribute("aria-valuenow")).toBe("99");
    }
    expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(2);
    expect(view.props.toggleRows).not.toHaveBeenCalled();
  });

  it("releases active pointer capture when image sources refresh or the layout changes", async () => {
    const patch = build([imageDiff()]);
    await mount(patch, "unified");
    await loaded();
    const beginDrag = async (pointerId) => {
      const divider = previews()[0].querySelector('[role="slider"]');
      const stage = previews()[0].querySelector(".git-panel-ImagePatchView-stage");
      const bounds = stage.getBoundingClientRect();
      let captured = false;
      const captureSpy = (method, callback) => {
        const spy = jasmine.isSpy(divider[method]) ? divider[method] : spyOn(divider, method);
        spy.calls.reset();
        spy.and.callFake(callback);
      };
      captureSpy("setPointerCapture", () => {
        captured = true;
      });
      captureSpy("hasPointerCapture", () => captured);
      captureSpy("releasePointerCapture", () => {
        captured = false;
      });
      await flushViews(() =>
        divider.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId,
            pointerType: "mouse",
            button: 0,
            buttons: 1,
            clientX: bounds.left + bounds.width / 4,
            clientY: bounds.top + bounds.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(divider.setPointerCapture).toHaveBeenCalledOnceWith(pointerId);
      expect(divider.getAttribute("aria-valuenow")).toBe("25");
      return divider;
    };
    const firstDivider = await beginDrag(9);
    const originalURLs = urls();
    const snapshot = own(patch.clone());
    await flushViews(() => view.update({ ...view.props, multiFilePatch: snapshot }));
    await loaded();
    expect(firstDivider.releasePointerCapture).toHaveBeenCalledOnceWith(9);
    expect(firstDivider.hasPointerCapture(9)).toBe(false);
    expect(previews()[0].querySelector('[role="slider"]').getAttribute("aria-valuenow")).toBe("25");
    expect(urls().every((url) => !originalURLs.includes(url))).toBe(true);

    const nextDivider = await beginDrag(10);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await loaded();
    expect(nextDivider.releasePointerCapture).toHaveBeenCalledOnceWith(10);
    expect(nextDivider.isConnected).toBe(false);
    expect(previews()[0].querySelector('[role="slider"]')).toBeNull();
    expect(
      repository.readFileAtEndpoint.calls
        .allArgs()
        .slice(0, 4)
        .every(([, , { signal }]) => signal.aborted),
    ).toBe(true);
    expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(6);
  });

  it("toggles full old and new on middle click without starting autoscroll or reacting to left clicks", async () => {
    await mount(build([imageDiff()]), "unified");
    await loaded();
    const preview = previews()[0];
    const divider = preview.querySelector('[role="slider"]');
    const image = preview.querySelector('[data-side="new"] img');
    const oldLayer = preview.querySelector(".git-panel-ImagePatchView-oldLayer");
    const click = (button) =>
      new MouseEvent("mousedown", {
        button,
        buttons: button === 1 ? 4 : 1,
        bubbles: true,
        cancelable: true,
      });
    await flushViews(() => image.dispatchEvent(click(0)));
    expect(divider.getAttribute("aria-valuenow")).toBe("50");
    for (const [value, clipped] of [
      ["100", "0%"],
      ["0", "100%"],
    ]) {
      const middle = click(1);
      await flushViews(() => image.dispatchEvent(middle));
      expect(middle.defaultPrevented).toBe(true);
      expect(divider.getAttribute("aria-valuenow")).toBe(value);
      expect(oldLayer.style.clipPath).toContain(clipped);
      const auxiliary = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
      await flushViews(() => image.dispatchEvent(auxiliary));
      expect(auxiliary.defaultPrevented).toBe(true);
      expect(divider.getAttribute("aria-valuenow")).toBe(value);
    }
    await flushViews(() => image.dispatchEvent(click(0)));
    expect(divider.getAttribute("aria-valuenow")).toBe("0");
    expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(2);
    expect(view.props.toggleRows).not.toHaveBeenCalled();
  });
});
