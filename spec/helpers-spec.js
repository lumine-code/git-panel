/** @babel */
import { mapWithConcurrency, withBusyMessage } from "../lib/helpers";

// The spec runner installs its own clock, so these gate on explicit deferreds
// rather than on elapsed time.
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("mapWithConcurrency", () => {
  it("returns results in the order of the input, not of completion", async () => {
    const gates = [0, 1, 2, 3, 4].map(() => {
      let release;
      const started = new Promise((resolve) => (release = resolve));
      return { started, release };
    });

    const mapped = mapWithConcurrency([0, 1, 2, 3, 4], 5, async (index) => {
      await gates[index].started;
      return index;
    });

    for (const index of [4, 1, 3, 0, 2]) {
      gates[index].release();
    }

    expect(await mapped).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps no more than the limit in flight", async () => {
    const releases = [];
    let inFlight = 0;
    let peak = 0;

    const mapped = mapWithConcurrency(new Array(12).fill(null), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => releases.push(resolve));
      inFlight -= 1;
    });

    await nextTurn();
    expect(releases.length).toBe(4);

    let released = 0;
    while (released < 12) {
      for (const release of releases.splice(0)) {
        release();
        released += 1;
      }
      await nextTurn();
    }
    await mapped;

    expect(peak).toBe(4);
  });

  it("visits every item when there are fewer items than the limit", async () => {
    expect(await mapWithConcurrency([1, 2], 16, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("resolves to an empty array for no items", async () => {
    expect(await mapWithConcurrency([], 8, async () => "never")).toEqual([]);
  });
});

describe("withBusyMessage", () => {
  function fakeBusySignal() {
    const events = [];
    return {
      events,
      create() {
        events.push("create");
        return {
          add(title) {
            events.push(`add:${title}`);
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };
  }

  it("brackets the operation with a provider add and dispose", async () => {
    const busySignal = fakeBusySignal();

    const result = await withBusyMessage(busySignal, "Staging 2 files", async () => {
      busySignal.events.push("work");
      return "done";
    });

    expect(result).toBe("done");
    expect(busySignal.events).toEqual(["create", "add:Staging 2 files", "work", "dispose"]);
  });

  it("disposes the provider when the operation throws", async () => {
    const busySignal = fakeBusySignal();

    let caught = null;
    try {
      await withBusyMessage(busySignal, "Discarding 1 file", async () => {
        throw new Error("boom");
      });
    } catch (e) {
      caught = e;
    }

    expect(caught.message).toBe("boom");
    expect(busySignal.events).toEqual(["create", "add:Discarding 1 file", "dispose"]);
  });

  it("runs the operation untouched when no busy-signal service is available", async () => {
    expect(await withBusyMessage(null, "Staging 1 file", async () => 42)).toBe(42);
  });
});
