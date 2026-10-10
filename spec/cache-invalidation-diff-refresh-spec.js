/** @babel */
import fs from "fs";
import os from "os";
import path from "path";
import { Disposable } from "lumine";
import ChangedFileItem from "../lib/items/changed-file-item";
import GitRootController from "../lib/controllers/git-root-controller";
import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import Repository from "../lib/models/repository";
import WorkdirContextPool from "../lib/models/workdir-context-pool";
import { createRepoSym } from "../lib/models/workdir-context";
import { Keys } from "../lib/models/repository-states/cache/keys";
import { flushViews } from "./helpers/etch";

async function waitUntil(check) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Repository update did not finish");
}

describe("diff refreshes while the repository cache invalidates an in-flight patch", () => {
  let directory, coreRepository, repository, pool, item, container, stylesheet;
  let pendingReads, frame;

  beforeEach(async () => {
    jasmine.useRealClock();
    pendingReads = [];
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((root) => ({
      path: root,
      ready: Promise.resolve(),
      closed: Promise.resolve(),
      onDidChange: () => new Disposable(),
      onDidInvalidate: () => new Disposable(),
      onDidError: () => new Disposable(),
      dispose() {},
    }));
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-live-diff-refresh-")),
    );
    coreRepository = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    const strategy = new GitShellOutStrategy(directory);
    await strategy.setConfig("user.name", "Git Panel Diff Specs");
    await strategy.setConfig("user.email", "diffs@lumine.invalid");
    const lines = Array.from(
      { length: 1000 },
      (_, row) => `old ${row} ${"long content ".repeat(25)}`,
    );
    fs.writeFileSync(path.join(directory, "example.txt"), `${lines.join("\n")}\n`);
    await strategy.stageFiles(["example.txt"]);
    await strategy.commit("Initial lines", {});
    for (const start of [100, 400, 700]) {
      for (let row = start; row < start + 40; row++) lines[row] = lines[row].replace("old", "new");
    }
    fs.writeFileSync(path.join(directory, "example.txt"), `${lines.join("\n")}\n`);
    await coreRepository.refreshStatusSnapshot();
    repository = new Repository(directory, strategy);
    await repository.getLoadPromise();
    pool = new WorkdirContextPool();
    pool.add(directory, { [createRepoSym]: () => repository });
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1000px; height: 340px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    cancelAnimationFrame(frame);
    for (const read of pendingReads) read.release();
    await item?.destroy();
    item = null;
    const context = pool?.getContext(directory);
    pool?.clear();
    await context?.destroy();
    if (coreRepository) lumine.repositories.forget(coreRepository);
    container?.remove();
    stylesheet?.dispose();
    if (directory) {
      const tempRoot = fs.realpathSync.native(os.tmpdir());
      if (path.dirname(directory) !== tempRoot) throw new Error("Unexpected temporary repo path");
      await fs.promises.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    }
  });

  async function settle() {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(() => {});
      const elements = Array.from(item.element.querySelectorAll("lumine-text-editor"));
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
    }
  }

  async function refreshThroughEviction({ wrapped, kind, layout = "unified", unequal = false }) {
    if (unequal) {
      const filePath = path.join(directory, "example.txt");
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      for (const start of [100, 400, 700])
        for (let row = start; row < start + 40; row++) lines[row] = `new ${row} short`;
      fs.writeFileSync(filePath, lines.join("\n"));
      repository.observeFilesystemChange([{ action: "modified", path: filePath }]);
      await coreRepository.refreshStatusSnapshot();
    }
    const discardLines = jasmine
      .createSpy("discard real hunk")
      .and.callFake((...args) =>
        GitRootController.prototype.discardLines.call(
          { ensureNoUnsavedFiles: async () => true },
          ...args,
        ),
      );
    item = new ChangedFileItem({
      workdirContextPool: pool,
      workingDirectory: directory,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      initialDiffView: layout,
      workspace: lumine.workspace,
      config: lumine.config,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      surfaceFileAtPath: () => {},
      discardLines,
      undoLastDiscard: () => {},
    });
    container.appendChild(item.element);
    await item.getFilePatchLoadedPromise();
    await settle();
    const editor = item.refEditor.get();
    if (!wrapped) {
      editor.setSoftWrapped(false);
      await settle();
    }
    const patchView = item.refPatchController.get().refView.get();
    const pair = layout === "side-by-side" ? patchView.refSideBySide.get() : null;
    if (pair) expect(pair.initialScrollAnchor ?? null).toBeNull();
    const nativeEditors = () =>
      Array.from(item.element.querySelectorAll("lumine-text-editor"), (element) =>
        element.getModel(),
      );
    const element = editor.getElement();
    const component = element.getComponent();
    const buffer = editor.getBuffer();
    const displayRow = pair
      ? kind === "external"
        ? pair.projection.patchRowToDisplayRow.get(95)
        : pair.projection.hunkRanges.get(
            pair.props.multiFilePatch.getFilePatches()[0].getHunks()[1],
          )[0]
      : 95;
    const screenRow = editor.screenPositionForBufferPosition([displayRow, 0]).row;
    element.setScrollTop(
      component.pixelPositionBeforeBlocksForRow(screenRow) +
        (pair && kind !== "external" ? -30 : 7),
    );
    if (!wrapped) element.setScrollLeft(180);
    await settle();
    const top = element.getScrollTop();
    const left = element.getScrollLeft();
    expect(top).toBeGreaterThan(0);
    expect(editor.isSoftWrapped()).toBe(wrapped);
    if (!wrapped) expect(left).toBeGreaterThan(0);
    expect(item.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(3);
    const originals = nativeEditors().map((model) => {
      const element = model.getElement();
      const firstChangedDecoration = model
        .getDecorations({ type: "line" })
        .find((decoration) =>
          /git-panel-FilePatchView-line--(?:added|deleted)/.test(decoration.getProperties().class),
        );
      return {
        model,
        element,
        component: element.getComponent(),
        buffer: model.getBuffer(),
        marker: pair ? firstChangedDecoration?.getMarker() : null,
      };
    });
    if (pair) {
      expect(originals.length).toBe(2);
      expect(originals.every((entry) => entry.marker !== null)).toBe(true);
      expect(originals[0].element.getScrollTop()).toBeCloseTo(top, 0);
      if (unequal) expect(pair.wrapAlignment.padding[1].size).toBeGreaterThan(0);
    }

    const frames = [];
    const sample = () => {
      frames.push({
        editors: nativeEditors(),
        loading: Boolean(item.element.querySelector(".git-panel-Loader")),
        offsets: originals.map(({ component }) => [
          component.renderedScrollTop,
          component.renderedScrollLeft,
        ]),
      });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    let holdingReads = true;
    const strategy = repository.git;
    const originalDiffs = strategy.getDiffsForFilePath.bind(strategy);
    spyOn(strategy, "getDiffsForFilePath").and.callFake(async (...args) => {
      const diffs = await originalDiffs(...args);
      if (holdingReads) {
        let release;
        const held = new Promise((resolve) => (release = resolve));
        pendingReads.push({ release });
        await held;
      }
      return diffs;
    });
    const errors = [];
    const originalPatch = repository.getFilePatchForPath.bind(repository);
    spyOn(repository, "getFilePatchForPath").and.callFake((...args) => {
      const result = originalPatch(...args);
      result.catch((error) => errors.push(error));
      return result;
    });
    const stage = spyOn(repository, "applyPatchToIndex").and.callThrough();
    if (kind === "external") {
      const filePath = path.join(directory, "example.txt");
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      for (let row = 400; row < 440; row++) lines[row] = `old ${row} ${"long content ".repeat(25)}`;
      fs.writeFileSync(filePath, lines.join("\n"));
      repository.observeFilesystemChange([{ action: "modified", path: filePath }]);
      await coreRepository.refreshStatusSnapshot();
    } else {
      await flushViews(() => {
        const suffix = kind === "stage" ? "stageButton" : "discardButton";
        const button = item.element.querySelectorAll(`.git-panel-HunkHeaderView-${suffix}`)[1];
        if (pair) {
          expect(getComputedStyle(button).visibility).toBe("visible");
          const buttonRect = button.getBoundingClientRect();
          const viewport = element.getBoundingClientRect();
          expect(buttonRect.bottom).toBeGreaterThan(viewport.top);
          expect(buttonRect.top).toBeLessThan(viewport.bottom);
        }
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        button.focus();
        button.click();
      });
      const operation = kind === "stage" ? stage : discardLines;
      await operation.calls.mostRecent().returnValue;
      expect(operation).toHaveBeenCalledTimes(1);
    }
    await waitUntil(() => pendingReads.length === 1);
    repository.acceptInvalidation(() => [Keys.filePatch.all]);
    pendingReads[0].release();
    await waitUntil(() => pendingReads.length === 2);
    await settle();
    expect(errors.some((error) => error.name === "AbortError" && error.code === "ABORT_ERR")).toBe(
      true,
    );
    expect(item.element.querySelector(".git-panel-Loader")).toBeNull();
    expect(nativeEditors()).toEqual(originals.map(({ model }) => model));
    expect(editor.isDestroyed()).toBe(false);
    expect(item.refEditor.get()).toBe(editor);
    expect(item.refEditor.get().getBuffer()).toBe(buffer);
    expect(editor.isSoftWrapped()).toBe(wrapped);
    expect(element.getScrollTop()).toBeCloseTo(top, 0);
    expect(element.getScrollLeft()).toBeCloseTo(left, 0);

    holdingReads = false;
    pendingReads[1].release();
    await waitUntil(() => item.element.querySelectorAll(".git-panel-HunkHeaderView").length === 2);
    await settle();
    cancelAnimationFrame(frame);
    expect(item.refEditor.get()).toBe(editor);
    expect(item.refEditor.get().getBuffer()).toBe(buffer);
    expect(editor.isSoftWrapped()).toBe(wrapped);
    expect(item.refEditor.get().getText()).not.toContain("new 400 ");
    expect(item.refEditor.get().getText()).toContain("new 100 ");
    expect(item.refEditor.get().getText()).toContain("new 700 ");
    expect(element.getScrollTop()).toBeCloseTo(top, 0);
    expect(element.getScrollLeft()).toBeCloseTo(left, 0);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((paint) => !paint.loading)).toBe(true);
    expect(pool.getContext(directory).getRepository()).toBe(repository);
    expect(repository.isPresent()).toBe(true);
    originals.forEach((before, index) => {
      const current = nativeEditors()[index];
      expect(current).toBe(before.model);
      expect(current.getBuffer()).toBe(before.buffer);
      expect(current.getElement()).toBe(before.element);
      expect(current.getElement().getScrollTop()).toBeCloseTo(top, 0);
      expect(current.getElement().getScrollLeft()).toBeCloseTo(left, 0);
      expect(current.isSoftWrapped()).toBe(wrapped);
      if (before.marker) {
        const markers = current
          .getDecorations({ type: "line" })
          .map((decoration) => decoration.getMarker());
        expect(markers).toContain(before.marker);
      }
      expect(frames.every((paint) => paint.editors[index] === before.model)).toBe(true);
      expect(
        Math.max(...frames.map((paint) => Math.abs(paint.offsets[index][0] - top))),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...frames.map((paint) => Math.abs(paint.offsets[index][1] - left))),
      ).toBeLessThanOrEqual(1);
    });
    if (pair) {
      expect(
        Math.max(...frames.map((paint) => Math.abs(paint.offsets[0][0] - paint.offsets[1][0]))),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...frames.map((paint) => Math.abs(paint.offsets[0][1] - paint.offsets[1][1]))),
      ).toBeLessThanOrEqual(1);
      if (unequal) expect(pair.wrapAlignment.padding[1].size).toBeGreaterThan(0);
    }
  }

  for (const scenario of [
    { wrapped: true, kind: "stage" },
    { wrapped: false, kind: "stage" },
    { wrapped: true, kind: "delete" },
    { wrapped: false, kind: "external" },
    { wrapped: true, kind: "stage", layout: "side-by-side" },
    { wrapped: true, kind: "stage", layout: "side-by-side", unequal: true },
    { wrapped: true, kind: "external", layout: "side-by-side", unequal: true },
  ]) {
    it(`keeps a ${scenario.wrapped ? "wrapped" : "unwrapped"} real ${scenario.layout || "unified"} changed-file pane ${scenario.unequal ? "with unequal line lengths " : ""}stable after ${scenario.kind} updates supersede its cache read`, async () => {
      await refreshThroughEviction(scenario);
    }, 30000);
  }
});
