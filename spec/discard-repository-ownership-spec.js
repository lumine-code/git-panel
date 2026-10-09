/** @babel */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Repository from "../lib/models/repository";
import GitRootController from "../lib/controllers/git-root-controller";
import GitTabController from "../lib/controllers/git-tab-controller";
import { createViewModel } from "./helpers/etch";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

describe("Git discard repository ownership", () => {
  let scratch,
    temporaryRoot,
    coreRepositories,
    repositories,
    controller,
    gates,
    work,
    tabControllers;
  const sourceFile = (index) =>
    path.join(repositories[index].getWorkingDirectoryPath(), "same.txt");
  const prepareHistory = async () => {
    const repository = repositories[0];
    await repository.storeBeforeAndAfterBlobs(
      ["same.txt"],
      () => true,
      () => repository.discardWorkDirChangesForPaths(["same.txt"]),
    );
    await expectAsync(fs.access(sourceFile(0))).toBeRejected();
  };
  const hold = (repository, method) => {
    const entered = deferred();
    const release = deferred();
    gates.push(release);
    const original = repository[method].bind(repository);
    spyOn(repository, method).and.callFake(async (...args) => {
      entered.resolve();
      await release.promise;
      return original(...args);
    });
    return { entered: entered.promise, release: release.resolve };
  };
  const switchRepository = () =>
    controller.update({ ...controller.props, repository: repositories[1] });

  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    temporaryRoot = await fs.realpath(os.tmpdir());
    scratch = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, "discard-owner-")));
    coreRepositories = [];
    repositories = [];
    gates = [];
    work = [];
    tabControllers = [];
    for (const [name, text] of [
      ["first", "first repository\n"],
      ["second", "second repository\n"],
    ]) {
      const directory = path.join(scratch, name);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, "same.txt"), text);
      coreRepositories.push(
        await lumine.repositories.initialize(directory, { initialBranch: "main" }),
      );
      const repository = new Repository(directory);
      repositories.push(repository);
      await repository.getLoadPromise();
      await repository.setConfig("user.name", `Controlled ${name}`);
      await repository.setConfig("user.email", `${name}@example.invalid`);
    }
    // Keep the render shell out of this filesystem proof. The controller,
    // props update boundary, workspace and both Git repository models are real.
    controller = createViewModel(GitRootController, {
      repository: repositories[0],
      workspace: lumine.workspace,
      busySignal: null,
      gitTabTracker: { ensureVisible() {} },
      notificationManager: lumine.notifications,
      confirm: async () => 0,
    });
  });

  afterEach(async () => {
    for (const gate of gates) gate.resolve();
    await Promise.allSettled(work);
    controller?.destroy();
    for (const tab of tabControllers) tab.destroy();
    for (const repository of repositories) repository.destroy();
    for (const repository of coreRepositories) await lumine.repositories.forget(repository);
    const relative = path.relative(temporaryRoot, scratch);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("Unsafe scratch cleanup target");
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("discards only the accepted repository after the panel selects another one", async () => {
    const gate = hold(repositories[0], "storeBeforeAndAfterBlobs");
    const discarding = controller.discardWorkDirChangesForPaths(["same.txt"]);
    work.push(discarding);
    await gate.entered;
    await switchRepository();
    gate.release();
    await discarding;
    await expectAsync(fs.access(sourceFile(0))).toBeRejected();
    expect(await fs.readFile(sourceFile(1), "utf8")).toBe("second repository\n");
  });

  it("restores only the accepted repository after a pending undo switches panels", async () => {
    await prepareHistory();
    const gate = hold(repositories[0], "restoreLastDiscardInTempFiles");
    const restoring = controller.undoLastDiscard();
    work.push(restoring);
    await gate.entered;
    await switchRepository();
    gate.release();
    await restoring;
    expect(await fs.readFile(sourceFile(1), "utf8")).toBe("second repository\n");
    expect(await fs.readFile(sourceFile(0), "utf8")).toBe("first repository\n");
    expect(repositories[0].getLastHistorySnapshots()).toEqual([]);
  });

  it("still restores ordinary live undo data and clears its actual history", async () => {
    await prepareHistory();
    await controller.undoLastDiscard();
    expect(await fs.readFile(sourceFile(0), "utf8")).toBe("first repository\n");
    expect(await fs.readFile(sourceFile(1), "utf8")).toBe("second repository\n");
    expect(repositories[0].getLastHistorySnapshots()).toEqual([]);
  });

  const buildTab = () => {
    const tab = createViewModel(GitTabController, {
      repository: repositories[0],
      workingDirectoryPath: repositories[0].getWorkingDirectoryPath(),
      username: "",
      email: "",
      config: lumine.config,
      mergeConflicts: [],
      resolutionProgress: { getStatus: () => ({ ready: true }) },
      notificationManager: lumine.notifications,
      confirm: async () => 0,
    });
    tabControllers.push(tab);
    return tab;
  };
  const switchTab = (tab) =>
    tab.update({
      ...tab.props,
      repository: repositories[1],
      workingDirectoryPath: repositories[1].getWorkingDirectoryPath(),
    });

  it("keeps a confirmed merge abort on the repository named before the confirmation wait", async () => {
    const tab = buildTab();
    const confirmation = deferred();
    gates.push(confirmation);
    tab.props.confirm = () => confirmation.promise;
    // The outer execution boundary is controlled; neither scratch repository
    // has a merge in progress and this case claims command targeting only.
    const first = spyOn(repositories[0], "abortMerge").and.resolveTo();
    const second = spyOn(repositories[1], "abortMerge").and.resolveTo();
    const aborting = tab.abortMerge();
    work.push(aborting);
    await switchTab(tab);
    confirmation.resolve(0);
    await aborting;
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  for (const switchDuringWait of [false, true]) {
    it(`stages the accepted repository ${switchDuringWait ? "after a panel switch" : "in ordinary live use"}`, async () => {
      const tab = buildTab();
      const gate = hold(repositories[0], "pathHasMergeMarkers");
      const staging = tab.stageFiles(["same.txt"]);
      work.push(staging);
      await gate.entered;
      if (switchDuringWait) await switchTab(tab);
      gate.release();
      await staging;
      expect((await repositories[0].getStagedChanges()).map((change) => change.filePath)).toEqual([
        "same.txt",
      ]);
      expect(await repositories[1].getStagedChanges()).toEqual([]);
      expect(await fs.readFile(sourceFile(1), "utf8")).toBe("second repository\n");
    });

    it(`sets both local identity fields in the accepted repository ${switchDuringWait ? "after a panel switch" : "in ordinary live use"}`, async () => {
      const tab = buildTab();
      tab.usernameBuffer.setText("Controlled Audit Person");
      tab.emailBuffer.setText("controlled@example.invalid");
      const secondIdentity = await Promise.all([
        repositories[1].getConfig("user.name"),
        repositories[1].getConfig("user.email"),
      ]);
      const gate = hold(repositories[0], "setConfig");
      const setting = tab.setLocalIdentity();
      work.push(setting);
      await gate.entered;
      if (switchDuringWait) await switchTab(tab);
      gate.release();
      await setting;
      expect(await repositories[0].getConfig("user.name")).toBe("Controlled Audit Person");
      expect(await repositories[0].getConfig("user.email")).toBe("controlled@example.invalid");
      expect(
        await Promise.all([
          repositories[1].getConfig("user.name"),
          repositories[1].getConfig("user.email"),
        ]),
      ).toEqual(secondIdentity);
    });
  }
});
