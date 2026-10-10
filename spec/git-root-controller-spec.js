/** @babel */
import { createViewModel } from "./helpers/etch";
import path from "path";

import GitRootController from "../lib/controllers/git-root-controller";
import PatchDocument from "../lib/models/patch-document";

describe("GitRootController repository initialization", () => {
  function buildController({ activeEditorPath = null, currentDirectory = null } = {}) {
    const controller = createViewModel(GitRootController, {
      workspace: {
        getActiveTextEditor: () => (activeEditorPath ? { getPath: () => activeEditorPath } : null),
      },
      repository: {
        isDestroyed: () => true,
        showGitTabInit: () => true,
      },
      project: {
        getDirectories: () => [],
        relativizePath: () => [null, null],
      },
      config: {
        get: () => currentDirectory,
      },
    });

    controller.updateState = (state, callback) => {
      controller.state = { ...controller.state, ...state };
      callback?.();
    };
    return controller;
  }

  it("defaults to the active file's directory when no repository is found", async () => {
    const filePath = path.join("C:\\", "files", "nested", "file.txt");
    const controller = buildController({ activeEditorPath: filePath });

    await controller.openInitializeDialog(path.join("C:\\", "first-root"));

    expect(controller.state.dialogRequest.getParams().dirPath).toBe(path.dirname(filePath));
  });

  it("keeps the current directory as the default when no file is open", async () => {
    const currentDirectory = path.join("C:\\", "second-root");
    const controller = buildController();

    await controller.openInitializeDialog(currentDirectory);

    expect(controller.state.dialogRequest.getParams().dirPath).toBe(currentDirectory);
  });
});

describe("GitRootController conflict recounting", () => {
  function buildRecountController() {
    const controller = Object.create(GitRootController.prototype);
    controller.props = {
      resolutionProgress: {
        reportDiskMarkerCount: jasmine.createSpy("reportDiskMarkerCount"),
      },
      notificationManager: { addError: jasmine.createSpy("addError") },
    };
    return controller;
  }

  it("settles with the persisted marker count", async () => {
    const controller = buildRecountController();
    const filePath = path.join(__dirname, "git-root-controller-spec.js");

    const count = await controller.refreshResolutionProgress(filePath);

    expect(count).toBe(0);
    expect(controller.props.resolutionProgress.reportDiskMarkerCount).toHaveBeenCalledWith(
      filePath,
      0,
    );
  });

  it("settles safely when a formerly conflicted file has disappeared", async () => {
    const controller = buildRecountController();
    const filePath = path.join(__dirname, "missing-conflict-file.txt");

    const count = await controller.refreshResolutionProgress(filePath);

    expect(count).toBe(0);
    expect(controller.props.resolutionProgress.reportDiskMarkerCount).toHaveBeenCalledWith(
      filePath,
      0,
    );
    expect(controller.props.notificationManager.addError).not.toHaveBeenCalled();
  });
});

describe("GitRootController patch source navigation", () => {
  const directory = path.join(__dirname, "source-repository");
  const documents = [
    PatchDocument.file(directory, "nested.txt", "staged"),
    PatchDocument.staged(directory),
    PatchDocument.commit(directory, "abc"),
  ];
  for (const document of documents) {
    it(`selects the ${document.kind} document's repository before revealing its panel location`, async () => {
      let finish;
      let selectedDirectory = "another-repository";
      const gate = new Promise((resolve) => {
        finish = resolve;
      });
      const events = [];
      const tab = {
        focusAndSelectStagingItem: jasmine
          .createSpy("select file")
          .and.callFake(() => events.push("file")),
        focusAndSelectCommitPreviewButton: jasmine
          .createSpy("select staged-all")
          .and.callFake(() => events.push("staged-all")),
        focusAndSelectRecentCommit: jasmine
          .createSpy("select commit")
          .and.callFake(() => events.push("commit")),
      };
      const tracker = {
        ensureVisible: jasmine.createSpy("show source panel").and.callFake(async () => {
          expect(selectedDirectory).toBe(directory);
          events.push("visible");
        }),
        getComponent: jasmine.createSpy("get selected panel").and.callFake(() => {
          expect(events[events.length - 1]).toBe("visible");
          return tab;
        }),
      };
      const selectRepository = jasmine
        .createSpy("select repository")
        .and.callFake(async (chosen) => {
          events.push("selecting");
          await gate;
          selectedDirectory = chosen;
          events.push("selected");
        });
      const controller = createViewModel(GitRootController, {
        repository: {
          isDestroyed: () => true,
          getWorkingDirectoryPath: () => "another-repository",
        },
        selectRepository,
        gitTabTracker: tracker,
      });
      try {
        const navigation = controller.surfaceDocument(document);
        expect(selectRepository).toHaveBeenCalledOnceWith(directory);
        expect(tracker.ensureVisible).not.toHaveBeenCalled();
        expect(tracker.getComponent).not.toHaveBeenCalled();
        finish();
        await navigation;
        expect(events).toEqual(["selecting", "selected", "visible", document.kind]);
        if (document.kind === "file")
          expect(tab.focusAndSelectStagingItem).toHaveBeenCalledOnceWith("nested.txt", "staged");
        else if (document.kind === "staged-all")
          expect(tab.focusAndSelectCommitPreviewButton).toHaveBeenCalledOnceWith();
        else expect(tab.focusAndSelectRecentCommit).toHaveBeenCalledOnceWith();
      } finally {
        finish();
        await controller.destroy();
      }
    });
  }
});
