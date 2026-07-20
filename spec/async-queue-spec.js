/** @babel */
/* global describe, it, expect */
// Ported from pulsar-edit/github test/async-queue.test.js (chai → Jasmine). The
// upstream `assert.async.*` polling assertions become an inline `until` helper.
import { autobind } from "../lib/helpers";
import AsyncQueue from "../lib/async-queue";

// The Lumine spec runner freezes `setTimeout`, so poll on microtasks instead —
// AsyncQueue schedules purely through promise chains, so yielding the microtask
// queue lets it make progress.
async function until(predicate, maxTicks = 10000) {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("timed out waiting for condition");
}

class Task {
  constructor(name, error) {
    autobind(this, "run", "finish");

    this.name = name;
    this.error = error;
    this.started = false;
    this.finished = false;
  }

  run() {
    this.started = true;
    this.finished = false;
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  finish() {
    this.finished = true;
    if (this.error) {
      this.reject(new Error(this.name));
    } else {
      this.resolve(this.name);
    }
  }
}

describe("AsyncQueue", () => {
  it("runs items in parallel up to the set max", async () => {
    const queue = new AsyncQueue({ parallelism: 3 });

    const tasks = [
      new Task("task 1"),
      new Task("task 2", true),
      new Task("task 3"),
      new Task("task 4"),
      new Task("task 5"),
    ];
    const results = [false, false, false, false, false];
    const errors = [false, false, false, false, false];

    const p0 = queue.push(() => tasks[0].run());
    const p1 = queue.push(() => tasks[1].run());
    queue.push(() => tasks[2].run());
    queue.push(() => tasks[3].run());
    queue.push(() => tasks[4].run());

    p0.then((value) => (results[0] = value)).catch((err) => (errors[0] = err));
    p1.then((value) => (results[1] = value)).catch((err) => (errors[1] = err));

    expect(tasks[0].started).toBe(true);
    expect(tasks[1].started).toBe(true);
    expect(tasks[2].started).toBe(true);
    expect(tasks[3].started).toBe(false);
    expect(tasks[4].started).toBe(false);

    expect(results[0]).toBe(false);

    tasks[0].finish();
    expect(tasks[0].finished).toBe(true);
    await until(() => results[0] === "task 1");
    expect(tasks[1].finished).toBe(false);
    expect(results[1]).toBe(false);

    expect(tasks[3].started).toBe(true);
    expect(tasks[4].started).toBe(false);

    tasks[1].finish();
    expect(tasks[1].finished).toBe(true);
    expect(tasks[2].finished).toBe(false);
    await until(() => errors[1] && errors[1].message === "task 2");

    expect(tasks[4].started).toBe(true);
  });

  it("runs non-parallelizable tasks serially", async () => {
    const queue = new AsyncQueue({ parallelism: 3 });

    const tasks = [
      new Task("task 1"),
      new Task("task 2"),
      new Task("task 3"),
      new Task("task 4"),
      new Task("task 5"),
      new Task("task 6"),
    ];

    const p0 = queue.push(() => tasks[0].run());
    const p1 = queue.push(() => tasks[1].run());
    const p2 = queue.push(() => tasks[2].run(), { parallel: false });
    const p3 = queue.push(() => tasks[3].run(), { parallel: false });
    queue.push(() => tasks[4].run());
    queue.push(() => tasks[5].run());

    expect(tasks[0].started).toBe(true);
    expect(tasks[1].started).toBe(true);
    expect(tasks[2].started).toBe(false); // not parallelizable!!
    expect(tasks[3].started).toBe(false);
    expect(tasks[4].started).toBe(false);
    expect(tasks[5].started).toBe(false);

    tasks[0].finish();
    await p0;
    expect(tasks[2].started).toBe(false); // still can't be started
    expect(tasks[3].started).toBe(false);

    tasks[1].finish();
    await p1;
    await until(() => tasks[2].started);
    expect(tasks[3].started).toBe(false); // still can't be started

    tasks[2].finish();
    await p2;
    await until(() => tasks[3].started);
    expect(tasks[4].started).toBe(false); // 3 is non-parallelizable so 4 can't start

    tasks[3].finish();
    await p3;
    await until(() => tasks[4].started); // both can start since they are parallelizable
    expect(tasks[5].started).toBe(true);
  });

  it("continues to work when tasks throw synchronous errors", async () => {
    const queue = new AsyncQueue({ parallelism: 1 });

    const p1 = queue.push(() => {
      throw new Error("error thrown from task 1");
    });
    const p2 = queue.push(() => new Promise((res) => res(2)));

    let threw = false;
    try {
      await p1;
    } catch (err) {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(await p2).toBe(2);
  });
});
