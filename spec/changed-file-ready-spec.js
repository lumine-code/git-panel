/** @babel */
import { Emitter } from "lumine";
import ChangedFileItem from "../lib/items/changed-file-item";
import { buildFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";
import GitRootController from "../lib/controllers/git-root-controller";

describe("native changed-file readiness and navigation", () => {
  let item, patch, emitter;
  afterEach(async () => {
    await item?.destroy();
    patch?.getBuffer().destroy();
    emitter?.dispose();
  });

  function createItem({ loading = false } = {}) {
    emitter = new Emitter();
    patch = buildFilePatch([
      {
        oldPath: "example.txt",
        newPath: "example.txt",
        status: "modified",
        oldMode: "100644",
        newMode: "100644",
        hunks: [
          {
            oldStartLine: 10,
            oldLineCount: 3,
            newStartLine: 10,
            newLineCount: 3,
            heading: "",
            lines: [" keep", "-before", "+after", " end"],
          },
        ],
      },
    ]);
    const repository = {
      isLoading: () => loading,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getFilePatchForPath: () => Promise.resolve(patch),
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
    };
    item = new ChangedFileItem({
      workdirContextPool: { add: () => ({ getRepository: () => repository }) },
      workingDirectory: "C:\\native-changed-file-spec",
      relPath: "example.txt",
      stagingStatus: "unstaged",
      workspace: lumine.workspace,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      config: lumine.config,
      tooltips: lumine.tooltips,
    });
    jasmine.attachToDOM(item.element);
    return item;
  }

  it("resolves only after the patch view exists and navigates the source line", async () => {
    createItem();
    await flushViews(async () => {});
    const controller = await item.getFilePatchLoadedPromise();
    expect(controller).toBe(item.refPatchController.get());
    const editor = item.refEditor.get();
    item.goToDiffLine(11);
    expect(editor.getCursorBufferPosition().row).toBe(2);
    item.focus();
    expect(editor.getElement().contains(document.activeElement)).toBe(true);
    item.goToDiffLine(100);
    expect(editor.getCursorBufferPosition().row).toBe(3);
  });

  it("settles readiness with null when closed while the repository is loading", async () => {
    createItem({ loading: true });
    const readiness = item.getFilePatchLoadedPromise();
    await item.destroy();
    expect(await readiness).toBeNull();
    await flushViews(async () => {});
    expect(item.destroyed).toBe(true);
  });
});

describe("current-file diff command guards", () => {
  it("handles a workspace without an active editor and explains unsaved files", async () => {
    let editor = null;
    const controller = Object.create(GitRootController.prototype);
    const warning = jasmine.createSpy("unsaved file warning");
    controller.props = {
      workspace: { getActiveTextEditor: () => editor },
      notificationManager: { addWarning: warning },
    };
    await controller.viewChangesForCurrentFile("unstaged");
    expect(warning).not.toHaveBeenCalled();
    editor = { getPath: () => null };
    await controller.viewChangesForCurrentFile("unstaged");
    expect(warning).toHaveBeenCalledOnceWith("Save the file before viewing its Git changes.");
  });

  it("uses the package initializer before retrying the current-file diff", async () => {
    const controller = Object.create(GitRootController.prototype);
    const projectPath = "example-project";
    let options;
    const notification = { dismiss: jasmine.createSpy("dismiss explanation") };
    controller.props = {
      workspace: { getActiveTextEditor: () => ({ getPath: () => __filename }) },
      repository: { getWorkingDirectoryPath: () => null },
      project: { relativizePath: () => [projectPath, "example.txt"] },
      notificationManager: {
        addInfo: (_message, chosen) => {
          options = chosen;
          return notification;
        },
      },
      initialize: jasmine.createSpy("initialize repository").and.resolveTo(projectPath),
    };
    await controller.viewChangesForCurrentFile("unstaged");
    spyOn(controller, "viewChangesForCurrentFile").and.resolveTo();
    await options.buttons[0].onDidClick();
    expect(controller.props.initialize).toHaveBeenCalledOnceWith(projectPath);
    expect(controller.viewChangesForCurrentFile).toHaveBeenCalledOnceWith("unstaged");
    expect(notification.dismiss).toHaveBeenCalled();
  });
});
