/** @babel */
/** @jsx h */
import path from "path";
import openInNextPane from "../lib/open-in-next-pane";
import GitRootController from "../lib/controllers/git-root-controller";
import ChangesView from "../lib/views/changes-view";
import PaneItemHost from "../lib/items/pane-item-host";
import StagingView from "../lib/views/staging-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { h, flushViews, createViewHost, createViewModel } from "./helpers/etch";

describe("jumping to a file in the next pane", () => {
  let anchorPane, anchorEditor, initialPanes, initialItems, view, patch, stylesheet, paneItem;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    initialPanes = new Set(lumine.workspace.getPanes());
    initialItems = new Set(lumine.workspace.getPaneItems());
    anchorPane = lumine.workspace.getCenter().getActivePane();
    anchorEditor = await lumine.workspace.open(path.join(__dirname, "patch-selection-spec.js"), {
      pane: anchorPane,
      pending: false,
    });
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    patch?.dispose();
    patch = null;
    stylesheet?.dispose();
    stylesheet = null;
    for (const item of lumine.workspace.getPaneItems()) {
      if (!initialItems.has(item)) await lumine.workspace.paneForItem(item)?.destroyItem(item);
    }
    for (const pane of lumine.workspace.getPanes()) {
      if (!initialPanes.has(pane)) pane.destroy();
    }
  });

  function opener(name = "copy-diff-spec.js") {
    return (options) =>
      lumine.workspace.open(path.join(__dirname, name), { ...options, pending: false });
  }

  function panes() {
    return lumine.workspace.getCenter().getPanes();
  }

  it("uses the next center pane in order, even when a third pane is active", async () => {
    const next = anchorPane.splitRight();
    const last = next.splitRight();
    last.activate();
    await flushViews(() => {});
    expect(panes()).toEqual([anchorPane, next, last]);
    expect(anchorEditor.getElement().closest("lumine-pane")?.getModel()).toBe(anchorPane);

    await openInNextPane(lumine.workspace, [opener()], anchorEditor.getElement());

    const opened = next.getItems().find((item) => item.getPath?.().endsWith("copy-diff-spec.js"));
    expect(opened).toBeDefined();
    expect(last.getItems()).toEqual([]);
    expect(panes()).toEqual([anchorPane, next, last]);
  });

  it("wraps from the last center pane to the first", async () => {
    const middle = anchorPane.splitRight();
    const last = middle.splitRight();
    await openInNextPane(lumine.workspace, [opener()], last.getElement());

    expect(
      anchorPane.getItems().some((item) => item.getPath?.().endsWith("copy-diff-spec.js")),
    ).toBe(true);
    expect(panes()).toEqual([anchorPane, middle, last]);
  });

  it("creates a right-hand copy when the file already exists in the sole source pane", async () => {
    expect(panes()).toEqual([anchorPane]);
    await openInNextPane(
      lumine.workspace,
      [opener("patch-selection-spec.js")],
      anchorEditor.getElement(),
    );

    expect(panes().length).toBe(2);
    const next = panes()[1];
    const opened = next.getActiveItem();
    expect(opened).not.toBe(anchorEditor);
    expect(opened.getBuffer()).toBe(anchorEditor.getBuffer());
    expect(anchorPane.getItems()).toContain(anchorEditor);
    expect(next.getParent().orientation).toBe("horizontal");
    expect(next.getParent().children).toEqual([anchorPane, next]);
  });

  it("uses the active center pane when the dispatch source is in a dock", async () => {
    const next = anchorPane.splitRight();
    anchorPane.activate();
    const dock = lumine.workspace.getRightDock();
    const dockPane = dock.getActivePane();
    const item = { element: document.createElement("div") };
    dockPane.addItem(item);
    dock.show();
    dockPane.activate();
    const dockPanes = dock.getPanes().slice();
    expect(lumine.workspace.getActivePane()).toBe(dockPane);

    await openInNextPane(lumine.workspace, [opener()], item.element);

    expect(next.getItems().some((entry) => entry.getPath?.().endsWith("copy-diff-spec.js"))).toBe(
      true,
    );
    expect(panes()).toEqual([anchorPane, next]);
    expect(dock.getPanes()).toEqual(dockPanes);
    expect(dockPane.getItems()).toContain(item);
  });

  it("opens a batch sequentially into one new pane", async () => {
    const names = ["copy-diff-spec.js", "split-files-spec.js"];
    await openInNextPane(lumine.workspace, names.map(opener), anchorEditor.getElement());

    expect(panes().length).toBe(2);
    expect(
      panes()[1]
        .getItems()
        .map((item) => path.basename(item.getPath())),
    ).toEqual(names);
    expect(anchorPane.getItems()).toEqual([anchorEditor]);
  });

  it("does not create an empty pane or continue a batch when the first open is declined", async () => {
    const decline = jasmine.createSpy("declined open").and.resolveTo(undefined);
    const later = jasmine.createSpy("later open").and.callFake(opener());

    await openInNextPane(lumine.workspace, [decline, later], anchorEditor.getElement());

    expect(decline).toHaveBeenCalledOnceWith({ pane: anchorPane, split: "right" });
    expect(later).not.toHaveBeenCalled();
    expect(panes()).toEqual([anchorPane]);
  });

  it("does not redirect the rest of a batch when its destination closes", async () => {
    const next = anchorPane.splitRight();
    const first = async (options) => {
      const item = await opener()(options);
      next.destroy();
      return item;
    };
    const second = jasmine.createSpy("second opener");

    expect(
      await openInNextPane(lumine.workspace, [first, second], anchorEditor.getElement()),
    ).toEqual([]);
    expect(second).not.toHaveBeenCalled();
    expect(anchorPane.getItems()).toContain(anchorEditor);
  });

  it("does not resolve a destination for an empty selection", async () => {
    const workspace = { getCenter: jasmine.createSpy("get center") };

    expect(await openInNextPane(workspace, [])).toEqual([]);

    expect(workspace.getCenter).not.toHaveBeenCalled();
  });

  it("opens a selected file-list batch permanently in the existing next pane", async () => {
    const next = anchorPane.splitRight();
    anchorPane.activate();
    const filePaths = ["copy-diff-spec.js", "split-files-spec.js"];
    const controller = Object.create(GitRootController.prototype);
    controller.props = {
      workspace: lumine.workspace,
      repository: { getWorkingDirectoryPath: () => __dirname },
    };
    const staging = createViewModel(StagingView, {
      commands: lumine.commands,
      workspace: lumine.workspace,
      workingDirectoryPath: __dirname,
      unstagedChanges: filePaths.map((filePath) => ({ filePath })),
      stagedChanges: [],
      mergeConflicts: [],
      openFiles: controller.openFiles.bind(controller),
    });
    staging.state.selection = staging.state.selection.selectAllItems();
    const container = document.createElement("div");
    jasmine.attachToDOM(container);
    const root = createViewHost(container);
    try {
      await flushViews(() =>
        root.update(
          <div className="git-panel-StagingView">
            <div className="git-panel-FilePatchListView-item" />
            {staging.renderCommands()}
          </div>,
        ),
      );
      await lumine.commands.dispatch(
        container.querySelector(".git-panel-FilePatchListView-item"),
        "git-panel:jump-to-file-in-next-pane",
      );
      await flushViews(() => {});

      expect(panes()).toEqual([anchorPane, next]);
      expect(next.getItems().map((item) => path.basename(item.getPath()))).toEqual(filePaths);
      expect(next.getPendingItem()).toBeNull();
      expect(anchorPane.getItems()).toEqual([anchorEditor]);
    } finally {
      await flushViews(() => root.destroy());
      staging.willDestroy();
      container.remove();
    }
  });

  async function mount(layout) {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    patch = buildMultiFilePatch([
      {
        oldPath: "patch-selection-spec.js",
        newPath: "patch-selection-spec.js",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        hunks: [
          {
            oldStartLine: 9,
            oldLineCount: 3,
            newStartLine: 21,
            newLineCount: 3,
            heading: "",
            lines: [" before", "-old value", "+new value", " after"],
          },
        ],
      },
    ]);
    view = new ChangesView({
      title: "Changes",
      multiFilePatch: patch,
      stagingStatus: "unstaged",
      surfaceKind: "file",
      readOnly: false,
      initialDiffView: layout,
      clipboard: { write: jasmine.createSpy("copy diff").and.resolveTo() },
      repository: { getWorkingDirectoryPath: () => __dirname },
      discardLines: jasmine.createSpy("discard rows").and.resolveTo(),
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
      surface: () => {},
    });
    paneItem = PaneItemHost.create("jump-test", { title: "Changes", singleton: true });
    paneItem.getElement().appendChild(view.element);
    paneItem.hydrate(view);
    anchorPane.addItem(paneItem);
    anchorPane.activateItem(paneItem);
    await flushViews(() => {});
    await flushViews(() => {});
    return view.refPatchController.get().refView.get();
  }

  for (const layout of ["unified", "side-by-side"]) {
    for (const side of ["new", "old"]) {
      it(`dispatches from a ${layout} ${side} line and retains its source-file position`, async () => {
        const patchView = await mount(layout);
        const canonicalRow = side === "new" ? 2 : 1;
        const pair = layout === "side-by-side" ? patchView.refSideBySide.get() : null;
        const sourceEditor = pair ? pair.editors[side].get() : patchView.refEditor.get();
        const row = pair ? pair.projection.patchRowToDisplayRow.get(canonicalRow) : canonicalRow;
        await flushViews(() => {
          sourceEditor.setCursorBufferPosition([row, 3], { autoscroll: false });
          sourceEditor.getElement().focus();
        });

        await lumine.commands.dispatch(
          sourceEditor.getElement(),
          "git-panel:jump-to-file-in-next-pane",
        );
        await flushViews(() => {});

        expect(panes().length).toBe(2);
        const opened = panes()[1].getActiveItem();
        expect(opened).not.toBe(anchorEditor);
        expect(opened.getPath()).toBe(anchorEditor.getPath());
        expect(opened.getCursorBufferPosition().toArray()).toEqual([21, side === "new" ? 3 : 0]);
        expect(anchorPane.getActiveItem()).toBe(paneItem);
      });
    }
  }
});
