/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import ChangedFileContainer from "../lib/containers/changed-file-container";
import ChangedFileItem from "../lib/items/changed-file-item";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

const sides = ["old", "new"];

describe("Side by Side scroll past end", () => {
  let view, container, stylesheet, emitter, source, refPatchController, previousSetting;
  const patches = [];

  beforeEach(() => {
    previousSetting = lumine.config.inspect("editor.scrollPastEnd");
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 760px; height: 340px;";
    jasmine.attachToDOM(container);
    emitter = new Emitter();
    refPatchController = new RefHolder();
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    for (const patch of patches.splice(0)) patch.dispose();
    emitter.dispose();
    container.remove();
    stylesheet.dispose();
    if (previousSetting.hasOverride)
      lumine.config.set("editor.scrollPastEnd", previousSetting.overrideValue);
    else lumine.config.unset("editor.scrollPastEnd");
  });

  function build(version = 0) {
    const lines = Array.from({ length: 10 }, (_, row) => [
      `-before-v${version} ${row} ${"before words ".repeat(row % 2 === 0 ? 24 : 3)}`,
      `+after-v${version} ${row} ${"after words ".repeat(row % 2 === 0 ? 3 : 24)}`,
    ]).flat();
    const patch = buildMultiFilePatch(
      [
        {
          oldPath: "example.txt",
          newPath: "example.txt",
          oldMode: "100644",
          newMode: "100644",
          status: "modified",
          hunks: [
            {
              oldStartLine: 1,
              newStartLine: 1,
              oldLineCount: 10,
              newLineCount: 10,
              heading: "",
              lines,
            },
          ],
        },
      ],
      { largeDiffThreshold: Infinity },
    );
    patches.push(patch);
    return patch;
  }

  function pair() {
    return refPatchController.get().refView.get().refSideBySide.get();
  }

  function editor(side) {
    return pair().editors[side].get();
  }

  function component(side) {
    return editor(side).getElement().getComponent();
  }

  async function settle(didPaint = () => {}) {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(() => {});
      const elements = sides.map((side) => editor(side).getElement());
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      didPaint();
    }
  }

  async function mount(enabled) {
    lumine.config.set("editor.scrollPastEnd", enabled);
    source = build();
    const repository = {
      isLoading: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getWorkingDirectoryPath: () => path.dirname(__filename),
      getFilePatchForPath: () => source,
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
    };
    view = new ChangedFileContainer({
      repository,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      initialDiffView: "side-by-side",
      itemType: ChangedFileItem,
      refPatchController,
      workspace: lumine.workspace,
      config: lumine.config,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      surfaceFileAtPath: () => {},
      discardLines: () => {},
      undoLastDiscard: () => {},
    });
    container.appendChild(view.element);
    await settle();
    for (const padding of pair().wrapAlignment.padding) expect(padding.size).toBeGreaterThan(0);
  }

  function expectAligned() {
    expect(component("old").getContentHeight()).toBeCloseTo(component("new").getContentHeight(), 0);
    expect(component("old").getMaxScrollTop()).toBeCloseTo(component("new").getMaxScrollTop(), 0);
    expect(component("old").getScrollTop()).toBeCloseTo(component("new").getScrollTop(), 0);
  }

  for (const enabled of [true, false]) {
    it(`uses the editor's initial scrollPastEnd=${enabled} setting in both wrapped columns`, async () => {
      await mount(enabled);
      for (const side of sides) {
        const native = component(side);
        expect(editor(side).getScrollPastEnd()).toBe(enabled);
        const padding = native.getScrollHeight() - native.getContentHeight();
        if (enabled) expect(padding).toBeGreaterThan(0);
        else expect(padding).toBeCloseTo(0, 0);
      }
      expectAligned();
    });
  }

  it("applies live setting changes and clamps both columns together when extra scrolling is disabled", async () => {
    await mount(true);
    const models = sides.map((side) => editor(side));
    const enabledMaximum = component("new").getMaxScrollTop();
    editor("new")
      .getElement()
      .setScrollTop(enabledMaximum - 5);
    await settle();
    lumine.config.set("editor.scrollPastEnd", false);
    await settle();
    const disabledMaximum = component("new").getMaxScrollTop();
    expect(disabledMaximum).toBeLessThan(enabledMaximum);
    for (const side of sides) {
      expect(editor(side).getScrollPastEnd()).toBe(false);
      expect(component(side).getScrollTop()).toBeCloseTo(disabledMaximum, 0);
    }
    expectAligned();
    lumine.config.set("editor.scrollPastEnd", true);
    await settle();
    for (let index = 0; index < sides.length; index++) {
      const side = sides[index];
      expect(editor(side)).toBe(models[index]);
      expect(editor(side).getScrollPastEnd()).toBe(true);
      expect(component(side).getMaxScrollTop()).toBeCloseTo(enabledMaximum, 0);
      expect(component(side).getScrollTop()).toBeCloseTo(disabledMaximum, 0);
    }
    expectAligned();
  });

  it("preserves both native viewports through a patch refresh while scrolled past the content end", async () => {
    await mount(true);
    const models = sides.map((side) => editor(side));
    const native = component("new");
    const savedTop = native.getMaxScrollTop() - 17;
    const contentMaximum = native.getContentHeight() - native.getScrollContainerClientHeight();
    expect(savedTop).toBeGreaterThan(contentMaximum);
    editor("new").getElement().setScrollTop(savedTop);
    await settle();
    source = build(1);
    await flushViews(() => emitter.emit("did-update"));
    await settle(() => {
      for (const side of sides)
        expect(Math.abs(component(side).renderedScrollTop - savedTop)).toBeLessThanOrEqual(1);
    });
    for (let index = 0; index < sides.length; index++) {
      const side = sides[index];
      expect(editor(side)).toBe(models[index]);
      expect(editor(side).getScrollPastEnd()).toBe(true);
      expect(editor(side).getText()).toContain(`${side === "old" ? "before" : "after"}-v1`);
      expect(component(side).getScrollTop()).toBeCloseTo(savedTop, 0);
    }
    expect(pair().patchViewportRestoration).toBeNull();
    expectAligned();
  });
});
