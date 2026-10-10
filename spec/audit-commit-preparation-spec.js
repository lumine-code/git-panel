/** @babel */
require("../lib/index");
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Repository from "../lib/models/repository";
import GitTabController from "../lib/controllers/git-tab-controller";
import CommitController from "../lib/controllers/commit-controller";
import CommitView from "../lib/views/commit-view";
import ChangedFileItem from "../lib/items/changed-file-item";
import { Emitter } from "lumine";
import { buildFilePatch } from "../lib/models/patch";
import {
  getFilePatchPaneItems,
  destroyFilePatchPaneItems,
  destroyEmptyFilePatchPaneItems,
} from "../lib/helpers";
import { createViewModel, flushViews } from "./helpers/etch";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("Commit preparation against current native Git context", () => {
  let scratch, temporaryRoot, core, repositories, tab, controller, view, gate, entered, work;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    temporaryRoot = await fs.realpath(os.tmpdir());
    scratch = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, "commit-prepare-")));
    core = [];
    repositories = [];
    gate = deferred();
    entered = deferred();
    work = [];
    for (const name of ["first", "second"]) {
      const directory = path.join(scratch, name);
      await fs.mkdir(directory);
      core.push(await lumine.repositories.initialize(directory, { initialBranch: "main" }));
      const repository = new Repository(directory);
      repositories.push(repository);
      await repository.getLoadPromise();
      await repository.setConfig("user.name", `Controlled ${name}`);
      await repository.setConfig("user.email", `${name}@example.invalid`);
      await fs.writeFile(path.join(directory, "same.txt"), `${name} initial\n`);
      await repository.stageFiles(["same.txt"]);
      await repository.commit(`${name} initial`, {});
      await fs.writeFile(path.join(directory, "same.txt"), `${name} changed\n`);
      await repository.stageFiles(["same.txt"]);
      repository.setCommitMessage(`${name} prepared`);
    }
    tab = createViewModel(GitTabController, {
      repository: repositories[0],
      config: lumine.config,
      username: "Controlled first",
      email: "first@example.invalid",
      ensureGitTab: async () => {
        entered.resolve();
        await gate.promise;
        return false;
      },
    });
    controller = createViewModel(CommitController, {
      repository: repositories[0],
      workspace: lumine.workspace,
      config: lumine.config,
      grammars: lumine.grammars,
      commit: tab.commit,
    });
    view = new CommitView({
      repository: repositories[0],
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      tooltips: lumine.tooltips,
      stagedChangesExist: true,
      mergeConflictsExist: false,
      prepareToCommit: tab.prepareToCommit,
      commit: controller.commit,
      abortMerge: () => {},
      maximumCharacterLimit: 72,
      messageBuffer: controller.commitMessageBuffer,
      isMerging: false,
      isCommitting: false,
      lastCommit: await repositories[0].getLastCommit(),
      currentBranch: await repositories[0].getCurrentBranch(),
      toggleExpandedCommitMessageEditor: () => {},
      deactivateCommitBox: false,
      userStore: tab.userStore,
      selectedCoAuthors: [],
      updateSelectedCoAuthors: () => {},
    });
    jasmine.attachToDOM(view.element);
  });
  afterEach(async () => {
    gate?.resolve();
    await Promise.allSettled(work);
    await view?.destroy();
    await controller?.destroy();
    await tab?.destroy();
    for (const repository of repositories) repository.destroy();
    for (const repository of core) await lumine.repositories.forget(repository);
    const relative = path.relative(temporaryRoot, scratch);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error("Unsafe scratch target");
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  for (const action of ["live", "switch", "switchback", "retire"]) {
    it(`preserves repository HEADs when preparation is ${action}`, async () => {
      const before = await Promise.all(
        repositories.map((repository) => repository.getLastCommit()),
      );
      const committing = view.commit(null, false);
      work.push(committing);
      await entered.promise;
      if (action.startsWith("switch")) {
        for (const index of action === "switchback" ? [1, 0] : [1]) {
          await tab.update({ ...tab.props, repository: repositories[index] });
          await controller.update({ ...controller.props, repository: repositories[index] });
          controller.commitMessageBuffer.setText(index ? "second prepared" : "first prepared");
          await flushViews(() =>
            view.update({
              ...view.props,
              repository: repositories[index],
              lastCommit: before[index],
            }),
          );
        }
      } else if (action === "retire") {
        await view.destroy();
        await tab.destroy();
      }
      gate.resolve();
      await committing;
      const after = await Promise.all(repositories.map((repository) => repository.getLastCommit()));
      if (action === "live") {
        expect(after[0].getSha()).not.toBe(before[0].getSha());
        expect(after[0].getFullMessage().trim()).toBe("first prepared");
      } else expect(after[0].getSha()).toBe(before[0].getSha());
      expect(after[1].getSha()).toBe(before[1].getSha());
    });
  }
});

describe("Patch cleanup against current native pane items", () => {
  let items, patches, emitters;
  beforeEach(() => {
    items = [];
    patches = [];
    emitters = [];
  });
  afterEach(async () => {
    for (const item of items) await item.destroy();
    for (const patch of patches) patch.dispose();
    for (const emitter of emitters) emitter.dispose();
  });
  async function createItem({
    stagingStatus = "unstaged",
    empty = false,
    loading = false,
    metadata = false,
  } = {}) {
    const emitter = new Emitter();
    emitters.push(emitter);
    const patch = buildFilePatch(
      empty
        ? []
        : [
            {
              oldPath: "example.txt",
              newPath: "example.txt",
              status: "modified",
              oldMode: "100644",
              newMode: metadata ? "100755" : "100644",
              hunks: metadata
                ? []
                : [
                    {
                      oldStartLine: 1,
                      oldLineCount: 1,
                      newStartLine: 1,
                      newLineCount: 1,
                      heading: "",
                      lines: ["-before", "+after"],
                    },
                  ],
            },
          ],
    );
    patches.push(patch);
    const repository = {
      isLoading: () => loading,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getFilePatchForPath: async () => patch,
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
    };
    const item = new ChangedFileItem({
      workdirContextPool: {
        retain: () => ({
          context: { getRepository: () => repository },
          ready: Promise.resolve(),
          dispose() {},
        }),
        onDidChangePoolContexts: () => ({ dispose() {} }),
      },
      workingDirectory: path.join(lumine.getConfigDirPath(), "native-patch"),
      relPath: "example.txt",
      stagingStatus,
      workspace: lumine.workspace,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      config: lumine.config,
      tooltips: lumine.tooltips,
    });
    items.push(item);
    lumine.workspace.getActivePane().addItem(item);
    await flushViews(() => {});
    if (!loading) await item.getFilePatchLoadedPromise();
    return item;
  }
  it("finds actual staged and unstaged items and closes only the staged one", async () => {
    const staged = await createItem({ stagingStatus: "staged" });
    const unstaged = await createItem();
    expect(staged.isFilePatchItem()).toBe(true);
    expect(staged.getStagingStatus()).toBe("staged");
    expect(getFilePatchPaneItems({}, lumine.workspace)).toEqual([staged, unstaged]);
    expect(getFilePatchPaneItems({ onlyStaged: true }, lumine.workspace)).toEqual([staged]);
    destroyFilePatchPaneItems({ onlyStaged: true }, lumine.workspace);
    expect(staged.isDestroyed).toBe(true);
    expect(unstaged.isDestroyed).toBe(false);
  });
  it("closes truly empty patches and preserves metadata-only changes and loading items", async () => {
    const empty = await createItem({ empty: true });
    const metadata = await createItem({ metadata: true });
    const loading = await createItem({ loading: true });
    expect(
      empty.refPatchController
        .get()
        .props.multiFilePatch.getFilePatches()
        .every((patch) => !patch.isPresent()),
    ).toBe(true);
    expect(metadata.refPatchController.get().props.multiFilePatch.getFilePatches().length).toBe(1);
    expect(loading.refPatchController.isEmpty()).toBe(true);
    expect(getFilePatchPaneItems({ empty: true }, lumine.workspace)).toEqual([empty]);
    destroyEmptyFilePatchPaneItems(lumine.workspace);
    expect(empty.isDestroyed).toBe(true);
    expect(metadata.isDestroyed).toBe(false);
    expect(loading.isDestroyed).toBe(false);
  });
});
