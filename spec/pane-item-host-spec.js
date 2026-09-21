/** @babel */
import { Emitter } from "lumine";
import PaneItemHost from "../lib/items/pane-item-host";

function createView() {
  const emitter = new Emitter();
  let destroyed = false;

  return {
    getTitle: () => "Hydrated title",
    getIconName: () => "hydrated-icon",
    serialize: () => ({ deserializer: "Hydrated", value: 1 }),
    customAction: () => "done",
    onDidChangeTitle: (callback) => emitter.on("did-change-title", callback),
    onDidChangeIcon: (callback) => emitter.on("did-change-icon", callback),
    onDidDestroy: (callback) => emitter.on("did-destroy", callback),
    onDidTerminatePendingState: (callback) => emitter.on("did-terminate-pending-state", callback),
    terminatePendingState: jasmine
      .createSpy("terminatePendingState")
      .and.callFake(() => emitter.emit("did-terminate-pending-state")),
    emitTitleChange: () => emitter.emit("did-change-title"),
    destroy: jasmine.createSpy("destroy").and.callFake(() => {
      if (!destroyed) {
        destroyed = true;
        emitter.emit("did-destroy");
        emitter.dispose();
      }
    }),
  };
}

describe("PaneItemHost", () => {
  it("provides its pane contract and fallback serialization before hydration", () => {
    const host = PaneItemHost.create("example", {
      classPrefix: "git-panel",
      uri: "example://one",
      title: "Example",
      iconName: "file",
      defaultLocation: "right",
      allowedLocations: ["right", "left"],
      serializeFallback: () => ({ deserializer: "Example", uri: "example://one" }),
    });

    expect(host.getURI()).toBe("example://one");
    expect(host.getTitle()).toBe("Example");
    expect(host.getIconName()).toBe("file");
    expect(host.getDefaultLocation()).toBe("right");
    expect(host.getAllowedLocations()).toEqual(["right", "left"]);
    expect(host.isHydrated()).toBe(false);
    expect(host.serialize()).toEqual({ deserializer: "Example", uri: "example://one" });

    host.destroy();
  });

  it("hydrates once, resolves readiness, delegates view methods, and forwards metadata events", async () => {
    const host = PaneItemHost.create("example", {
      title: "Fallback",
      serializeFallback: () => ({ deserializer: "Example" }),
    });
    const view = createView();
    const titleChanged = jasmine.createSpy("titleChanged");
    host.onDidChangeTitle(titleChanged);

    expect(host.hydrate(view)).toBe(true);
    expect(await host.whenHydrated()).toBe(view);
    expect(host.getHydratedView()).toBe(view);
    expect(host.customAction()).toBe("done");
    expect(host.getTitle()).toBe("Hydrated title");
    expect(host.getIconName()).toBe("hydrated-icon");
    expect(host.serialize()).toEqual({ deserializer: "Hydrated", value: 1 });

    const pendingTerminated = jasmine.createSpy("pendingTerminated");
    host.onDidTerminatePendingState(pendingTerminated);
    host.terminatePendingState();
    expect(pendingTerminated).toHaveBeenCalledTimes(1);
    expect(view.terminatePendingState).toHaveBeenCalledTimes(1);

    view.emitTitleChange();
    expect(titleChanged).toHaveBeenCalled();
    expect(host.hydrate(view)).toBe(false);

    host.destroy();
  });

  it("rejects a different second view and destroys a view supplied after destroy", async () => {
    const host = PaneItemHost.create("example", {
      serializeFallback: () => ({ deserializer: "Example" }),
    });
    const firstView = createView();
    const secondView = createView();

    host.hydrate(firstView);
    expect(() => host.hydrate(secondView)).toThrow();
    host.destroy();
    expect(firstView.destroy).toHaveBeenCalledTimes(1);
    expect(host.hydrate(secondView)).toBe(false);
    expect(secondView.destroy).toHaveBeenCalledTimes(1);
    expect(host.isDestroyed()).toBe(true);
  });

  it("resolves pending readiness with null and emits destruction once", async () => {
    const host = PaneItemHost.create("example");
    const destroyed = jasmine.createSpy("destroyed");
    host.onDidDestroy(destroyed);

    host.destroy();
    host.destroy();

    expect(await host.whenHydrated()).toBeNull();
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it("propagates destruction initiated by the hydrated view", () => {
    const host = PaneItemHost.create("example");
    const view = createView();
    const destroyed = jasmine.createSpy("destroyed");
    host.onDidDestroy(destroyed);

    host.hydrate(view);
    view.destroy();

    expect(host.isDestroyed()).toBe(true);
    expect(host.getHydratedView()).toBeNull();
    expect(destroyed).toHaveBeenCalledTimes(1);
  });
});
