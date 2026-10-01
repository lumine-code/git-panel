/** @babel */
import { Emitter } from "lumine";

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
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

  it("does not restore a repository after the active context was cleared", async () => {
    const read = deferred();
    const didUpdate = jasmine.createSpy();
    const observer = new ModelObserver({ fetchData: () => read.promise, didUpdate });
    const refresh = observer.setActiveModel(model);

    observer.setActiveModel(null);
    didUpdate.calls.reset();
    read.resolve("removed repository");
    await refresh;

    expect(observer.getActiveModel()).toBeNull();
    expect(observer.getActiveModelData()).toBeNull();
    expect(didUpdate).not.toHaveBeenCalled();
    observer.destroy();
  });

  it("keeps a replacement repository's pending refresh when an older read completes", async () => {
    const previous = deferred();
    const current = deferred();
    const currentEmitter = new Emitter();
    const currentModel = {
      isDestroyed: () => false,
      onDidUpdate: (callback) => currentEmitter.on("did-update", callback),
    };
    const fetchData = jasmine
      .createSpy()
      .and.returnValues(previous.promise, current.promise, Promise.resolve("fresh replacement"));
    const observer = new ModelObserver({ fetchData });
    const previousRefresh = observer.setActiveModel(model);
    observer.setActiveModel(currentModel);
    currentEmitter.emit("did-update");

    previous.resolve("old repository");
    await previousRefresh;

    expect(observer.inProgress).toBe(true);
    expect(observer.hasPendingUpdate()).toBe(true);
    expect(fetchData).toHaveBeenCalledTimes(2);
    expect(observer.getActiveModelData()).toBeNull();

    current.resolve("superseded replacement");
    await until(() => fetchData.calls.count() === 3);
    await observer.getLastModelDataRefreshPromise();

    expect(observer.getActiveModel()).toBe(currentModel);
    expect(observer.getActiveModelData()).toBe("fresh replacement");
    expect(observer.inProgress).toBe(false);
    observer.destroy();
    currentEmitter.dispose();
  });

  it("clears data when a background read finds the repository's working directory missing", async () => {
    const error = new Error(
      "Git repository is unavailable during history: working-directory-missing",
    );
    error.code = "ERR_GIT_REPOSITORY_UNAVAILABLE";
    const fetchData = jasmine.createSpy();
    // Reject only when the second read starts, so the failure represents a
    // repository disappearing after its initial data was already published.
    fetchData.and.callFake(() =>
      fetchData.calls.count() === 1 ? Promise.resolve("available data") : Promise.reject(error),
    );
    const didUpdate = jasmine.createSpy();
    const observer = new ModelObserver({ fetchData, didUpdate });
    spyOn(console, "error");
    await observer.setActiveModel(model);
    didUpdate.calls.reset();

    emitter.emit("did-update");
    await observer.getLastModelDataRefreshPromise();

    expect(observer.getActiveModelData()).toBeNull();
    expect(didUpdate).toHaveBeenCalledOnceWith(model);
    expect(console.error).not.toHaveBeenCalled();
    observer.destroy();
  });

  it("does not report a failure from the previous repository after switching context", async () => {
    const previous = deferred();
    const currentEmitter = new Emitter();
    const currentModel = {
      isDestroyed: () => false,
      onDidUpdate: (callback) => currentEmitter.on("did-update", callback),
    };
    const fetchData = jasmine
      .createSpy()
      .and.returnValues(previous.promise, Promise.resolve("current repository"));
    const observer = new ModelObserver({ fetchData });
    spyOn(console, "error");
    const previousRefresh = observer.setActiveModel(model);
    await observer.setActiveModel(currentModel);

    previous.reject(new Error("Old repository failed"));
    await previousRefresh;

    expect(observer.getActiveModelData()).toBe("current repository");
    expect(console.error).not.toHaveBeenCalled();
    observer.destroy();
    currentEmitter.dispose();
  });

  it("reports an unexpected current failure and keeps the last available data", async () => {
    const error = new Error("Git history is corrupt");
    let unavailable = false;
    const observer = new ModelObserver({
      fetchData: () => (unavailable ? Promise.reject(error) : Promise.resolve("last data")),
    });
    spyOn(console, "error");
    await observer.setActiveModel(model);
    unavailable = true;

    emitter.emit("did-update");
    await observer.getLastModelDataRefreshPromise();

    expect(observer.getActiveModelData()).toBe("last data");
    expect(console.error).toHaveBeenCalledWith("Git panel model data refresh failed", error);
    observer.destroy();
  });

  it("does not publish a result after the repository is destroyed", async () => {
    const read = deferred();
    const didUpdate = jasmine.createSpy();
    const observer = new ModelObserver({ fetchData: () => read.promise, didUpdate });
    const refresh = observer.setActiveModel(model);
    didUpdate.calls.reset();
    model.isDestroyed = () => true;
    read.resolve("destroyed repository");

    await refresh;

    expect(observer.getActiveModelData()).toBeNull();
    expect(didUpdate).not.toHaveBeenCalled();
    observer.destroy();
  });

  it("does not publish or start a queued read after the observer is destroyed", async () => {
    const read = deferred();
    const fetchData = jasmine.createSpy().and.returnValue(read.promise);
    const didUpdate = jasmine.createSpy();
    const observer = new ModelObserver({ fetchData, didUpdate });
    const refresh = observer.setActiveModel(model);
    emitter.emit("did-update");
    observer.destroy();
    didUpdate.calls.reset();
    read.resolve("disposed observer");

    await refresh;
    emitter.emit("did-update");
    observer.refreshModelData();
    observer.setActiveModel(model);

    expect(observer.getActiveModelData()).toBeNull();
    expect(didUpdate).not.toHaveBeenCalled();
    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(observer.hasPendingUpdate()).toBe(false);
  });
});
