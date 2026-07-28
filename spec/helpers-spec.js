/** @babel */
import { withBusyMessage } from "../lib/helpers";

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
