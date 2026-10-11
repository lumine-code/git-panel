/** @babel */
import path from "path";
import { CompositeDisposable, Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import PaneItemHost from "../lib/items/pane-item-host";
import { buildMultiFilePatch } from "../lib/models/patch";
import adapter from "../lib/navigation-adapter";
import { flushViews } from "./helpers/etch";

function diff(filePath, hunks = [1, 20], overrides = {}) {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks: hunks.map((line) => ({
      oldStartLine: line,
      newStartLine: line,
      oldLineCount: 2,
      newLineCount: 2,
      heading: `${filePath} section ${line}`,
      lines: [" context", "-before", "+after"],
    })),
    ...overrides,
  };
}

describe("patch navigation outline", () => {
  let view, container, stylesheet, subscriptions, host;
  const patches = [];

  beforeEach(() => {
    subscriptions = new CompositeDisposable();
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 300px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    lumine.config.unset("editor.scrollZone");
    subscriptions.dispose();
    host?.destroy();
    host = null;
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
    container.remove();
    stylesheet.dispose();
  });

  function build(files, options) {
    const patch = buildMultiFilePatch(files, options);
    patches.push(patch);
    return patch;
  }

  async function paint() {
    await flushViews(() => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const pending = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(pending);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function mount(patch, layout) {
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      initialDiffView: layout,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      stagingStatus: "unstaged",
      selectedRows: new Set(),
      selectionMode: "hunk",
      selectedRowsChanged: () => {},
      toggleRows: () => {},
      discardRows: () => {},
      toggleFile: () => {},
      toggleModeChange: () => {},
      toggleSymlinkChange: () => {},
      openFile: () => {},
      surface: () => {},
      undoLastDiscard: () => {},
      diveIntoMirrorPatch: () => {},
    });
    container.append(view.element);
    await paint();
    await paint();
  }

  it("reveals next and previous unified hunks through the native editor", async () => {
    const patch = build([diff("file.txt")]);
    await mount(patch, "unified");
    const [first, second] = patch.getFilePatches()[0].getHunks();
    const editor = view.refEditor.get();
    view.setCanonicalSelectionRanges([first.getRange()], { autoscroll: false });
    const requested = jasmine.createSpy("native hunk reveal");
    subscriptions.add(editor.onDidRequestAutoscroll(requested));

    await flushViews(() => view.selectNextHunk());
    expect(editor.getSelectedBufferRange()).toEqual(second.getRange());
    expect(requested.calls.mostRecent().args[0].options.mode).toEqual(editor.getScrollZone());

    await flushViews(() => view.selectPreviousHunk());
    expect(editor.getSelectedBufferRange()).toEqual(first.getRange());
    expect(requested.calls.mostRecent().args[0].options.mode).toEqual(editor.getScrollZone());
  });

  for (const layout of ["unified", "side-by-side"]) {
    it(`lists hidden hunks and reveals only the chosen file in ${layout}`, async () => {
      const patch = build([diff("first.txt"), diff("second.txt")], { largeDiffThreshold: 1 });
      await mount(patch, layout);
      let headers;
      subscriptions.add(view.observeNavigationHeaders((next) => (headers = next)));
      expect(headers.map((header) => header.text)).toEqual(["first.txt", "second.txt"]);
      expect(headers.map((header) => header.children.length)).toEqual([2, 2]);
      expect(headers[1].children[1].text).toBe("@@ -20,2 +20,2 @@ second.txt section 20");
      expect(headers[1].children[1].startPoint).toBeUndefined();
      expect(patch.getBuffer().isEmpty()).toBe(true);
      expect(view.getScrollmapState().markers.filter((marker) => marker.level === 2)).toEqual([]);
      const input = document.createElement("input");
      container.append(input);
      input.focus();
      await flushViews(() =>
        view.navigateToNavigationHeader(headers[1].children[1], { focus: false }),
      );
      await paint();
      const [first, second] = patch.getFilePatches();
      expect(first.getRenderStatus().isVisible()).toBe(false);
      expect(second.getRenderStatus().isVisible()).toBe(true);
      expect(headers[1].children.map((header) => header.text)).toEqual(
        Array.from(view.element.querySelectorAll(".git-panel-HunkHeaderView-title"), (element) =>
          element.textContent.trim(),
        ),
      );
      expect(view.getCanonicalSelectionRanges()).toEqual([second.getHunks()[1].getRange()]);
      expect(document.activeElement).toBe(input);
      expect(headers[1].children[1].currentCount).toBe(1);
      expect(headers[1].stackCount).toBe(1);
      const state = view.getScrollmapState();
      const hunkMarkers = state.markers.filter((marker) => marker.level === 2);
      expect(hunkMarkers.length).toBe(2);
      expect(hunkMarkers[1].current).toBe(true);
      expect(hunkMarkers[1].end).toBeGreaterThan(hunkMarkers[1].top);
      const ids = headers[1].children.map((header) => header.id);
      await flushViews(() => view.changePatchRenderStatus(second, false));
      expect(headers[1].children.map((header) => header.id)).toEqual(ids);
      await flushViews(() => view.navigateToNavigationHeader(headers[1].children[0]));
      expect(view.getCanonicalSelectionRanges()).toEqual([second.getHunks()[0].getRange()]);
      expect(view.element.contains(document.activeElement)).toBe(true);
    });

    it(`reveals the exact no-content file header without loading it in ${layout}`, async () => {
      lumine.config.set("editor.scrollZone", [40]);
      const files = Array.from({ length: 24 }, (_, index) => diff(`empty-${index}.txt`, []));
      files.push(diff("large.txt"));
      const patch = build(files, { largeDiffThreshold: 1 });
      await mount(patch, layout);
      const headers = view.getNavigationHeaders();
      const fileMarkers = view.getScrollmapState().markers.filter((marker) => marker.level === 1);
      expect(fileMarkers.length).toBe(files.length);
      expect(new Set(fileMarkers.map((marker) => marker.top)).size).toBe(files.length);
      const target = headers[10];
      const file = patch.getFilePatches()[10];
      await flushViews(() => view.navigateToNavigationHeader(target, { focus: false }));
      await paint();
      const pair = view.refSideBySide.getOr(null);
      const element = pair
        ? pair.sharedHeaderRecords.get(file).element
        : view.fileHeaderDecorations.get(file).content;
      const editorElement = pair
        ? pair.editors[pair.activeSide].get().getElement()
        : view.refEditor.get().getElement();
      const spacer = pair
        ? pair.sharedHeaderRecords.get(file).spacers[pair.activeSide]
        : view.fileHeaderDecorations.get(file).spacer;
      const component = editorElement.getComponent();
      const spacerBounds = spacer.getBoundingClientRect();
      const margin = component.getVerticalAutoscrollMargin();
      const travel = component.getScrollContainerClientHeight() - 2 * margin - spacerBounds.height;
      const zoneOffset = margin + travel * 0.4;
      const paintedOffset = spacerBounds.top - editorElement.getBoundingClientRect().top;
      // Native painting quantizes scrolling to physical pixels.
      expect(Math.abs(paintedOffset - zoneOffset)).toBeLessThanOrEqual(
        1 / (window.devicePixelRatio || 1) + 0.01,
      );
      const difference =
        element.getBoundingClientRect().top - editorElement.getBoundingClientRect().top;
      expect(difference).toBeGreaterThanOrEqual(-3);
      expect(element.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        editorElement.getBoundingClientRect().bottom + 3,
      );
      expect(patch.getFilePatches().at(-1).getRenderStatus().isVisible()).toBe(false);
      expect(view.getNavigationHeaders()[10].currentCount).toBe(1);
    });

    it(`rejects old headers after replacing the patch in ${layout}`, async () => {
      const patch = build([diff("old.txt")]);
      await mount(patch, layout);
      const oldHeader = view.getNavigationHeaders()[0].children[1];
      let latest;
      const callback = jasmine.createSpy("headers").and.callFake((headers) => (latest = headers));
      const observation = view.observeNavigationHeaders(callback);
      subscriptions.add(observation);
      const next = build([diff("new.txt", [50])]);
      await flushViews(() => view.update({ ...view.props, multiFilePatch: next }));
      await paint();
      expect(latest[0].text).toBe("new.txt");
      expect(latest[0].children.length).toBe(1);
      const selections = view.getCanonicalSelectionRanges();
      await view.navigateToNavigationHeader(oldHeader);
      expect(view.getCanonicalSelectionRanges()).toEqual(selections);
      observation.dispose();
      callback.calls.reset();
      await flushViews(() => view.changePatchRenderStatus(next.getFilePatches()[0], false));
      expect(callback).not.toHaveBeenCalled();
    });

    it(`publishes one outline change per hunk jump and follows the cursor in ${layout}`, async () => {
      const patch = build([diff("example.txt")]);
      await mount(patch, layout);
      const callback = jasmine.createSpy("headers");
      subscriptions.add(view.observeNavigationHeaders(callback));
      callback.calls.reset();
      const target = view.getNavigationHeaders()[0].children[1];
      await flushViews(() => view.navigateToNavigationHeader(target, { focus: false }));
      await paint();
      expect(callback).toHaveBeenCalledTimes(1);
      const hunk = patch.getFilePatches()[0].getHunks()[1];
      const pair = view.refSideBySide.getOr(null);
      callback.calls.reset();
      await flushViews(() => {
        if (pair) pair.goToPatchPosition({ row: hunk.getRange().start.row, column: 1 });
        else view.refEditor.get().setCursorBufferPosition([hunk.getRange().start.row, 1]);
      });
      expect(callback).not.toHaveBeenCalled();
      await flushViews(() => {
        const first = patch.getFilePatches()[0].getHunks()[0].getRange().start;
        if (pair) pair.goToPatchPosition(first);
        else view.refEditor.get().setCursorBufferPosition(first);
      });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.calls.mostRecent().args[0][0].children[0].currentCount).toBe(1);
    });
  }

  it("keeps renamed and binary files without inventing hunks", async () => {
    const patch = build([
      diff("before.txt", [], { newPath: "after.txt", status: "renamed" }),
      diff("binary.bin", [], { binary: true }),
    ]);
    await mount(patch, "unified");
    expect(view.getNavigationHeaders().map(({ text, children }) => ({ text, children }))).toEqual([
      { text: "before.txt → after.txt", children: [] },
      { text: "binary.bin", children: [] },
    ]);
  });

  it("retains a remaining hunk's identity when a preceding hunk disappears", async () => {
    await mount(build([diff("example.txt")]), "unified");
    const id = view.getNavigationHeaders()[0].children[1].id;
    const next = build([diff("example.txt", [20])]);
    await flushViews(() => view.update({ ...view.props, multiFilePatch: next }));
    expect(view.getNavigationHeaders()[0].children[0].id).toBe(id);
  });

  it("uses the same chunk title for an empty or whitespace-padded section heading", async () => {
    const file = diff("example.txt");
    file.hunks[0].heading = "";
    file.hunks[1].heading = "  section heading  ";
    await mount(build([file]), "unified");
    const titles = Array.from(
      view.element.querySelectorAll(".git-panel-HunkHeaderView-title"),
      (element) => element.textContent,
    );
    expect(titles).toEqual(["@@ -1,2 +1,2 @@", "@@ -20,2 +20,2 @@ section heading"]);
    expect(view.getNavigationHeaders()[0].children.map((header) => header.text)).toEqual(titles);
  });

  it("subscribes after hydration and cancels a disposed hydration observer", async () => {
    host = PaneItemHost.create("git-patch");
    const callback = jasmine.createSpy("headers");
    const observation = adapter.observeHeaders(host, callback);
    expect(adapter.handlesItem(host)).toBe(true);
    expect(callback).toHaveBeenCalledWith([], { instant: true });
    observation.dispose();
    const observeNavigationHeaders = jasmine
      .createSpy("observe headers")
      .and.returnValue(new Disposable());
    host.hydrate({ observeNavigationHeaders });
    await globalThis.flushMicrotasks();
    expect(observeNavigationHeaders).not.toHaveBeenCalled();
    const gitHost = PaneItemHost.create("git");
    expect(adapter.handlesItem(gitHost)).toBe(false);
    gitHost.destroy();
  });

  it("populates an already active host when its view hydrates and releases its observer", async () => {
    host = PaneItemHost.create("git-patch");
    const callback = jasmine.createSpy("headers");
    const observation = adapter.observeHeaders(host, callback);
    const patch = build([diff("hydrated.txt")]);
    await mount(patch, "unified");
    host.hydrate(view);
    await globalThis.flushMicrotasks();
    expect(callback.calls.mostRecent().args[0][0].text).toBe("hydrated.txt");
    expect(view.navigationObserverCount).toBe(1);
    observation.dispose();
    expect(view.navigationObserverCount).toBe(0);
  });

  it("integrates search and next-header with Navigation Panel through the service", async () => {
    const patch = build([diff("first.txt"), diff("second.txt")]);
    await mount(patch, "side-by-side");
    host = PaneItemHost.create("git-patch");
    host.getElement().append(view.element);
    host.hydrate({
      observeNavigationHeaders: (callback) => view.observeNavigationHeaders(callback),
      navigateToNavigationHeader: (header, options) =>
        view.navigateToNavigationHeader(header, options),
    });
    subscriptions.add(lumine.packages.serviceHub.provide("navigation.adapter", "1.0.0", adapter));
    const pkg = await lumine.packages.activatePackage("navigation-panel");
    const main = pkg.mainModule;
    const tree = main.getNavigationTree();
    await lumine.workspace.open(host);
    await flushViews(() => {});
    expect(main.headers.map((header) => header.text)).toEqual(["first.txt", "second.txt"]);
    await flushViews(() => main.headers[0].children[0].navigate({ focus: false }));
    await flushViews(() => main.navigateHeader(1));
    expect(view.getCanonicalSelectionRanges()).toEqual([
      patch.getFilePatches()[0].getHunks()[1].getRange(),
    ]);
    tree.searchQuery = "section";
    await flushViews(() => {
      tree.filter();
      return tree.update(main.headers, { instant: true });
    });
    expect(tree.element.querySelectorAll(".navigation-text").length).toBe(4);
    expect(new Set(tree.searches.map((header) => header.id)).size).toBe(4);
    await lumine.packages.deactivatePackage("navigation-panel");
  });
});
