/** @babel */
import { Emitter } from "atom";

import ModelObserver from "../lib/models/model-observer";

async function until(predicate, maxTicks = 10000) {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("timed out waiting for condition");
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe("ModelObserver", () => {
  let emitter;
  let model;

  beforeEach(() => {
    emitter = new Emitter();
    model = {
      isDestroyed: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
    };
  });

  afterEach(() => emitter.dispose());

  it("does not publish a fetch result superseded by a pending model update", async () => {
    const first = deferred();
    const second = deferred();
    const fetchData = jasmine.createSpy().and.returnValues(first.promise, second.promise);
    const didUpdate = jasmine.createSpy();
    const observer = new ModelObserver({ fetchData, didUpdate });

    observer.setActiveModel(model);
    didUpdate.calls.reset();
    emitter.emit("did-update");

    first.resolve("stale");
    await until(() => fetchData.calls.count() === 2);

    expect(observer.getActiveModelData()).toBeNull();
    expect(didUpdate).not.toHaveBeenCalled();

    second.resolve("fresh");
    await observer.getLastModelDataRefreshPromise();

    expect(observer.getActiveModelData()).toBe("fresh");
    expect(didUpdate).toHaveBeenCalledTimes(1);
    observer.destroy();
  });

  it("publishes a fetch result when no newer update is pending", async () => {
    const didUpdate = jasmine.createSpy();
    const observer = new ModelObserver({
      fetchData: () => Promise.resolve("current"),
      didUpdate,
    });

    await observer.setActiveModel(model);

    expect(observer.getActiveModelData()).toBe("current");
    expect(didUpdate).toHaveBeenCalledTimes(2);
    observer.destroy();
  });
});
