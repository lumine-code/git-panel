/** @babel */

import path from "path";

import GitTabController, { pathsForStageAll } from "../lib/controllers/git-tab-controller";

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
    const nextState = GitTabController.getDerivedStateFromProps(propsWith({ email: "" }), {
      editingIdentity: false,
      manuallyEditingIdentity: false,
    });

    expect(nextState.editingIdentity).toBe(true);
  });

  it("closes an automatic prompt when a later read finds a complete identity", () => {
    const nextState = GitTabController.getDerivedStateFromProps(propsWith(), {
      editingIdentity: true,
      manuallyEditingIdentity: false,
    });

    expect(nextState.editingIdentity).toBe(false);
  });

  it("does not open automatically for provisional loading data", () => {
    const nextState = GitTabController.getDerivedStateFromProps(
      propsWith({ email: "", fetchInProgress: true }),
      {
        editingIdentity: false,
        manuallyEditingIdentity: false,
      },
    );

    expect(nextState.editingIdentity).toBe(false);
  });

  it("preserves an identity editor that was opened manually", () => {
    const nextState = GitTabController.getDerivedStateFromProps(propsWith(), {
      editingIdentity: true,
      manuallyEditingIdentity: true,
    });

    expect(nextState).toBeNull();
  });
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
