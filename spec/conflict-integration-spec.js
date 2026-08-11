/** @babel */
/** @jsx React.createElement */

import fs from "fs";
import os from "os";
import path from "path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import EditorConflictController from "../lib/controllers/editor-conflict-controller";
import GitTabController from "../lib/controllers/git-tab-controller";
import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import Conflict from "../lib/models/conflicts/conflict";
import ResolutionProgress from "../lib/models/conflicts/resolution-progress";
import Repository from "../lib/models/repository";

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

describe("conflict resolution against a real Git repository", () => {
  let workingDirectory;
  let coreRepository;
  let panelRepository;
  let strategy;
  let editors;
  let roots;
  let containers;
  let previousActEnvironment;

  beforeEach(async () => {
    previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    editors = [];
    roots = [];
    containers = [];

    workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-conflict-drive-")),
    );
    coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    strategy = new GitShellOutStrategy(workingDirectory);
    panelRepository = new Repository(workingDirectory);
    await panelRepository.getLoadPromise();
    await strategy.setConfig("user.name", "Git Panel Conflict Specs");
    await strategy.setConfig("user.email", "conflicts@lumine.invalid");
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => root.unmount());
    }
    containers.forEach((container) => container.remove());
    editors.forEach((editor) => editor.destroy());
    panelRepository?.destroy();
    strategy?.destroy();
    if (coreRepository) lumine.repositories.forget(coreRepository);
    global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  async function writeAndCommit(contentsByPath, message) {
    for (const [filePath, contents] of Object.entries(contentsByPath)) {
      fs.writeFileSync(path.join(workingDirectory, filePath), contents);
    }
    await strategy.stageFiles(Object.keys(contentsByPath));
    await strategy.commit(message, {});
  }

  async function createTwoFileMergeConflict() {
    await writeAndCommit(
      {
        ".gitattributes": "custom.txt conflict-marker-size=12\n",
        "standard.txt": "base\n",
        "custom.txt": "base\n",
      },
      "base",
    );

    await strategy.checkout("feature", { createNew: true });
    await writeAndCommit(
      { "standard.txt": "feature\n", "custom.txt": "feature\n" },
      "feature changes",
    );

    await strategy.checkout("main");
    await writeAndCommit({ "standard.txt": "main\n", "custom.txt": "main\n" }, "main changes");

    let mergeFailed = false;
    try {
      await strategy.merge("feature");
    } catch (_error) {
      mergeFailed = true;
    }
    expect(mergeFailed).toBe(true);
    expect((await strategy.exec(["ls-files", "-u"])).trim()).not.toBe("");
  }

  async function diskMarkerCount(filePath) {
    return Conflict.countFromStream(fs.createReadStream(filePath, { encoding: "utf8" }));
  }

  async function mountConflictEditor(relativePath, resolutionProgress, { isRebase = false } = {}) {
    const fullPath = path.join(workingDirectory, relativePath);
    const editor = await lumine.workspace.open(fullPath, { activatePane: false });
    editors.push(editor);

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    const refreshResolutionProgress = async (filePath) => {
      const count = await diskMarkerCount(filePath);
      resolutionProgress.reportDiskMarkerCount(filePath, count);
      return count;
    };
    await refreshResolutionProgress(fullPath);

    let controller;
    await act(async () => {
      root.render(
        <EditorConflictController
          ref={(instance) => (controller = instance)}
          editor={editor}
          isRebase={isRebase}
          resolutionProgress={resolutionProgress}
          refreshResolutionProgress={refreshResolutionProgress}
          commands={lumine.commands}
        />,
      );
    });

    return { controller, editor, fullPath, refreshResolutionProgress };
  }

  function buildStageController(resolutionProgress, mergeConflicts, notificationManager) {
    const controller = Object.create(GitTabController.prototype);
    controller.props = {
      repository: panelRepository,
      notificationManager,
      resolutionProgress,
      workingDirectoryPath: workingDirectory,
      mergeConflicts,
      unstagedChanges: [],
      confirm: jasmine.createSpy("confirm"),
    };
    return controller;
  }

  it("isolates editors, blocks dirty resolutions, and stages saved standard and custom markers", async () => {
    await createTwoFileMergeConflict();
    const mergeConflicts = await panelRepository.getMergeConflicts();
    expect(mergeConflicts.map((conflict) => conflict.filePath).sort()).toEqual([
      "custom.txt",
      "standard.txt",
    ]);

    const resolutionProgress = new ResolutionProgress();
    const standard = await mountConflictEditor("standard.txt", resolutionProgress);
    const custom = await mountConflictEditor("custom.txt", resolutionProgress);
    expect(standard.controller.state.conflicts.size).toBe(1);
    expect(custom.controller.state.conflicts.size).toBe(1);
    expect(custom.editor.getText()).toContain("<<<<<<<<<<<< HEAD");

    standard.editor.setCursorBufferPosition([0, 0]);
    lumine.commands.dispatch(standard.editor.getElement(), "git-panel:resolve-as-ours");
    await act(async () => nextTurn());

    expect(normalizeEol(standard.editor.getText())).toBe("main\n");
    expect(standard.editor.isModified()).toBe(true);
    expect(custom.editor.getText()).toContain("<<<<<<<<<<<< HEAD");
    expect(custom.editor.isModified()).toBe(false);

    const notifications = {
      addWarning: jasmine.createSpy("addWarning"),
      addError: jasmine.createSpy("addError"),
    };
    const stageController = buildStageController(resolutionProgress, mergeConflicts, notifications);
    await stageController.stageFiles(["standard.txt"]);
    expect((await strategy.exec(["ls-files", "-u", "--", "standard.txt"])).trim()).not.toBe("");
    expect(notifications.addWarning).toHaveBeenCalled();

    await act(async () => {
      await standard.editor.save();
      await standard.refreshResolutionProgress(standard.fullPath);
      await nextTurn();
    });
    expect(resolutionProgress.isStagingReady(standard.fullPath)).toBe(true);
    await stageController.stageFiles(["standard.txt"]);
    expect((await strategy.exec(["ls-files", "-u", "--", "standard.txt"])).trim()).toBe("");

    custom.editor.setCursorBufferPosition([0, 0]);
    lumine.commands.dispatch(custom.editor.getElement(), "git-panel:resolve-as-ours");
    await act(async () => {
      await nextTurn();
      await custom.editor.save();
      await custom.refreshResolutionProgress(custom.fullPath);
      await nextTurn();
    });
    expect(normalizeEol(custom.editor.getText())).toBe("main\n");
    expect(resolutionProgress.isStagingReady(custom.fullPath)).toBe(true);
    await stageController.stageFiles(["custom.txt"]);

    expect((await strategy.exec(["ls-files", "-u"])).trim()).toBe("");
    expect(normalizeEol(fs.readFileSync(path.join(workingDirectory, "standard.txt"), "utf8"))).toBe(
      "main\n",
    );
    expect(normalizeEol(fs.readFileSync(path.join(workingDirectory, "custom.txt"), "utf8"))).toBe(
      "main\n",
    );
    expect(notifications.addError).not.toHaveBeenCalled();
  });

  it("keeps user-facing ours semantics while rebasing", async () => {
    await writeAndCommit({ "rebase.txt": "base\n" }, "base");
    await strategy.checkout("feature", { createNew: true });
    await writeAndCommit({ "rebase.txt": "feature\n" }, "feature change");
    await strategy.checkout("main");
    await writeAndCommit({ "rebase.txt": "main\n" }, "main change");
    await strategy.checkout("feature");

    let rebaseFailed = false;
    try {
      await strategy.exec(["rebase", "main"], { writeOperation: true });
    } catch (_error) {
      rebaseFailed = true;
    }
    expect(rebaseFailed).toBe(true);
    expect(await panelRepository.isRebasing()).toBe(true);

    const mergeConflicts = await panelRepository.getMergeConflicts();
    expect(mergeConflicts.map((conflict) => conflict.filePath)).toEqual(["rebase.txt"]);
    const resolutionProgress = new ResolutionProgress();
    const rebase = await mountConflictEditor("rebase.txt", resolutionProgress, {
      isRebase: true,
    });

    rebase.editor.setCursorBufferPosition([0, 0]);
    lumine.commands.dispatch(rebase.editor.getElement(), "git-panel:resolve-as-ours");
    await act(async () => {
      await nextTurn();
      await rebase.editor.save();
      await rebase.refreshResolutionProgress(rebase.fullPath);
      await nextTurn();
    });

    expect(normalizeEol(rebase.editor.getText())).toBe("feature\n");
    expect(resolutionProgress.isStagingReady(rebase.fullPath)).toBe(true);
    const notifications = {
      addWarning: jasmine.createSpy("addWarning"),
      addError: jasmine.createSpy("addError"),
    };
    const stageController = buildStageController(resolutionProgress, mergeConflicts, notifications);
    await stageController.stageFiles(["rebase.txt"]);

    expect((await strategy.exec(["ls-files", "-u"])).trim()).toBe("");
    expect(normalizeEol(fs.readFileSync(rebase.fullPath, "utf8"))).toBe("feature\n");
    expect(notifications.addWarning).not.toHaveBeenCalled();
    expect(notifications.addError).not.toHaveBeenCalled();
  });

  it("requires an explicit choice for binary and delete-modify conflicts", async () => {
    await writeAndCommit(
      {
        ".gitattributes": "binary.bin binary\n",
        "binary.bin": Buffer.from([0, 1, 2, 3]),
        "delete-modify.txt": "base\n",
      },
      "base",
    );
    await strategy.checkout("feature", { createNew: true });
    await writeAndCommit(
      {
        "binary.bin": Buffer.from([0, 4, 5, 6]),
        "delete-modify.txt": "feature keeps this file\n",
      },
      "feature changes",
    );
    await strategy.checkout("main");
    fs.writeFileSync(path.join(workingDirectory, "binary.bin"), Buffer.from([0, 7, 8, 9]));
    fs.unlinkSync(path.join(workingDirectory, "delete-modify.txt"));
    await strategy.stageFiles(["binary.bin", "delete-modify.txt"]);
    await strategy.commit("main changes", {});

    let mergeFailed = false;
    try {
      await strategy.merge("feature");
    } catch (_error) {
      mergeFailed = true;
    }
    expect(mergeFailed).toBe(true);

    const mergeConflicts = await panelRepository.getMergeConflicts();
    expect(mergeConflicts.map((conflict) => conflict.filePath).sort()).toEqual([
      "binary.bin",
      "delete-modify.txt",
    ]);
    expect(await panelRepository.pathHasMergeMarkers("binary.bin")).toBe(false);
    expect(await panelRepository.pathHasMergeMarkers("delete-modify.txt")).toBe(false);

    const resolutionProgress = new ResolutionProgress();
    for (const conflict of mergeConflicts) {
      resolutionProgress.reportDiskMarkerCount(path.join(workingDirectory, conflict.filePath), 0);
      expect(
        resolutionProgress.getStatus(path.join(workingDirectory, conflict.filePath)).reason,
      ).toBe("choice");
    }

    const notifications = {
      addWarning: jasmine.createSpy("addWarning"),
      addError: jasmine.createSpy("addError"),
    };
    const stageController = buildStageController(resolutionProgress, mergeConflicts, notifications);
    stageController.props.confirm.and.returnValue(Promise.resolve(1));
    await stageController.stageFiles(["binary.bin"]);
    expect((await strategy.exec(["ls-files", "-u", "--", "binary.bin"])).trim()).not.toBe("");

    stageController.props.confirm.and.returnValue(Promise.resolve(0));
    await stageController.stageFiles(["binary.bin", "delete-modify.txt"]);
    expect((await strategy.exec(["ls-files", "-u"])).trim()).toBe("");
    expect(
      normalizeEol(fs.readFileSync(path.join(workingDirectory, "delete-modify.txt"), "utf8")),
    ).toBe("feature keeps this file\n");
    expect(notifications.addWarning).not.toHaveBeenCalled();
    expect(notifications.addError).not.toHaveBeenCalled();
  });
});
