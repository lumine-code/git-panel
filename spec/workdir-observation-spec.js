/** @babel */
import { Emitter } from "lumine";
import WorkdirObservation from "../lib/models/workdir-observation";

describe("pane observation ownership", () => {
  let emitter, observations;
  beforeEach(() => {
    emitter = new Emitter();
    observations = [];
  });
  afterEach(() => {
    for (const observation of observations) observation.dispose();
    emitter.dispose();
  });

  function fixture() {
    let finish;
    const lease = {
      context: { getRepository: () => ({ name: "first" }) },
      ready: new Promise((resolve) => (finish = resolve)),
      dispose: jasmine.createSpy("dispose lease"),
    };
    const pool = {
      retain: jasmine.createSpy("retain").and.returnValue(lease),
      onDidChangePoolContexts: (callback) => emitter.on("change", callback),
    };
    const didChange = jasmine.createSpy("didChange");
    const observation = new WorkdirObservation(didChange);
    observations.push(observation);
    return { lease, pool, observation, didChange, finish };
  }

  it("keeps the model hidden until ready and reuses a pane's handle across renders", async () => {
    const { pool, observation, finish } = fixture();
    expect(observation.getRepository(pool, "repo")).toBeNull();
    finish();
    await Promise.resolve();
    expect(observation.getRepository(pool, "repo").name).toBe("first");
    observation.getRepository(pool, "repo");
    expect(pool.retain).toHaveBeenCalledOnceWith("repo");
  });

  it("waits for a replacement and ignores the superseded context's completion", async () => {
    const { pool, lease, observation, finish } = fixture();
    observation.getRepository(pool, "repo");
    let finishReplacement;
    lease.context = { getRepository: () => ({ name: "replacement" }) };
    lease.ready = new Promise((resolve) => (finishReplacement = resolve));
    emitter.emit("change");
    finish();
    await Promise.resolve();
    expect(observation.getRepository(pool, "repo")).toBeNull();
    finishReplacement();
    await Promise.resolve();
    expect(observation.getRepository(pool, "repo").name).toBe("replacement");
    expect(pool.retain).toHaveBeenCalledTimes(1);
  });

  it("releases the old directory and cancels its pending callback when props change", async () => {
    const { pool, lease, observation, didChange, finish } = fixture();
    observation.getRepository(pool, "first");
    const second = {
      context: { getRepository: () => ({ name: "second" }) },
      ready: Promise.resolve(),
      dispose: jasmine.createSpy("dispose second"),
    };
    pool.retain.and.returnValue(second);
    observation.getRepository(pool, "second");
    await Promise.resolve();
    didChange.calls.reset();
    finish();
    await Promise.resolve();
    expect(lease.dispose).toHaveBeenCalledTimes(1);
    expect(didChange).not.toHaveBeenCalled();
    expect(observation.getRepository(pool, "second").name).toBe("second");
    observation.dispose();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});
