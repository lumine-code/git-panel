/** @babel */
import GitPackage from "../lib/git-package";

async function until(predicate, maxTicks = 10000) {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("timed out waiting for condition");
}

describe("GitPackage startup repository selection", () => {
  it("coalesces a burst of active-context updates to the latest trailing request", async () => {
    let finishFirstUpdate;
    const firstUpdate = new Promise((resolve) => (finishFirstUpdate = resolve));
    const packageInstance = {
      switchboard: { didScheduleActiveContextUpdate: jasmine.createSpy() },
      pendingActiveContextOptions: null,
      activeContextUpdatePromise: null,
      updateActiveContext: jasmine.createSpy().and.returnValues(firstUpdate, Promise.resolve()),
      runActiveContextUpdates: GitPackage.prototype.runActiveContextUpdates,
    };

    const first = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance, {
      usePath: "C:\\first",
    });
    const second = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance, {
      usePath: "C:\\second",
    });
    const third = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance, {
      usePath: "C:\\latest",
    });
    const discoveryUpdate = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(third).toBe(discoveryUpdate);
    expect(packageInstance.updateActiveContext.calls.count()).toBe(1);

    finishFirstUpdate();
    await first;

    expect(packageInstance.updateActiveContext.calls.count()).toBe(2);
    expect(packageInstance.updateActiveContext.calls.argsFor(1)).toEqual([
      { usePath: "C:\\latest" },
    ]);
    expect(packageInstance.activeContextUpdatePromise).toBeNull();
  });

  it("materializes contexts only for project roots and the active repository", async () => {
    const rootPath = "C:\\workspace";
    const activeWorkdir = "C:\\workspace\\active";
    const activeLumineRepository = { getWorkingDirectory: () => activeWorkdir };
    const rootContext = { getRepository: () => ({ isPresent: () => false }) };
    const activeContext = { getRepository: () => ({ isPresent: () => true }) };
    const contexts = new Map([
      [rootPath, rootContext],
      [activeWorkdir, activeContext],
    ]);
    const contextPool = {
      add: jasmine.createSpy().and.callFake((workdir) => contexts.get(workdir)),
      getContext: (workdir) => contexts.get(workdir),
    };
    const packageInstance = {
      project: {
        getPaths: () => [rootPath],
        getDirectories: () => [
          {
            contains: (candidate) => candidate.startsWith(rootPath),
            getPath: () => rootPath,
          },
        ],
      },
      repositories: {
        getForPath: (candidate) => (candidate === activeWorkdir ? activeLumineRepository : null),
        resolveForPath: () => Promise.resolve(null),
        getActiveRepositoryContext: () => ({
          repository: activeLumineRepository,
          workingDirectory: activeWorkdir,
        }),
        getRepositories: jasmine.createSpy(),
      },
      workdirCache: { find: () => Promise.resolve(null) },
      contextPool,
      startupContextPending: false,
      activeContext,
    };

    const next = await GitPackage.prototype.getNextContext.call(packageInstance);

    expect(next).toBe(activeContext);
    expect(contextPool.add.calls.allArgs()).toEqual([[rootPath], [activeWorkdir]]);
    expect(packageInstance.repositories.getRepositories).not.toHaveBeenCalled();
  });

  it("keeps the startup gate closed until the restored context update settles", async () => {
    let finishUpdate;
    const packageInstance = {
      activated: true,
      workspace: { isDestroyed: () => false },
      repositories: {
        setActiveRepositoryForPath: jasmine.createSpy().and.returnValue(Promise.resolve()),
      },
      scheduleActiveContextUpdate: jasmine
        .createSpy()
        .and.returnValue(new Promise((resolve) => (finishUpdate = resolve))),
      startupContextPending: true,
    };
    spyOn(global, "setImmediate").and.callFake((callback) => {
      Promise.resolve().then(callback);
      return 1;
    });

    GitPackage.prototype.scheduleStartupActiveContextUpdate.call(packageInstance, {
      usePath: "C:\\workdir",
      lock: true,
    });

    await until(() => packageInstance.scheduleActiveContextUpdate.calls.any());
    expect(packageInstance.startupContextPending).toBe(true);
    expect(packageInstance.scheduleActiveContextUpdate).toHaveBeenCalledWith({
      usePath: "C:\\workdir",
      waitForRepository: true,
    });

    finishUpdate();
    await until(() => !packageInstance.startupContextPending);
  });
});
