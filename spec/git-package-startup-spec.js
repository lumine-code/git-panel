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
