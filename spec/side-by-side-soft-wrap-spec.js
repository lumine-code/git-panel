/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function hunk(lines, start = 1) {
  return {
    oldStartLine: start,
    newStartLine: start,
    oldLineCount: lines.filter((line) => line[0] !== "+").length,
    newLineCount: lines.filter((line) => line[0] !== "-").length,
    heading: "",
    lines,
  };
}

const longOld = "old words ".repeat(45);
const longNew = "new words ".repeat(15);

describe("side-by-side soft wrapping", () => {
  let view;
  let container;
  let stylesheet;
  let publication;
  let patch;

  function pair() {
    return view.refSideBySide.get();
  }

  function editor(side) {
    return pair().editors[side].get();
  }

  async function render() {
    for (let pass = 0; pass < 3; pass++) {
      await flushViews(async () => {});
      const elements = [editor("old").getElement(), editor("new").getElement()];
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
    }
  }

  async function mount(
    hunks = [
      hunk([`-${longOld}`, `+${longNew}`, " after"]),
      hunk(["-gone", `+${longOld}`, "+extra"], 30),
    ],
  ) {
    patch = buildMultiFilePatch(
      [
        {
          oldPath: "example.txt",
          newPath: "example.txt",
          oldMode: "100644",
          newMode: "100644",
          status: "modified",
          hunks,
        },
      ],
      { largeDiffThreshold: Infinity },
    );
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      surfaceKind: "file",
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      stagingStatus: "unstaged",
      selectedRows: new Set(),
      selectionMode: "hunk",
      selectedRowsChanged: (rows, mode, multiple) => {
        queueMicrotask(() => {
          if (!view.destroyed)
            void view.update({
              ...view.props,
              selectedRows: rows,
              selectionMode: mode,
              hasMultipleFileSelections: multiple,
            });
        });
      },
      toggleRows: jasmine.createSpy("stage wrapped rows"),
      discardRows: () => {},
      toggleFile: () => {},
      toggleModeChange: () => {},
      toggleSymlinkChange: () => {},
      openFile: () => {},
      surface: () => {},
      undoLastDiscard: () => {},
      diveIntoMirrorPatch: () => {},
      onWillUpdatePatch: (callback) => publication.on("will-update", callback),
      onDidUpdatePatch: (callback) => publication.on("did-update", callback),
    });
    container.appendChild(view.element);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await render();
  }

  function assertAlignedRows() {
    for (let row = 0; row < pair().projection.rows.length; row++)
      expect(editor("old").getElement().pixelPositionForBufferPosition([row, 0]).top).toBeCloseTo(
        editor("new").getElement().pixelPositionForBufferPosition([row, 0]).top,
        0,
      );
    expect(editor("old").getElement().getScrollHeight()).toBeCloseTo(
      editor("new").getElement().getScrollHeight(),
      0,
    );
    for (const record of pair().sharedHeaders) {
      if (record.spacers.old.isConnected && record.spacers.new.isConnected)
        expect(record.spacers.old.getBoundingClientRect().top).toBeCloseTo(
          record.spacers.new.getBoundingClientRect().top,
          0,
        );
    }
  }

  beforeEach(() => {
    publication = new Emitter();
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 500px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    patch?.dispose();
    publication.dispose();
    container.remove();
    stylesheet.dispose();
  });

  it("wraps both native columns by default and aligns shorter rows, missing rows, and headers", async () => {
    await mount();
    for (const side of ["old", "new"]) {
      expect(editor(side).isSoftWrapped()).toBe(true);
      expect(editor(side).getScreenLineCount()).toBeGreaterThan(editor(side).getLineCount());
    }
    expect(pair().wrapAlignment.padding[0].size).toBeGreaterThan(0);
    expect(pair().wrapAlignment.padding[1].size).toBeGreaterThan(0);
    assertAlignedRows();
  });

  it("keeps toggles from either editor in sync and preserves them through selection rerenders", async () => {
    await mount();
    lumine.commands.dispatch(editor("old").getElement(), "editor:toggle-soft-wrap");
    await render();
    expect(editor("old").isSoftWrapped()).toBe(false);
    expect(editor("new").isSoftWrapped()).toBe(false);
    expect(pair().wrapAlignment.padding.every((padding) => padding.size === 0)).toBe(true);
    await flushViews(() => view.update({ ...view.props, selectedRows: new Set([0]) }));
    await render();
    expect(editor("old").isSoftWrapped()).toBe(false);
    expect(editor("new").isSoftWrapped()).toBe(false);
    lumine.commands.dispatch(editor("new").getElement(), "editor:toggle-soft-wrap");
    await render();
    expect(editor("old").isSoftWrapped()).toBe(true);
    expect(editor("new").isSoftWrapped()).toBe(true);
    assertAlignedRows();
  });

  it("retains measured native gutters through selection and passive prop updates", async () => {
    await mount();
    const gutters = ["old", "new"].map((side) =>
      editor(side).gutterWithName(`${side}-line-numbers`),
    );
    await flushViews(() => view.update({ ...view.props, selectedRows: new Set([1]) }));
    await render();
    await flushViews(() => view.update({ ...view.props }));
    await render();
    for (const [index, side] of ["old", "new"].entries())
      expect(editor(side).gutterWithName(`${side}-line-numbers`)).toBe(gutters[index]);
    assertAlignedRows();
  });

  for (const [side, prefix, index] of [
    ["old", "+", 0],
    ["new", "-", 1],
  ]) {
    it(`fills the missing ${side} cell through all wrapped continuation rows`, async () => {
      await mount([hunk([`${prefix}${longOld}`, `${prefix}short`, " context"])]);
      const element = editor(side).getElement();
      const block = pair().wrapAlignment.padding[index].get(0);
      const first = element.querySelector('.line[data-screen-row="0"]');
      const next = element.querySelector('.line[data-screen-row="1"]');
      expect(block.height).toBeGreaterThan(editor(side).getLineHeightInPixels());
      expect(block.element.classList.contains("git-panel-SideBySidePatchView-placeholder")).toBe(
        true,
      );
      expect(getComputedStyle(block.element).backgroundColor).toBe(
        getComputedStyle(first).backgroundColor,
      );
      expect(getComputedStyle(block.element).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(block.element.getBoundingClientRect().top).toBeCloseTo(
        first.getBoundingClientRect().bottom,
        0,
      );
      expect(block.element.getBoundingClientRect().bottom).toBeCloseTo(
        next.getBoundingClientRect().top,
        0,
      );
      const fill = block.gutterFill;
      const gutters = element.getComponent().refs.gutterContainer.element.getBoundingClientRect();
      expect(fill.isConnected).toBe(true);
      expect(fill.getBoundingClientRect().top).toBeCloseTo(
        block.element.getBoundingClientRect().top,
        0,
      );
      expect(fill.getBoundingClientRect().bottom).toBeCloseTo(
        block.element.getBoundingClientRect().bottom,
        0,
      );
      expect(fill.getBoundingClientRect().left).toBeCloseTo(gutters.left, 0);
      expect(fill.getBoundingClientRect().right).toBeCloseTo(gutters.right, 0);
      expect(getComputedStyle(fill).backgroundColor).toBe(
        getComputedStyle(block.element).backgroundColor,
      );
      assertAlignedRows();
    });
  }

  it("extends the changed row background through padding on the shorter wrapped side", async () => {
    await mount();
    for (const side of ["old", "new"])
      editor(side).setCursorBufferPosition([0, 0], { autoscroll: false });
    await render();
    for (const [side, index, row, type] of [
      ["new", 1, 0, "added"],
      ["old", 0, 2, "deleted"],
    ]) {
      const element = editor(side).getElement();
      element.setScrollTop(element.pixelPositionForBufferPosition([row, 0]).top - 100);
      await render();
      const block = pair().wrapAlignment.padding[index].get(row);
      const screenRow = editor(side).screenRowForBufferRow(row);
      const line = element.querySelector(`.line[data-screen-row="${screenRow}"]`);
      expect(block.element.isConnected).toBe(true);
      expect(block.gutterFill.isConnected).toBe(true);
      expect(getComputedStyle(block.gutterFill).backgroundColor).toBe(
        getComputedStyle(block.element).backgroundColor,
      );
      expect(block.element.classList.contains(`git-panel-FilePatchView-line--${type}`)).toBe(true);
      expect(getComputedStyle(block.element).backgroundColor).toBe(
        getComputedStyle(line).backgroundColor,
      );
      expect(getComputedStyle(block.element).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      assertAlignedRows();
    }
  });

  it("restores gutter padding colors after native selection tint is cleared", async () => {
    await mount();
    const current = editor("new");
    const block = pair().wrapAlignment.padding[1].get(0);
    current.setSelectedBufferRange(
      [
        [0, 0],
        [current.getLastBufferRow(), Infinity],
      ],
      { autoscroll: false },
    );
    await render();
    expect(block.element.hasAttribute("data-block-decoration-selected")).toBe(true);
    expect(getComputedStyle(block.gutterFill).backgroundColor).toBe(
      getComputedStyle(block.element).backgroundColor,
    );
    current.setCursorBufferPosition([0, 0], { autoscroll: false });
    await render();
    expect(block.element.hasAttribute("data-block-decoration-selected")).toBe(false);
    expect(getComputedStyle(block.gutterFill).backgroundColor).toBe(
      getComputedStyle(block.element).backgroundColor,
    );
  });

  it("reconciles wrapped row padding after a width change while retaining existing blocks", async () => {
    await mount();
    const block = pair().wrapAlignment.padding[1].get(0);
    const previousHeight = block.height;
    container.style.width = "480px";
    await render();
    expect(pair().wrapAlignment.padding[1].get(0)).toBe(block);
    expect(block.height).toBeGreaterThan(previousHeight);
    assertAlignedRows();
  });

  it("updates virtualized row padding after resize before that row enters the viewport", async () => {
    const unchanged = Array.from({ length: 80 }, (_, index) => ` context ${index}`);
    await mount([hunk([...unchanged, `-${longOld}`, `+${longNew}`, " after"])]);
    for (const side of ["old", "new"]) editor(side).getElement().setScrollTop(0);
    await render();
    const block = pair().wrapAlignment.padding[1].get(80);
    const previousHeight = block.height;
    expect(block.element.isConnected).toBe(false);
    for (const side of ["old", "new"]) editor(side).getElement().setUpdatedSynchronously(false);
    container.style.width = "480px";
    await render();
    expect(pair().wrapAlignment.padding[1].get(80)).toBe(block);
    expect(block.height).toBeGreaterThan(previousHeight);
    assertAlignedRows();
    editor("new").getElement().scrollToBottom();
    await render();
    expect(block.element.isConnected).toBe(true);
    expect(editor("old").getElement().getScrollTop()).toBe(
      editor("new").getElement().getScrollTop(),
    );
    assertAlignedRows();
  });

  it("updates row padding when line height changes without resizing the viewport", async () => {
    await mount();
    const block = pair().wrapAlignment.padding[1].get(0);
    const previousHeight = block.height;
    for (const side of ["old", "new"]) {
      const element = editor(side).getElement();
      element.style.lineHeight = "36px";
      element.getComponent().didUpdateStyles();
    }
    await render();
    expect(block.height).toBeGreaterThan(previousHeight);
    assertAlignedRows();
  });

  it("settles repeated resizes and wrap toggles without ResizeObserver feedback", async () => {
    const errors = [];
    const didError = (event) => {
      if (event.message.includes("ResizeObserver")) errors.push(event.message);
    };
    window.addEventListener("error", didError);
    try {
      await mount();
      for (const side of ["old", "new"]) editor(side).getElement().setUpdatedSynchronously(false);
      for (const width of [480, 850, 620, 1000, 500, 900]) {
        // Native update promises may resolve inside observer delivery. Start
        // each simulated user resize in a fresh frame, outside that callback.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        container.style.width = `${width}px`;
        await render();
        assertAlignedRows();
        editor("old").toggleSoftWrapped();
        await render();
        assertAlignedRows();
      }
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", didError);
    }
  });

  it("stages the selected canonical changed line after choosing a wrapped continuation", async () => {
    await mount();
    const newEditor = editor("new");
    const continuation = newEditor.screenPositionForBufferPosition([0, 80]);
    expect(continuation.row).toBeGreaterThan(newEditor.screenRowForBufferRow(0));
    newEditor.setSelectedScreenRange(
      [
        [continuation.row, 0],
        [continuation.row, Infinity],
      ],
      { autoscroll: false },
    );
    await render();
    expect(Array.from(view.props.selectedRows)).toEqual([1]);
    lumine.commands.dispatch(newEditor.getElement(), "core:confirm");
    expect(view.props.toggleRows).toHaveBeenCalledWith(new Set([1]), "line");
  });

  it("keeps aligned rendered rows in every rapid smooth wheel frame with wrapped gaps", async () => {
    const unchanged = Array.from({ length: 80 }, (_, index) => ` context ${index}`);
    await mount([
      hunk([`-${longOld}`, `+${longNew}`, ...unchanged, "-deleted", `+${longOld}`, "+extra"]),
    ]);
    const components = [
      editor("old").getElement().getComponent(),
      editor("new").getElement().getComponent(),
    ];
    for (const component of components) {
      component.element.getModel().update({ smoothScrolling: true, wheelScrollDuration: 120 });
      component.element.setUpdatedSynchronously(false);
      component.scrollAnimator.raf = () => 0;
      component.scrollAnimator.caf = () => {};
    }
    await render();
    for (const deltaY of [700, -300, 800, -1000]) {
      components[0].element.dispatchEvent(
        new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
      );
      for (let frame = 0; frame < 3; frame++) {
        components[1].scrollAnimator.advance(1000 / 60);
        expect(components[0].renderedScrollTop).toBe(components[1].renderedScrollTop);
      }
    }
  });

  it("releases wrap padding when the side-by-side view closes", async () => {
    await mount();
    const alignment = pair().wrapAlignment;
    const markers = alignment.padding.flatMap((padding) =>
      Array.from(padding.values(), (block) => block.marker),
    );
    expect(markers.length).toBeGreaterThan(0);
    await view.destroy();
    expect(alignment.disposed).toBe(true);
    expect(markers.every((marker) => marker.isDestroyed())).toBe(true);
    expect(container.querySelectorAll(".git-panel-SideBySidePatchView-wrapPadding").length).toBe(0);
  });
});
