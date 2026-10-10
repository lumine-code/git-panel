/** @babel */
import path from "path";
import { Emitter } from "lumine";
import GitPackage from "../lib/git-package";
import ChangedFileItem from "../lib/items/changed-file-item";
import PaneItem from "../lib/lumine/pane-item";
import { buildFilePatch } from "../lib/models/patch";
import StagingView from "../lib/views/staging-view";
import { h, flushViews } from "./helpers/etch";

describe("pending patch pane item reuse", () => {
  let registration, emitter, repository, pool, pane, factory, readPatch;
  let patches, deferredReads, openedPromises, stylesheet;
  const workingDirectory = path.join(__dirname, "pending-patch-workdir");

  const uriFor = (relPath, stagingStatus = "unstaged", workdir = workingDirectory) =>
    ChangedFileItem.buildURI(relPath, workdir, stagingStatus);

  const readKey = (relPath, staged) => `${staged ? "staged" : "unstaged"}:${relPath}`;

  function patchFor(relPath, staged = false) {
    const key = readKey(relPath, staged);
    if (!patches.has(key)) {
      patches.set(
        key,
        buildFilePatch([
          {
            oldPath: relPath,
            newPath: relPath,
            status: "modified",
            oldMode: "100644",
            newMode: "100644",
            hunks: [
              {
                oldStartLine: 1,
                oldLineCount: 2,
                newStartLine: 1,
                newLineCount: 2,
                heading: "",
                lines: [" keep", `-before ${key}`, `+after ${key}`],
              },
            ],
          },
        ]),
      );
    }
    return patches.get(key);
  }

  function deferRead(relPath, staged = false) {
    let resolve, reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const gate = { promise, resolve, reject, relPath, staged };
    deferredReads.set(readKey(relPath, staged), gate);
    return gate;
  }

  function longPatchFor(relPath) {
    const key = readKey(relPath, false);
    const patch = buildFilePatch(
      [
        {
          oldPath: relPath,
          newPath: relPath,
          status: "modified",
          oldMode: "100644",
          newMode: "100644",
          hunks: [0, 1].map((section) => ({
            oldStartLine: section * 200 + 1,
            oldLineCount: 60,
            newStartLine: section * 200 + 1,
            newLineCount: 60,
            heading: `section ${section}`,
            lines: Array.from({ length: 60 }, (_, row) => [
              `-before ${key} ${section}:${row} ${"long before words ".repeat(12)}`,
              `+after ${key} ${section}:${row} ${"long after words ".repeat(12)}`,
            ]).flat(),
          })),
        },
      ],
      { largeDiffThreshold: Infinity },
    );
    patches.set(key, patch);
    return patch;
  }

  function open(uri, options = {}) {
    const promise = lumine.workspace.open(uri, { pending: true, ...options });
    openedPromises.push(promise);
    promise.catch(() => {});
    return promise;
  }

  async function waitForRead(relPath, staged = false) {
    for (let tick = 0; tick < 10000; tick++) {
      if (
        readPatch.calls
          .allArgs()
          .some(([readPath, options]) => readPath === relPath && options.staged === staged)
      )
        return;
      await Promise.resolve();
    }
    throw new Error(`The pending preview did not request ${readKey(relPath, staged)}`);
  }

  async function initialItem(relPath = "one.txt") {
    const item = await open(uriFor(relPath));
    await flushViews(() => {});
    await item.getFilePatchLoadedPromise();
    return item;
  }

  async function settleEditors(item) {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(() => {});
      const elements = Array.from(item.getElement().querySelectorAll("lumine-text-editor"));
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  beforeEach(() => {
    lumine.config.set("core.allowPendingPaneItems", true);
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    pane = lumine.workspace.getCenter().getActivePane();
    emitter = new Emitter();
    patches = new Map();
    deferredReads = new Map();
    openedPromises = [];
    stylesheet = null;
    readPatch = jasmine.createSpy("read patch").and.callFake((relPath, { staged }) => {
      return deferredReads.get(readKey(relPath, staged))?.promise ?? patchFor(relPath, staged);
    });
    repository = {
      isLoading: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getFilePatchForPath: readPatch,
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
    };
    pool = {
      retain: jasmine.createSpy("retain observation").and.callFake(() => ({
        context: { getRepository: () => repository },
        ready: Promise.resolve(),
        dispose: jasmine.createSpy("release observation"),
      })),
      onDidChangePoolContexts: () => ({ dispose() {} }),
    };
    factory = jasmine
      .createSpy("create patch pane item")
      .and.callFake((options) =>
        GitPackage.prototype.createFilePatchPaneItem.call({ controller: null }, options),
      );
    registration = new PaneItem({
      workspace: lumine.workspace,
      uriPattern: ChangedFileItem.uriPattern,
      createPaneItem: factory,
      canReusePendingItem: (view, params) => view.canReusePendingItem(params),
      reusePendingItem: (view, params, options) => view.reusePendingItem(params, options),
      children: ({ itemHolder, params }) =>
        h(ChangedFileItem, {
          ref: itemHolder.setter,
          workdirContextPool: pool,
          relPath: path.join(...params.relPath),
          workingDirectory: params.workingDirectory,
          stagingStatus: params.stagingStatus,
          workspace: lumine.workspace,
          commands: lumine.commands,
          keymaps: lumine.keymaps,
          config: lumine.config,
          tooltips: lumine.tooltips,
        }),
    });
  });

  afterEach(async () => {
    for (const gate of deferredReads.values()) gate.resolve(patchFor(gate.relPath, gate.staged));
    await Promise.allSettled(openedPromises);
    await registration?.destroy();
    for (const patch of patches.values()) patch.dispose();
    emitter?.dispose();
    stylesheet?.dispose();
  });

  it("keeps the host, view and editor while publishing the new path, stage and URI", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const buffer = editor.getBuffer();
    const nextPath = path.join("nested", "two.txt");
    const nextURI = uriFor(nextPath, "staged");
    const changedURI = jasmine.createSpy("changed URI");
    const changedTitle = jasmine.createSpy("changed title");
    item.onDidChangeURI(changedURI);
    item.onDidChangeTitle(changedTitle);

    expect(await open(nextURI)).toBe(item);
    await flushViews(() => {});

    expect(factory).toHaveBeenCalledTimes(1);
    expect(item.getHydratedView()).toBe(view);
    expect(view.refEditor.get()).toBe(editor);
    expect(editor.getBuffer()).toBe(buffer);
    expect(editor.getText()).toContain(`after staged:${nextPath}`);
    expect(view.getFilePath()).toBe(nextPath);
    expect(view.getStagingStatus()).toBe("staged");
    expect(item.getURI()).toBe(nextURI);
    expect(item.getTitle()).toBe(`Staged Changes: ${nextPath}`);
    expect(item.serialize()).toEqual({ deserializer: "FilePatchControllerStub", uri: nextURI });
    expect(changedURI).toHaveBeenCalledTimes(1);
    expect(changedTitle).toHaveBeenCalledTimes(1);
    expect(pane.itemForURI(nextURI)).toBe(item);
    expect(pane.itemForURI(uriFor("one.txt"))).toBeFalsy();
    expect(pane.getPendingItem()).toBe(item);
    expect(pool.retain).toHaveBeenCalledTimes(1);

    await flushViews(() => registration.update({ ...registration.props }));
    expect(view.getFilePath()).toBe(nextPath);
    const copy = item.copy();
    await flushViews(() => {});
    expect(copy.getURI()).toBe(nextURI);
    expect(copy.serialize().uri).toBe(nextURI);
    expect(copy.getHydratedView().getFilePath()).toBe(nextPath);
    expect(copy.getHydratedView().getStagingStatus()).toBe("staged");
  });

  it("keeps the displayed patch until ready and lets the newest selection win", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const originalText = editor.getText();
    const previous = deferRead("two.txt");
    const latest = deferRead("three.txt");
    const previousOpen = open(uriFor("two.txt"));
    await waitForRead("two.txt");

    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getFilePath()).toBe("one.txt");
    expect(editor.getText()).toBe(originalText);
    expect(view.refEditor.get()).toBe(editor);

    const latestOpen = open(uriFor("three.txt"));
    await waitForRead("three.txt");
    latest.resolve(patchFor("three.txt"));
    expect(await latestOpen).toBe(item);
    previous.resolve(patchFor("two.txt"));
    expect(await previousOpen).toBeUndefined();
    await flushViews(() => {});

    expect(item.getURI()).toBe(uriFor("three.txt"));
    expect(view.getFilePath()).toBe("three.txt");
    expect(view.refEditor.get()).toBe(editor);
    expect(editor.getText()).toContain("after unstaged:three.txt");
    expect(editor.getText()).not.toContain("after unstaged:two.txt");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  for (const layout of ["unified", "side-by-side"]) {
    it(`resets selection and scroll while retaining ${layout} editors and the chosen layout`, async () => {
      stylesheet = lumine.themes.requireStylesheet(
        path.join(__dirname, "..", "styles", "main.css"),
      );
      longPatchFor("deep-one.txt");
      longPatchFor("deep-two.txt");
      const item = await initialItem("deep-one.txt");
      item.getElement().style.cssText = "display: flex; width: 760px; height: 340px;";
      const view = item.getHydratedView();
      const controller = view.refPatchController.get();
      const initialPatchView = controller.refView.get();
      // Set the view-owned wrapping preference before scoped initialization
      // and native measurements, so both columns start with a horizontal range.
      initialPatchView.layoutViewportPreferences = {
        unified: { softWrapped: false, leftColumn: 0 },
        "side-by-side": { softWrapped: false, leftColumn: 0 },
      };
      await flushViews(() => initialPatchView.invalidate());
      await flushViews(() => controller.setDiffView(layout));
      const patchView = controller.refView.get();
      const pair = patchView.refSideBySide.getOr(null);
      const editors = pair
        ? [pair.editors.old.get(), pair.editors.new.get()]
        : [view.refEditor.get()];
      await settleEditors(item);
      for (const editor of editors) expect(editor.isSoftWrapped()).toBe(false);
      pair?.releaseInitialScrollAnchor();
      const secondHunk = controller.props.multiFilePatch.getFilePatches()[0].getHunks()[1];
      patchView.setCanonicalSelectionRanges([secondHunk.getRange()], { autoscroll: false });
      await settleEditors(item);
      // Manual fixture scrolling represents input taking over after selection.
      // Release the passive selection/layout anchors as a real gesture does.
      pair?.releasePatchViewport();
      patchView.fullWidthHeaders.releaseViewport();
      const canonicalRow = secondHunk.getRange().start.row;
      const row = pair ? pair.projection.patchRowToDisplayRow.get(canonicalRow) : canonicalRow;
      for (const editor of editors) {
        const element = editor.getElement();
        element.getComponent().scrollAnimator.cancel();
        element.setScrollTop(element.getComponent().pixelPositionBeforeBlocksForRow(row) + 7);
        element.setScrollLeft(180);
      }
      await settleEditors(item);
      const previous = editors.map((editor) => ({
        editor,
        element: editor.getElement(),
        buffer: editor.getBuffer(),
      }));
      for (const { element } of previous) {
        expect(element.getScrollTop())
          .withContext(`${layout} vertical fixture offset`)
          .toBeGreaterThan(0);
        expect(element.getScrollLeft())
          .withContext(`${layout} horizontal fixture offset`)
          .toBeGreaterThan(0);
      }
      expect(Math.min(...controller.state.selectedRows)).toBeGreaterThan(0);

      expect(await open(uriFor("deep-two.txt"))).toBe(item);
      await settleEditors(item);

      expect(item.getHydratedView()).toBe(view);
      expect(view.refPatchController.get()).toBe(controller);
      expect(controller.refView.get()).toBe(patchView);
      expect(controller.getDiffView()).toBe(layout);
      const currentPair = patchView.refSideBySide.getOr(null);
      expect(currentPair).toBe(pair);
      const currentEditors = currentPair
        ? [currentPair.editors.old.get(), currentPair.editors.new.get()]
        : [view.refEditor.get()];
      currentEditors.forEach((editor, index) => {
        expect(editor).toBe(previous[index].editor);
        expect(editor.getElement()).toBe(previous[index].element);
        expect(editor.getBuffer()).toBe(previous[index].buffer);
        expect(editor.getElement().getScrollTop()).toBeCloseTo(0, 0);
        expect(editor.getElement().getScrollLeft()).toBeCloseTo(0, 0);
        expect(editor.getText()).toContain("unstaged:deep-two.txt");
      });
      const firstHunk = controller.props.multiFilePatch.getFilePatches()[0].getHunks()[0];
      expect(patchView.getCanonicalSelectionRanges()).toEqual([firstHunk.getRange()]);
      expect(controller.state.selectionMode).toBe("hunk");
      expect(factory).toHaveBeenCalledTimes(1);
    });
  }

  it("does not inherit the previous document's collapsed render status", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const currentPatch = view.refPatchController.get().props.multiFilePatch;
    currentPatch.collapseFilePatch(currentPatch.getFilePatches()[0]);
    await flushViews(() => {});
    expect(currentPatch.getFilePatches()[0].getRenderStatus().isVisible()).toBe(false);

    expect(await open(uriFor("two.txt"))).toBe(item);
    await flushViews(() => {});

    const nextPatch = view.refPatchController.get().props.multiFilePatch;
    expect(nextPatch.getFilePatches()[0].getRenderStatus().isVisible()).toBe(true);
    expect(nextPatch.getFilePatches()[0].getHunks().length).toBe(1);
    expect(readPatch.calls.mostRecent().args[1].builder.renderStatusOverrides).toBeUndefined();
  });

  it("retains the previous patch and pending state when the replacement read fails", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const originalText = editor.getText();
    const failed = deferRead("two.txt");
    const nextOpen = open(uriFor("two.txt"));
    await waitForRead("two.txt");
    const error = new Error("Unable to read replacement patch");
    failed.reject(error);

    await expectAsync(nextOpen).toBeRejectedWith(error);
    await flushViews(() => {});
    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getFilePath()).toBe("one.txt");
    expect(view.refEditor.get()).toBe(editor);
    expect(editor.getText()).toBe(originalText);
    expect(pane.getPendingItem()).toBe(item);
    expect(item.isDestroyed()).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("cancels a disposed replacement patch without modifying the displayed document", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const originalText = editor.getText();
    const disposedPatch = patchFor("two.txt");
    disposedPatch.dispose();

    expect(await open(uriFor("two.txt"))).toBeUndefined();
    await flushViews(() => {});

    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getFilePath()).toBe("one.txt");
    expect(editor.getText()).toBe(originalText);
    expect(pane.getPendingItem()).toBe(item);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("preserves the previous document when cloning the replacement patch fails", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const originalText = editor.getText();
    const target = patchFor("two.txt");
    const error = new Error("Unable to clone replacement patch");
    spyOn(target, "clone").and.throwError(error);

    await expectAsync(open(uriFor("two.txt"))).toBeRejectedWith(error);
    await flushViews(() => {});

    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getFilePath()).toBe("one.txt");
    expect(item.getTitle()).toBe("Unstaged Changes: one.txt");
    expect(item.serialize().uri).toBe(uriFor("one.txt"));
    expect(view.refEditor.get()).toBe(editor);
    expect(editor.getText()).toBe(originalText);
    expect(pane.getPendingItem()).toBe(item);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("ignores an earlier repository refresh after committing another preview", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const refresh = deferRead("one.txt");
    readPatch.calls.reset();
    emitter.emit("did-update");
    await waitForRead("one.txt");

    expect(await open(uriFor("two.txt"))).toBe(item);
    refresh.resolve(patchFor("one.txt"));
    await flushViews(() => {});

    expect(item.getURI()).toBe(uriFor("two.txt"));
    expect(view.getFilePath()).toBe("two.txt");
    expect(view.refEditor.get()).toBe(editor);
    expect(editor.getText()).toContain("after unstaged:two.txt");
    expect(editor.getText()).not.toContain("after unstaged:one.txt");
  });

  it("cancels a replacement when the current preview becomes permanent", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const originalText = editor.getText();
    const next = deferRead("two.txt");
    const nextOpen = open(uriFor("two.txt"));
    await waitForRead("two.txt");

    expect(await open(uriFor("one.txt"), { pending: false })).toBe(item);
    next.resolve(patchFor("two.txt"));
    expect(await nextOpen).toBeUndefined();
    await flushViews(() => {});
    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getFilePath()).toBe("one.txt");
    expect(editor.getText()).toBe(originalText);
    expect(pane.getPendingItem()).toBeNull();
  });

  it("does not adopt a replacement after the preview has been closed", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const next = deferRead("two.txt");
    const nextOpen = open(uriFor("two.txt"));
    await waitForRead("two.txt");

    await pane.destroyItem(item);
    next.resolve(patchFor("two.txt"));
    expect(await nextOpen).toBeUndefined();
    await flushViews(() => {});
    expect(item.isDestroyed()).toBe(true);
    expect(view.getFilePath()).toBe("one.txt");
    expect(lumine.workspace.getPaneItems()).not.toContain(item);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("constructs a separate item for a permanent open", async () => {
    const item = await initialItem();
    const next = await open(uriFor("two.txt"), { pending: false });
    await flushViews(() => {});

    expect(next).not.toBe(item);
    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(item.isDestroyed()).toBe(true);
    expect(pane.getPendingItem()).toBeNull();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("uses ordinary pending replacement for another working directory", async () => {
    const item = await initialItem();
    const otherWorkdir = path.join(__dirname, "another-pending-patch-workdir");
    const nextURI = uriFor("two.txt", "unstaged", otherWorkdir);
    const next = await open(nextURI);
    await flushViews(() => {});

    expect(next).not.toBe(item);
    expect(item.isDestroyed()).toBe(true);
    expect(next.getURI()).toBe(nextURI);
    expect(next.getHydratedView().getWorkingDirectory()).toBe(otherWorkdir);
    expect(pane.getPendingItem()).toBe(next);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("staging selection preview activation", () => {
  it("activates a pending item while preserving focus in the staging panel", async () => {
    const item = {};
    const pane = { activateItem: jasmine.createSpy("activate item") };
    const open = jasmine.createSpy("open preview").and.resolveTo(item);
    const view = {
      props: {
        workingDirectoryPath: "example-repository",
        workspace: { open, paneForItem: () => pane },
      },
    };

    await StagingView.prototype.showFilePatchItem.call(view, "example.txt", "unstaged", {
      activate: false,
      pane,
    });

    expect(open).toHaveBeenCalledOnceWith(
      ChangedFileItem.buildURI("example.txt", "example-repository", "unstaged"),
      { pending: true, activatePane: false, activateItem: true, pane },
    );
  });
});
