/** @babel */
import fs from "fs";
import os from "os";
import path from "path";
import { Disposable } from "lumine";
import FileSystemChangeObserver from "../lib/models/file-system-change-observer";

describe("file observation for repository state", () => {
  let directory, observer;
  beforeEach(() => {
    jasmine.useRealClock();
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "git-observer-")));
    observer = new FileSystemChangeObserver({ getWorkingDirectoryPath: () => directory });
  });
  afterEach(async () => {
    await observer.destroy();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  it("delivers native changes after ready and releases the subscription on destroy", async () => {
    const events = [];
    observer.onDidChange((batch) => events.push(...batch));
    const firstStart = observer.start();
    expect(observer.start()).toBe(firstStart);
    await firstStart;
    const filePath = path.join(directory, "outside.txt");
    fs.writeFileSync(filePath, "outside");
    await globalThis.conditionPromise(() => events.some((event) => event.path === filePath));
    await observer.destroy();
    expect(observer.isStarted()).toBe(false);
    expect(observer.currentFileWatcher).toBeNull();
  });
  it("invalidates repository state when the watch stream loses continuity", async () => {
    let invalidate;
    const handle = {
      path: directory,
      ready: Promise.resolve(),
      closed: Promise.resolve(),
      onDidChange: () => new Disposable(),
      onDidInvalidate: (callback) => {
        invalidate = callback;
        return new Disposable();
      },
      onDidError: () => new Disposable(),
      dispose() {},
    };
    spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(handle);
    const changed = jasmine.createSpy("changed");
    const workdirChanged = jasmine.createSpy("workdirChanged");
    observer.onDidInvalidate(changed);
    observer.onDidChangeWorkdirOrHead(workdirChanged);
    await observer.start();
    invalidate({ path: directory, reason: "worker-restart", generation: 2 });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(workdirChanged).toHaveBeenCalledTimes(1);
  });
});
