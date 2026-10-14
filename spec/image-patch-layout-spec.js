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
      const [oldSide, newSide] = previews()[0].querySelectorAll("figure");
      expect([oldSide.dataset.side, newSide.dataset.side]).toEqual(["old", "new"]);
      expect(oldSide.textContent).toContain("Index");
      expect(newSide.textContent).toContain("Working Tree");
      expect(oldSide.getBoundingClientRect().right).toBeLessThanOrEqual(
        newSide.getBoundingClientRect().left,
      );
      for (const img of previews()[0].querySelectorAll("img")) {
        expect(img.src.startsWith("blob:")).toBe(true);
        expect(img.naturalWidth).toBe(160);
        expect(img.naturalHeight).toBe(260);
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
      expect(added.querySelector('[data-side="old"]').textContent).toContain(
        "File absent in this version",
      );
      expect(deleted.querySelector('[data-side="new"] img')).toBeNull();
      expect(deleted.querySelector('[data-side="new"]').textContent).toContain(
        "File absent in this version",
      );
      expect(renamed.querySelector('[data-side="old"] img').alt).toBe("Old: old-name.png");
      expect(renamed.querySelector('[data-side="new"] img').alt).toBe("New: new-name.png");
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
      expect(repository.readFileAtEndpoint).toHaveBeenCalledTimes(6);
      expect(urls().every((url) => !refreshedURLs.includes(url))).toBe(true);
      expect(snapshot.getBuffer().isEmpty()).toBe(true);
    });
  }
});
