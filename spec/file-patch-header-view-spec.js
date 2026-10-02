/** @babel */
import FilePatchHeaderView from "../lib/views/file-patch-header-view";
import ChangedFileItem from "../lib/items/changed-file-item";
import CommitDetailItem from "../lib/items/commit-detail-item";
import { flushViews } from "./helpers/etch";

describe("file patch header diff layout", () => {
  let view;

  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  function createView(props = {}) {
    view = new FilePatchHeaderView({
      itemType: ChangedFileItem,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      ...props,
    });
    jasmine.attachToDOM(view.element);
    return view;
  }

  function layoutButton(mode) {
    return view.element.querySelector(`[data-diff-view="${mode}"]`);
  }

  it("starts in unified view and exposes both layouts as accessible toggle buttons", () => {
    createView();
    const group = view.element.querySelector(".git-panel-FilePatchView-layoutToggle");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Diff view");
    expect(layoutButton("unified").classList.contains("active")).toBe(true);
    expect(layoutButton("unified").getAttribute("aria-pressed")).toBe("true");
    expect(layoutButton("side-by-side").classList.contains("active")).toBe(false);
    expect(layoutButton("side-by-side").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the pressed state when its controlled layout changes", async () => {
    createView();
    await flushViews(() => view.update({ ...view.props, diffView: "side-by-side" }));
    expect(layoutButton("unified").classList.contains("active")).toBe(false);
    expect(layoutButton("unified").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("side-by-side").classList.contains("active")).toBe(true);
    expect(layoutButton("side-by-side").getAttribute("aria-pressed")).toBe("true");
  });

  it("offers the layout toggle in commit detail headers without staging actions", () => {
    const onDiffViewChange = jasmine.createSpy("change diff layout");
    createView({ itemType: CommitDetailItem, onDiffViewChange });
    layoutButton("side-by-side").click();
    layoutButton("unified").click();
    expect(onDiffViewChange.calls.allArgs()).toEqual([["side-by-side"], ["unified"]]);
    expect(view.element.querySelectorAll(".btn-group").length).toBe(1);
  });

  it("keeps layout mouse presses out of the editor's selection handling", () => {
    createView();
    const mouseDown = jasmine.createSpy("editor mouse down");
    view.element.addEventListener("mousedown", mouseDown);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    layoutButton("side-by-side").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mouseDown).not.toHaveBeenCalled();
  });
});
