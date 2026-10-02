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
  function observationSwitch() {
    let resume;
    const nextContext = { getWorkingDirectory: () => "next-repository" };
    const previousContext = { getWorkingDirectory: () => "previous-repository" };
    const previous = { context: previousContext, dispose: jasmine.createSpy("release previous") };
    const next = {
      context: nextContext,
      ready: new Promise((resolve) => (resume = resolve)),
      dispose: jasmine.createSpy("release next"),
    };
    const packageInstance = {
      activationGeneration: {},
      activationDisposed: false,
      activeContext: previousContext,
      activeObservation: previous,
      pendingActiveObservations: new Set(),
      contextPool: { retain: jasmine.createSpy("retain").and.returnValue(next) },
      scheduleRerender: jasmine.createSpy("render"),
      switchboard: { didFinishActiveContextUpdate: jasmine.createSpy() },
      emitter: { emit: jasmine.createSpy("emit") },
    };
    return { packageInstance, previous, next, nextContext, resume };
  }

  it("keeps the selected model observed until its replacement is ready", async () => {
    const { packageInstance, previous, next, nextContext, resume } = observationSwitch();
    const change = GitPackage.prototype.setActiveContext.call(packageInstance, nextContext);
    expect(packageInstance.activeContext).toBe(previous.context);
    expect(previous.dispose).not.toHaveBeenCalled();
    expect(packageInstance.scheduleRerender).not.toHaveBeenCalled();
    resume();
    await change;
    expect(packageInstance.activeContext).toBe(nextContext);
    expect(packageInstance.activeObservation).toBe(next);
    expect(previous.dispose).toHaveBeenCalledTimes(1);
    expect(packageInstance.pendingActiveObservations.size).toBe(0);
  });

  it("releases a pending selection if its activation ends during resume", async () => {
    const { packageInstance, previous, next, nextContext, resume } = observationSwitch();
    const change = GitPackage.prototype.setActiveContext.call(packageInstance, nextContext);
    packageInstance.activationGeneration = null;
    packageInstance.activationDisposed = true;
    resume();
    await change;
    expect(packageInstance.activeContext).toBe(previous.context);
    expect(packageInstance.scheduleRerender).not.toHaveBeenCalled();
    expect(next.dispose).toHaveBeenCalledTimes(1);
    expect(packageInstance.pendingActiveObservations.size).toBe(0);
  });

  it("registers cold global commands without waiting for the view root", async () => {
    let commands;
    const root = {
      gitTabTracker: {
        toggle: jasmine.createSpy("toggle"),
        toggleFocus: jasmine.createSpy("toggleFocus"),
      },
    };
    const packageInstance = {
      commands: {
        add: jasmine.createSpy("add").and.callFake((_selector, entries) => {
          commands = entries;
          return { dispose() {} };
        }),
      },
      subscriptions: { add: jasmine.createSpy("add") },
      ensureRootController: jasmine
        .createSpy("ensureRootController")
        .and.returnValue(Promise.resolve({ root })),
      invokeGitController: jasmine
        .createSpy("invokeGitController")
        .and.returnValue(Promise.resolve()),
    };

    GitPackage.prototype.registerGlobalCommands.call(packageInstance);
    await commands["git-panel:toggle-focus"]();
    await commands["git-panel:clone"].didDispatch();

    expect(packageInstance.commands.add.calls.argsFor(0)[0]).toBe("lumine-workspace");
    expect(commands["git-panel:clone"].description).toBe(
      "Clone a remote repository into a folder you choose.",
    );
    expect(root.gitTabTracker.toggleFocus).toHaveBeenCalled();
    expect(packageInstance.invokeGitController).toHaveBeenCalledWith("openCloneDialog");
  });

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

  it("reports a failed refresh and preserves the rejection for awaited callers", async () => {
    const error = new Error("metadata watch failed");
    const packageInstance = {
      activationGeneration: {},
      activationDisposed: false,
      switchboard: { didScheduleActiveContextUpdate() {} },
      notificationManager: { addWarning: jasmine.createSpy("warning") },
      updateActiveContext: jasmine.createSpy("update").and.rejectWith(error),
      runActiveContextUpdates: GitPackage.prototype.runActiveContextUpdates,
    };
    const refresh = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance);
    await expectAsync(refresh).toBeRejectedWith(error);
    expect(packageInstance.notificationManager.addWarning).toHaveBeenCalledOnceWith(
      "Unable to refresh the active Git repository.",
      { detail: error.message, dismissable: true },
    );
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

  it("does not create contexts when path discovery finishes after deactivation", async () => {
    let finishDiscovery;
    const discovery = new Promise((resolve) => (finishDiscovery = resolve));
    const workdir = "C:\\moving-repository";
    const packageInstance = {
      activationGeneration: {},
      activationDisposed: false,
      project: { getPaths: () => [workdir] },
      repositories: {
        getForPath: () => null,
        resolveForPath: () => discovery,
        getActiveRepositoryContext: () => ({ repository: null, workingDirectory: null }),
      },
      contextPool: { add: jasmine.createSpy("add") },
    };
    const next = GitPackage.prototype.getNextContext.call(packageInstance);
    packageInstance.activationGeneration = null;
    packageInstance.activationDisposed = true;

    finishDiscovery({ getWorkingDirectory: () => workdir });

    expect(await next).toBeNull();
    expect(packageInstance.contextPool.add).not.toHaveBeenCalled();
  });

  it("does not install a context resolved by a previous activation", async () => {
    let finishContext;
    const context = new Promise((resolve) => (finishContext = resolve));
    const packageInstance = {
      activationGeneration: {},
      activationDisposed: false,
      workspace: { isDestroyed: () => false },
      switchboard: { didBeginActiveContextUpdate: jasmine.createSpy() },
      getNextContext: () => context,
      setActiveContext: jasmine.createSpy("setActiveContext"),
    };
    const update = GitPackage.prototype.updateActiveContext.call(packageInstance, {});
    packageInstance.activationGeneration = {};
    finishContext({ repository: "previous activation" });

    await update;

    expect(packageInstance.setActiveContext).not.toHaveBeenCalled();
  });

  it("does not clear the next activation's update promise when an old update finishes", async () => {
    let finishPrevious;
    let finishCurrent;
    const previous = new Promise((resolve) => (finishPrevious = resolve));
    const current = new Promise((resolve) => (finishCurrent = resolve));
    const packageInstance = {
      activationGeneration: {},
      activationDisposed: false,
      switchboard: { didScheduleActiveContextUpdate: jasmine.createSpy() },
      pendingActiveContextOptions: null,
      activeContextUpdatePromise: null,
      updateActiveContext: jasmine.createSpy().and.returnValues(previous, current),
      runActiveContextUpdates: GitPackage.prototype.runActiveContextUpdates,
    };
    const previousUpdate = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance);
    packageInstance.activationGeneration = {};
    packageInstance.activeContextUpdatePromise = null;
    const currentUpdate = GitPackage.prototype.scheduleActiveContextUpdate.call(packageInstance);

    finishPrevious();
    await previousUpdate;

    expect(packageInstance.activeContextUpdatePromise).toBe(currentUpdate);

    finishCurrent();
    await currentUpdate;

    expect(packageInstance.activeContextUpdatePromise).toBeNull();
  });
});
