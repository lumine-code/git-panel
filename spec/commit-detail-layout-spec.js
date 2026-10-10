/** @babel */
import path from "path";
import { Disposable, Range } from "lumine";
import CommitDetailView from "../lib/views/commit-detail-view";
import CommitDetailItem from "../lib/items/commit-detail-item";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function diff(filePath, oldValue, newValue) {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: 3,
        newStartLine: 1,
        newLineCount: 3,
        heading: "",
        lines: [" before", `-${oldValue}`, `+${newValue}`, " after"],
      },
    ],
  };
}

describe("commit detail diff layout", () => {
  let view;
  let patch;
  let container;
  let stylesheet;

  beforeEach(async () => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1000px; height: 400px;";
    jasmine.attachToDOM(container);
    patch = buildMultiFilePatch(
      [diff("first.txt", "first old", "first new"), diff("second.txt", "second old", "second new")],
      { largeDiffThreshold: Infinity },
    );
    const author = {
      getEmail: () => "author@example.com",
      getAvatarUrl: () => null,
    };
    view = new CommitDetailView({
      commit: {
        getMessageSubject: () => "Update both files",
        getMessageBody: () => "",
        getAuthorName: () => "Author",
        getAuthorDate: () => 1,
        getAuthor: () => author,
        getCoAuthors: () => [],
        getSha: () => "1234567890",
        getMultiFileDiff: () => patch,
      },
      currentRemote: { isGithubRepo: () => false },
      itemType: CommitDetailItem,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      surfaceCommit: () => {},
    });
    container.appendChild(view.element);
    await flushViews(async () => {});
    spyOn(controller(), "setDiffView").and.callThrough();
    await renderEditors();
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    patch?.dispose();
    patch = null;
    container.remove();
    stylesheet.dispose();
  });

  function controller() {
    return view.refPatchController.get();
  }

  function patchView() {
    return controller().refView.get();
  }

  function button(mode) {
    return view.element.querySelector(`[data-diff-view="${mode}"]`);
  }

  function selectedRanges() {
    return patchView()
      .getCanonicalSelectionRanges()
      .map((range) => range.serialize());
  }

  async function renderEditors() {
    await flushViews(async () => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const updates = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(updates);
  }

  async function clickLayout(mode) {
    await flushViews(() => {
      button(mode).click();
      return controller().setDiffView.calls.mostRecent().returnValue;
    });
    await flushViews(async () => {});
    await renderEditors();
  }

  function expectActiveLayout(mode) {
    for (const candidate of ["unified", "side-by-side"]) {
      expect(button(candidate).classList.contains("selected")).toBe(candidate === mode);
      expect(button(candidate).classList.contains("active")).toBe(false);
      expect(button(candidate).getAttribute("aria-pressed")).toBe(String(candidate === mode));
    }
  }

  function expectOneHeaderToggle() {
    const header = view.element.querySelector(
      ".git-panel-CommitDetailView-header.native-key-bindings",
    );
    const toggles = view.element.querySelectorAll(".git-panel-DiffViewToggle");
    expect(toggles.length).toBe(1);
    expect(header.contains(toggles[0])).toBe(true);
    expect(
      view.element.querySelectorAll(".git-panel-FilePatchView-header [data-diff-view]").length,
    ).toBe(0);
  }

  it("defaults to unified with one accessible layout toggle in the commit header", () => {
    expect(controller().getDiffView()).toBe("unified");
    expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(1);
    expect(view.element.querySelectorAll(".git-panel-FilePatchView-header").length).toBe(2);
    expectOneHeaderToggle();
    const toggle = view.element.querySelector(".git-panel-DiffViewToggle");
    expect(toggle.getAttribute("role")).toBe("group");
    expect(toggle.getAttribute("aria-label")).toBe("Diff view");
    expect(button("unified").textContent).toBe("Unified");
    expect(button("side-by-side").textContent).toBe("Side by Side");
    expectActiveLayout("unified");
  });

  it("switches the complete multiple-file diff and updates the commit header in both directions", async () => {
    await clickLayout("side-by-side");
    expect(controller().setDiffView).toHaveBeenCalledWith("side-by-side");
    expect(controller().getDiffView()).toBe("side-by-side");
    expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(2);
    const pair = patchView().refSideBySide.get();
    expect(pair.editors.old.get().getText()).toContain("first old");
    expect(pair.editors.old.get().getText()).toContain("second old");
    expect(pair.editors.new.get().getText()).toContain("first new");
    expect(pair.editors.new.get().getText()).toContain("second new");
    expectOneHeaderToggle();
    expectActiveLayout("side-by-side");

    await clickLayout("unified");
    expect(controller().setDiffView).toHaveBeenCalledWith("unified");
    expect(controller().getDiffView()).toBe("unified");
    expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(1);
    expect(patchView().refEditor.get().getBuffer()).toBe(patch.getBuffer());
    expectOneHeaderToggle();
    expectActiveLayout("unified");
  });

  it("guards mouse presses and preserves the selected patch rows and editor focus while switching", async () => {
    const editor = patchView().refEditor.get();
    editor.setSelectedBufferRange(new Range([1, 0], [1, Infinity]), { autoscroll: false });
    editor.getElement().focus();
    await flushViews(async () => {});
    const expectedRanges = selectedRanges();
    const expectedRows = Array.from(controller().state.selectedRows);
    const mouseDown = jasmine.createSpy("commit header mouse down");
    view.element.addEventListener("mousedown", mouseDown);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button("side-by-side").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mouseDown).not.toHaveBeenCalled();
    expect(editor.getElement().contains(document.activeElement)).toBe(true);
    expect(selectedRanges()).toEqual(expectedRanges);

    await clickLayout("side-by-side");
    expect(selectedRanges()).toEqual(expectedRanges);
    expect(Array.from(controller().state.selectedRows)).toEqual(expectedRows);
    const oldEditor = patchView().refSideBySide.get().editors.old.get();
    expect(oldEditor.getElement().contains(document.activeElement)).toBe(true);
    await clickLayout("unified");
    expect(selectedRanges()).toEqual(expectedRanges);
    expect(Array.from(controller().state.selectedRows)).toEqual(expectedRows);
    expect(patchView().refEditor.get().getElement().contains(document.activeElement)).toBe(true);
  });

  it("keeps keyboard focus in the header when a focused layout button activates", async () => {
    button("side-by-side").focus();
    await clickLayout("side-by-side");
    expect(document.activeElement).toBe(button("side-by-side"));
    expectActiveLayout("side-by-side");
    button("unified").focus();
    await clickLayout("unified");
    expect(document.activeElement).toBe(button("unified"));
    expectActiveLayout("unified");
  });
});
