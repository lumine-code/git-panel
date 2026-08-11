/** @babel */
import path from "path";

import GitRootController from "../lib/controllers/git-root-controller";

describe("GitRootController repository initialization", () => {
  function buildController({ activeEditorPath = null, currentDirectory = null } = {}) {
    const controller = new GitRootController({
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

    controller.setState = (state, callback) => {
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
