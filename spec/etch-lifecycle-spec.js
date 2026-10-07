/** @babel */
import path from "path";
import { TextBuffer } from "lumine";

describe("git-panel native Etch lifecycle", () => {
  let View, h, Editor, Commands, Command, RefHolder, MarkerLayer, Marker, Decoration;
  let container;
  const ownedViews = new Set();
  const ownedEditors = new Set();
  const suppliedBuffers = new Set();

  function moduleDefault(modulePath) {
    const loaded = require(modulePath);
    return loaded.default || loaded;
  }

  async function settle() {
    await globalThis.flushMicrotasks();
    lumine.views.updateDocument(() => {});
    await lumine.views.getNextUpdatePromise();
    await globalThis.flushMicrotasks();
  }

  function own(view) {
    ownedViews.add(view);
    container.appendChild(view.element);
    return view;
  }

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    ({ View, h } = require("../lib/etch/view"));
    Editor = moduleDefault("../lib/lumine/lumine-text-editor");
    ({ default: Commands, Command } = require("../lib/lumine/commands"));
    RefHolder = moduleDefault("../lib/models/ref-holder");
    MarkerLayer = moduleDefault("../lib/lumine/marker-layer");
    Marker = moduleDefault("../lib/lumine/marker");
    Decoration = moduleDefault("../lib/lumine/decoration");
    container = document.createElement("div");
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    for (const view of ownedViews) await view.destroy();
    ownedViews.clear();
    for (const editor of ownedEditors) if (!editor.isDestroyed()) editor.destroy();
    ownedEditors.clear();
    for (const buffer of suppliedBuffers) if (!buffer.isDestroyed()) buffer.release();
    suppliedBuffers.clear();
    await settle();
    container.remove();
  });

  it("coalesces 500 state changes into one scheduled DOM update", async () => {
    let renders = 0;
    class Counter extends View {
      constructor() {
        super();
        this.state = { value: 0 };
        this.initialize();
      }
      render() {
        renders++;
        return h("output", null, this.state.value);
      }
    }
    const counter = own(new Counter());
    const completions = [];
    for (let value = 1; value <= 500; value++) completions.push(counter.updateState({ value }));
    expect(renders).toBe(1);
    expect(counter.element.textContent).toBe("0");
    await settle();
    await Promise.all(completions);
    expect(renders).toBe(2);
    expect(counter.element.textContent).toBe("500");
  });

  it("discards queued writes, reads and callbacks and destroys children once", async () => {
    let child,
      childDestructions = 0,
      reads = 0,
      renders = 0;
    const callbacks = jasmine.createSpy("queued callback");
    const childRef = new RefHolder();
    const buttonRef = new RefHolder();
    class Child extends View {
      constructor(props, children) {
        super(props, children);
        this.initialize();
      }
      render() {
        return h("span", { ref: "content" }, "child");
      }
      willDestroy() {
        childDestructions++;
      }
    }
    class Parent extends View {
      constructor() {
        super();
        this.initialize();
      }
      render() {
        renders++;
        return h(
          "div",
          null,
          h("button", { ref: buttonRef.setter }),
          h(Child, {
            ref: (value) => {
              child = value || child;
              childRef.setter(value);
            },
          }),
        );
      }
      readAfterUpdate() {
        reads++;
      }
    }
    const parent = own(new Parent());
    parent.updateSync();
    const queued = parent.updateState({ value: "pending" }, callbacks);
    const beforeDestroy = renders;
    await parent.destroy();
    await parent.destroy();
    await parent.updateState({ value: "too late" }, callbacks);
    await settle();
    await queued;
    expect(renders).toBe(beforeDestroy);
    expect(reads).toBe(0);
    expect(callbacks).not.toHaveBeenCalled();
    expect(childDestructions).toBe(1);
    expect(child.destroyed).toBe(true);
    expect(parent.element.isConnected).toBe(false);
    expect(parent.virtualNode).toBeNull();
    expect(child.refs.content).toBeUndefined();
    expect(childRef.isEmpty()).toBe(true);
    expect(buttonRef.isEmpty()).toBe(true);
  });

  it("disposes commands and clears refs after a mounted owner is destroyed", async () => {
    const target = new RefHolder();
    const invoked = jasmine.createSpy("native action");
    class Owner extends View {
      constructor() {
        super();
        this.initialize();
      }
      render() {
        return h(
          "div",
          { ref: target.setter },
          h(
            Commands,
            { registry: lumine.commands, target },
            h(Command, { command: "git-panel:etch-lifecycle-action", callback: invoked }),
          ),
        );
      }
    }
    const owner = own(new Owner());
    const element = target.get();
    await lumine.commands.dispatch(element, "git-panel:etch-lifecycle-action");
    expect(invoked).toHaveBeenCalledTimes(1);
    await owner.destroy();
    expect(target.isEmpty()).toBe(true);
    expect(
      lumine.commands
        .findCommands({ target: element })
        .some(({ name }) => name === "git-panel:etch-lifecycle-action"),
    ).toBe(false);
    await lumine.commands.dispatch(element, "git-panel:etch-lifecycle-action");
    expect(invoked).toHaveBeenCalledTimes(1);
  });

  it("releases an owned buffer once and preserves a supplied owner's retain across repeated mounts", async () => {
    const owned = own(new Editor());
    const ownBuffer = owned.getModel().getBuffer();
    const releaseOwned = spyOn(ownBuffer, "release").and.callThrough();
    await owned.destroy();
    await owned.destroy();
    expect(releaseOwned).toHaveBeenCalledTimes(1);
    expect(ownBuffer.isDestroyed()).toBe(true);

    const buffer = new TextBuffer("supplied content").retain();
    suppliedBuffers.add(buffer);
    const retained = spyOn(buffer, "retain").and.callThrough();
    const released = spyOn(buffer, "release").and.callThrough();
    for (let index = 0; index < 20; index++) {
      const modelRef = new RefHolder();
      const view = own(new Editor({ buffer, refModel: modelRef }));
      expect(view.getModel().getBuffer()).toBe(buffer);
      expect(modelRef.get()).toBe(view.getModel());
      view.invalidate();
      await view.destroy();
      await view.destroy();
      expect(modelRef.isEmpty()).toBe(true);
      expect(buffer.isDestroyed()).toBe(false);
      expect(buffer.getText()).toBe("supplied content");
    }
    await settle();
    expect(retained).toHaveBeenCalledTimes(20);
    expect(released).toHaveBeenCalledTimes(20);
    expect(buffer.isRetained()).toBe(true);
  });

  it("moves owned marker resources to the new editor without retaining the old layer", async () => {
    const first = lumine.workspace.buildTextEditor();
    const second = lumine.workspace.buildTextEditor();
    ownedEditors.add(first);
    ownedEditors.add(second);
    first.setText("first file");
    second.setText("second file");
    let layer;
    const children = [
      h(
        Marker,
        {
          bufferRange: [
            [0, 0],
            [0, 3],
          ],
        },
        h(Decoration, { type: "highlight", className: "etch-lifecycle-highlight" }),
      ),
    ];
    const layerView = own(
      new MarkerLayer(
        {
          editor: first,
          handleLayer: (value) => {
            layer = value;
          },
        },
        children,
      ),
    );
    const oldLayer = layer;
    expect(oldLayer.getMarkerCount()).toBe(1);
    expect(first.getDecorations({ class: "etch-lifecycle-highlight" }).length).toBe(1);
    await layerView.update(
      {
        editor: second,
        handleLayer: (value) => {
          layer = value;
        },
      },
      children,
    );
    await settle();
    expect(oldLayer.isDestroyed()).toBe(true);
    expect(layer.getMarkerCount()).toBe(1);
    expect(first.getDecorations({ class: "etch-lifecycle-highlight" }).length).toBe(0);
    expect(second.getDecorations({ class: "etch-lifecycle-highlight" }).length).toBe(1);
    await layerView.destroy();
    expect(second.getDecorations({ class: "etch-lifecycle-highlight" }).length).toBe(0);
  });

  it("unwinds already-created editors when a later child fails to initialize", () => {
    const buildEditor = spyOn(lumine.workspace, "buildTextEditor").and.callThrough();
    const editorRef = new RefHolder();
    class Failure extends View {
      constructor(props, children) {
        super(props, children);
        this.initialize();
      }
      render() {
        throw new Error("intentional native child failure");
      }
    }
    class Owner extends View {
      constructor() {
        super();
        this.initialize();
      }
      render() {
        return h("div", null, h(Editor, { ref: editorRef.setter }), h(Failure));
      }
    }
    expect(() => new Owner()).toThrowError("intentional native child failure");
    const editor = buildEditor.calls.mostRecent().returnValue;
    expect(editor.isDestroyed()).toBe(true);
    expect(editor.getBuffer().isDestroyed()).toBe(true);
    expect(editorRef.isEmpty()).toBe(true);
  });

  it("rejects a failed native render while healthy peers update and a later render recovers", async () => {
    const error = new Error("intentional native update failure");
    const reported = spyOn(console, "error");
    const callback = jasmine.createSpy("failed update callback");
    class Renderer extends View {
      constructor() {
        super();
        this.state = { fail: false, value: "before" };
        this.initialize();
      }
      render() {
        if (this.state.fail) throw error;
        return h("output", null, this.state.value);
      }
    }
    const broken = own(new Renderer());
    const healthy = own(new Renderer());
    const rejection = expectAsync(broken.updateState({ fail: true }, callback)).toBeRejectedWith(
      error,
    );
    const successful = healthy.updateState({ value: "healthy" });
    await settle();
    await rejection;
    await successful;
    expect(healthy.element.textContent).toBe("healthy");
    expect(broken.element.textContent).toBe("before");
    expect(reported).toHaveBeenCalledOnceWith("Native panel update failed", error);
    expect(callback).not.toHaveBeenCalled();
    await broken.updateState({ fail: false, value: "recovered" });
    await settle();
    expect(broken.element.textContent).toBe("recovered");
    expect(callback).not.toHaveBeenCalled();
  });

  it("rejects a failed native read hook while unrelated reads finish and later updates recover", async () => {
    const error = new Error("intentional native read failure");
    const reported = spyOn(console, "error");
    let healthyReads = 0;
    class Reader extends View {
      constructor() {
        super();
        this.state = { fail: false, value: "before" };
        this.initialize();
      }
      render() {
        return h("output", null, this.state.value);
      }
      readAfterUpdate() {
        if (this.state.fail) throw error;
        healthyReads++;
      }
    }
    const broken = own(new Reader());
    const healthy = own(new Reader());
    const rejection = expectAsync(broken.updateState({ fail: true })).toBeRejectedWith(error);
    const success = healthy.updateState({ value: "healthy" });
    await settle();
    await rejection;
    await success;
    expect(healthyReads).toBe(1);
    expect(reported).toHaveBeenCalledOnceWith("Native panel update failed", error);
    await broken.updateState({ fail: false, value: "recovered" });
    await settle();
    expect(broken.element.textContent).toBe("recovered");
    expect(healthyReads).toBe(2);
  });

  it("opens, closes and unloads fresh native pane generations repeatedly", async () => {
    const packagePath = path.join(__dirname, "..");
    const uri = "lumine-git://dock-item/git";
    const workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    const generations = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      if (lumine.packages.isPackageLoaded("git-panel"))
        await lumine.packages.unloadPackage("git-panel");
      await lumine.packages.startPackage(packagePath);
      await lumine.commands.dispatch(workspaceElement, "git-panel:toggle-focus");
      await settle();
      const pane = lumine.workspace.paneForURI(uri);
      expect(pane).not.toBeNull();
      const host = pane.itemForURI(uri);
      const view = await host.whenHydrated();
      expect(view.destroyed).toBe(false);
      expect(view.element.isConnected).toBe(true);
      expect(generations.includes(view.constructor)).toBe(false);
      generations.push(view.constructor);
      await pane.destroyItem(host, true);
      expect(host.isDestroyed()).toBe(true);
      expect(view.destroyed).toBe(true);
      await lumine.commands.dispatch(workspaceElement, "git-panel:toggle-focus");
      await settle();
      const replacement = lumine.workspace.paneForURI(uri).itemForURI(uri);
      const replacementView = await replacement.whenHydrated();
      expect(replacement).not.toBe(host);
      await lumine.packages.unloadPackage("git-panel");
      expect(replacement.isDestroyed()).toBe(true);
      expect(replacementView.destroyed).toBe(true);
      expect(lumine.workspace.paneForURI(uri)).toBeUndefined();
    }
  });
});
