/** @babel */
import { Disposable, Emitter } from "lumine";
import WorkdirContext, { createRepoSym } from "../lib/models/workdir-context";
import WorkdirContextPool from "../lib/models/workdir-context-pool";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("WorkdirContext observation leases", () => {
  let contexts, model, core, owner, add, observers, interests;

  const observer = ({ ready = Promise.resolve(), closed = Promise.resolve() } = {}) => {
    const emitter = new Emitter();
    const value = {
      onDidChange: (cb) => emitter.on("change", cb),
      onDidInvalidate: (cb) => emitter.on("invalidate", cb),
      onDidChangeWorkdirOrHead: (cb) => emitter.on("head", cb),
      start: jasmine.createSpy("start observer").and.returnValue(ready),
      destroy: jasmine.createSpy("destroy observer").and.callFake(() => {
        emitter.dispose();
        return closed;
      }),
      change: (events) => emitter.emit("change", events),
    };
    observers.push(value);
    return value;
  };

  const createContext = (options = {}) => {
    const context = new WorkdirContext("C:/repository", {
      [createRepoSym]: () => model,
      ...options,
    });
    contexts.push(context);
    spyOn(context, "createChangeObserver").and.callFake(() => observer());
    return context;
  };

  beforeEach(() => {
    contexts = [];
    observers = [];
    interests = { status: 0, refs: 0 };
    const events = new Emitter();
    const cache = { clear: jasmine.createSpy("clear model read cache") };
    model = {
      state: "present",
      isPresent: () => model.state === "present",
      isAbsent: () => model.state === "absent",
      isDestroyed: () => model.state === "destroyed",
      getLoadPromise: () => Promise.resolve(),
      getCache: () => cache,
      onDidChangeState: (cb) => events.on("state", cb),
      onDidGloballyInvalidate: (cb) => events.on("global", cb),
      acceptInvalidation: jasmine.createSpy("invalidate model"),
      refresh: jasmine.createSpy("refresh model"),
      observeFilesystemChange: jasmine.createSpy("observe filesystem change"),
      destroy: jasmine.createSpy("destroy model").and.callFake(() => {
        model.state = "destroyed";
        events.emit("state", {});
      }),
    };
    core = {
      onDidChangeStatusSnapshot: () => {
        interests.status++;
        return new Disposable(() => interests.status--);
      },
      onDidChangeRefsSnapshot: () => {
        interests.refs++;
        return new Disposable(() => interests.refs--);
      },
      refreshStatusSnapshot: jasmine.createSpy("fresh status").and.resolveTo({}),
      refreshRefsSnapshot: jasmine.createSpy("fresh refs").and.resolveTo({}),
    };
    owner = { repository: core, dispose: jasmine.createSpy("release core owner") };
    add = spyOn(lumine.repositories, "add").and.resolveTo(owner);
  });

  afterEach(async () => {
    for (const context of contexts) await context.destroy();
    WorkdirContext.destroyAbsent();
  });

  it("keeps cached models dormant until retained and suspends only after the last owner", async () => {
    const context = createContext();
    const retainedModel = context.getRepository();
    expect(context.getChangeObserver()).toBeNull();
    expect(add).not.toHaveBeenCalled();
    const first = context.retainObservation();
    const second = context.retainObservation();
    expect(first.ready).toBe(second.ready);
    await first.ready;
    expect(observers.length).toBe(1);
    expect(interests).toEqual({ status: 1, refs: 1 });
    first.dispose();
    first.dispose();
    expect(interests).toEqual({ status: 1, refs: 1 });
    second.dispose();
    expect(interests).toEqual({ status: 0, refs: 0 });
    expect(context.getRepository()).toBe(retainedModel);
    expect(retainedModel.destroy).not.toHaveBeenCalled();
    expect(observers[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("waits for the previous observer to close before resuming with a new generation", async () => {
    const context = createContext();
    const started = deferred();
    const closed = deferred();
    context.createChangeObserver.and.callFake(() =>
      observers.length ? observer() : observer({ ready: started.promise, closed: closed.promise }),
    );
    const notification = jasmine.createSpy("observation ready");
    context.onDidStartObserver(notification);
    const first = context.retainObservation();
    const firstReady = first.ready;
    await flush();
    first.dispose();
    expect(await firstReady).toBeNull();
    const second = context.retainObservation();
    await flush();
    expect(observers.length).toBe(1);
    closed.resolve();
    await second.ready;
    started.resolve();
    await flush();
    expect(observers.length).toBe(2);
    expect(notification).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it("disposes a core add result that arrives after the last observation was released", async () => {
    const acquired = deferred();
    add.and.returnValue(acquired.promise);
    const context = createContext();
    const lease = context.retainObservation();
    const ready = lease.ready;
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    lease.dispose();
    expect(await ready).toBeNull();
    acquired.resolve(owner);
    await flush();
    expect(owner.dispose).toHaveBeenCalledTimes(1);
    expect(interests).toEqual({ status: 0, refs: 0 });
    expect(core.refreshStatusSnapshot).not.toHaveBeenCalled();
  });

  it("cancels readiness and snapshot requests when destroyed during refresh", async () => {
    const status = deferred();
    core.refreshStatusSnapshot.and.returnValue(status.promise);
    const context = createContext();
    const lease = context.retainObservation();
    const ready = lease.ready;
    await flush();
    const signal = core.refreshStatusSnapshot.calls.mostRecent().args[0].signal;
    await context.destroy();
    expect(signal.aborted).toBe(true);
    expect(await ready).toBeNull();
    expect(interests).toEqual({ status: 0, refs: 0 });
    status.reject(new Error("late snapshot failure"));
    await flush();
    expect(context.whenObservationReady()).toBe(context.whenObservationReady());
    expect(await context.whenObservationReady()).toBeNull();
  });

  it("clears pre-handshake cache reads again only after fresh snapshots are ready", async () => {
    const context = createContext();
    const cache = model.getCache();
    const status = deferred();
    core.refreshStatusSnapshot.and.returnValue(status.promise);
    const notification = jasmine.createSpy("ready notification");
    context.onDidStartObserver(notification);
    const lease = context.retainObservation();
    expect(cache.clear).toHaveBeenCalledTimes(1);
    await flush();
    expect(notification).not.toHaveBeenCalled();
    status.resolve({});
    await lease.ready;
    expect(cache.clear).toHaveBeenCalledTimes(2);
    expect(notification).toHaveBeenCalledTimes(1);
    lease.dispose();
  });

  it("waits for both core snapshots before reopening an observed view", async () => {
    const status = deferred();
    const refs = deferred();
    core.refreshStatusSnapshot.and.returnValue(status.promise);
    core.refreshRefsSnapshot.and.returnValue(refs.promise);
    const context = createContext();
    const lease = context.retainObservation();
    let ready = false;
    lease.ready.then(() => (ready = true));
    await flush();
    expect(core.refreshStatusSnapshot).toHaveBeenCalledTimes(1);
    expect(core.refreshRefsSnapshot).toHaveBeenCalledTimes(1);
    status.resolve({});
    await flush();
    expect(ready).toBe(false);
    refs.resolve({});
    await lease.ready;
    expect(ready).toBe(true);
    lease.dispose();
  });

  for (const state of ["empty", "absent"]) {
    it(`resolves readiness for ${state} repositories without watchers or core interests`, async () => {
      model.state = state;
      if (state === "absent")
        model.getLoadPromise = () => Promise.reject(new Error("absent never loads"));
      const context = createContext();
      const lease = context.retainObservation();
      expect(await lease.ready).toBe(context);
      expect(observers).toEqual([]);
      expect(add).not.toHaveBeenCalled();
      lease.dispose();
    });
  }

  it("transfers pool owners on replacement and keeps absent readiness stable after clear", async () => {
    const pool = new WorkdirContextPool({ [createRepoSym]: () => model });
    const first = pool.add("C:/repository");
    contexts.push(first);
    spyOn(first, "createChangeObserver").and.callFake(() => observer());
    const lease = pool.retain("C:/repository");
    await lease.ready;
    const replacementModel = {
      ...model,
      state: "present",
      isPresent: () => true,
      isDestroyed: () => false,
      destroy: jasmine.createSpy("destroy replacement model"),
    };
    const next = pool.replace("C:/repository", { [createRepoSym]: () => replacementModel });
    contexts.push(next);
    spyOn(next, "createChangeObserver").and.callFake(() => observer());
    expect(lease.context).toBe(next);
    await lease.ready;
    expect(lease.context.getRepository()).toBe(replacementModel);
    expect(observers.length).toBe(2);
    expect(interests).toEqual({ status: 1, refs: 1 });
    pool.clear();
    expect(lease.context.isPresent()).toBe(false);
    expect(lease.ready).toBe(lease.ready);
    lease.dispose();
  });
});
