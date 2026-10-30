/** @babel */
import path from "path";
import { Emitter } from "lumine";
import PatchItem from "../lib/items/patch-item.js";
import PatchDocument from "../lib/models/patch-document.js";
import { buildFilePatch } from "../lib/models/patch/index.js";
import { flushViews } from "./helpers/etch.js";
import GitRootController from "../lib/controllers/git-root-controller.js";

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
    item = new PatchItem({
      workdirContextPool: {
        retain: () => ({
          context: { getRepository: () => repository },
          ready,
          dispose: release,
        }),
        onDidChangePoolContexts: () => ({ dispose() {} }),
      },
      document: PatchDocument.file("C:\\native-changed-file-spec", "example.txt", "unstaged"),
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
    const controller = await item.getPatchLoadedPromise();
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
    const readiness = item.getPatchLoadedPromise();
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
    expect(await item.getPatchLoadedPromise()).not.toBeNull();
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
    expect(await item.getPatchLoadedPromise()).toBeNull();
    expect(readPatch).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("emits one destroy event and releases one observation when a listener destroys it again", async () => {
    createItem();
    await flushViews(() => {});
    const didDestroy = jasmine.createSpy("destroy event").and.callFake(() => item.destroy());
    item.onDidDestroy(didDestroy);
    await item.destroy();
    await item.destroy();
    expect(didDestroy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(item.destroyed).toBe(true);
  });
});

describe("current-file diff command guards", () => {
  it("opens the dispatch target's file repository while another repository is pinned", async () => {
    const controller = Object.create(GitRootController.prototype);
    const workingDirectory = path.dirname(import.meta.filename);
    const editor = {
      getPath: () => import.meta.filename,
      getCursorBufferPosition: () => ({ row: 4 }),
    };
    const coreRepository = {
      getWorkingDirectory: () => workingDirectory,
      posixRelativePath: () => "selected.js",
    };
    const event = { target: document.createElement("div") };
    const getContext = jasmine
      .createSpy("resolve dispatch context")
      .and.returnValue({ editor, repository: coreRepository });
    const patchView = {
      getPatchLoadedPromise: async () => {},
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
      PatchDocument.file(workingDirectory, "selected.js", "unstaged").getURI(),
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

  it("uses the connected setup provider before retrying the current-file diff", async () => {
    const controller = Object.create(GitRootController.prototype);
    const projectPath = "example-project";
    let options;
    const notification = { dismiss: jasmine.createSpy("dismiss explanation") };
    controller.props = {
      workspace: { getActiveTextEditor: () => ({ getPath: () => import.meta.filename }) },
      repositories: {
        getCommandContext: () => ({
          editor: { getPath: () => import.meta.filename },
          repository: null,
        }),
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
      repositorySetup: {
        openInitializeDialog: jasmine.createSpy("initialize repository").and.resolveTo({
          getWorkingDirectory: () => projectPath,
        }),
      },
    };
    await controller.viewChangesForCurrentFile("unstaged");
    spyOn(controller, "viewChangesForCurrentFile").and.resolveTo();
    await options.buttons[0].onDidClick();
    expect(controller.props.repositorySetup.openInitializeDialog).toHaveBeenCalledOnceWith({
      event: undefined,
      directoryPath: projectPath,
    });
    expect(controller.viewChangesForCurrentFile).toHaveBeenCalledOnceWith("unstaged", undefined);
    expect(notification.dismiss).toHaveBeenCalled();
  });

  it("does not retry a cancelled setup and omits it without a connected provider", async () => {
    const controller = Object.create(GitRootController.prototype);
    let options;
    controller.props = {
      repositories: {
        getCommandContext: () => ({
          editor: { getPath: () => import.meta.filename },
          repository: null,
        }),
        getForPath: () => null,
        resolveForPath: async () => null,
      },
      project: { relativizePath: () => [path.dirname(import.meta.filename), "example.txt"] },
      notificationManager: {
        addWarning: (_message, chosen) => {
          options = chosen;
          return { dismiss() {} };
        },
      },
    };
    await controller.viewChangesForCurrentFile("unstaged");
    expect(options.buttons).toEqual([]);

    controller.props.repositorySetup = { openInitializeDialog: async () => null };
    await controller.viewChangesForCurrentFile("unstaged");
    const retry = spyOn(controller, "viewChangesForCurrentFile");
    await options.buttons[0].onDidClick();
    expect(retry).not.toHaveBeenCalled();
  });
});
