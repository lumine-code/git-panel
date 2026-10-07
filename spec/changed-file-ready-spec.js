/** @babel */
import path from "path";
import { Emitter } from "lumine";
import ChangedFileItem from "../lib/items/changed-file-item";
import { buildFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";
import GitRootController from "../lib/controllers/git-root-controller";

describe("native changed-file readiness and navigation", () => {
  let item, patch, emitter, readPatch, release;
  afterEach(async () => {
    await item?.destroy();
    patch?.getBuffer().destroy();
    emitter?.dispose();
  });

  function createItem({ loading = false, ready = Promise.resolve() } = {}) {
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
    readPatch = jasmine.createSpy("read patch").and.resolveTo(patch);
    release = jasmine.createSpy("release observation");
    const repository = {
      isLoading: () => loading,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getFilePatchForPath: readPatch,
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
    };
    item = new ChangedFileItem({
      workdirContextPool: {
        retain: () => ({
          context: { getRepository: () => repository },
          ready,
          dispose: release,
        }),
        onDidChangePoolContexts: () => ({ dispose() {} }),
      },
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

  it("waits for fresh snapshots before reading and releases its own observation", async () => {
    let resume;
    createItem({ ready: new Promise((resolve) => (resume = resolve)) });
    await flushViews(async () => {});
    expect(readPatch).not.toHaveBeenCalled();
    expect(item.refPatchController.isEmpty()).toBe(true);
    resume();
    await flushViews(async () => {});
    expect(await item.getFilePatchLoadedPromise()).not.toBeNull();
    expect(readPatch).toHaveBeenCalled();
    await item.destroy();
    await item.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not mount readers when a closed pane's resume finishes later", async () => {
    let resume;
    createItem({ ready: new Promise((resolve) => (resume = resolve)) });
    await item.destroy();
    resume();
    await flushViews(async () => {});
    expect(await item.getFilePatchLoadedPromise()).toBeNull();
    expect(readPatch).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("current-file diff command guards", () => {
  it("opens the dispatch target's file repository while another repository is pinned", async () => {
    const controller = Object.create(GitRootController.prototype);
    const workingDirectory = path.dirname(__filename);
    const editor = { getPath: () => __filename, getCursorBufferPosition: () => ({ row: 4 }) };
    const coreRepository = {
      getWorkingDirectory: () => workingDirectory,
      posixRelativePath: () => "selected.js",
    };
    const event = { target: document.createElement("div") };
    const getContext = jasmine
      .createSpy("resolve dispatch context")
      .and.returnValue({ editor, repository: coreRepository });
    const patchView = {
      getFilePatchLoadedPromise: async () => {},
      goToDiffLine: jasmine.createSpy("navigate"),
      focus: jasmine.createSpy("focus"),
    };
    const open = jasmine
      .createSpy("open targeted diff")
      .and.resolveTo({ whenHydrated: async () => patchView });
    controller.quietlySelectItem = jasmine.createSpy("select in pinned panel");
    controller.props = {
      repositories: { getCommandContext: getContext },
      repository: { getWorkingDirectoryPath: () => "another-repository" },
      workspace: { open, getActivePane: () => ({}) },
      config: { get: () => "none" },
    };
    await controller.viewChangesForCurrentFile("unstaged", event);
    expect(getContext).toHaveBeenCalledOnceWith(event, { scope: "file" });
    expect(open.calls.mostRecent().args[0]).toBe(
      ChangedFileItem.buildURI("selected.js", workingDirectory, "unstaged"),
    );
    expect(controller.quietlySelectItem).not.toHaveBeenCalled();
    expect(patchView.goToDiffLine).toHaveBeenCalledOnceWith(5);
  });
  it("handles a workspace without an active editor and explains unsaved files", async () => {
    let editor = null;
    const controller = Object.create(GitRootController.prototype);
    const warning = jasmine.createSpy("unsaved file warning");
    controller.props = {
      workspace: { getActiveTextEditor: () => editor },
      repositories: { getCommandContext: () => ({ editor, repository: null }) },
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
      repositories: {
        getCommandContext: () => ({ editor: { getPath: () => __filename }, repository: null }),
        getForPath: () => null,
        resolveForPath: async () => null,
      },
      repository: { getWorkingDirectoryPath: () => null },
      project: { relativizePath: () => [projectPath, "example.txt"] },
      notificationManager: {
        addWarning: (_message, chosen) => {
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
    expect(controller.viewChangesForCurrentFile).toHaveBeenCalledOnceWith("unstaged", undefined);
    expect(notification.dismiss).toHaveBeenCalled();
  });
});
