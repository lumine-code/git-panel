/** @babel */
import path from "path";
import { Emitter } from "lumine";
import GitPackage from "../lib/git-package";
import PatchItem from "../lib/items/patch-item";
import PatchDocument from "../lib/models/patch-document";
import Commit from "../lib/models/commit";
import PaneItem from "../lib/lumine/pane-item";
import { buildFilePatch, buildMultiFilePatch } from "../lib/models/patch";
import StagingView from "../lib/views/staging-view";
import { h, flushViews } from "./helpers/etch";

const navigationAdapter = require("../lib/navigation-adapter");

describe("pending patch pane item reuse", () => {
  let registration, emitter, repository, pool, pane, factory, readPatch;
  let patches, deferredReads, openedPromises, stylesheet, repositories, leases, commits;
  let surfaceDocument, readyGates;
  const workingDirectory = path.join(__dirname, "pending-patch-workdir");

  const uriFor = (relPath, stagingStatus = "unstaged", workdir = workingDirectory) =>
    PatchDocument.file(workdir, relPath, stagingStatus).getURI();

  const readKey = (relPath, staged, workdir = workingDirectory) =>
    `${workdir === workingDirectory ? "" : `${workdir}|`}${staged ? "staged" : "unstaged"}:${relPath}`;

  function patchFor(relPath, staged = false, workdir = workingDirectory) {
    const key = readKey(relPath, staged, workdir);
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

  function deferRead(relPath, staged = false, workdir = workingDirectory) {
    let resolve, reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const gate = { promise, resolve, reject, relPath, staged, workdir };
    deferredReads.set(readKey(relPath, staged, workdir), gate);
    return gate;
  }

  function multiPatchFor(workdir) {
    const key = `${workdir}|staged-all`;
    if (!patches.has(key)) {
      const source = patchFor("all-one.txt", true, workdir);
      const other = patchFor("all-two.txt", true, workdir);
      const raw = [source, other].map((patch) => {
        const file = patch.getFilePatches()[0];
        const relPath = file.getPath();
        return {
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
              lines: [
                " keep",
                `-before all ${workdir}:${relPath}`,
                `+after all ${workdir}:${relPath}`,
              ],
            },
          ],
        };
      });
      patches.set(key, buildMultiFilePatch(raw));
    }
    return patches.get(key);
  }

  function commitFor(workdir, sha) {
    const key = `${workdir}|commit:${sha}`;
    if (!commits.has(key)) {
      const commit = new Commit({
        sha,
        author: {
          getEmail: () => "author@example.com",
          getFullName: () => "Author",
          getAvatarUrl: () => null,
        },
        authorDate: 1,
        messageSubject: `Subject ${sha}`,
        messageBody: "",
      });
      commit.setMultiFileDiff(multiPatchFor(workdir).clone());
      commits.set(key, commit);
    }
    return commits.get(key);
  }

  function repositoryFor(workdir) {
    if (repositories.has(workdir)) return repositories.get(workdir);
    const events = workdir === workingDirectory ? emitter : new Emitter();
    const next = {
      events,
      isLoading: () => false,
      getWorkingDirectoryPath: () => workdir,
      onDidUpdate: (callback) => events.on("did-update", callback),
      getFilePatchForPath:
        workdir === workingDirectory
          ? readPatch
          : jasmine
              .createSpy(`read ${workdir}`)
              .and.callFake(
                (relPath, { staged }) =>
                  deferredReads.get(readKey(relPath, staged, workdir))?.promise ??
                  patchFor(relPath, staged, workdir),
              ),
      getStagedChangesPatch: jasmine
        .createSpy(`read staged ${workdir}`)
        .and.callFake(() => multiPatchFor(workdir)),
      getCommit: jasmine
        .createSpy(`read commit ${workdir}`)
        .and.callFake((sha) => commitFor(workdir, sha)),
      getCurrentBranch: () => ({ getName: () => "main" }),
      getRemoteForBranch: () => ({ isGithubRepo: () => false }),
      isCommitPushed: () => false,
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
      applyPatchToIndex: jasmine.createSpy(`apply patch ${workdir}`).and.resolveTo(),
      stageFiles: jasmine.createSpy(`stage files ${workdir}`).and.resolveTo(),
      unstageFiles: jasmine.createSpy(`unstage files ${workdir}`).and.resolveTo(),
    };
    repositories.set(workdir, next);
    return next;
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
    await item.getPatchLoadedPromise();
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
    repositories = new Map();
    leases = [];
    commits = new Map();
    readyGates = new Map();
    surfaceDocument = jasmine.createSpy("surface document");
    openedPromises = [];
    stylesheet = null;
    readPatch = jasmine.createSpy("read patch").and.callFake((relPath, { staged }) => {
      return deferredReads.get(readKey(relPath, staged))?.promise ?? patchFor(relPath, staged);
    });
    repository = repositoryFor(workingDirectory);
    pool = {
      retain: jasmine.createSpy("retain observation").and.callFake((directory) => {
        const lease = {
          directory,
          context: { getRepository: () => repositoryFor(directory) },
          ready: readyGates.get(directory)?.promise ?? Promise.resolve(),
          dispose: jasmine.createSpy(`release observation ${directory}`),
        };
        leases.push(lease);
        return lease;
      }),
      onDidChangePoolContexts: () => ({ dispose() {} }),
    };
    factory = jasmine
      .createSpy("create patch pane item")
      .and.callFake((options) =>
        GitPackage.prototype.createPatchPaneItem.call({ controller: null }, options),
      );
    registration = new PaneItem({
      workspace: lumine.workspace,
      uriPattern: PatchDocument.uriPattern,
      createPaneItem: factory,
      canReusePendingItem: (view, { document }) => view.canReusePendingItem(document),
      reusePendingItem: (view, { document }, options) => view.reusePendingItem(document, options),
      children: ({ itemHolder, params }) =>
        h(PatchItem, {
          ref: itemHolder.setter,
          workdirContextPool: pool,
          document: params.document,
          workspace: lumine.workspace,
          commands: lumine.commands,
          keymaps: lumine.keymaps,
          config: lumine.config,
          tooltips: lumine.tooltips,
          surfaceDocument,
        }),
    });
  });

  afterEach(async () => {
    for (const gate of deferredReads.values())
      gate.resolve(patchFor(gate.relPath, gate.staged, gate.workdir));
    for (const gate of readyGates.values()) gate.resolve();
    await Promise.allSettled(openedPromises);
    await registration?.destroy();
    for (const patch of patches.values()) patch.dispose();
    for (const commit of commits.values()) commit.dispose();
    for (const repo of repositories.values()) repo.events.dispose();
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
    expect(item.serialize()).toEqual({ deserializer: "PatchPaneItem", uri: nextURI });
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

  it("replaces the observed navigation outline across file, staged-all and commit pending previews", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const buffer = editor.getBuffer();
    const updates = [];
    const subscription = navigationAdapter.observeHeaders(item, (headers, options) => {
      expect(options).toEqual({ instant: true });
      updates.push(headers);
    });
    try {
      expect(navigationAdapter.handlesItem(item)).toBe(true);
      expect(updates.at(-1).map((file) => file.text)).toEqual(["one.txt"]);
      expect(updates.at(-1)[0].children.map((chunk) => chunk.text)).toEqual(["@@ -1,2 +1,2 @@"]);
      const stale = updates.at(-1)[0].children[0];
      const commit = commitFor(workingDirectory, "navigation-commit");
      commit.setMultiFileDiff(patchFor("committed.txt").clone());
      const documents = [
        [PatchDocument.staged(workingDirectory), ["all-one.txt", "all-two.txt"]],
        [PatchDocument.commit(workingDirectory, "navigation-commit"), ["committed.txt"]],
      ];
      for (const [document, files] of documents) {
        expect(await open(document.getURI())).toBe(item);
        await settleEditors(item);
        expect(item.getHydratedView()).toBe(view);
        expect(view.refEditor.get()).toBe(editor);
        expect(editor.getBuffer()).toBe(buffer);
        const outline = updates.at(-1);
        expect(outline.map((file) => file.text)).toEqual(files);
        expect(outline.every((file) => file.children.length === 1)).toBe(true);
        expect(outline.every((file) => file.id.includes(document.getURI()))).toBe(true);
        const ranges = editor.getSelectedBufferRanges();
        const updateCount = updates.length;
        await navigationAdapter.navigateTo(item, stale, { focus: false });
        expect(editor.getSelectedBufferRanges()).toEqual(ranges);
        expect(updates).toHaveSize(updateCount);
      }
    } finally {
      subscription.dispose();
    }
  });

  it("refreshes observed chunks from the repository and ignores a saved header from the old snapshot", async () => {
    const source = longPatchFor("navigation.txt");
    const item = await initialItem("navigation.txt");
    const editor = item.getHydratedView().refEditor.get();
    const updates = [];
    const subscription = navigationAdapter.observeHeaders(item, (headers) => updates.push(headers));
    try {
      const initial = updates.at(-1)[0];
      expect(initial.children).toHaveSize(2);
      expect(initial.children[1].text).toContain("section 1");
      const stale = initial.children[1];
      const refreshed = source.getStagePatchForHunk(source.getFilePatches()[0].getHunks()[0]);
      patches.set(readKey("navigation.txt", false), refreshed);
      source.dispose();
      readPatch.calls.reset();
      emitter.emit("did-update");
      await waitForRead("navigation.txt");
      await settleEditors(item);

      expect(item.getHydratedView().refEditor.get()).toBe(editor);
      const outline = updates.at(-1);
      expect(outline.map((file) => file.text)).toEqual(["navigation.txt"]);
      expect(outline[0].children).toHaveSize(1);
      expect(outline[0].children[0].text).toContain("section 0");
      expect(outline[0].patch).not.toBe(initial.patch);
      expect(editor.getText()).not.toContain("navigation.txt 1:");
      const ranges = editor.getSelectedBufferRanges();
      const updateCount = updates.length;
      await navigationAdapter.navigateTo(item, stale, { focus: false });
      expect(editor.getSelectedBufferRanges()).toEqual(ranges);
      expect(updates).toHaveSize(updateCount);
    } finally {
      subscription.dispose();
    }
  });

  it("stops adapter updates after unsubscribe and after the observed pane host closes", async () => {
    const item = await initialItem();
    const unsubscribed = jasmine.createSpy("unsubscribed navigation updates");
    const stopped = navigationAdapter.observeHeaders(item, unsubscribed);
    expect(unsubscribed).toHaveBeenCalled();
    stopped.dispose();
    const stoppedCount = unsubscribed.calls.count();
    expect(await open(uriFor("two.txt"))).toBe(item);
    await settleEditors(item);
    expect(unsubscribed.calls.count()).toBe(stoppedCount);

    const active = jasmine.createSpy("active navigation updates");
    const subscription = navigationAdapter.observeHeaders(item, active);
    try {
      const stale = active.calls.mostRecent().args[0][0].children[0];
      expect(await open(PatchDocument.staged(workingDirectory).getURI())).toBe(item);
      await settleEditors(item);
      expect(active.calls.mostRecent().args[0].map((file) => file.text)).toEqual([
        "all-one.txt",
        "all-two.txt",
      ]);
      await pane.destroyItem(item);
      const closedCount = active.calls.count();
      emitter.emit("did-update");
      await flushViews(() => {});
      await navigationAdapter.navigateTo(item, stale, { focus: false });
      expect(item.isDestroyed()).toBe(true);
      expect(active.calls.count()).toBe(closedCount);
      expect(unsubscribed.calls.count()).toBe(stoppedCount);
    } finally {
      subscription.dispose();
    }
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

  it("clears an initial commit host's icon when its document becomes a file patch", async () => {
    const item = await open(PatchDocument.commit(workingDirectory, "initial-commit").getURI());
    await flushViews(() => {});
    await item.getPatchLoadedPromise();
    expect(item.getIconName()).toBe("git-commit");
    const changedIcon = jasmine.createSpy("changed icon");
    item.onDidChangeIcon(changedIcon);
    expect(await open(uriFor("one.txt"))).toBe(item);
    await flushViews(() => {});
    expect(item.getIconName()).toBeNull();
    expect(changedIcon).toHaveBeenCalledTimes(1);
    expect(item.getURI()).toBe(uriFor("one.txt"));
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

  it("rejects an already cloned replacement whose cached source is disposed before adoption", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const container = view.refContainer.get();
    const target = patchFor("two.txt");
    const prepare = container.prepareNavigationData.bind(container);
    let candidateBuffer;
    spyOn(container, "prepareNavigationData").and.callFake((data) => {
      const prepared = prepare(data);
      candidateBuffer = prepared.data.multiFilePatch.getBuffer();
      target.dispose();
      return prepared;
    });
    expect(await open(uriFor("two.txt"))).toBeUndefined();
    await flushViews(() => {});
    expect(candidateBuffer.isDestroyed()).toBe(true);
    expect(view.refEditor.get().getText()).toContain("unstaged:one.txt");
    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getFilePath()).toBe("one.txt");
    expect(pane.getPendingItem()).toBe(item);
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

  it("reuses the pending preview for another working directory and transfers its observation", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const editor = view.refEditor.get();
    const oldLease = leases[0];
    const otherWorkdir = path.join(__dirname, "another-pending-patch-workdir");
    const nextURI = uriFor("two.txt", "unstaged", otherWorkdir);
    const next = await open(nextURI);
    await flushViews(() => {});

    expect(next).toBe(item);
    expect(item.isDestroyed()).toBe(false);
    expect(next.getURI()).toBe(nextURI);
    expect(next.getHydratedView()).toBe(view);
    expect(view.getWorkingDirectory()).toBe(otherWorkdir);
    expect(view.refEditor.get()).toBe(editor);
    expect(view.refPatchController.get().props.repository).toBe(repositoryFor(otherWorkdir));
    expect(pane.getPendingItem()).toBe(next);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(pool.retain).toHaveBeenCalledTimes(2);
    expect(oldLease.dispose).toHaveBeenCalledTimes(1);
    expect(leases[1].dispose).not.toHaveBeenCalled();
    await pane.destroyItem(item);
    expect(leases[1].dispose).toHaveBeenCalledTimes(1);
  });

  for (const layout of ["unified", "side-by-side"]) {
    it(`shares ${layout} editors, buffers and layout across every patch document and repository`, async () => {
      const item = await initialItem();
      const view = item.getHydratedView();
      const controller = view.refPatchController.get();
      await flushViews(() => controller.setDiffView(layout));
      await settleEditors(item);
      const patchView = controller.refView.get();
      const pair = patchView.refSideBySide.getOr(null);
      const editors = pair
        ? [pair.editors.old.get(), pair.editors.new.get()]
        : [view.refEditor.get()];
      const buffers = editors.map((editor) => editor.getBuffer());
      const otherWorkdir = path.join(__dirname, "shared-patch-second-repo");
      const emptyWorkdir = path.join(__dirname, "shared-patch-empty-repo");
      patches.set(`${emptyWorkdir}|staged-all`, buildMultiFilePatch([]));
      const documents = [
        PatchDocument.file(workingDirectory, "one.txt", "staged"),
        PatchDocument.staged(workingDirectory),
        PatchDocument.commit(workingDirectory, "first-commit"),
        PatchDocument.staged(emptyWorkdir),
        PatchDocument.commit(emptyWorkdir, "empty-commit"),
        PatchDocument.commit(otherWorkdir, "second-commit"),
        PatchDocument.staged(otherWorkdir),
        PatchDocument.file(otherWorkdir, "other.txt", "unstaged"),
        PatchDocument.file(workingDirectory, "back.txt", "unstaged"),
      ];
      for (const document of documents) {
        expect(await open(document.getURI())).toBe(item);
        await settleEditors(item);
        expect(item.getHydratedView()).toBe(view);
        expect(view.getDocument()).toEqual(document);
        expect(view.refPatchController.get()).toBe(controller);
        expect(controller.refView.get()).toBe(patchView);
        expect(controller.getDiffView()).toBe(layout);
        expect(patchView.refSideBySide.getOr(null)).toBe(pair);
        const current = pair
          ? [pair.editors.old.get(), pair.editors.new.get()]
          : [view.refEditor.get()];
        current.forEach((editor, index) => {
          expect(editor).toBe(editors[index]);
          expect(editor.getBuffer()).toBe(buffers[index]);
        });
        expect(controller.props.repository).toBe(repositoryFor(document.workingDirectory));
        expect(controller.props.readOnly).toBe(document.kind === "commit");
        if (document.workingDirectory === emptyWorkdir) {
          expect(controller.props.multiFilePatch.getFilePatches()).toEqual([]);
          expect(current.every((editor) => editor.getText() === "")).toBe(true);
        }
        expect(item.getURI()).toBe(document.getURI());
        expect(item.getTitle()).toBe(document.getTitle());
        expect(item.getIconName()).toBe(document.getIconName());
        expect(item.serialize()).toEqual({ deserializer: "PatchPaneItem", uri: document.getURI() });
        const copy = item.copy();
        await flushViews(() => {});
        expect(copy.getURI()).toBe(document.getURI());
        expect(copy.serialize()).toEqual(item.serialize());
        expect(copy.getHydratedView().getDocument()).toEqual(document);
        await copy.destroy();
      }
      expect(factory).toHaveBeenCalledTimes(1 + documents.length);
      expect(pane.getPendingItem()).toBe(item);
    });
  }

  it("updates headers and write permissions when moving from commit history to staged and unstaged changes", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const controller = view.refPatchController.get();
    expect(await open(PatchDocument.commit(workingDirectory, "readonly-commit").getURI())).toBe(
      item,
    );
    await flushViews(() => {});
    expect(item.getElement().textContent).toContain("Subject readonly-commit");
    expect(controller.props.readOnly).toBe(true);
    const file = controller.props.multiFilePatch.getFilePatches()[0];
    await controller.toggleFile(file);
    await controller.toggleRows(new Set([2]), "line");
    lumine.commands.dispatch(view.refEditor.get().getElement(), "core:confirm");
    await flushViews(() => {});
    expect(repository.applyPatchToIndex).not.toHaveBeenCalled();
    expect(repository.stageFiles).not.toHaveBeenCalled();
    expect(repository.unstageFiles).not.toHaveBeenCalled();

    expect(await open(PatchDocument.staged(workingDirectory).getURI())).toBe(item);
    await flushViews(() => {});
    expect(item.getElement().textContent).toContain("Staged Changes");
    expect(item.getElement().textContent).not.toContain("Subject readonly-commit");
    expect(controller.props.readOnly).toBe(false);
    await controller.toggleRows(new Set([2]), "line");
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);

    const otherWorkdir = path.join(__dirname, "writable-second-repo");
    expect(await open(uriFor("other.txt", "unstaged", otherWorkdir))).toBe(item);
    await flushViews(() => {});
    expect(controller.props.readOnly).toBe(false);
    await controller.toggleRows(new Set([2]), "line");
    expect(repositoryFor(otherWorkdir).applyPatchToIndex).toHaveBeenCalledTimes(1);
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);
  });

  it("surfaces the current source after changing document kind and repository", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const otherWorkdir = path.join(__dirname, "surface-second-repo");
    const documents = [
      PatchDocument.file(workingDirectory, "surface.txt", "staged"),
      PatchDocument.staged(otherWorkdir),
      PatchDocument.commit(otherWorkdir, "surface-commit"),
    ];
    for (const document of documents) {
      expect(await open(document.getURI())).toBe(item);
      await flushViews(() => {});
      surfaceDocument.calls.reset();
      lumine.commands.dispatch(view.refEditor.get().getElement(), "git-panel:surface");
      expect(surfaceDocument).toHaveBeenCalledOnceWith(document);
    }
  });

  it("targets the selected file and clears stale staging rows for a collapsed file header", async () => {
    const item = await open(PatchDocument.staged(workingDirectory).getURI());
    await flushViews(() => {});
    await item.getPatchLoadedPromise();
    await settleEditors(item);
    const controller = item.refPatchController.get();
    const diffView = controller.refView.get();
    let headers;
    const observation = item.observeNavigationHeaders((next) => (headers = next));
    try {
      await flushViews(() => item.navigateToNavigationHeader(headers[1]));
      const file = controller.props.multiFilePatch.getFilePatches()[1];
      expect(controller.state.selectedRows.size).toBeGreaterThan(0);
      expect(
        Array.from(controller.state.selectedRows).every(
          (row) => controller.props.multiFilePatch.getFilePatchAt(row) === file,
        ),
      ).toBe(true);
      await flushViews(() => diffView.changePatchRenderStatus(file, false));
      await settleEditors(item);
      await flushViews(() => item.navigateToNavigationHeader(headers[1]));
      expect(controller.state.selectedRows.size).toBe(0);
      expect(document.activeElement.classList.contains("git-panel-FilePatchView-header")).toBe(
        true,
      );
      await diffView.didConfirm();
      expect(repository.applyPatchToIndex).not.toHaveBeenCalled();
    } finally {
      observation.dispose();
    }
  });

  it("keeps the displayed repository observed while a different repository's read fails", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const oldLease = leases[0];
    const otherWorkdir = path.join(__dirname, "failed-second-repo");
    const candidate = repositoryFor(otherWorkdir);
    const gate = deferRead("two.txt", false, otherWorkdir);
    const pending = open(uriFor("two.txt", "unstaged", otherWorkdir));
    for (let pass = 0; pass < 1000 && !candidate.getFilePatchForPath.calls.count(); pass++)
      await Promise.resolve();
    expect(candidate.getFilePatchForPath).toHaveBeenCalled();
    expect(oldLease.dispose).not.toHaveBeenCalled();
    expect(view.refPatchController.get().props.repository).toBe(repository);
    const error = new Error("Unable to read another repository");
    gate.reject(error);
    await expectAsync(pending).toBeRejectedWith(error);
    await flushViews(() => {});
    expect(leases[1].dispose).toHaveBeenCalledTimes(1);
    expect(oldLease.dispose).not.toHaveBeenCalled();
    expect(item.getURI()).toBe(uriFor("one.txt"));
    expect(view.getWorkingDirectory()).toBe(workingDirectory);
    expect(pane.getPendingItem()).toBe(item);
  });

  it("releases a superseded repository's candidate lease and ignores its late patch", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const otherWorkdir = path.join(__dirname, "superseded-second-repo");
    const candidate = repositoryFor(otherWorkdir);
    const gate = deferRead("two.txt", false, otherWorkdir);
    const previous = open(uriFor("two.txt", "unstaged", otherWorkdir));
    for (let pass = 0; pass < 1000 && !candidate.getFilePatchForPath.calls.count(); pass++)
      await Promise.resolve();
    expect(candidate.getFilePatchForPath).toHaveBeenCalled();
    expect(await open(PatchDocument.staged(workingDirectory).getURI())).toBe(item);
    gate.resolve(patchFor("two.txt", false, otherWorkdir));
    expect(await previous).toBeUndefined();
    await flushViews(() => {});
    expect(leases[1].dispose).toHaveBeenCalledTimes(1);
    expect(leases[0].dispose).not.toHaveBeenCalled();
    expect(view.getDocument()).toEqual(PatchDocument.staged(workingDirectory));
    expect(view.refEditor.get().getText()).not.toContain("unstaged:two.txt");
  });

  it("releases both leases when closed while another repository is still preparing", async () => {
    const item = await initialItem();
    const otherWorkdir = path.join(__dirname, "waiting-second-repo");
    let resolve;
    const promise = new Promise((finish) => {
      resolve = finish;
    });
    readyGates.set(otherWorkdir, { promise, resolve });
    const pending = open(uriFor("two.txt", "unstaged", otherWorkdir));
    for (let pass = 0; pass < 1000 && leases.length < 2; pass++) await Promise.resolve();
    expect(leases.length).toBe(2);
    expect(leases[0].dispose).not.toHaveBeenCalled();
    expect(leases[1].dispose).not.toHaveBeenCalled();
    await pane.destroyItem(item);
    expect(await pending).toBeUndefined();
    expect(leases[0].dispose).toHaveBeenCalledTimes(1);
    expect(leases[1].dispose).toHaveBeenCalledTimes(1);
    resolve();
    await flushViews(() => {});
    expect(repositoryFor(otherWorkdir).getFilePatchForPath).not.toHaveBeenCalled();
    expect(item.isDestroyed()).toBe(true);
  });

  it("ignores the old repository's unfinished refresh after replacing it with another repository", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const refresh = deferRead("one.txt");
    readPatch.calls.reset();
    emitter.emit("did-update");
    await waitForRead("one.txt");
    const otherWorkdir = path.join(__dirname, "refresh-second-repo");
    expect(await open(uriFor("other.txt", "unstaged", otherWorkdir))).toBe(item);
    refresh.resolve(patchFor("one.txt"));
    await flushViews(() => {});
    const editor = view.refEditor.get();
    expect(view.refPatchController.get().props.repository).toBe(repositoryFor(otherWorkdir));
    expect(editor.getText()).toContain("unstaged:other.txt");
    expect(editor.getText()).not.toContain("unstaged:one.txt");
    readPatch.calls.reset();
    emitter.emit("did-update");
    await flushViews(() => {});
    expect(readPatch).not.toHaveBeenCalled();
  });

  it("allows a new staging operation after replacement with a different document whose text is identical", async () => {
    const item = await initialItem();
    const view = item.getHydratedView();
    const controller = view.refPatchController.get();
    const source = patchFor("one.txt");
    patches.set(readKey("one.txt", true), source);
    await controller.toggleRows(new Set([2]), "line");
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);
    expect(controller.stagingOperationInProgress).toBe(true);
    expect(await open(uriFor("one.txt", "staged"))).toBe(item);
    await flushViews(() => {});
    expect(controller.props.multiFilePatch.getBuffer().getText()).toBe(
      source.getBuffer().getText(),
    );
    await controller.toggleRows(new Set([2]), "line");
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest staging operation busy when the old document's write finishes late", async () => {
    const item = await initialItem();
    await settleEditors(item);
    const view = item.getHydratedView();
    const controller = view.refPatchController.get();
    patches.set(readKey("one.txt", true), patchFor("one.txt"));
    let finishPrevious, finishCurrent;
    const previousGate = new Promise((resolve) => {
      finishPrevious = resolve;
    });
    const currentGate = new Promise((resolve) => {
      finishCurrent = resolve;
    });
    repository.applyPatchToIndex.and.returnValues(previousGate, currentGate);
    const previous = controller.toggleRows();
    await flushViews(() => {});
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);
    expect(await open(uriFor("one.txt", "staged"))).toBe(item);
    await settleEditors(item);
    const current = controller.toggleRows();
    await flushViews(() => {});
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(2);
    finishPrevious();
    await previous;
    await flushViews(() => {});
    expect(controller.stagingOperationInProgress).toBe(true);
    finishCurrent();
    await current;
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
      PatchDocument.file("example-repository", "example.txt", "unstaged").getURI(),
      { pending: true, activatePane: false, activateItem: true, pane },
    );
  });
});
