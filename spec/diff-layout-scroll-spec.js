/** @babel */
import path from "path";
import { Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function hunk(lines, start) {
  return {
    oldStartLine: start,
    newStartLine: start,
    oldLineCount: lines.filter((line) => !line.startsWith("+")).length,
    newLineCount: lines.filter((line) => !line.startsWith("-")).length,
    heading: `section ${start}`,
    lines,
  };
}

function file(name, hunks) {
  return {
    oldPath: name,
    newPath: name,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks,
  };
}

describe("diff layout viewport anchors", () => {
  let view;
  let patch;
  let container;
  let stylesheet;

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 780px; height: 340px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    patch?.dispose();
    container.remove();
    stylesheet.dispose();
    lumine.config.unset("editor.softWrap");
  });

  async function settle() {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(async () => {});
      const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
    }
  }

  async function mount(raw) {
    patch = buildMultiFilePatch(raw, { largeDiffThreshold: Infinity });
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      readOnly: true,
      workspace: lumine.workspace,
      config: lumine.config,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      selectedRows: new Set(),
      selectionMode: "line",
      selectedRowsChanged: () => {},
      surface: () => {},
    });
    container.appendChild(view.element);
    await settle();
  }

  function pair() {
    return view.refSideBySide.get();
  }

  function editor(side) {
    return view.state.diffView === "unified" ? view.refEditor.get() : pair().editors[side].get();
  }

  function canonicalAnchor(side = "new") {
    if (view.state.diffView === "side-by-side") {
      pair().activeSide = side;
      return pair().captureCanonicalScrollAnchor();
    }
    return editor().getElement().getComponent().captureScrollAnchor({ anchorTop: true });
  }

  async function layout(mode) {
    await flushViews(() => view.didChangeDiffView(mode));
    await settle();
  }

  async function scrollTo(position, side = "new", offset = -7) {
    if (view.state.diffView === "side-by-side") pair().releaseInitialScrollAnchor();
    const model = editor(side);
    const component = model.getElement().getComponent();
    const row = model.screenPositionForBufferPosition(position).row;
    model.getElement().setScrollTop(component.pixelPositionBeforeBlocksForRow(row) - offset);
    if (view.state.diffView === "side-by-side") pair().activeSide = side;
    await settle();
    return canonicalAnchor(side);
  }

  function assertAnchorAt(anchor, side = "new") {
    const model = editor(side);
    const position =
      view.state.diffView === "unified"
        ? anchor.bufferPosition
        : [
            pair().projection.patchRowToDisplayRow.get(anchor.bufferPosition.row),
            anchor.bufferPosition.column,
          ];
    const component = model.getElement().getComponent();
    const screenRow = model.screenPositionForBufferPosition(position).row;
    expect(
      component.pixelPositionBeforeBlocksForRow(screenRow) - component.getScrollTop(),
    ).toBeCloseTo(anchor.offset, 0);
  }

  function deepDiff() {
    return [
      file("first.txt", [
        hunk(Array.from({ length: 80 }, (_, i) => [`-old ${i}`, `+new ${i}`]).flat(), 1),
      ]),
      file("second.txt", [
        hunk(
          Array.from({ length: 60 }, (_, i) => ` context ${i}`),
          300,
        ),
        hunk(Array.from({ length: 70 }, (_, i) => [`-gone ${i}`, `+added ${i}`]).flat(), 500),
      ]),
    ];
  }

  it("keeps a deep canonical content row across compression and multiple file/hunk headers", async () => {
    await mount(deepDiff());
    const anchor = await scrollTo([253, 0]);
    const previousPixels = editor().getElement().getScrollTop();
    await layout("side-by-side");
    assertAnchorAt(anchor, "new");
    expect(editor("new").getElement().getScrollTop()).toBeLessThan(previousPixels);
    const returning = canonicalAnchor("new");
    await layout("unified");
    assertAnchorAt(returning);
  });

  it("keeps a wrapped continuation visible when column widths change in either direction", async () => {
    const long = "source words ".repeat(48);
    await mount([
      file("wrapped.txt", [
        hunk(Array.from({ length: 90 }, (_, i) => [`-${i} ${long}`, `+${i} ${long}`]).flat(), 1),
      ]),
    ]);
    const anchor = await scrollTo([101, 250]);
    expect(anchor.bufferPosition.column).toBeGreaterThan(0);
    await layout("side-by-side");
    assertAnchorAt(anchor, "new");
    const returning = await scrollTo(
      [pair().projection.patchRowToDisplayRow.get(121), 300],
      "new",
      -4,
    );
    expect(returning.bufferPosition.column).toBeGreaterThan(0);
    await layout("unified");
    assertAnchorAt(returning);
  });

  it("anchors deleted content on the Before column and keeps that column active on return", async () => {
    await mount(deepDiff());
    const anchor = await scrollTo([252, 0]);
    await layout("side-by-side");
    expect(pair().activeSide).toBe("old");
    assertAnchorAt(anchor, "old");
    editor("old").getElement().focus();
    const returning = canonicalAnchor("old");
    await layout("unified");
    assertAnchorAt(returning);
    await layout("side-by-side");
    expect(pair().activeSide).toBe("old");
    expect(document.activeElement).toBe(editor("old").getElement());
  });

  it("uses the populated counterpart when the active column contains only a placeholder", async () => {
    const lines = [
      ...Array.from({ length: 80 }, (_, i) => ` before ${i}`),
      ...Array.from({ length: 40 }, (_, i) => `+addition ${i} ${"wrapped words ".repeat(20)}`),
      ...Array.from({ length: 80 }, (_, i) => ` after ${i}`),
    ];
    await mount([file("additions.txt", [hunk(lines, 1)])]);
    await layout("side-by-side");
    await scrollTo([95, 0], "new");
    pair().activeSide = "old";
    const anchor = pair().captureCanonicalScrollAnchor();
    expect(anchor.bufferPosition.row).toBeGreaterThanOrEqual(80);
    expect(anchor.side).toBe("new");
    await layout("unified");
    assertAnchorAt(anchor);
    await layout("side-by-side");
    assertAnchorAt(anchor, "new");
  });

  it("remembers wrapping per layout and the horizontal position of an unwrapped layout", async () => {
    await mount([
      file("wide.txt", [
        hunk(
          Array.from({ length: 90 }, (_, i) => ` context ${i} ${"content ".repeat(200)}`),
          1,
        ),
      ]),
    ]);
    editor().setSoftWrapped(false);
    await settle();
    const anchor = await scrollTo([55, 0]);
    editor().getElement().setScrollLeft(180);
    await settle();
    await layout("side-by-side");
    expect(editor("new").isSoftWrapped()).toBe(true);
    assertAnchorAt(anchor, "new");
    await layout("unified");
    expect(editor().isSoftWrapped()).toBe(false);
    expect(editor().getElement().getScrollLeft()).toBeCloseTo(180, 0);
    editor().setSelectedBufferRange(
      [
        [40, 3],
        [40, 9],
      ],
      { autoscroll: false },
    );
    const selections = view.getCanonicalSelectionRanges().map((range) => range.serialize());
    await layout("side-by-side");
    expect(view.getCanonicalSelectionRanges().map((range) => range.serialize())).toEqual(
      selections,
    );
  });

  it("releases the inherited Before anchor when the After column receives a wheel gesture", async () => {
    await mount(deepDiff());
    await scrollTo([252, 0]);
    await layout("side-by-side");
    expect(pair().activeSide).toBe("old");
    const before = editor("old").getElement().getScrollTop();
    for (const side of ["old", "new"]) editor(side).update({ smoothScrolling: false });
    pair().didMouseWheel("new", new WheelEvent("wheel", { deltaY: 120, cancelable: true }));
    await settle();
    expect(pair().initialScrollAnchor).toBeNull();
    expect(editor("old").getElement().getComponent().settlingScrollAnchor).toBeNull();
    const moved = editor("new").getElement().getScrollTop();
    expect(moved).toBeGreaterThan(before);
    pair().measureSharedHeaders();
    pair().wrapAlignment.synchronize();
    await settle();
    expect(editor("new").getElement().getScrollTop()).toBeCloseTo(moved, 0);
  });

  it("retains the mounted selection and viewport when layout requests arrive before painting", async () => {
    await mount(deepDiff());
    editor().setSoftWrapped(false);
    editor().setSelectedBufferRange(
      [
        [253, 2],
        [253, 5],
      ],
      { autoscroll: false },
    );
    const ranges = view.getCanonicalSelectionRanges().map((range) => range.serialize());
    const anchor = await scrollTo([253, 0]);
    await flushViews(() =>
      Promise.all([
        view.didChangeDiffView("side-by-side"),
        view.didChangeDiffView("unified"),
        view.didChangeDiffView("side-by-side"),
      ]),
    );
    await settle();
    expect(view.state.diffView).toBe("side-by-side");
    expect(editor("new").isSoftWrapped()).toBe(true);
    expect(view.getCanonicalSelectionRanges().map((range) => range.serialize())).toEqual(ranges);
    assertAnchorAt(anchor, "new");
  });

  it("anchors actual text when a short removed row's padding fills the Before viewport", async () => {
    const lines = [
      ...Array.from({ length: 80 }, (_, i) => ` before ${i}`),
      "-short removed row",
      `+${"lengthy new text ".repeat(140)}`,
      ...Array.from({ length: 80 }, (_, i) => ` after ${i}`),
    ];
    await mount([file("paired-wrap.txt", [hunk(lines, 1)])]);
    await layout("side-by-side");
    const anchor = await scrollTo([80, 400], "new");
    expect(pair().projection.rows[80].oldRow).toBe(80);
    pair().activeSide = "old";
    const paddingAnchor = pair().captureCanonicalScrollAnchor();
    expect(paddingAnchor.side).toBe("new");
    expect(paddingAnchor.bufferPosition.column).toBeGreaterThan(0);
    expect(paddingAnchor.bufferPosition).toEqual(anchor.bufferPosition);
    await layout("unified");
    assertAnchorAt(paddingAnchor);
  });

  it("drops an inherited projection anchor when a refreshed source snapshot replaces the rows", async () => {
    await mount(deepDiff());
    await scrollTo([253, 0]);
    await layout("side-by-side");
    expect(pair().initialScrollAnchor).not.toBeNull();
    const snapshot = pair().prepareForPatchUpdate();
    expect(pair().initialScrollAnchor).toBeNull();
    const raw = deepDiff();
    raw[0].hunks[0] = hunk(
      [...Array.from({ length: 30 }, (_, i) => ` fresh ${i}`), ...raw[0].hunks[0].lines],
      1,
    );
    const previousPatch = patch;
    patch = buildMultiFilePatch(raw, { largeDiffThreshold: Infinity });
    await flushViews(() => view.update({ ...view.props, multiFilePatch: patch }));
    previousPatch.dispose();
    await settle();
    expect(pair().initialScrollAnchor).toBeNull();
    expect(editor("new").getElement().getScrollTop()).toBeCloseTo(snapshot.viewport[1][0], 0);
  });

  it("restores an unwrapped Side by Side horizontal viewport after scoped wrapping initializes", async () => {
    lumine.config.set("editor.softWrap", true);
    await mount([
      file("wide-sides.txt", [
        hunk(
          Array.from({ length: 90 }, (_, i) => ` context ${i} ${"contents ".repeat(200)}`),
          1,
        ),
      ]),
    ]);
    await layout("side-by-side");
    editor("new").setSoftWrapped(false);
    await settle();
    const anchor = await scrollTo([55, 0], "new");
    editor("new").getElement().setScrollLeft(180);
    await settle();
    await layout("unified");
    assertAnchorAt(anchor);
    await layout("side-by-side");
    expect(editor("new").isSoftWrapped()).toBe(false);
    expect(editor("old").isSoftWrapped()).toBe(false);
    expect(editor("new").getElement().getScrollLeft()).toBeCloseTo(180, 0);
    expect(editor("old").getElement().getScrollLeft()).toBeCloseTo(180, 0);
  });
});
