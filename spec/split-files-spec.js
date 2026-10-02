/** @babel */
/** @jsx h */
import path from "path";
import { h, flushViews, createViewHost, createViewModel } from "./helpers/etch";

import GitRootController from "../lib/controllers/git-root-controller";
import CompositeListSelection from "../lib/models/composite-list-selection";
import StagingView from "../lib/views/staging-view";
import menu from "../menus/main.json";

describe("splitting selected changed files", () => {
  function buildController(workspace = lumine.workspace, repositoryPath = __dirname) {
    const controller = Object.create(GitRootController.prototype);
    controller.props = {
      workspace,
      repository: { getWorkingDirectoryPath: () => repositoryPath },
    };
    return controller;
  }

  describe("StagingView selection", () => {
    for (const listKey of ["unstaged", "staged", "conflicts"]) {
      it(`opens the selected ${listKey} files with the requested direction`, async () => {
        const items = [{ filePath: "first.txt" }, { filePath: "second.txt" }];
        const view = Object.create(StagingView.prototype);
        view.state = {
          selection: new CompositeListSelection({
            listsByKey: [
              ["unstaged", listKey === "unstaged" ? items : []],
              ["staged", listKey === "staged" ? items : []],
              ["conflicts", listKey === "conflicts" ? items : []],
            ],
            idForItem: (item) => item.filePath,
          }).selectAllItems(),
        };
        view.props = { openFiles: jasmine.createSpy("openFiles").and.resolveTo() };

        await view.splitFile("left");

        expect(view.props.openFiles).toHaveBeenCalledOnceWith(
          ["first.txt", "second.txt"],
          undefined,
          { split: "left" },
        );
      });
    }

    it("dispatches each file-list context action through its local command registration", async () => {
      const container = document.createElement("div");
      jasmine.attachToDOM(container);
      const root = createViewHost(container);
      const openFiles = jasmine.createSpy("openFiles").and.resolveTo([]);
      const view = createViewModel(StagingView, {
        commands: lumine.commands,
        workspace: lumine.workspace,
        workingDirectoryPath: __dirname,
        unstagedChanges: [{ filePath: "selected.txt" }],
        stagedChanges: [],
        mergeConflicts: [],
        openFiles,
      });
      const menuRegistration = lumine.contextMenu.add(menu["context-menu"]);

      try {
        await flushViews(async () =>
          root.update(
            <div className="git-panel-StagingView">
              <div className="git-panel-FilePatchListView-item" />
              {view.renderCommands()}
            </div>,
          ),
        );
        const row = container.querySelector(".git-panel-FilePatchListView-item");
        const template = lumine.contextMenu.templateForElement(row);
        const outsideCommands = lumine.commands.findCommands({ target: container });

        for (const direction of ["up", "down", "left", "right"]) {
          const command = `git-panel:split-${direction}`;
          const action = template.find((entry) => entry.command === command);
          expect(action).toBeDefined();
          expect(outsideCommands.some((entry) => entry.name === command)).toBe(false);

          await lumine.commands.dispatch(row, action.command);

          expect(openFiles.calls.mostRecent().args).toEqual([
            ["selected.txt"],
            undefined,
            { split: direction },
          ]);
        }
        expect(openFiles).toHaveBeenCalledTimes(4);
      } finally {
        menuRegistration.dispose();
        await flushViews(async () => root.destroy());
        view.willDestroy();
        container.remove();
      }
    });
  });

  describe("workspace panes", () => {
    let controller, anchorPane, anchorEditor, initialPanes, initialItems, previousPendingSetting;

    beforeEach(async () => {
      initialPanes = new Set(lumine.workspace.getPanes());
      initialItems = new Set(lumine.workspace.getPaneItems());
      previousPendingSetting = lumine.config.get("core.allowPendingPaneItems");
      lumine.config.set("core.allowPendingPaneItems", true);
      anchorPane = lumine.workspace.getCenter().getActivePane();
      anchorEditor = await lumine.workspace.open(
        path.join(__dirname, "git-root-controller-spec.js"),
        {
          pane: anchorPane,
        },
      );
      controller = buildController();
    });

    afterEach(async () => {
      for (const item of lumine.workspace.getPaneItems()) {
        if (!initialItems.has(item)) {
          await lumine.workspace.paneForItem(item)?.destroyItem(item);
        }
      }
      for (const pane of lumine.workspace.getPanes()) {
        if (!initialPanes.has(pane)) pane.destroy();
      }
      lumine.config.set("core.allowPendingPaneItems", previousPendingSetting);
    });

    for (const direction of ["up", "down", "left", "right"]) {
      it(`opens a single file in a pending pane ${direction} of the editor`, async () => {
        const paneCount = lumine.workspace.getCenter().getPanes().length;

        const [editor] = await controller.openFiles(
          ["primary-click-selection-spec.js"],
          undefined,
          {
            split: direction,
          },
        );

        const splitPane = lumine.workspace.paneForItem(editor);
        expect(lumine.workspace.getCenter().getPanes().length).toBe(paneCount + 1);
        expect(splitPane).not.toBe(anchorPane);
        expect(splitPane.getContainer().getLocation()).toBe("center");
        expect(splitPane.getPendingItem()).toBe(editor);
        expect(anchorPane.getItems()).toContain(anchorEditor);
        const axis = splitPane.getParent();
        expect(axis.orientation).toBe(
          ["up", "down"].includes(direction) ? "vertical" : "horizontal",
        );
        const splitIndex = axis.children.indexOf(splitPane);
        const anchorIndex = axis.children.indexOf(anchorPane);
        expect(splitIndex - anchorIndex).toBe(["up", "left"].includes(direction) ? -1 : 1);
      });
    }

    it("opens every selected file in one split and keeps all of them permanent", async () => {
      const filePaths = ["primary-click-selection-spec.js", "middle-click-selection-spec.js"];
      const paneCount = lumine.workspace.getCenter().getPanes().length;

      const editors = await controller.openFiles(filePaths, undefined, { split: "right" });

      const splitPane = lumine.workspace.paneForItem(editors[0]);
      expect(lumine.workspace.getCenter().getPanes().length).toBe(paneCount + 1);
      expect(splitPane.getItems()).toEqual(editors);
      expect(editors.map((editor) => path.basename(editor.getPath()))).toEqual(filePaths);
      expect(splitPane.getPendingItem()).toBeNull();
      expect(anchorPane.getItems()).toContain(anchorEditor);
    });

    it("splits the center editor when a dock pane has focus", async () => {
      const dock = lumine.workspace.getRightDock();
      const dockPane = dock.getActivePane();
      const item = { element: document.createElement("div") };
      dockPane.addItem(item);
      dock.show();
      dockPane.activate();
      expect(lumine.workspace.getActivePane()).toBe(dockPane);
      const dockPaneCount = dock.getPanes().length;

      const [editor] = await controller.openFiles(["primary-click-selection-spec.js"], undefined, {
        split: "down",
      });

      const splitPane = lumine.workspace.paneForItem(editor);
      expect(splitPane.getContainer().getLocation()).toBe("center");
      expect(splitPane.getParent().children).toEqual([anchorPane, splitPane]);
      expect(dock.getPanes().length).toBe(dockPaneCount);
      expect(dockPane.getItems()).toContain(item);
    });

    it("opens another editor in the split when the file already exists in the anchor", async () => {
      const [editor] = await controller.openFiles(["git-root-controller-spec.js"], undefined, {
        split: "right",
      });

      expect(editor).not.toBe(anchorEditor);
      expect(editor.getBuffer()).toBe(anchorEditor.getBuffer());
      expect(lumine.workspace.paneForItem(editor)).not.toBe(anchorPane);
      expect(anchorPane.getItems()).toContain(anchorEditor);
    });

    it("keeps normal file opening in the existing pane", async () => {
      const paneCount = lumine.workspace.getCenter().getPanes().length;

      const [editor] = await controller.openFiles(["primary-click-selection-spec.js"]);

      expect(lumine.workspace.paneForItem(editor)).toBe(anchorPane);
      expect(lumine.workspace.getCenter().getPanes().length).toBe(paneCount);
      expect(anchorPane.getPendingItem()).toBe(editor);
    });
  });

  describe("unavailable files", () => {
    it("does not open or split a pane for an empty selection", async () => {
      const workspace = {
        open: jasmine.createSpy("open"),
        getCenter: jasmine.createSpy("getCenter"),
      };
      const controller = buildController(workspace);

      expect(await controller.openFiles([], undefined, { split: "right" })).toEqual([]);
      expect(workspace.open).not.toHaveBeenCalled();
      expect(workspace.getCenter).not.toHaveBeenCalled();
    });

    it("does not open subsequent files if the first open is declined", async () => {
      const workspace = {
        open: jasmine.createSpy("open").and.resolveTo(undefined),
        getCenter: () => ({ getActivePane: () => ({}) }),
        paneForItem: jasmine.createSpy("paneForItem"),
      };
      const controller = buildController(workspace);

      await controller.openFiles(["first.txt", "second.txt"], undefined, { split: "right" });

      expect(workspace.open).toHaveBeenCalledTimes(1);
      expect(workspace.paneForItem).not.toHaveBeenCalled();
    });
  });
});
