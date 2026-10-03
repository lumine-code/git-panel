/** @babel */
import Gutter from "../lib/lumine/gutter";
import Decoration from "../lib/lumine/decoration";
import { h } from "../lib/etch/view";
import RefHolder from "../lib/models/ref-holder";
import { flushViews } from "./helpers/etch";

describe("optional native gutter visibility", () => {
  const editors = [];
  const views = [];
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.cssText = "width: 600px; height: 180px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    while (views.length) await views.pop().destroy();
    while (editors.length) editors.pop().destroy();
    await flushViews(async () => {});
    container.remove();
  });

  function editor(attach = true) {
    const model = lumine.workspace.buildTextEditor();
    model.setText(Array.from({ length: 200 }, (_, row) => `row ${row}`).join("\n"));
    const element = model.getElement();
    element.style.cssText = "width: 600px; height: 180px;";
    element.setUpdatedSynchronously(false);
    if (attach) container.appendChild(element);
    editors.push(model);
    return model;
  }

  function gutter(model, props = {}) {
    const resource = new Gutter({
      editor: model,
      name: "optional-comments",
      type: "decorated",
      hideWhenEmpty: true,
      ...props,
    });
    container.appendChild(resource.element);
    views.push(resource);
    return resource;
  }

  function decoration(model, row, props = {}) {
    return model.decorateMarker(model.markBufferPosition([row, 0]), {
      type: "gutter",
      gutterName: "optional-comments",
      item: document.createElement("button"),
      ...props,
    });
  }

  async function paint(model) {
    await flushViews(async () => {});
    const element = model.getElement();
    const pending = element.getNextUpdatePromise();
    element.getComponent().scheduleUpdate();
    await pending;
  }

  function scans(spy, name = "optional-comments") {
    return spy.calls.allArgs().filter(([properties]) => properties?.gutterName === name).length;
  }

  it("batches mounting decorations and ignores line-number items in the global inventory", async () => {
    const model = editor(false);
    const inventory = spyOn(model, "getDecorations").and.callThrough();
    const resource = gutter(model);
    for (let index = 0; index < 400; index++)
      decoration(model, index % 200, { type: "line-number" });
    await globalThis.flushMicrotasks();
    expect(scans(inventory)).toBe(1);
    expect(resource.gutter.isVisible()).toBe(false);
  });

  it("retains an off-screen comment column while scrolling and hides it when the item disappears", async () => {
    const model = editor();
    const resource = gutter(model);
    await paint(model);
    expect(resource.gutter.isVisible()).toBe(false);
    const comment = decoration(model, 199);
    await paint(model);
    expect(resource.gutter.isVisible()).toBe(true);
    const width = resource.gutter.getElement().getBoundingClientRect().width;
    expect(width).toBeGreaterThan(0);
    model.getElement().scrollToBottom();
    await paint(model);
    expect(resource.gutter.isVisible()).toBe(true);
    expect(resource.gutter.getElement().getBoundingClientRect().width).toBe(width);
    model.getElement().setScrollTop(0);
    await paint(model);
    expect(resource.gutter.isVisible()).toBe(true);
    comment.destroy();
    await paint(model);
    expect(resource.gutter.isVisible()).toBe(false);
    expect(resource.gutter.getElement().getBoundingClientRect().width).toBe(0);
  });

  it("reacts to decoration type and gutter-name changes without accepting line-number subtypes", async () => {
    const model = editor(false);
    const resource = gutter(model);
    const item = document.createElement("button");
    const comment = decoration(model, 150, { item });
    await globalThis.flushMicrotasks();
    expect(resource.gutter.isVisible()).toBe(true);
    comment.setProperties({ type: "line-number", gutterName: "optional-comments", item });
    await globalThis.flushMicrotasks();
    expect(resource.gutter.isVisible()).toBe(false);
    comment.setProperties({ type: "gutter", gutterName: "another-gutter", item });
    await globalThis.flushMicrotasks();
    expect(resource.gutter.isVisible()).toBe(false);
    comment.setProperties({ type: "gutter", gutterName: "optional-comments", item });
    await globalThis.flushMicrotasks();
    expect(resource.gutter.isVisible()).toBe(true);
  });

  it("disposes old editor callbacks and skips stale queued scans when its provider changes", async () => {
    const first = editor(false);
    const second = editor(false);
    const editorRef = RefHolder.on(first);
    const resource = gutter(editorRef);
    await globalThis.flushMicrotasks();
    const firstInventory = spyOn(first, "getDecorations").and.callThrough();
    decoration(first, 1);
    editorRef.setter(second);
    await globalThis.flushMicrotasks();
    expect(scans(firstInventory)).toBe(0);
    expect(first.gutterWithName("optional-comments")).toBeNull();
    expect(resource.gutter).toBe(second.gutterWithName("optional-comments"));
    expect(resource.gutter.isVisible()).toBe(false);
    decoration(first, 2);
    await globalThis.flushMicrotasks();
    expect(scans(firstInventory)).toBe(0);
    expect(resource.gutter.isVisible()).toBe(false);
  });

  it("does not scan or recreate a gutter after destruction with a visibility check queued", async () => {
    const model = editor(false);
    const resource = gutter(model);
    await globalThis.flushMicrotasks();
    const inventory = spyOn(model, "getDecorations").and.callThrough();
    decoration(model, 5);
    await resource.destroy();
    await globalThis.flushMicrotasks();
    expect(scans(inventory)).toBe(0);
    expect(model.gutterWithName("optional-comments")).toBeNull();
  });

  it("honors explicit visibility while leaving normal gutters visible without items", async () => {
    const model = editor(false);
    const hidden = gutter(model, { visible: false });
    decoration(model, 5);
    await globalThis.flushMicrotasks();
    expect(hidden.gutter.isVisible()).toBe(false);
    const normal = gutter(model, { name: "ordinary", hideWhenEmpty: false });
    expect(normal.gutter.isVisible()).toBe(true);
  });

  it("switches a class-only gutter decoration to real content and back without retaining its item", async () => {
    const model = editor();
    const resource = gutter(model);
    const marker = model.markBufferPosition([1, 0]);
    const background = new Decoration({
      editor: model,
      decorable: marker,
      type: "gutter",
      gutterName: "optional-comments",
      classOnly: true,
      className: "selection-background",
    });
    views.push(background);
    container.appendChild(background.element);
    await paint(model);
    expect(background.domNode).toBeNull();
    expect(background.decorationHolder.get().getProperties().item).toBeNull();
    expect(resource.gutter.isVisible()).toBe(false);
    await background.update({ ...background.props, classOnly: false }, [
      h("button", null, "Comment"),
    ]);
    await paint(model);
    expect(background.domNode).not.toBeNull();
    expect(resource.gutter.isVisible()).toBe(true);
    await background.update({ ...background.props, classOnly: true });
    await paint(model);
    expect(background.domNode).toBeNull();
    expect(background.decorationHolder.get().getProperties().item).toBeNull();
    expect(resource.gutter.isVisible()).toBe(false);
  });
});
