/** @babel */
import { createViewModel } from "./helpers/etch.js";

import path from "path";

import GitTabController, { pathsForStageAll } from "../lib/controllers/git-tab-controller.js";

describe("GitTabController identity editor state", () => {
  const repository = {
    isPresent: () => true,
  };

  const propsWith = (overrides = {}) => ({
    fetchInProgress: false,
    repository,
    repositoryDrift: false,
    username: "Author",
    email: "author@example.com",
    ...overrides,
  });

  it("automatically opens while a loaded identity is incomplete", () => {
    const nextState = GitTabController.deriveState(propsWith({ email: "" }), {
      editingIdentity: false,
      manuallyEditingIdentity: false,
    });

    expect(nextState.editingIdentity).toBe(true);
  });

  it("closes an automatic prompt when a later read finds a complete identity", () => {
    const nextState = GitTabController.deriveState(propsWith(), {
      editingIdentity: true,
      manuallyEditingIdentity: false,
    });

    expect(nextState.editingIdentity).toBe(false);
  });

  it("does not open automatically for provisional loading data", () => {
    const nextState = GitTabController.deriveState(
      propsWith({ email: "", fetchInProgress: true }),
      {
        editingIdentity: false,
        manuallyEditingIdentity: false,
      },
    );

    expect(nextState.editingIdentity).toBe(false);
  });

  it("preserves an identity editor that was opened manually", () => {
    const nextState = GitTabController.deriveState(propsWith(), {
      editingIdentity: true,
      manuallyEditingIdentity: true,
    });

    expect(nextState).toBeNull();
  });

  function identityController() {
    const controller = Object.create(GitTabController.prototype);
    controller.props = {
      repository: {
        setConfig: jasmine.createSpy("setConfig").and.resolveTo(),
        unsetConfig: jasmine.createSpy("unsetConfig").and.resolveTo(),
      },
      notificationManager: { addError: jasmine.createSpy("addError") },
    };
    controller.usernameBuffer = { getText: () => "Author" };
    controller.emailBuffer = { getText: () => "author@example.com" };
    controller.closeIdentityEditor = jasmine.createSpy("closeIdentityEditor");
    return controller;
  }

  it("closes the form only after both identity values have been saved", async () => {
    const controller = identityController();
    let finishEmail;
    controller.props.repository.setConfig.and.callFake((key) =>
      key === "user.email" ? new Promise((resolve) => (finishEmail = resolve)) : Promise.resolve(),
    );

    const saving = controller.setIdentity({ global: true });
    await Promise.resolve();
    expect(controller.closeIdentityEditor).not.toHaveBeenCalled();
    finishEmail();
    await saving;

    expect(controller.props.repository.setConfig.calls.allArgs()).toEqual([
      ["user.name", "Author", { global: true }],
      ["user.email", "author@example.com", { global: true }],
    ]);
    expect(controller.closeIdentityEditor).toHaveBeenCalledTimes(1);
    expect(controller.props.notificationManager.addError).not.toHaveBeenCalled();
  });

  for (const failedKey of ["user.name", "user.email"]) {
    it(`keeps the form open and reports a failed ${failedKey} write so it can be retried`, async () => {
      const controller = identityController();
      controller.props.repository.setConfig.and.callFake((key) =>
        key === failedKey ? Promise.reject(new Error("Permission denied")) : Promise.resolve(),
      );

      await expectAsync(controller.setIdentity({ global: true })).toBeResolved();

      expect(controller.closeIdentityEditor).not.toHaveBeenCalled();
      expect(controller.props.notificationManager.addError).toHaveBeenCalledOnceWith(
        "Unable to save Git identity",
        { detail: "Permission denied", dismissable: true },
      );

      controller.props.repository.setConfig.and.resolveTo();
      await controller.setIdentity({ global: true });
      expect(controller.closeIdentityEditor).toHaveBeenCalledTimes(1);
    });
  }
});

describe("GitTabController conflict staging", () => {
  it("expands Stage All to the displayed files instead of using a repository-wide pathspec", () => {
    const props = {
      unstagedChanges: [{ filePath: "a.txt" }, { filePath: "folder/b.txt" }],
      stagedChanges: [{ filePath: "staged.txt" }],
    };

    expect(pathsForStageAll(props, "unstaged")).toEqual(["a.txt", "folder/b.txt"]);
    expect(pathsForStageAll(props, "staged")).toEqual(["staged.txt"]);
  });

  it("refuses to stage an unready merge conflict", async () => {
    const repository = {
      pathHasMergeMarkers: jasmine
        .createSpy("pathHasMergeMarkers")
        .and.returnValue(Promise.resolve(false)),
      stageFiles: jasmine.createSpy("stageFiles"),
    };
    const notificationManager = { addWarning: jasmine.createSpy("addWarning") };
    const controller = Object.create(GitTabController.prototype);
    controller.props = {
      repository,
      notificationManager,
      resolutionProgress: {
        getStatus: () => ({ ready: false, remaining: 1, reason: "conflicts" }),
      },
      workingDirectoryPath: "C:\\repo",
      mergeConflicts: [{ filePath: "conflicted.txt" }],
      unstagedChanges: [],
      confirm: jasmine.createSpy("confirm"),
    };

    await controller.stageFiles(["conflicted.txt"]);

    expect(repository.stageFiles).not.toHaveBeenCalled();
    expect(notificationManager.addWarning).toHaveBeenCalled();
    expect(controller.props.confirm).not.toHaveBeenCalled();
  });

  it("stages a saved marker-free conflict", async () => {
    const repository = {
      pathHasMergeMarkers: () => Promise.resolve(false),
      stageFiles: jasmine.createSpy("stageFiles").and.returnValue(Promise.resolve()),
    };
    const controller = Object.create(GitTabController.prototype);
    controller.props = {
      repository,
      notificationManager: { addWarning: jasmine.createSpy("addWarning") },
      resolutionProgress: {
        getStatus: () => ({ ready: true, remaining: 0, reason: "ready" }),
      },
      workingDirectoryPath: "C:\\repo",
      mergeConflicts: [{ filePath: "conflicted.txt" }],
      unstagedChanges: [],
      confirm: jasmine.createSpy("confirm"),
    };

    await controller.stageFiles(["conflicted.txt"]);

    expect(repository.stageFiles).toHaveBeenCalledWith(["conflicted.txt"]);
  });

  it("requires confirmation for marker-free non-text conflicts", async () => {
    const repository = {
      pathHasMergeMarkers: () => Promise.resolve(false),
      stageFiles: jasmine.createSpy("stageFiles").and.returnValue(Promise.resolve()),
    };
    const markResolutionSelected = jasmine.createSpy("markResolutionSelected");
    const controller = Object.create(GitTabController.prototype);
    controller.props = {
      repository,
      notificationManager: { addWarning: jasmine.createSpy("addWarning") },
      resolutionProgress: {
        getStatus: () => ({ ready: false, remaining: 0, reason: "choice" }),
        markResolutionSelected,
      },
      workingDirectoryPath: "C:\\repo",
      mergeConflicts: [{ filePath: "binary.dat" }],
      unstagedChanges: [],
      confirm: jasmine.createSpy("confirm").and.returnValue(Promise.resolve(0)),
    };

    await controller.stageFiles(["binary.dat"]);

    expect(markResolutionSelected).toHaveBeenCalledWith(path.join("C:\\repo", "binary.dat"));
    expect(repository.stageFiles).toHaveBeenCalledWith(["binary.dat"]);
  });
});

describe("GitTabController staging re-entry", () => {
  function nextTurn() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  // attemptFileStageOperation is a bound instance field, so it exists only on a
  // constructed controller. The constructor needs a username, an email, a
  // config and a repository; a null repository leaves UserStore's observer
  // inert, which is all this needs.
  function buildController({ stageFiles, listUpdate }) {
    const controller = createViewModel(GitTabController, {
      username: "",
      email: "",
      repository: null,
      config: { observe: () => ({ dispose() {} }) },
    });
    controller.refStagingView = { map: () => ({ getOr: () => listUpdate }) };
    controller.stageFiles = stageFiles;
    controller.unstageFiles = () => Promise.resolve();
    controller.props = {
      busySignal: null,
      notificationManager: { addError: jasmine.createSpy("addError") },
    };
    return controller;
  }

  it("swallows a second attempt while the first is still running", async () => {
    let finishStaging;
    const stageFiles = jasmine
      .createSpy("stageFiles")
      .and.returnValue(new Promise((resolve) => (finishStaging = resolve)));
    // Already resolved: this stands in for a list refresh the staging operation
    // did not cause, which is what used to re-arm the guard early.
    const controller = buildController({ stageFiles, listUpdate: Promise.resolve() });

    const first = controller.attemptFileStageOperation(["a.txt"], "unstaged");
    await nextTurn();

    controller.attemptFileStageOperation(["a.txt"], "unstaged");
    controller.attemptFileStageOperation(["a.txt"], "unstaged");
    await nextTurn();
    expect(stageFiles.calls.count()).toBe(1);

    finishStaging();
    await first.selectionUpdatePromise;

    controller.attemptFileStageOperation(["a.txt"], "unstaged");
    expect(stageFiles.calls.count()).toBe(2);
  });

  it("re-arms after a failed operation, which never updates the lists", async () => {
    const stageFiles = jasmine
      .createSpy("stageFiles")
      .and.returnValue(Promise.reject(new Error("index.lock exists")));
    const controller = buildController({ stageFiles, listUpdate: new Promise(() => {}) });

    const { stageOperationPromise } = controller.attemptFileStageOperation(["a.txt"], "unstaged");
    await stageOperationPromise;

    expect(controller.props.notificationManager.addError).toHaveBeenCalled();
    expect(controller.stagingOperationInProgress).toBe(false);
  });
});
